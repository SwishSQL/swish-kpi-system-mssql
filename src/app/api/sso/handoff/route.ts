/**
 * SWiSH World single sign-on handoff - KPI Management
 * ===================================================
 * SWiSH World (world.swishhh.net) opens KPI through
 *
 *     GET /api/sso/handoff?token=<60-second JWT>
 *
 * The token is signed with the shared secret (HS256, issuer "swish-task-hub",
 * audience "KPI") and carries the person's e-mail. We match it to a KPI user,
 * create a normal dbo.Session row (exactly what the login form does through
 * createSession() in src/lib/auth.ts) and answer with a 303 redirect that
 * carries the kpi_session cookie - the same effect as logging in, without the
 * login form.
 *
 * Configuration (KPI side, .env - restart `next start` after editing):
 *   TASK_HUB_SSO_SECRET=<same value as SSO_SECRET_KPI in SWiSH World's .env>
 *   TASK_HUB_SOURCE_CODE=KPI   (optional - only if SWiSH World issues another code)
 *   APP_URL=https://kpi.swishhh.net   (the public host; used for the returnUrl host check)
 *
 * Nothing to mount: the App Router serves this file at GET /api/sso/handoff and
 * src/middleware.ts lets every /api/* path through unauthenticated. The role in
 * the token is informational only - authorisation always comes from the KPI
 * user row (systemRole + permissions), never from the token.
 */

import { NextRequest, NextResponse } from 'next/server';
import type { User } from '@prisma/client';
import * as jwt from 'jsonwebtoken';
import { db } from '@/lib/db';
import { clientInfo } from '@/lib/api';
import { normalizeEmail } from '@/lib/passwords';
import { issueSession, sessionCookieOptions, SESSION_COOKIE } from '@/lib/auth';
import { rateLimit } from '@/lib/rateLimit';
import { logAudit } from '@/lib/audit';

export const dynamic = 'force-dynamic';

/** Audience SWiSH World puts in the token = the Source app code configured there. */
const SOURCE_CODE = (process.env.TASK_HUB_SOURCE_CODE || 'KPI').trim();
const ISSUER = 'swish-task-hub';
/** Roles a hub identity mapping may never point at (a mapping cannot hand out admin access). */
const ADMIN_ROLES = new Set(['SUPER_ADMIN', 'ADMIN']);

interface HandoffClaims {
  email?: string;
  name?: string;
  role?: string;
  returnUrl?: string;
  /** Optional: the KPI employeeId / user id SWiSH World knows for this person (Settings -> Identity mapping). */
  sourceUsername?: string;
  sourceUserId?: string;
  sourceName?: string;
}

function sharedSecret(): string {
  return (process.env.TASK_HUB_SSO_SECRET || '').trim();
}

function plain(status: number, message: string): NextResponse {
  return new NextResponse(message, {
    status,
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'no-store, private',
      'Referrer-Policy': 'no-referrer',
    },
  });
}

/** Relative Location header: works behind IIS/ARR whatever host it forwards, and can never point off-site. */
function redirectTo(path: string): NextResponse {
  const res = new NextResponse(null, { status: 303 });
  res.headers.set('Location', path);
  res.headers.set('Cache-Control', 'no-store, private');
  res.headers.set('Referrer-Policy', 'no-referrer');
  return res;
}

function loginRedirect(reason: string, email: string): NextResponse {
  const params = new URLSearchParams({ sso: reason });
  if (email) params.set('email', email);
  return redirectTo(`/login?${params.toString()}`);
}

function firstHeader(req: NextRequest, name: string): string | null {
  const value = req.headers.get(name);
  if (!value) return null;
  const first = value.split(',')[0]?.trim().toLowerCase();
  return first || null;
}

/** Hosts this KPI instance answers on: the request host, the IIS-forwarded host and APP_URL. */
function ownHosts(req: NextRequest): Set<string> {
  const hosts = new Set<string>();
  for (const name of ['x-forwarded-host', 'x-original-host', 'host']) {
    const value = firstHeader(req, name);
    if (value) hosts.add(value);
  }
  try {
    if (process.env.APP_URL) hosts.add(new URL(process.env.APP_URL).host.toLowerCase());
  } catch {
    /* ignore a malformed APP_URL */
  }
  try {
    hosts.add(req.nextUrl.host.toLowerCase());
  } catch {
    /* ignore */
  }
  return hosts;
}

/**
 * Where to land. Only paths on this KPI host are accepted, the auth pages and
 * the API are replaced by the home page (the person is signed in now), and
 * anything else falls back to "/" so a token can never redirect to a foreign
 * site. Deep links from SWiSH World (/?month=YYYY-MM&employee=<id>, /admin)
 * pass through unchanged.
 */
function landingPath(req: NextRequest, returnUrl: string | undefined): string {
  if (!returnUrl) return '/';
  try {
    const url = new URL(returnUrl, req.nextUrl.origin);
    if (!ownHosts(req).has(url.host.toLowerCase())) return '/';
    if (/^\/(login|change-password|api)(\/|$)/i.test(url.pathname)) return '/';
    const path = `${url.pathname}${url.search}${url.hash}`;
    return path.startsWith('/') && !path.startsWith('//') && !path.startsWith('/\\') ? path : '/';
  } catch {
    return '/';
  }
}

