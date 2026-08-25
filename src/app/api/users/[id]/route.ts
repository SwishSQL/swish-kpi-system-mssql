import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { db } from '@/lib/db';
import { wrap, getCtx, requirePerm, ApiError } from '@/lib/api';
import { normalizeEmail, isValidEmail } from '@/lib/passwords';
import { manageableRoles, SystemRole } from '@/lib/permissions';
import { logAudit } from '@/lib/audit';
import { revokeAllSessions } from '@/lib/auth';

export const dynamic = 'force-dynamic';

const patchSchema = z.object({
  fullName: z.string().min(1).max(200).optional(),
  email: z.string().min(3).max(200).optional(),
  systemRole: z.enum(['SUPER_ADMIN', 'ADMIN', 'COMPLIANCE_SPECIALIST', 'HR_ADMIN', 'EMPLOYEE']).optional(),
  isActive: z.boolean().optional(),
  departmentId: z.string().nullable().optional(),
  position: z.string().max(200).nullable().optional(),
});

export const PATCH = wrap(async (req: NextRequest, { params }: { params: { id: string } }) => {
  const ctx = await getCtx(req);
  const body = patchSchema.parse(await req.json());

  const target = await db.user.findUnique({
    where: { id: params.id },
    include: { employeeProfile: true },
  });
  if (!target) throw new ApiError(404, 'User not found.');

  const actorRoles = manageableRoles(ctx.user.systemRole as SystemRole);

  if (body.isActive !== undefined) {
    requirePerm(ctx, 'users.deactivate');
    if (target.id === ctx.user.id) throw new ApiError(400, 'You cannot deactivate your own account.');
  }
  if (body.fullName || body.email || body.departmentId !== undefined || body.position !== undefined) {
    requirePerm(ctx, 'users.update');
  }
  if (body.systemRole) {
    requirePerm(ctx, 'users.update');
    if (!actorRoles.includes(body.systemRole) || !actorRoles.includes(target.systemRole as SystemRole)) {
      throw new ApiError(403, 'You cannot assign a role at or above your own authority.');
    }
  }

  let email: string | undefined;
  if (body.email) {
    email = normalizeEmail(body.email);
    if (!isValidEmail(email)) throw new ApiError(400, 'Invalid email format.');
    const dup = await db.user.findUnique({ where: { email } });
    if (dup && dup.id !== target.id) throw new ApiError(409, 'Another user already uses this email.');
  }

  await db.$transaction(async (tx) => {
    await tx.user.update({
      where: { id: target.id },
      data: {
        fullName: body.fullName?.trim(),
        email,
        systemRole: body.systemRole,
        isActive: body.isActive,
      },
    });
    if (target.employeeProfile) {
      await tx.employeeProfile.update({
        where: { id: target.employeeProfile.id },
        data: {
          fullName: body.fullName?.trim(),
          departmentId: body.departmentId === undefined ? undefined : body.departmentId,
          position: body.position === undefined ? undefined : body.position,
          isActive: body.isActive,
        },
      });
    }
    await logAudit(tx, {
      userId: ctx.user.id,
      action: body.isActive === false ? 'USER_DEACTIVATED' : body.isActive === true ? 'USER_ACTIVATED' : 'USER_UPDATED',
      entityType: 'User',
      entityId: target.id,
      oldValues: { fullName: target.fullName, email: target.email, systemRole: target.systemRole, isActive: target.isActive },
      newValues: body,
      ipAddress: ctx.ip,
      userAgent: ctx.ua,
    });
  });

  if (body.isActive === false) await revokeAllSessions(target.id);

  return NextResponse.json({ ok: true });
});
