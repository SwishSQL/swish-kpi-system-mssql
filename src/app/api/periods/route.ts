import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { db } from '@/lib/db';
import { wrap, getCtx, requirePerm, ApiError } from '@/lib/api';
import { logAudit } from '@/lib/audit';

export const dynamic = 'force-dynamic';

export const GET = wrap(async (req: NextRequest) => {
  const ctx = await getCtx(req);
  const periods = await db.submissionPeriod.findMany({
    orderBy: [{ year: 'desc' }, { month: 'desc' }],
    take: 36,
  });
  return NextResponse.json({ periods, canManage: ctx.perms.has('periods.manage') });
});

const createSchema = z.object({
  month: z.number().int().min(1).max(12),
  year: z.number().int().min(2000).max(2100),
  deadlineAt: z.string().nullable().optional(),
  gracePeriodEndsAt: z.string().nullable().optional(),
});

export const POST = wrap(async (req: NextRequest) => {
  const ctx = await getCtx(req);
  requirePerm(ctx, 'periods.manage');
  const body = createSchema.parse(await req.json());

  const existing = await db.submissionPeriod.findUnique({
    where: { year_month: { year: body.year, month: body.month } },
  });
  if (existing) throw new ApiError(409, 'This submission month already exists.');

  const period = await db.submissionPeriod.create({
    data: {
      month: body.month,
      year: body.year,
      status: 'OPEN',
      opensAt: new Date(),
      deadlineAt: body.deadlineAt ? new Date(body.deadlineAt) : null,
      gracePeriodEndsAt: body.gracePeriodEndsAt ? new Date(body.gracePeriodEndsAt) : null,
    },
  });
  await logAudit(db, {
    userId: ctx.user.id,
    action: 'PERIOD_CREATED',
    entityType: 'SubmissionPeriod',
    entityId: period.id,
    newValues: body,
    ipAddress: ctx.ip,
    userAgent: ctx.ua,
  });
  return NextResponse.json({ ok: true, id: period.id });
});
