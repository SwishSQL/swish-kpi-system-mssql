import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { db } from '@/lib/db';
import { wrap, getCtx, requirePerm, ApiError } from '@/lib/api';
import { logAudit } from '@/lib/audit';
import { notifyUsers, submissionLink } from '@/lib/notify';

export const dynamic = 'force-dynamic';

const patchSchema = z.object({
  action: z.enum(['open', 'close', 'lock', 'reopen', 'update']),
  deadlineAt: z.string().nullable().optional(),
  gracePeriodEndsAt: z.string().nullable().optional(),
});

export const PATCH = wrap(async (req: NextRequest, { params }: { params: { id: string } }) => {
  const ctx = await getCtx(req);
  requirePerm(ctx, 'periods.manage');
  const body = patchSchema.parse(await req.json());

  const period = await db.submissionPeriod.findUnique({ where: { id: params.id } });
  if (!period) throw new ApiError(404, 'Period not found.');
  const monthKey = `${period.year}-${String(period.month).padStart(2, '0')}`;

  await db.$transaction(async (tx) => {
    if (body.action === 'open') {
      await tx.submissionPeriod.update({
        where: { id: period.id },
        data: { status: 'OPEN', opensAt: period.opensAt ?? new Date() },
      });
    } else if (body.action === 'close') {
      await tx.submissionPeriod.update({ where: { id: period.id }, data: { status: 'CLOSED' } });
    } else if (body.action === 'lock') {
      await tx.submissionPeriod.update({
        where: { id: period.id },
        data: { status: 'LOCKED', lockedAt: new Date() },
      });
      await tx.kpiSubmission.updateMany({
        where: { submissionMonth: monthKey, submissionStatus: { in: ['SUBMITTED', 'UPDATED', 'REOPENED'] } },
        data: { submissionStatus: 'LOCKED', lockedAt: new Date() },
      });
    } else if (body.action === 'reopen') {
      await tx.submissionPeriod.update({
        where: { id: period.id },
        data: { status: 'OPEN', reopenedAt: new Date(), lockedAt: null },
      });
      await tx.kpiSubmission.updateMany({
        where: { submissionMonth: monthKey, submissionStatus: 'LOCKED' },
        data: { submissionStatus: 'REOPENED', lockedAt: null },
      });
    }
    if (body.deadlineAt !== undefined || body.gracePeriodEndsAt !== undefined) {
      await tx.submissionPeriod.update({
        where: { id: period.id },
        data: {
          deadlineAt: body.deadlineAt === undefined ? undefined : body.deadlineAt ? new Date(body.deadlineAt) : null,
          gracePeriodEndsAt:
            body.gracePeriodEndsAt === undefined
              ? undefined
              : body.gracePeriodEndsAt
                ? new Date(body.gracePeriodEndsAt)
                : null,
        },
      });
    }
    await logAudit(tx, {
      userId: ctx.user.id,
      action: `PERIOD_${body.action.toUpperCase()}`,
      entityType: 'SubmissionPeriod',
      entityId: period.id,
      oldValues: { status: period.status },
      newValues: body,
      ipAddress: ctx.ip,
      userAgent: ctx.ua,
    });

    if (body.action === 'lock' || body.action === 'reopen') {
      const affected = await tx.kpiSubmission.findMany({
        where: { submissionMonth: monthKey },
        select: { employee: { select: { userId: true } } },
        distinct: ['employeeProfileId'],
      });
      const userIds = affected.map((a) => a.employee.userId).filter((x): x is string => !!x);
      await notifyUsers(tx, userIds, {
        type: body.action === 'lock' ? 'PERIOD_LOCKED' : 'SUBMISSION_REOPENED',
        title: body.action === 'lock' ? `Period ${monthKey} locked` : `Period ${monthKey} reopened`,
        message:
          body.action === 'lock'
            ? `The submission month ${monthKey} has been locked. Results can no longer be edited.`
            : `The submission month ${monthKey} has been reopened for edits.`,
        entityType: 'SubmissionPeriod',
        entityId: period.id,
        link: submissionLink(monthKey),
      });
    }
  });

  return NextResponse.json({ ok: true });
});
