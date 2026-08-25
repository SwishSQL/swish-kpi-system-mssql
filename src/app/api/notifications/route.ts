import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { db } from '@/lib/db';
import { wrap, getCtx } from '@/lib/api';

export const dynamic = 'force-dynamic';

export const GET = wrap(async (req: NextRequest) => {
  const ctx = await getCtx(req);
  const notifications = await db.notification.findMany({
    where: { recipientUserId: ctx.user.id },
    orderBy: { createdAt: 'desc' },
    take: 50,
    select: {
      id: true, type: true, title: true, message: true,
      link: true, isRead: true, createdAt: true,
    },
  });
  const unread = await db.notification.count({
    where: { recipientUserId: ctx.user.id, isRead: false },
  });
  return NextResponse.json({ notifications, unread });
});

const readSchema = z.object({
  ids: z.array(z.string()).optional(),
  all: z.boolean().optional(),
});

export const POST = wrap(async (req: NextRequest) => {
  const ctx = await getCtx(req);
  const body = readSchema.parse(await req.json());
  await db.notification.updateMany({
    where: {
      recipientUserId: ctx.user.id,
      ...(body.all ? {} : { id: { in: body.ids ?? [] } }),
    },
    data: { isRead: true },
  });
  return NextResponse.json({ ok: true });
});
