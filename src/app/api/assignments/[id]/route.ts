import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { db } from '@/lib/db';
import { wrap, getCtx, requirePerm, ApiError } from '@/lib/api';
import { logAudit } from '@/lib/audit';
import { round2 } from '@/lib/scoring';
import { rescoreOpenSubmissions } from '@/lib/submissions';
import { notifyUsers, complianceUserIds } from '@/lib/notify';

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

  let rescored: { id: string }[] = [];
  let editRequestId: string | null = null;

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

    if (targetOrThresholdChanged) {
      rescored = await rescoreOpenSubmissions(
        tx,
        {
          ...assignment,
          kpi: {
            varianceIndicator: assignment.kpi.varianceIndicator as 'U' | 'D',
            matrixType: assignment.kpi.matrixType as 'UNIT' | 'TIME' | 'PERCENTAGE',
          },
        },
        { target: newTarget, threshold: newThreshold, weight: newWeight }
      );
    }

    // A department head's edit is applied immediately like any other, but
    // flagged for Compliance to review - see EditRequest in schema.prisma.
    // Reject reverts these same fields and rescores the same way; approve
    // just clears the flag, nothing about the applied values changes.
    if (canManageOwnDept) {
      const changedFields = ['target', 'threshold', 'weight'] as const;
      const oldValues: Record<string, number> = {};
      const newValues: Record<string, number> = {};
      for (const f of changedFields) {
        if (body[f] !== undefined && body[f] !== assignment[f]) {
          oldValues[f] = assignment[f];
          newValues[f] = body[f]!;
        }
      }
      if (Object.keys(newValues).length > 0) {
        const editRequest = await tx.editRequest.create({
          data: {
            entityType: 'KpiAssignment',
            entityId: assignment.id,
            oldValues: JSON.stringify(oldValues),
            newValues: JSON.stringify(newValues),
            requestedByUserId: ctx.user.id,
          },
        });
        editRequestId = editRequest.id;
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
        editRequestId,
      },
      ipAddress: ctx.ip,
      userAgent: ctx.ua,
    });
  });

  if (editRequestId) {
    const approvers = await complianceUserIds();
    await notifyUsers(db, approvers, {
      type: 'EDIT_PENDING_COMPLIANCE_REVIEW',
      title: 'Assignment edit awaiting Compliance review',
      message: `${ctx.user.fullName} edited ${assignment.kpi.kpiCode} for ${assignment.employee.fullName}.`,
      entityType: 'KpiAssignment',
      entityId: assignment.id,
      link: '/admin',
    });
  }

  return NextResponse.json({ ok: true, rescoredSubmissions: rescored.length, editRequestId });
});
