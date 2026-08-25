import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { db } from '@/lib/db';
import { wrap, getCtx, requirePerm, ApiError } from '@/lib/api';
import { logAudit } from '@/lib/audit';

export const dynamic = 'force-dynamic';

const patchSchema = z.object({
  kpiName: z.string().min(1).max(300).optional(),
  description: z.string().max(3000).optional(),
  calculationMethod: z.string().max(2000).optional(),
  varianceIndicator: z.enum(['U', 'D']).optional(),
  matrix: z.string().max(200).optional(),
  defaultTarget: z.number().nullable().optional(),
  targetText: z.string().max(300).optional(),
  responsibleDepartmentText: z.string().max(200).optional(),
  defaultThreshold: z.number().nullable().optional(),
  defaultWeight: z.number().min(0).max(100).nullable().optional(),
  frequency: z.string().max(50).optional(),
  responsibleDepartmentId: z.string().nullable().optional(),
  formOfSubmission: z.string().max(500).optional(),
  scoreCap: z.number().min(100).max(1000).optional(),
  zeroActualIsPerfect: z.boolean().optional(),
  isActive: z.boolean().optional(),
});

/**
 * Permanent removal, for KPIs created by mistake. Anything that has ever been
 * scored is refused: those rows are somebody's appraisal history, and
 * deactivating hides a KPI from future months without erasing the past.
 */
export const DELETE = wrap(async (req: NextRequest, { params }: { params: { id: string } }) => {
  const ctx = await getCtx(req);
  requirePerm(ctx, 'kpi_library.manage');
  if (ctx.user.systemRole !== 'SUPER_ADMIN' && ctx.user.systemRole !== 'ADMIN') {
    throw new ApiError(403, 'Only an Admin or Super Admin can delete a KPI.');
  }

  const kpi = await db.kpi.findUnique({
    where: { id: params.id },
    include: { _count: { select: { assignments: true } } },
  });
  if (!kpi) throw new ApiError(404, 'KPI not found.');

  const submissionCount = await db.kpiSubmission.count({
    where: { kpiAssignment: { kpiId: kpi.id } },
  });
  if (submissionCount > 0) {
    throw new ApiError(
      409,
      `${kpi.kpiCode} has ${submissionCount} recorded result${submissionCount === 1 ? '' : 's'} and cannot be deleted - that is scored history. Deactivate it instead to stop it appearing in future months.`,
      'HAS_SUBMISSIONS'
    );
  }

  await db.$transaction(async (tx) => {
    // Assignments without results carry nothing worth keeping once the KPI goes.
    await tx.kpiAssignment.deleteMany({ where: { kpiId: kpi.id } });
    await tx.kpi.delete({ where: { id: kpi.id } });
    await logAudit(tx, {
      userId: ctx.user.id,
      action: 'KPI_DELETED',
      entityType: 'Kpi',
      entityId: kpi.id,
      oldValues: {
        kpiCode: kpi.kpiCode,
        kpiName: kpi.kpiName,
        description: kpi.description,
        varianceIndicator: kpi.varianceIndicator,
        targetText: kpi.targetText,
        responsibleDepartmentText: kpi.responsibleDepartmentText,
        assignmentsRemoved: kpi._count.assignments,
      },
      ipAddress: ctx.ip,
      userAgent: ctx.ua,
    });
  });

  return NextResponse.json({
    ok: true,
    deleted: kpi.kpiCode,
    assignmentsRemoved: kpi._count.assignments,
  });
});

export const PATCH = wrap(async (req: NextRequest, { params }: { params: { id: string } }) => {
  const ctx = await getCtx(req);
  requirePerm(ctx, 'kpi_library.manage');
  const body = patchSchema.parse(await req.json());

  const kpi = await db.kpi.findUnique({ where: { id: params.id } });
  if (!kpi) throw new ApiError(404, 'KPI not found.');

  await db.$transaction(async (tx) => {
    await tx.kpi.update({ where: { id: kpi.id }, data: body });
    await logAudit(tx, {
      userId: ctx.user.id,
      action: 'KPI_UPDATED',
      entityType: 'Kpi',
      entityId: kpi.id,
      oldValues: {
        kpiName: kpi.kpiName,
        varianceIndicator: kpi.varianceIndicator,
        scoreCap: kpi.scoreCap,
        isActive: kpi.isActive,
      },
      newValues: body,
      ipAddress: ctx.ip,
      userAgent: ctx.ua,
    });
  });
  return NextResponse.json({ ok: true });
});
