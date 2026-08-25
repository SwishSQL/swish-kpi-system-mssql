import { NextRequest, NextResponse } from 'next/server';
import { wrap, getCtx } from '@/lib/api';

export const dynamic = 'force-dynamic';

export const GET = wrap(async (req: NextRequest) => {
  const ctx = await getCtx(req, { allowMustChange: true });
  return NextResponse.json({
    user: {
      id: ctx.user.id,
      employeeId: ctx.user.employeeId,
      fullName: ctx.user.fullName,
      email: ctx.user.email,
      systemRole: ctx.user.systemRole,
      mustChangePassword: ctx.user.mustChangePassword,
    },
    profile: ctx.profile
      ? {
          id: ctx.profile.id,
          employeeId: ctx.profile.employeeId,
          departmentId: ctx.profile.departmentId,
          departmentName: ctx.profile.department?.name ?? null,
          position: ctx.profile.position,
        }
      : null,
    permissions: [...ctx.perms],
    hasReports: ctx.hasReports,
    managedDepartmentIds: ctx.managedDepartmentIds,
    canSwitchDepartments:
      ctx.perms.has('submissions.view_all') ||
      ctx.perms.has('dashboards.view_all') ||
      ctx.managedDepartmentIds.length > 1,
  });
});
