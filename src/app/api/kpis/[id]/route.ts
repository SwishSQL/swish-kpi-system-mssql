import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { db } from '@/lib/db';
import { wrap, getCtx, requirePerm, ApiError } from '@/lib/api';
import { logAudit } from '@/lib/audit';
import { notifyUsers, complianceUserIds } from '@/lib/notify';

// Fields a department head may edit for their own department's KPI. Moving a
// KPI to a different department or (de)activating it stays manage-only - those
// are library-administration actions, not "editing this KPI's own definition."
const DEPARTMENT_HEAD_EDITABLE_FIELDS = [
  'kpiName',
  'description',
  'calculationMethod',
  'varianceIndicator',
  'matrixType',
  'defaultTarget',
  'targetText',
  'defaultThreshold',
  'defaultWeight',
  'frequency',
  'formOfSubmission',
] as const;

export const dynamic = 'force-dynamic';

const patchSchema = z.object({
  kpiName: z.string().min(1).max(300).optional(),
  description: z.string().max(3000).optional(),
  calculationMethod: z.string().max(2000).optional(),
  varianceIndicator: z.enum(['U', 'D']).optional(),
  matrixType: z.enum(['UNIT', 'TIME', 'PERCENTAGE']).optional(),
  defaultTarget: z.number().nullable().optional(),
  targetText: z.string().max(300).optional(),
  defaultThreshold: z.number().nullable().optional(),
  defaultWeight: z.number().min(0).max(100).nullable().optional(),
  frequency: z.string().max(50).optional(),
  responsibleDepartmentId: z.string().nullable().optional(),
  formOfSubmission: z.string().max(500).optional(),
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

/**
 * Full kpi_library.manage rights edit any KPI, same as always. A department
 * head with none of that may edit a KPI belonging to their own department -
 * but only once it is APPROVED (a still-pending proposal is corrected by
 * rejecting/resubmitting, not through this path), and only the fields that
 * describe the KPI itself, not its department or active status.
 */
export const PATCH = wrap(async (req: NextRequest, { params }: { params: { id: string } }) => {
  const ctx = await getCtx(req);
  const canManageAny = ctx.perms.has('kpi_library.manage');
  const canManageOwnDept = !canManageAny && ctx.managedDepartmentIds.length > 0;
  if (!canManageAny && !canManageOwnDept) {
    throw new ApiError(403, 'You do not have permission to perform this action.');
  }
  const body = patchSchema.parse(await req.json());

  const kpi = await db.kpi.findUnique({ where: { id: params.id } });
  if (!kpi) throw new ApiError(404, 'KPI not found.');

  if (canManageOwnDept) {
    if (!kpi.responsibleDepartmentId || !ctx.managedDepartmentIds.includes(kpi.responsibleDepartmentId)) {
      throw new ApiError(403, 'You can only edit a KPI that belongs to a department you manage.');
    }
    if (kpi.approvalStatus !== 'APPROVED') {
      throw new ApiError(409, 'A still-pending proposal is corrected by rejecting or resubmitting it, not by editing.');
    }
    // Only flag fields outside the allowed set if they're actually being
    // changed - the edit form round-trips every field on the KPI, changed or
    // not, so an unchanged responsibleDepartmentId/isActive must not 403.
    const disallowed = Object.keys(body).filter(
      (k) =>
        !(DEPARTMENT_HEAD_EDITABLE_FIELDS as readonly string[]).includes(k) &&
        (body as Record<string, unknown>)[k] !== (kpi as Record<string, unknown>)[k]
    );
    if (disallowed.length > 0) {
      throw new ApiError(403, `You cannot change ${disallowed.join(', ')} - that requires full KPI library rights.`);
    }
  }

  let editRequestId: string | null = null;

  await db.$transaction(async (tx) => {
    await tx.kpi.update({ where: { id: kpi.id }, data: body });

    // A department head's edit is applied immediately like any other, but
    // flagged for Compliance to review - see EditRequest in schema.prisma.
    if (canManageOwnDept) {
      const oldValues: Record<string, unknown> = {};
      const newValues: Record<string, unknown> = {};
      for (const f of DEPARTMENT_HEAD_EDITABLE_FIELDS) {
        if (body[f] !== undefined && body[f] !== kpi[f]) {
          oldValues[f] = kpi[f];
          newValues[f] = body[f];
        }
      }
      if (Object.keys(newValues).length > 0) {
        const editRequest = await tx.editRequest.create({
          data: {
            entityType: 'Kpi',
            entityId: kpi.id,
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
      action: 'KPI_UPDATED',
      entityType: 'Kpi',
      entityId: kpi.id,
      oldValues: {
        kpiName: kpi.kpiName,
        varianceIndicator: kpi.varianceIndicator,
        matrixType: kpi.matrixType,
        isActive: kpi.isActive,
      },
      newValues: { ...body, editRequestId },
      ipAddress: ctx.ip,
      userAgent: ctx.ua,
    });
  });

  if (editRequestId) {
    const approvers = await complianceUserIds();
    await notifyUsers(db, approvers, {
      type: 'EDIT_PENDING_COMPLIANCE_REVIEW',
      title: 'KPI edit awaiting Compliance review',
      message: `${ctx.user.fullName} edited ${kpi.kpiCode} - ${kpi.kpiName}.`,
      entityType: 'Kpi',
      entityId: kpi.id,
      link: '/admin',
    });
  }

  return NextResponse.json({ ok: true, editRequestId });
});