export async function GET(req: NextRequest) {
  try {
    return await handoff(req);
  } catch (err) {
    // Never log the request URL here - it carries the token.
    console.error('[sso] handoff failed:', err instanceof Error ? err.message : err);
    return plain(500, 'KPI could not complete the SWiSH World sign-in (server or database error). Try again, or sign in with your e-mail and password.');
  }
}

async function handoff(req: NextRequest): Promise<NextResponse> {
  const secret = sharedSecret();
  if (secret.length < 32) {
    return plain(
      500,
      'TASK_HUB_SSO_SECRET is not configured on KPI (it must be the 64-character value from SWiSH World and at least 32 characters long). Ask IT.'
    );
  }

  const { ip, ua } = clientInfo(req);
  if (!rateLimit(`sso:${ip ?? 'unknown'}`, 20, 5 * 60 * 1000)) {
    return plain(429, 'Too many sign-in attempts. Please wait a few minutes and open KPI from SWiSH World again.');
  }

  const token = req.nextUrl.searchParams.get('token') ?? '';
  let claims: HandoffClaims;
  try {
    claims = jwt.verify(token, secret, {
      algorithms: ['HS256'],
      issuer: ISSUER,
      audience: SOURCE_CODE,
    }) as HandoffClaims;
  } catch {
    return plain(
      401,
      'This SWiSH World sign-in link is invalid or has expired (links last 60 seconds). Go back to SWiSH World and open KPI again.'
    );
  }

  const email = normalizeEmail(String(claims.email ?? ''));
  if (!email) {
    return plain(401, 'The SWiSH World sign-in token did not include an e-mail address.');
  }

  const failed = async (reason: string, userId?: string | null) => {
    try {
      await logAudit(db, {
        userId: userId ?? null,
        action: 'LOGIN_FAILED',
        entityType: 'User',
        entityId: userId ?? email,
        newValues: { via: 'swish-world-sso', reason },
        ipAddress: ip,
        userAgent: ua,
      });
    } catch (err) {
      console.warn('[sso] could not write LOGIN_FAILED audit row:', err instanceof Error ? err.message : err);
    }
  };

  // 1) e-mail (the KPI login name IS the work e-mail; User.email is unique and
  //    stored lowercased). 2) the KPI employeeId SWiSH World mapped to this
  //    person. 3) the mapped KPI user id.
  const byEmail = await db.user.findMany({ where: { email }, take: 2 });
  if (byEmail.length > 1) {
    await failed('ambiguous-email');
    return loginRedirect('ambiguous', email);
  }
  let user: User | null = byEmail[0] ?? null;

  if (!user) {
    const sourceUsername = String(claims.sourceUsername ?? '').trim();
    const sourceUserId = String(claims.sourceUserId ?? '').trim();
    if (sourceUsername) {
      user = await db.user.findUnique({ where: { employeeId: sourceUsername } });
      if (!user) user = await db.user.findUnique({ where: { email: normalizeEmail(sourceUsername) } });
    }
    if (!user && sourceUserId) {
      user = await db.user.findUnique({ where: { id: sourceUserId } });
    }
    // A mapping may only point at an account that has no e-mail of its own (or
    // the same one), and never at an administrator - a hub admin cannot map
    // themselves into someone else's KPI account.
    if (user) {
      const ownEmail = normalizeEmail(user.email ?? '');
      if ((ownEmail && ownEmail !== email) || ADMIN_ROLES.has(user.systemRole)) {
        await failed('mapping-refused', user.id);
        return loginRedirect('mapping-refused', email);
      }
    }
  }

  if (!user) {
    await failed('no-user');
    return loginRedirect('no-user', email);
  }
  if (!user.isActive) {
    await failed('disabled', user.id);
    return loginRedirect('disabled', email);
  }
  if (user.lockedUntil && user.lockedUntil > new Date()) {
    await failed('locked', user.id);
    return loginRedirect('disabled', email);
  }

  // Same bookkeeping as POST /api/auth/login on success.
  await db.user.update({
    where: { id: user.id },
    data: { failedLoginAttempts: 0, lockedUntil: null, lastLoginAt: new Date() },
  });
  const { token: sessionToken } = await issueSession(user.id, ip, ua);
  await logAudit(db, {
    userId: user.id,
    action: 'LOGIN',
    entityType: 'User',
    entityId: user.id,
    newValues: { via: 'swish-world-sso' },
    ipAddress: ip,
    userAgent: ua,
  });

  // First login still has to set a password - AppContext would bounce there anyway.
  const target = user.mustChangePassword ? '/change-password' : landingPath(req, claims.returnUrl);
  const res = redirectTo(target);
  res.cookies.set(SESSION_COOKIE, sessionToken, sessionCookieOptions());
  return res;
}
