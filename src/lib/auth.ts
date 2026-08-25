import crypto from 'crypto';
import { cookies } from 'next/headers';
import { db } from './db';

export const SESSION_COOKIE = 'kpi_session';
const SESSION_TTL_HOURS = 12;
export const MAX_FAILED_LOGINS = 5;
export const LOCKOUT_MINUTES = 15;

function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

export async function createSession(userId: string, ipAddress?: string | null, userAgent?: string | null) {
  const token = crypto.randomBytes(32).toString('hex');
  const expiresAt = new Date(Date.now() + SESSION_TTL_HOURS * 3600 * 1000);
  await db.session.create({
    data: { tokenHash: hashToken(token), userId, ipAddress, userAgent, expiresAt },
  });
  cookies().set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: SESSION_TTL_HOURS * 3600,
  });
}

export async function destroyCurrentSession() {
  const token = cookies().get(SESSION_COOKIE)?.value;
  if (token) {
    await db.session.updateMany({
      where: { tokenHash: hashToken(token) },
      data: { revokedAt: new Date() },
    });
  }
  cookies().delete(SESSION_COOKIE);
}

export async function revokeAllSessions(userId: string) {
  await db.session.updateMany({
    where: { userId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
}

export async function getSessionUser() {
  const token = cookies().get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const session = await db.session.findUnique({
    where: { tokenHash: hashToken(token) },
    include: { user: { include: { employeeProfile: { include: { department: true } } } } },
  });
  if (!session) return null;
  if (session.revokedAt || session.expiresAt < new Date()) return null;
  if (!session.user.isActive) return null;
  return session.user;
}
