import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { db } from '@/lib/db';
import { wrap, getCtx, requirePerm, ApiError } from '@/lib/api';
import { hashPassword } from '@/lib/passwords';
import { logAudit } from '@/lib/audit';
import { revokeAllSessions } from '@/lib/auth';

export const dynamic = 'force-dynamic';

const bodySchema = z.object({
  temporaryPassword: z.string().max(200).optional().nullable(),
});

export const POST = wrap(async (req: NextRequest, { params }: { params: { id: string } }) => {
  const ctx = await getCtx(req);
  requirePerm(ctx, 'users.reset_password');
  const body = bodySchema.parse(await req.json().catch(() => ({})));

  const target = await db.user.findUnique({ where: { id: params.id } });
  if (!target) throw new ApiError(404, 'User not found.');

  // Default temporary password is the Employee ID; the user must change it on first login.
  const tempPassword = body.temporaryPassword?.trim() || target.employeeId;

  await db.user.update({
    where: { id: target.id },
    data: {
      passwordHash: await hashPassword(tempPassword),
      mustChangePassword: true,
      failedLoginAttempts: 0,
      lockedUntil: null,
    },
  });
  await revokeAllSessions(target.id);
  await logAudit(db, {
    userId: ctx.user.id,
    action: 'PASSWORD_RESET',
    entityType: 'User',
    entityId: target.id,
    ipAddress: ctx.ip,
    userAgent: ctx.ua,
  });

  return NextResponse.json({
    ok: true,
    note: body.temporaryPassword
      ? 'Temporary password set to the value you provided.'
      : 'Temporary password reset to the Employee ID.',
  });
});
