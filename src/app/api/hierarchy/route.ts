import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { db } from '@/lib/db';
import { wrap, getCtx, requirePerm, ApiError } from '@/lib/api';
import { validateManagerAssignment, buildChildrenMap, getDescendants } from '@/lib/hierarchy';
import { logAudit } from '@/lib/audit';

export const dynamic = 'force-dynamic';

export const GET = wrap(async (req: NextRequest) => {
  const ctx = await getCtx(req);
  requirePerm(ctx, 'hierarchy.view');

  const [employees, departments] = await Promise.all([
    db.employeeProfile.findMany({
      include: { department: true, user: { select: { systemRole: true, isActive: true, email: true } } },
      orderBy: { fullName: 'asc' },
    }),
    db.department.findMany({ where: { isActive: true } }),
  ]);

  const childrenMap = buildChildrenMap(
    employees.filter((e) => e.isActive).map((e) => ({
      employeeId: e.employeeId,
      directManagerEmployeeId: e.directManagerEmployeeId,
    }))
  );
  const byEmployeeId = new Map(employees.map((e) => [e.employeeId, e]));

  return NextResponse.json({
    employees: employees.map((e) => ({
      id: e.id,
      employeeId: e.employeeId,
      fullName: e.fullName,
      email: e.user?.email ?? null,
      position: e.position,
      departmentId: e.departmentId,
      departmentName: e.department?.name ?? null,
      directManagerEmployeeId: e.directManagerEmployeeId,
      // Compared live against the manager's current department rather than
      // trusted from the stored flag: either side can be moved afterwards
      // (Users tab, an import) without going back through this screen, which
      // left the badge showing on people whose manager shares their department.
      crossDepartmentOverride: e.directManagerEmployeeId
        ? byEmployeeId.get(e.directManagerEmployeeId)?.departmentId !== e.departmentId
        : false,
      isActive: e.isActive,
      systemRole: e.user?.systemRole ?? null,
      directReports: (childrenMap.get(e.employeeId) ?? []).length,
      totalReports: getDescendants(e.employeeId, childrenMap).size,
    })),
    warnings: {
      employeesWithoutManager: employees
        .filter((e) => e.isActive && !e.directManagerEmployeeId)
        .map((e) => ({ employeeId: e.employeeId, fullName: e.fullName })),
      departmentsWithoutManager: departments
        .filter((d) => !d.departmentManagerEmployeeId)
        .map((d) => ({ id: d.id, name: d.name })),
    },
    canManage: ctx.perms.has('hierarchy.manage'),
  });
});

const actionSchema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('set_manager'),
    employeeId: z.string().min(1),
    managerEmployeeId: z.string().nullable(),
    crossDepartmentOverride: z.boolean().optional(),
  }),
  z.object({
    action: z.literal('move_department'),
    employeeId: z.string().min(1),
    departmentId: z.string().nullable(),
  }),
  z.object({
    action: z.literal('set_active'),
    employeeId: z.string().min(1),
    isActive: z.boolean(),
  }),
]);

export const POST = wrap(async (req: NextRequest) => {
  const ctx = await getCtx(req);
  requirePerm(ctx, 'hierarchy.manage');
  const body = actionSchema.parse(await req.json());

  const employee = await db.employeeProfile.findUnique({
    where: { employeeId: body.employeeId },
    include: { department: true },
  });
  if (!employee) throw new ApiError(404, 'Employee not found.');

  if (body.action === 'set_manager') {
    let manager = null;
    if (body.managerEmployeeId) {
      manager = await db.employeeProfile.findUnique({ where: { employeeId: body.managerEmployeeId } });
      if (!manager || !manager.isActive) throw new ApiError(400, 'Manager employee not found or inactive.');
    }

    const all = await db.employeeProfile.findMany({
      where: { isActive: true },
      select: { employeeId: true, directManagerEmployeeId: true, departmentId: true },
    });
    const err = validateManagerAssignment(body.employeeId, body.managerEmployeeId, all);
    if (err) throw new ApiError(400, err);

    const crossDept =
      manager && employee.departmentId && manager.departmentId &&
      employee.departmentId !== manager.departmentId;
    if (crossDept && !body.crossDepartmentOverride) {
      throw new ApiError(
        409,
        'Manager belongs to a different department. Confirm the cross-department override to proceed.',
        'CROSS_DEPARTMENT'
      );
    }

    await db.$transaction(async (tx) => {
      await tx.employeeProfile.update({
        where: { id: employee.id },
        data: {
          directManagerEmployeeId: body.managerEmployeeId,
          crossDepartmentOverride: !!crossDept,
        },
      });
      await logAudit(tx, {
        userId: ctx.user.id,
        action: 'HIERARCHY_MANAGER_CHANGED',
        entityType: 'EmployeeProfile',
        entityId: employee.id,
        oldValues: { directManagerEmployeeId: employee.directManagerEmployeeId },
        newValues: { directManagerEmployeeId: body.managerEmployeeId, crossDepartmentOverride: !!crossDept },
        ipAddress: ctx.ip,
        userAgent: ctx.ua,
      });
    });
    return NextResponse.json({ ok: true });
  }

  if (body.action === 'move_department') {
    await db.$transaction(async (tx) => {
      await tx.employeeProfile.update({
        where: { id: employee.id },
        data: { departmentId: body.departmentId },
      });
      await logAudit(tx, {
        userId: ctx.user.id,
        action: 'HIERARCHY_DEPARTMENT_CHANGED',
        entityType: 'EmployeeProfile',
        entityId: employee.id,
        oldValues: { departmentId: employee.departmentId },
        newValues: { departmentId: body.departmentId },
        ipAddress: ctx.ip,
        userAgent: ctx.ua,
      });
    });
    return NextResponse.json({ ok: true });
  }

  // set_active
  await db.$transaction(async (tx) => {
    await tx.employeeProfile.update({
      where: { id: employee.id },
      data: { isActive: body.isActive },
    });
    if (employee.userId) {
      await tx.user.update({ where: { id: employee.userId }, data: { isActive: body.isActive } });
    }
    await logAudit(tx, {
      userId: ctx.user.id,
      action: body.isActive ? 'EMPLOYEE_ACTIVATED' : 'EMPLOYEE_DEACTIVATED',
      entityType: 'EmployeeProfile',
      entityId: employee.id,
      ipAddress: ctx.ip,
      userAgent: ctx.ua,
    });
  });
  return NextResponse.json({ ok: true });
});
