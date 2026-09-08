import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { db } from '@/lib/db';
import { wrap, getCtx, requirePerm, ApiError } from '@/lib/api';
import { logAudit } from '@/lib/audit';
import { notifyUsers } from '@/lib/notify';
import { rescoreOpenSubmissions } from '@/lib/submissions';

export const dynamic = 'force-dynamic';

const bodySchema = z.object({ reason: z.string().max(1000).optional() });

/**
 * Turns down a department head's edit: the KPI/assignment is reverted to
 * whatever it held before the edit (EditRequest.oldValues), and for an
 * assignment whose target/threshold moved, every submission that isn't
 * already APPROVED is rescored back the same way rescoreOpenSubmissions()
 * already handles a normal target/threshold edit.
 */
export const POST = wrap(async (req: NextRequest, { params }: { params: { id: string } }) => {
  const ctx = await getCtx(req);
  requirePerm(ctx, 'approvals.approve_compliance');
  const body = bodySchema.parse(await req.json().catch(() => ({})));
  const reason = body.reason?.trim() || 'No reason given.';

  const editRequest = await db.editRequest.findUnique({ where: { id: params.id } });
  if (!editRequest) throw new ApiError(404, 'Edit request not found.');
  if (editRequest.status !== 'PENDING') {
    throw new ApiError(409, 'This edit has already been reviewed.');
  }
  const oldValues = JSON.parse(editRequest.oldValues) as Record<string, number | string>;

  if (editRequest.entityType === 'KpiAssignment') {
    const assignment = await db.kpiAssignment.findUnique({
      where: { id: editRequest.entityId },
      include: { kpi: true },
    });
    if (!assignment) throw new ApiError(404, 'The assignment this edit applied to no longer exists.');

    await db.$transaction(async (tx) => {
      await tx.kpiAssignment.update({ where: { id: assignment.id }, data: oldValues });
      if ('target' in oldValues || 'threshold' in oldValues) {
        await rescoreOpenSubmissions(
          tx,
          {
            ...assignment,
            kpi: {
              varianceIndicator: assignment.kpi.varianceIndicator as 'U' | 'D',
              matrixType: assignment.kpi.matrixType as 'UNIT' | 'TIME' | 'PERCENTAGE',
            },
          },
          {
            target: Number(oldValues.target ?? assignment.target),
            threshold: Number(oldValues.threshold ?? assignment.threshold),
            weight: Number(oldValues.weight ?? assignment.weight),
          }
        );
      }
      await tx.editRequest.update({
        where: { id: editRequest.id },
        data: { status: 'REJECTED', rejectionReason: reason, reviewedByUserId: ctx.user.id, reviewedAt: new Date() },
      });
      await logAudit(tx, {
        userId: ctx.user.id,
        action: 'EDIT_REQUEST_REJECTED',
        entityType: 'KpiAssignment',
        entityId: assignment.id,
        oldValues: JSON.parse(editRequest.newValues),
        newValues: { ...oldValues, reason },
        ipAddress: ctx.ip,
        userAgent: ctx.ua,
      });
    });
  } else if (editRequest.entityType === 'Kpi') {
    const kpi = await db.kpi.findUnique({ where: { id: editRequest.entityId } });
    if (!kpi) throw new ApiError(404, 'The KPI this edit applied to no longer exists.');

    await db.$transaction(async (tx) => {
      await tx.kpi.update({ where: { id: kpi.id }, data: oldValues });
      await tx.editRequest.update({
        where: { id: editRequest.id },
        data: { status: 'REJECTED', rejectionReason: reason, reviewedByUserId: ctx.user.id, reviewedAt: new Date() },
      });
      await logAudit(tx, {
        userId: ctx.user.id,
        action: 'EDIT_REQUEST_REJECTED',
        entityType: 'Kpi',
        entityId: kpi.id,
        oldValues: JSON.parse(editRequest.newValues),
        newValues: { ...oldValues, reason },
        ipAddress: ctx.ip,
        userAgent: ctx.ua,
      });
    });
  } else {
    throw new ApiError(400, `Unknown edit request entity type: ${editRequest.entityType}`);
  }

  await notifyUsers(db, [editRequest.requestedByUserId], {
    type: 'EDIT_REQUEST_REJECTED',
    title: 'Your edit was rejected',
    message: `Compliance rejected your change to ${editRequest.entityType === 'Kpi' ? 'a KPI' : 'an assignment'}: ${reason}`,
    entityType: editRequest.entityType,
    entityId: editRequest.entityId,
    link: '/admin',
  });

  return NextResponse.json({ ok: true });
});
