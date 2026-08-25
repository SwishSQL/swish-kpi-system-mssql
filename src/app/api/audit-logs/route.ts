import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { parseJsonColumn } from '@/lib/audit';
import { wrap, getCtx, requirePerm } from '@/lib/api';

export const dynamic = 'force-dynamic';

export const GET = wrap(async (req: NextRequest) => {
  const ctx = await getCtx(req);
  requirePerm(ctx, 'audit_logs.view');
  const sp = req.nextUrl.searchParams;
  const action = sp.get('action') || undefined;
  const entityType = sp.get('entityType') || undefined;
  const q = sp.get('q')?.trim() || '';
  const page = Math.max(1, Number(sp.get('page')) || 1);
  const pageSize = 50;

  const where = {
    ...(action ? { action } : {}),
    ...(entityType ? { entityType } : {}),
    ...(q
      ? {
          OR: [
            { user: { fullName: { contains: q } } },
            { user: { email: { contains: q } } },
            { entityId: { contains: q } },
          ],
        }
      : {}),
  };

  const [logs, totalCount] = await Promise.all([
    db.auditLog.findMany({
      where,
      include: { user: { select: { fullName: true, email: true } } },
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    db.auditLog.count({ where }),
  ]);

  return NextResponse.json({
    logs: logs.map((l) => ({
      id: l.id,
      userName: l.user?.fullName ?? 'System',
      action: l.action,
      entityType: l.entityType,
      entityId: l.entityId,
      oldValues: parseJsonColumn(l.oldValues),
      newValues: parseJsonColumn(l.newValues),
      ipAddress: l.ipAddress,
      createdAt: l.createdAt,
    })),
    page,
    totalPages: Math.max(1, Math.ceil(totalCount / pageSize)),
    totalCount,
  });
});
