import { Prisma, PrismaClient } from '@prisma/client';
import { db } from './db';

type DbClient = PrismaClient | Prisma.TransactionClient;

export interface NotificationInput {
  type: string;
  title: string;
  message: string;
  entityType?: string;
  entityId?: string;
  /** Where clicking should land, e.g. "/?month=2026-07&employee=<profileId>". */
  link?: string;
}

/** The submissions screen, opened on one employee's card for a given month. */
export function submissionLink(month: string, employeeProfileId?: string): string {
  const params = new URLSearchParams({ month });
  if (employeeProfileId) params.set('employee', employeeProfileId);
  return `/?${params}`;
}

/**
 * In-app notifications. The service is the single entry point so an
 * email transport can be added later without touching call sites.
 */
export async function notifyUsers(client: DbClient, userIds: string[], n: NotificationInput) {
  const unique = [...new Set(userIds)].filter(Boolean);
  if (unique.length === 0) return;
  await client.notification.createMany({
    data: unique.map((recipientUserId) => ({
      recipientUserId,
      type: n.type,
      title: n.title,
      message: n.message,
      entityType: n.entityType ?? null,
      entityId: n.entityId ?? null,
      link: n.link ?? '',
    })),
  });
}

/**
 * Everyone who signs off at the compliance stage: the permission is what
 * counts, so an override grants it without changing anybody's role.
 */
export async function complianceUserIds(): Promise<string[]> {
  const perm = await db.permission.findUnique({ where: { code: 'approvals.approve_compliance' } });
  if (!perm) return [];

  const roles = await db.rolePermission.findMany({
    where: { permissionId: perm.id },
    select: { role: true },
  });
  const overrides = await db.userPermissionOverride.findMany({
    where: { permissionId: perm.id },
    select: { userId: true, allowed: true },
  });

  const byRole = roles.length
    ? await db.user.findMany({
        where: { isActive: true, systemRole: { in: roles.map((r) => r.role) } },
        select: { id: true },
      })
    : [];

  const ids = new Set(byRole.map((u) => u.id));
  for (const o of overrides) {
    if (o.allowed) ids.add(o.userId);
    else ids.delete(o.userId);
  }
  return [...ids];
}

/** userIds of the direct manager chain (direct manager + department manager). */
export async function managerUserIdsFor(employeeProfileId: string): Promise<string[]> {
  const profile = await db.employeeProfile.findUnique({
    where: { id: employeeProfileId },
    include: { department: true },
  });
  if (!profile) return [];
  const managerEmployeeIds = new Set<string>();
  if (profile.directManagerEmployeeId) managerEmployeeIds.add(profile.directManagerEmployeeId);
  if (profile.department?.departmentManagerEmployeeId)
    managerEmployeeIds.add(profile.department.departmentManagerEmployeeId);
  managerEmployeeIds.delete(profile.employeeId);
  if (managerEmployeeIds.size === 0) return [];
  const managers = await db.employeeProfile.findMany({
    where: { employeeId: { in: [...managerEmployeeIds] }, userId: { not: null } },
    select: { userId: true },
  });
  return managers.map((m) => m.userId!).filter(Boolean);
}
