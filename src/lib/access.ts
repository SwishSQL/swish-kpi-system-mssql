import { db } from './db';
import { Ctx } from './api';
import { buildChildrenMap, getDescendants } from './hierarchy';

export interface VisibleScope {
  /** null means everything (view_all / submit_all) */
  employeeProfileIds: string[] | null;
}

/**
 * Which employee profiles the actor may VIEW (forSubmit=false) or
 * SUBMIT FOR (forSubmit=true). Combines role permissions with the
 * reporting hierarchy:
 *  - *_all            -> whole company
 *  - department scope -> departments the actor manages (or all when the
 *                        role grants view_department without managing one)
 *  - team scope       -> the actor's reporting branch (direct + indirect)
 *  - own scope        -> self
 */
export async function getVisibleScope(ctx: Ctx, forSubmit: boolean): Promise<VisibleScope> {
  const suffix = forSubmit
    ? { all: 'submissions.submit_all', dept: 'submissions.submit_department', team: 'submissions.submit_team', own: 'submissions.submit_own' }
    : { all: 'submissions.view_all', dept: 'submissions.view_department', team: 'submissions.view_team', own: 'submissions.view_own' };

  if (ctx.perms.has(suffix.all)) return { employeeProfileIds: null };

  const ids = new Set<string>();

  if (ctx.profile && ctx.perms.has(suffix.own)) ids.add(ctx.profile.id);

  if (ctx.perms.has(suffix.dept) && ctx.managedDepartmentIds.length > 0) {
    const deptEmployees = await db.employeeProfile.findMany({
      where: { departmentId: { in: ctx.managedDepartmentIds }, isActive: true },
      select: { id: true },
    });
    for (const e of deptEmployees) ids.add(e.id);
  }

  if (ctx.perms.has(suffix.team) && ctx.profile) {
    const all = await db.employeeProfile.findMany({
      where: { isActive: true },
      select: { id: true, employeeId: true, directManagerEmployeeId: true },
    });
    const childrenMap = buildChildrenMap(all);
    const descendants = getDescendants(ctx.profile.employeeId, childrenMap);
    for (const e of all) if (descendants.has(e.employeeId)) ids.add(e.id);
  }

  return { employeeProfileIds: [...ids] };
}

export async function canAccessProfile(
  ctx: Ctx,
  employeeProfileId: string,
  forSubmit: boolean
): Promise<boolean> {
  const scope = await getVisibleScope(ctx, forSubmit);
  if (scope.employeeProfileIds === null) return true;
  return scope.employeeProfileIds.includes(employeeProfileId);
}

/** Prisma where-fragment restricting employee profiles to the visible scope. */
export function scopeWhere(scope: VisibleScope): Record<string, unknown> {
  if (scope.employeeProfileIds === null) return {};
  return { id: { in: scope.employeeProfileIds } };
}
