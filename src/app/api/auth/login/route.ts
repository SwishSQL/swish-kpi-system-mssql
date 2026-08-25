import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { db } from '@/lib/db';
import { wrap, clientInfo, ApiError } from '@/lib/api';
import { verifyPassword, normalizeEmail } from '@/lib/passwords';
import { createSession, MAX_FAILED_LOGINS, LOCKOUT_MINUTES } from '@/lib/auth';
import { rateLimit } from '@/lib/rateLimit';
import { logAudit } from '@/lib/audit';

export const dynamic = 'force-dynamic';

const bodySchema = z.object({
  email: z.string().min(3).max(200),
  password: z.string().min(1).max(200),
});

export const POST = wrap(async (req: NextRequest) => {
  const { ip, ua } = clientInfo(req);
  const body = bodySchema.parse(await req.json());
  const email = normalizeEmail(body.email);

  if (!rateLimit(`login:${ip}:${email}`, 10, 5 * 60 * 1000)) {
    throw new ApiError(429, 'Too many login attempts. Please wait a few minutes.');
  }

  const user = await db.user.findUnique({ where: { email } });
  const invalid = new ApiError(401, 'Invalid email or password.');

  if (!user || !user.isActive) {
    await logAudit(db, { action: 'LOGIN_FAILED', entityType: 'User', entityId: email, ipAddress: ip, userAgent: ua });
    throw invalid;
  }

  if (user.lockedUntil && user.lockedUntil > new Date()) {
    throw new ApiError(423, `Account temporarily locked. Try again after ${LOCKOUT_MINUTES} minutes.`);
  }

  const ok = await verifyPassword(body.password, user.passwordHash);
  if (!ok) {
    const attempts = user.failedLoginAttempts + 1;
    const lock = attempts >= MAX_FAILED_LOGINS;
    await db.user.update({
      where: { id: user.id },
      data: {
        failedLoginAttempts: lock ? 0 : attempts,
        lockedUntil: lock ? new Date(Date.now() + LOCKOUT_MINUTES * 60 * 1000) : null,
      },
    });
    await logAudit(db, { userId: user.id, action: 'LOGIN_FAILED', entityType: 'User', entityId: user.id, ipAddress: ip, userAgent: ua });
    if (lock) throw new ApiError(423, `Too many failed attempts. Account locked for ${LOCKOUT_MINUTES} minutes.`);
    throw invalid;
  }

  await db.user.update({
    where: { id: user.id },
    data: { failedLoginAttempts: 0, lockedUntil: null, lastLoginAt: new Date() },
  });
  await createSession(user.id, ip, ua);
  await logAudit(db, { userId: user.id, action: 'LOGIN', entityType: 'User', entityId: user.id, ipAddress: ip, userAgent: ua });

  return NextResponse.json({
    ok: true,
    mustChangePassword: user.mustChangePassword,
    fullName: user.fullName,
  });
});
