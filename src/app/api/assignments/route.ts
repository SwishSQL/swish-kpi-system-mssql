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
  const sp = req.nextUrl.searchParams;
  const year = Number(sp.get('year')) || new Date().getFullYear();
  const departmentId = sp.get('departmentId') || undefined;
  const q = sp.get('q')?.trim() || '';

  const assignments = await db.kpiAssignment.findMany({
    where: {
      year,
      employee: {
        ...(departmentId ? { departmentId } : {}),
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

  return NextResponse.json({
    year,
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
      target: a.target,
      threshold: a.threshold,
      weight: a.weight,
      frequency: a.frequency,
      formOfSubmission: a.formOfSubmission,
      effectiveFrom: a.effectiveFrom,
      effectiveTo: a.effectiveTo,
      isActive: a.isActive,
      employeeWeightTotal: weightByEmployee.get(a.employeeProfileId) ?? 0,
    })),
    canManage: ctx.perms.has('kpi_assignments.manage'),
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

export const POST = wrap(async (req: NextRequest) => {
  const ctx = await getCtx(req);
  requirePerm(ctx, 'kpi_assignments.manage');
  const body = createSchema.parse(await req.json());

  const [employee, kpi] = await Promise.all([
    db.employeeProfile.findUnique({ where: { employeeId: body.employeeId } }),
    db.kpi.findUnique({ where: { id: body.kpiId } }),
  ]);
  if (!employee) throw new ApiError(404, 'Employee not found.');
  if (!kpi) throw new ApiError(404, 'KPI not found.');

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
