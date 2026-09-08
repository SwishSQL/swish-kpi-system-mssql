import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { db } from '@/lib/db';
import { wrap, getCtx, requirePerm, ApiError } from '@/lib/api';
import { logAudit } from '@/lib/audit';
import { round2, computeScore, performanceStatus, weightedScore } from '@/lib/scoring';

export const dynamic = 'force-dynamic';

const patchSchema = z.object({
  target: z.number().optional(),
  threshold: z.number().optional(),
  weight: z.number().min(0).max(100).optional(),
  frequency: z.string().max(50).optional(),
  formOfSubmission: z.string().max(500).optional(),
  effectiveTo: z.string().nullable().optional(),
  isActive: z.boolean().optional(),
});

/**
 * Takes one KPI off one employee for good. An assignment with results recorded
 * against it is refused: those rows are that person's appraisal history, and
 * deactivating drops the KPI from future months without erasing the past.
 */
export const DELETE = wrap(async (req: NextRequest, { params }: { params: { id: string } }) => {
  const ctx = await getCtx(req);
  requirePerm(ctx, 'kpi_assignments.manage');

  const assignment = await db.kpiAssignment.findUnique({
    where: { id: params.id },
    include: {
      kpi: true,
      employee: true,
      _count: { select: { submissions: true } },
    },
  });
  if (!assignment) throw new ApiError(404, 'Assignment not found.');

  if (assignment._count.submissions > 0) {
    const n = assignment._count.submissions;
    throw new ApiError(
      409,
      `${assignment.kpi.kpiCode} has ${n} recorded result${n === 1 ? '' : 's'} for ${assignment.employee.fullName} and cannot be deleted - that is scored history. Deactivate it instead to drop it from future months.`,
      'HAS_SUBMISSIONS'
    );
  }

  await db.$transaction(async (tx) => {
    await tx.kpiAssignment.delete({ where: { id: assignment.id } });
    await logAudit(tx, {
      userId: ctx.user.id,
      action: 'ASSIGNMENT_DELETED',
      entityType: 'KpiAssignment',
      entityId: assignment.id,
      oldValues: {
        employeeId: assignment.employee.employeeId,
        employeeName: assignment.employee.fullName,
        kpiCode: assignment.kpi.kpiCode,
        kpiName: assignment.kpi.kpiName,
        year: assignment.year,
        target: assignment.target,
        threshold: assignment.threshold,
        weight: assignment.weight,
      },
      ipAddress: ctx.ip,
      userAgent: ctx.ua,
    });
  });

  // Removing a weight changes what the employee's remaining weights add up to.
  const remaining = await db.kpiAssignment.findMany({
    where: { employeeProfileId: assignment.employeeProfileId, year: assignment.year, isActive: true },
    select: { weight: true },
  });
  const totalWeight = round2(remaining.reduce((s, a) => s + a.weight, 0));

  return NextResponse.json({
    ok: true,
    removed: `${assignment.kpi.kpiCode} from ${assignment.employee.fullName}`,
    employeeName: assignment.employee.fullName,
    remainingKpis: remaining.length,
    totalWeight,
    weightsValid: Math.abs(totalWeight - 100) < 0.01,
  });
});

/**
 * Full kpi_assignments.manage rights edit any assignment, same as always. A
 * department head with none of that may still edit, but only an assignment
 * whose employee belongs to a department they manage - the same boundary
 * already enforced on assigning someone in the first place.
 */
export const PATCH = wrap(async (req: NextRequest, { params }: { params: { id: string } }) => {
  const ctx = await getCtx(req);
  const canManageAny = ctx.perms.has('kpi_assignments.manage');
  const canManageOwnDept = !canManageAny && ctx.managedDepartmentIds.length > 0;
  if (!canManageAny && !canManageOwnDept) {
    throw new ApiError(403, 'You do not have permission to perform this action.');
  }
  const body = patchSchema.parse(await req.json());

  const assignment = await db.kpiAssignment.findUnique({
    where: { id: params.id },
    include: { employee: true, kpi: true },
  });
  if (!assignment) throw new ApiError(404, 'Assignment not found.');

  if (canManageOwnDept) {
    if (!assignment.employee.departmentId || !ctx.managedDepartmentIds.includes(assignment.employee.departmentId)) {
      throw new ApiError(403, 'You can only edit assignments for someone in a department you manage.');
    }
  }

  const newTarget = body.target ?? assignment.target;
  const newThreshold = body.threshold ?? assignment.threshold;
  const newWeight = body.weight ?? assignment.weight;
  const targetOrThresholdChanged =
    (body.target !== undefined && body.target !== assignment.target) ||
    (body.threshold !== undefined && body.threshold !== assignment.threshold);

  const rescored: { id: string }[] = [];

  await db.$transaction(async (tx) => {
    await tx.kpiAssignment.update({
      where: { id: assignment.id },
      data: {
        target: body.target,
        threshold: body.threshold,
        weight: body.weight,
        frequency: body.frequency,
        formOfSubmission: body.formOfSubmission,
        effectiveTo:
          body.effectiveTo === undefined
            ? undefined
            : body.effectiveTo
              ? new Date(body.effectiveTo)
              : null,
        isActive: body.isActive,
      },
    });

    // The target/threshold just changed under whatever hasn't been signed off
    // yet - a correction to the number, not a resubmission, so version and
    // stage are left untouched and approved/locked history is never rewritten.
    if (targetOrThresholdChanged) {
      const open = await tx.kpiSubmission.findMany({
        where: { kpiAssignmentId: assignment.id, stage: { not: 'APPROVED' } },
      });
      for (const s of open) {
        const score = computeScore({
          variance: assignment.kpi.varianceIndicator as 'U' | 'D',
          actual: s.normalizedActualResult,
          target: newTarget,
          matrixType: assignment.kpi.matrixType as 'UNIT' | 'TIME' | 'PERCENTAGE',
        });
        const perf = performanceStatus(
          assignment.kpi.varianceIndicator as 'U' | 'D',
          s.normalizedActualResult,
          newTarget,
          newThreshold
        );
        const weighted = weightedScore(score, newWeight);
        await tx.kpiSubmission.update({
          where: { id: s.id },
          data: { calculatedScore: score, weightedScore: weighted, performanceStatus: perf },
        });
        rescored.push({ id: s.id });
      }
    }

    await logAudit(tx, {
      userId: ctx.user.id,
      action: 'ASSIGNMENT_UPDATED',
      entityType: 'KpiAssignment',
      entityId: assignment.id,
      oldValues: {
        target: assignment.target,
        threshold: assignment.threshold,
        weight: assignment.weight,
        isActive: assignment.isActive,
      },
      newValues: {
        ...body,
        rescoredSubmissions: rescored.length,
      },
      ipAddress: ctx.ip,
      userAgent: ctx.ua,
    });
  });
  return NextResponse.json({ ok: true, rescoredSubmissions: rescored.length });
});
