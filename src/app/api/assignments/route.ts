import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { db } from '@/lib/db';
import { wrap, getCtx, requirePerm, ApiError } from '@/lib/api';
import { logAudit } from '@/lib/audit';
import { round2 } from '@/lib/scoring';

export const dynamic = 'force-dynamic';

export const GET = wrap(async (req: NextRequest) => {
  const ctx = await getCtx(req);
  requirePerm(ctx, 'kpi_assignments.view');
  const canManageAny = ctx.perms.has('kpi_assignments.manage');
  // Someone whose only route in is being a department head sees their own
  // department's assignments only - not the request-level global filter.
  if (!canManageAny && ctx.managedDepartmentIds.length === 0) {
    throw new ApiError(403, 'You do not have permission to perform this action.');
  }
  const sp = req.nextUrl.searchParams;
  const year = Number(sp.get('year')) || new Date().getFullYear();
  const departmentId = sp.get('departmentId') || undefined;
  const q = sp.get('q')?.trim() || '';

  if (!canManageAny && departmentId && !ctx.managedDepartmentIds.includes(departmentId)) {
    throw new ApiError(403, 'You can only view assignments for a department you manage.');
  }

  const assignments = await db.kpiAssignment.findMany({
    where: {
      year,
      employee: {
        ...(canManageAny
          ? departmentId
            ? { departmentId }
            : {}
          : { departmentId: departmentId ?? { in: ctx.managedDepartmentIds } }),
        ...(q
          ? {
              OR: [
                { fullName: { contains: q } },
                { employeeId: { contains: q } },
              ],
            }
          : {}),
      },
    },
    include: {
      employee: { include: { department: true } },
      kpi: true,
    },
    orderBy: [{ employee: { fullName: 'asc' } }, { kpi: { kpiCode: 'asc' } }],
    take: 3000,
  });

  // Flag employees whose active weights do not total 100
  const weightByEmployee = new Map<string, number>();
  for (const a of assignments) {
    if (!a.isActive) continue;
    weightByEmployee.set(
      a.employeeProfileId,
      round2((weightByEmployee.get(a.employeeProfileId) ?? 0) + a.weight)
    );
  }

  // A department head's edit is applied immediately but flagged until
  // Compliance reviews it - see EditRequest in schema.prisma.
  const pendingEdits = await db.editRequest.findMany({
    where: { entityType: 'KpiAssignment', entityId: { in: assignments.map((a) => a.id) }, status: 'PENDING' },
    select: { id: true, entityId: true },
  });
  const pendingEditByAssignment = new Map(pendingEdits.map((e) => [e.entityId, e.id]));

  return NextResponse.json({
    year,
    canReviewEdits: ctx.perms.has('approvals.approve_compliance'),
    assignments: assignments.map((a) => ({
      id: a.id,
      employeeProfileId: a.employeeProfileId,
      employeeId: a.employee.employeeId,
      employeeName: a.employee.fullName,
      departmentName: a.employee.department?.name ?? null,
      kpiId: a.kpiId,
      kpiCode: a.kpi.kpiCode,
      kpiName: a.kpi.kpiName,
      varianceIndicator: a.kpi.varianceIndicator,
      kpiApprovalStatus: a.kpi.approvalStatus,
      target: a.target,
      threshold: a.threshold,
      weight: a.weight,
      frequency: a.frequency,
      formOfSubmission: a.formOfSubmission,
      effectiveFrom: a.effectiveFrom,
      effectiveTo: a.effectiveTo,
      isActive: a.isActive,
      employeeWeightTotal: weightByEmployee.get(a.employeeProfileId) ?? 0,
      pendingEditRequestId: pendingEditByAssignment.get(a.id) ?? null,
    })),
    canManage: canManageAny || ctx.managedDepartmentIds.length > 0,
  });
});

const createSchema = z.object({
  employeeId: z.string().min(1),
  kpiId: z.string().min(1),
  year: z.number().int().min(2000).max(2100),
  target: z.number(),
  threshold: z.number(),
  weight: z.number().min(0).max(100),
  frequency: z.string().max(50).optional(),
  formOfSubmission: z.string().max(500).optional(),
  effectiveFrom: z.string().optional(),
});

/**
 * Full kpi_assignments.manage rights work exactly as they always have: assign
 * anyone to anything. A department head with none of that may still assign,
 * but only their own team to a KPI belonging to their own department - a
 * still-pending proposal included, since setting the assignment up ahead of
 * approval is the point. A rejected KPI can never be newly assigned, for
 * anyone.
 */
export const POST = wrap(async (req: NextRequest) => {
  const ctx = await getCtx(req);
  const canManageAny = ctx.perms.has('kpi_assignments.manage');
  const canManageOwnDept = !canManageAny && ctx.managedDepartmentIds.length > 0;
  if (!canManageAny && !canManageOwnDept) {
    throw new ApiError(403, 'You do not have permission to perform this action.');
  }
  const body = createSchema.parse(await req.json());

  const [employee, kpi] = await Promise.all([
    db.employeeProfile.findUnique({ where: { employeeId: body.employeeId } }),
    db.kpi.findUnique({ where: { id: body.kpiId } }),
  ]);
  if (!employee) throw new ApiError(404, 'Employee not found.');
  if (!kpi) throw new ApiError(404, 'KPI not found.');

  if (canManageOwnDept) {
    if (!employee.departmentId || !ctx.managedDepartmentIds.includes(employee.departmentId)) {
      throw new ApiError(403, 'You can only assign KPIs to someone in a department you manage.');
    }
    if (!kpi.responsibleDepartmentId || !ctx.managedDepartmentIds.includes(kpi.responsibleDepartmentId)) {
      throw new ApiError(403, 'You can only assign a KPI that belongs to a department you manage.');
    }
  }
  if (kpi.approvalStatus === 'REJECTED') {
    throw new ApiError(409, `${kpi.kpiCode} was rejected and cannot be assigned.`);
  }

  const existing = await db.kpiAssignment.findFirst({
    where: {
      employeeProfileId: employee.id,
      kpiId: kpi.id,
      year: body.year,
      isActive: true,
      effectiveTo: null,
    },
  });
  if (existing) {
    throw new ApiError(
      409,
      `An active ${body.year} assignment of ${kpi.kpiCode} for this employee already exists. Edit it instead of creating a duplicate.`
    );
  }

  const assignment = await db.kpiAssignment.create({
    data: {
      employeeProfileId: employee.id,
      kpiId: kpi.id,
      year: body.year,
      target: body.target,
      threshold: body.threshold,
      weight: body.weight,
      frequency: body.frequency || kpi.frequency,
      formOfSubmission: body.formOfSubmission || kpi.formOfSubmission,
      effectiveFrom: body.effectiveFrom ? new Date(body.effectiveFrom) : new Date(Date.UTC(body.year, 0, 1)),
    },
  });
  await logAudit(db, {
    userId: ctx.user.id,
    action: 'ASSIGNMENT_CREATED',
    entityType: 'KpiAssignment',
    entityId: assignment.id,
    newValues: body,
    ipAddress: ctx.ip,
    userAgent: ctx.ua,
  });
  return NextResponse.json({ ok: true, id: assignment.id });
});
