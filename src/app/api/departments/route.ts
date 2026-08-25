import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { db } from '@/lib/db';
import { wrap, getCtx, requirePerm, ApiError } from '@/lib/api';
import { logAudit } from '@/lib/audit';

export const dynamic = 'force-dynamic';

export const GET = wrap(async (req: NextRequest) => {
  const ctx = await getCtx(req); // any authenticated user may list departments (needed for filters)
  const departments = await db.department.findMany({
    orderBy: { name: 'asc' },
    include: { _count: { select: { employees: { where: { isActive: true } } } } },
  });
  const managerIds = departments
    .map((d) => d.departmentManagerEmployeeId)
    .filter((x): x is string => !!x);
  const managers = managerIds.length
    ? await db.employeeProfile.findMany({
        where: { employeeId: { in: managerIds } },
        select: { employeeId: true, fullName: true },
      })
    : [];
  const managerMap = new Map(managers.map((m) => [m.employeeId, m.fullName]));
  return NextResponse.json({
    departments: departments.map((d) => ({
      id: d.id,
      code: d.code,
      name: d.name,
      isActive: d.isActive,
      employeeCount: d._count.employees,
      departmentManagerEmployeeId: d.departmentManagerEmployeeId,
      departmentManagerName: d.departmentManagerEmployeeId
        ? managerMap.get(d.departmentManagerEmployeeId) ?? null
        : null,
    })),
    canManage: ctx.perms.has('departments.manage'),
  });
});

const createSchema = z.object({
  code: z.string().min(1).max(30),
  name: z.string().min(1).max(200),
  departmentManagerEmployeeId: z.string().max(50).nullable().optional(),
});

export const POST = wrap(async (req: NextRequest) => {
  const ctx = await getCtx(req);
  requirePerm(ctx, 'departments.manage');
  const body = createSchema.parse(await req.json());

  const dup = await db.department.findFirst({
    where: { OR: [{ code: body.code.trim() }, { name: body.name.trim() }] },
  });
  if (dup) throw new ApiError(409, 'A department with this code or name already exists.');

  if (body.departmentManagerEmployeeId) {
    const mgr = await db.employeeProfile.findUnique({
      where: { employeeId: body.departmentManagerEmployeeId },
    });
    if (!mgr) throw new ApiError(400, 'Department manager employee not found.');
  }

  const dept = await db.department.create({
    data: {
      code: body.code.trim(),
      name: body.name.trim(),
      departmentManagerEmployeeId: body.departmentManagerEmployeeId || null,
    },
  });
  await logAudit(db, {
    userId: ctx.user.id,
    action: 'DEPARTMENT_CREATED',
    entityType: 'Department',
    entityId: dept.id,
    newValues: body,
    ipAddress: ctx.ip,
    userAgent: ctx.ua,
  });
  return NextResponse.json({ ok: true, id: dept.id });
});
