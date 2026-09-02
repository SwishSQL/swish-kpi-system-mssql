import { NextRequest, NextResponse } from 'next/server';
import { ZodError } from 'zod';
import { db } from './db';
import { getSessionUser } from './auth';
import { resolvePermissions } from './permissions';

export class ApiError extends Error {
  status: number;
  code?: string;
  constructor(status: number, message: string, code?: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export type SessionUser = NonNullable<Awaited<ReturnType<typeof getSessionUser>>>;

export interface Ctx {
  user: SessionUser;
  profile: SessionUser['employeeProfile'];
  perms: Set<string>;
  hasReports: boolean;
  managedDepartmentIds: string[];
  ip: string | null;
  ua: string | null;
}

export function clientInfo(req: NextRequest) {
  const ip =
    req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    req.headers.get('x-real-ip') ||
    null;
  const ua = req.headers.get('user-agent');
  return { ip, ua };
}

/**
 * Builds the request context: authenticated user, effective permissions
 * (role defaults + overrides + hierarchy-derived scopes) and client info.
 * CSRF: mutating requests must carry the x-csrf header (set by the app's
 * fetch wrapper); combined with SameSite=Lax cookies.
 */
export async function getCtx(
  req: NextRequest,
  opts: { allowMustChange?: boolean } = {}
): Promise<Ctx> {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    if (req.headers.get('x-csrf') !== '1') {
      throw new ApiError(403, 'Missing CSRF header.');
    }
  }
  const user = await getSessionUser();
  if (!user) throw new ApiError(401, 'Not authenticated.');
  if (user.mustChangePassword && !opts.allowMustChange) {
    throw new ApiError(403, 'Password change required.', 'PASSWORD_CHANGE_REQUIRED');
  }

  const [rolePerms, overrides] = await Promise.all([
    db.rolePermission.findMany({ where: { role: user.systemRole }, include: { permission: true } }),
    db.userPermissionOverride.findMany({ where: { userId: user.id }, include: { permission: true } }),
  ]);

  const perms = resolvePermissions(
    rolePerms.map((rp) => rp.permission.code),
    overrides.map((o) => ({ code: o.permission.code, allowed: o.allowed }))
  );

  const profile = user.employeeProfile;
  let hasReports = false;
  let managedDepartmentIds: string[] = [];

  if (profile) {
    const [reportCount, managedDepts] = await Promise.all([
      db.employeeProfile.count({
        where: { directManagerEmployeeId: profile.employeeId, isActive: true },
      }),
      db.department.findMany({
        where: { departmentManagerEmployeeId: profile.employeeId, isActive: true },
        select: { id: true },
      }),
    ]);
    hasReports = reportCount > 0;
    managedDepartmentIds = managedDepts.map((d) => d.id);

    // Management authority derived from the reporting hierarchy, not only the role.
    if (hasReports) {
      perms.add('submissions.view_team');
      perms.add('submissions.submit_team');
      perms.add('dashboards.view_team');
    }
    if (managedDepartmentIds.length > 0) {
      perms.add('submissions.view_department');
      perms.add('submissions.submit_department');
      perms.add('dashboards.view_department');
      // A department head can see and propose KPIs, and assign them to their
      // own team - all scoped to their department by the route handlers, not
      // by this grant. Someone who already holds the unscoped kpi_library.
      // manage / kpi_assignments.manage keeps the wider access those give.
      perms.add('kpi_library.view');
      perms.add('kpi_assignments.view');
    }
  }

  const { ip, ua } = clientInfo(req);
  return { user, profile, perms, hasReports, managedDepartmentIds, ip, ua };
}

export function requirePerm(ctx: Ctx, ...codes: string[]) {
  if (!codes.some((c) => ctx.perms.has(c))) {
    throw new ApiError(403, 'You do not have permission to perform this action.');
  }
}

type Handler = (req: NextRequest, params: any) => Promise<NextResponse | Response>;

export function wrap(handler: Handler): Handler {
  return async (req, params) => {
    try {
      return await handler(req, params);
    } catch (err) {
      if (err instanceof ApiError) {
        return NextResponse.json({ error: err.message, code: err.code }, { status: err.status });
      }
      if (err instanceof ZodError) {
        const msg = err.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
        return NextResponse.json({ error: `Validation failed: ${msg}` }, { status: 400 });
      }
      console.error('API error:', err);
      return NextResponse.json({ error: 'Internal server error.' }, { status: 500 });
    }
  };
}
