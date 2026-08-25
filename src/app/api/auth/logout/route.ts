import { NextRequest, NextResponse } from 'next/server';
import { wrap, clientInfo } from '@/lib/api';
import { destroyCurrentSession, getSessionUser } from '@/lib/auth';
import { logAudit } from '@/lib/audit';
import { db } from '@/lib/db';

export const dynamic = 'force-dynamic';

export const POST = wrap(async (req: NextRequest) => {
  const { ip, ua } = clientInfo(req);
  const user = await getSessionUser();
  await destroyCurrentSession();
  if (user) {
    await logAudit(db, { userId: user.id, action: 'LOGOUT', entityType: 'User', entityId: user.id, ipAddress: ip, userAgent: ua });
  }
  return NextResponse.json({ ok: true });
});
