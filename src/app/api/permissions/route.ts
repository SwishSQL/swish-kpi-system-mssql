import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { db } from '@/lib/db';
import { wrap, getCtx, requirePerm, ApiError } from '@/lib/api';
import { PERMISSIONS, ALL_PERMISSION_CODES } from '@/lib/permissions';
import { logAudit } from '@/lib/audit';

export const dynamic = 'force-dynamic';

export const GET = wrap(async (req: NextRequest) => {
  const ctx = await getCtx(req);
  requirePerm(ctx, 'permissions.manage');
  const [rolePerms, overrides] = await Promise.all([
    db.rolePermission.findMany({ include: { permission: true } }),
    db.userPermissionOverride.findMany({
      include: { permission: true, user: { select: { fullName: true, email: true } } },
    }),
  ]);
  const matrix: Record<string, string[]> = {};
  for (const rp of rolePerms) {
    (matrix[rp.role] ??= []).push(rp.permission.code);
  }
  return NextResponse.json({
    permissions: PERMISSIONS,
    matrix,
    overrides: overrides.map((o) => ({
      id: o.id,
      userId: o.userId,
      userName: o.user.fullName,
      userEmail: o.user.email,
      code: o.permission.code,
      allowed: o.allowed,
    })),
  });
});

const bodySchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('role'),
    role: z.enum(['SUPER_ADMIN', 'ADMIN', 'COMPLIANCE_SPECIALIST', 'HR_ADMIN', 'EMPLOYEE']),
    codes: z.array(z.string()),
  }),
  z.object({
    type: z.literal('override'),
    userId: z.string(),
    code: z.string(),
    allowed: z.boolean().nullable(), // null removes the override
  }),
]);

export const POST = wrap(async (req: NextRequest) => {
  const ctx = await getCtx(req);
  requirePerm(ctx, 'permissions.manage');
  const body = bodySchema.parse(await req.json());

  if (body.type === 'role') {
    if (body.role === 'SUPER_ADMIN' && ctx.user.systemRole !== 'SUPER_ADMIN') {
      throw new ApiError(403, 'Only a Super Admin can edit Super Admin permissions.');
    }
    if (
      ctx.user.systemRole !== 'SUPER_ADMIN' &&
      body.codes.some((c) => !ctx.perms.has(c))
    ) {
      throw new ApiError(403, 'You cannot grant permissions you do not hold yourself.');
    }
    const invalid = body.codes.filter((c) => !ALL_PERMISSION_CODES.includes(c));
    if (invalid.length) throw new ApiError(400, `Unknown permissions: ${invalid.join(', ')}`);

    await db.$transaction(async (tx) => {
      const perms = await tx.permission.findMany({ where: { code: { in: body.codes } } });
      await tx.rolePermission.deleteMany({ where: { role: body.role } });
      await tx.rolePermission.createMany({
        data: perms.map((p) => ({ role: body.role, permissionId: p.id })),
      });
      await logAudit(tx, {
        userId: ctx.user.id,
        action: 'PERMISSIONS_ROLE_UPDATED',
        entityType: 'RolePermission',
        entityId: body.role,
        newValues: { codes: body.codes },
        ipAddress: ctx.ip,
        userAgent: ctx.ua,
      });
    });
    return NextResponse.json({ ok: true });
  }

  // user override
  const perm = await db.permission.findUnique({ where: { code: body.code } });
  if (!perm) throw new ApiError(400, 'Unknown permission code.');
  if (ctx.user.systemRole !== 'SUPER_ADMIN' && body.allowed && !ctx.perms.has(body.code)) {
    throw new ApiError(403, 'You cannot grant a permission you do not hold yourself.');
  }
  await db.$transaction(async (tx) => {
    if (body.allowed === null) {
      await tx.userPermissionOverride.deleteMany({
        where: { userId: body.userId, permissionId: perm.id },
      });
    } else {
      await tx.userPermissionOverride.upsert({
        where: { userId_permissionId: { userId: body.userId, permissionId: perm.id } },
        create: { userId: body.userId, permissionId: perm.id, allowed: body.allowed },
        update: { allowed: body.allowed },
      });
    }
    await logAudit(tx, {
      userId: ctx.user.id,
      action: 'PERMISSIONS_OVERRIDE_UPDATED',
      entityType: 'UserPermissionOverride',
      entityId: body.userId,
      newValues: { code: body.code, allowed: body.allowed },
      ipAddress: ctx.ip,
      userAgent: ctx.ua,
    });
  });
  return NextResponse.json({ ok: true });
});
