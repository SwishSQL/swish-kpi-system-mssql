import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { db } from '@/lib/db';
import { wrap, getCtx, ApiError } from '@/lib/api';
import { hashPassword, verifyPassword, validatePasswordStrength } from '@/lib/passwords';
import { logAudit } from '@/lib/audit';

export const dynamic = 'force-dynamic';

const bodySchema = z.object({
  currentPassword: z.string().min(1).max(200),
  newPassword: z.string().min(1).max(200),
});

export const POST = wrap(async (req: NextRequest) => {
  const ctx = await getCtx(req, { allowMustChange: true });
  const body = bodySchema.parse(await req.json());

  const ok = await verifyPassword(body.currentPassword, ctx.user.passwordHash);
  if (!ok) throw new ApiError(400, 'Current password is incorrect.');

  const weak = validatePasswordStrength(body.newPassword);
  if (weak) throw new ApiError(400, weak);
  if (body.newPassword === ctx.user.employeeId) {
    throw new ApiError(400, 'The new password cannot be your Employee ID.');
  }
  if (body.newPassword === body.currentPassword) {
    throw new ApiError(400, 'The new password must be different from the current one.');
  }

  await db.user.update({
    where: { id: ctx.user.id },
    data: { passwordHash: await hashPassword(body.newPassword), mustChangePassword: false },
  });
  await logAudit(db, {
    userId: ctx.user.id,
    action: 'PASSWORD_CHANGED',
    entityType: 'User',
    entityId: ctx.user.id,
    ipAddress: ctx.ip,
    userAgent: ctx.ua,
  });

  return NextResponse.json({ ok: true });
});
