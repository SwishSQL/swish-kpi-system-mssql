import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { db } from '@/lib/db';
import { wrap, getCtx, ApiError } from '@/lib/api';
import { logAudit } from '@/lib/audit';
import { notifyUsers, userIdsWithPermission } from '@/lib/notify';

export const dynamic = 'force-dynamic';

// Admin/HR/Compliance keep seeing the whole company library today, whatever
// permission grants got them there; a department head with none of that sees
// only their own department's KPIs plus anything they proposed themselves.
const BROAD_LIBRARY_ROLES = ['SUPER_ADMIN', 'ADMIN', 'HR_ADMIN', 'COMPLIANCE_SPECIALIST'];

export const GET = wrap(async (req: NextRequest) => {
  const ctx = await getCtx(req);
  const canManage = ctx.perms.has('kpi_library.manage');
  const canPropose = !canManage && ctx.managedDepartmentIds.length > 0;
  // kpi_library.view is granted to a department head too now (so the nav item
  // and the Assignments picker work for them), so it can no longer be read as
  // "sees everything" - only the role or the manage permission mean that here.
  const fullView = canManage || BROAD_LIBRARY_ROLES.includes(ctx.user.systemRole);
  if (!fullView && !canPropose) {
    throw new ApiError(403, 'You do not have permission to perform this action.');
  }

  const q = req.nextUrl.searchParams.get('q')?.trim() || '';
  const where: Prisma.KpiWhereInput = {
    ...(q
      ? {
          OR: [
            { kpiCode: { contains: q } },
            { kpiName: { contains: q } },
          ],
        }
      : {}),
    // A department head sees only what belongs to their department or what
    // they proposed themselves - never the rest of the company's library.
    ...(!fullView
      ? {
          OR: [
            { responsibleDepartmentId: { in: ctx.managedDepartmentIds } },
            { createdByUserId: ctx.user.id },
          ],
        }
      : {}),
  };

  const kpis = await db.kpi.findMany({
    where,
    include: { responsibleDepartment: true, _count: { select: { assignments: true } } },
    orderBy: { kpiCode: 'asc' },
    take: 1000,
  });

  // A department head's edit is applied immediately but flagged until
  // Compliance reviews it - see EditRequest in schema.prisma.
  const pendingEdits = await db.editRequest.findMany({
    where: { entityType: 'Kpi', entityId: { in: kpis.map((k) => k.id) }, status: 'PENDING' },
    select: { id: true, entityId: true },
  });
  const pendingEditByKpi = new Map(pendingEdits.map((e) => [e.entityId, e.id]));

  return NextResponse.json({
    canReviewEdits: ctx.perms.has('approvals.approve_compliance'),
    kpis: kpis.map((k) => ({
      id: k.id,
      kpiCode: k.kpiCode,
      kpiName: k.kpiName,
      description: k.description,
      calculationMethod: k.calculationMethod,
      varianceIndicator: k.varianceIndicator,
      matrixType: k.matrixType,
      defaultTarget: k.defaultTarget,
      targetText: k.targetText,
      defaultThreshold: k.defaultThreshold,
      defaultWeight: k.defaultWeight,
      frequency: k.frequency,
      responsibleDepartmentId: k.responsibleDepartmentId,
      responsibleDepartmentText: k.responsibleDepartmentText,
      responsibleDepartmentName: k.responsibleDepartment?.name ?? null,
      formOfSubmission: k.formOfSubmission,
      isActive: k.isActive,
      assignmentCount: k._count.assignments,
      approvalStatus: k.approvalStatus,
      rejectionReason: k.rejectionReason,
      createdByUserId: k.createdByUserId,
      isMine: k.createdByUserId === ctx.user.id,
      pendingEditRequestId: pendingEditByKpi.get(k.id) ?? null,
    })),
    canManage,
    canPropose,
    canApprove: ctx.perms.has('kpi_library.approve'),
    managedDepartmentIds: ctx.managedDepartmentIds,
  });
});

const kpiSchema = z.object({
  kpiCode: z.string().min(1).max(60),
  kpiName: z.string().min(1).max(300),
  description: z.string().max(3000).optional(),
  calculationMethod: z.string().max(2000).optional(),
  varianceIndicator: z.enum(['U', 'D']),
  matrixType: z.enum(['UNIT', 'TIME', 'PERCENTAGE']),
  defaultTarget: z.number().nullable().optional(),
  targetText: z.string().max(300).optional(),
  defaultThreshold: z.number().nullable().optional(),
  defaultWeight: z.number().min(0).max(100).nullable().optional(),
  frequency: z.string().max(50).optional(),
  responsibleDepartmentId: z.string().nullable().optional(),
  formOfSubmission: z.string().max(500).optional(),
});

/**
 * Two ways in. Someone with full kpi_library.manage rights creates a KPI the
 * way the library has always worked - it is live immediately. A department
 * head with none of that authority may propose one for their own department;
 * it starts PENDING and cannot be measured against until Compliance or an
 * Admin approves it.
 */
export const POST = wrap(async (req: NextRequest) => {
  const ctx = await getCtx(req);
  const canManage = ctx.perms.has('kpi_library.manage');
  const canPropose = !canManage && ctx.managedDepartmentIds.length > 0;
  if (!canManage && !canPropose) {
    throw new ApiError(403, 'You do not have permission to perform this action.');
  }

  const body = kpiSchema.parse(await req.json());

  if (canPropose) {
    if (!body.responsibleDepartmentId || !ctx.managedDepartmentIds.includes(body.responsibleDepartmentId)) {
      throw new ApiError(
        400,
        'Choose one of your own departments - a department head can only propose a KPI for a department they manage.'
      );
    }
  }

  const dup = await db.kpi.findUnique({ where: { kpiCode: body.kpiCode.trim() } });
  if (dup) throw new ApiError(409, 'A KPI with this code already exists.');

  const kpi = await db.kpi.create({
    data: {
      kpiCode: body.kpiCode.trim(),
      kpiName: body.kpiName.trim(),
      description: body.description ?? '',
      calculationMethod: body.calculationMethod ?? '',
      varianceIndicator: body.varianceIndicator,
      matrixType: body.matrixType,
      defaultTarget: body.defaultTarget ?? null,
      targetText: body.targetText ?? '',
      defaultThreshold: body.defaultThreshold ?? null,
      defaultWeight: body.defaultWeight ?? null,
      frequency: body.frequency ?? 'Monthly',
      responsibleDepartmentId: body.responsibleDepartmentId ?? null,
      formOfSubmission: body.formOfSubmission ?? '',
      approvalStatus: canPropose ? 'PENDING' : 'APPROVED',
      createdByUserId: ctx.user.id,
    },
  });
  await logAudit(db, {
    userId: ctx.user.id,
    action: 'KPI_CREATED',
    entityType: 'Kpi',
    entityId: kpi.id,
    newValues: { ...body, approvalStatus: kpi.approvalStatus },
    ipAddress: ctx.ip,
    userAgent: ctx.ua,
  });

  if (canPropose) {
    const approvers = await userIdsWithPermission('kpi_library.approve');
    await notifyUsers(db, approvers, {
      type: 'KPI_PENDING_APPROVAL',
      title: 'New KPI awaiting approval',
      message: `${ctx.user.fullName} proposed ${kpi.kpiCode} - ${kpi.kpiName}.`,
      entityType: 'Kpi',
      entityId: kpi.id,
      link: '/admin',
    });
  }

  return NextResponse.json({ ok: true, id: kpi.id, approvalStatus: kpi.approvalStatus });
});
