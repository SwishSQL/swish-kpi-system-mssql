import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { wrap, getCtx, requirePerm, ApiError } from '@/lib/api';
import { logAudit } from '@/lib/audit';
import { notifyUsers } from '@/lib/notify';

export const dynamic = 'force-dynamic';

/**
 * A department head's edit to a KPI or assignment is already live (see the
 * PATCH handlers) - this just clears the flag. Nothing about the applied
 * values changes.
 */
export const POST = wrap(async (req: NextRequest, { params }: { params: { id: string } }) => {
  const ctx = await getCtx(req);
  requirePerm(ctx, 'approvals.approve_compliance');

  const editRequest = await db.editRequest.findUnique({ where: { id: params.id } });
  if (!editRequest) throw new ApiError(404, 'Edit request not found.');
  if (editRequest.status !== 'PENDING') {
    throw new ApiError(409, 'This edit has already been reviewed.');
  }

  await db.$transaction(async (tx) => {
    await tx.editRequest.update({
      where: { id: editRequest.id },
      data: { status: 'APPROVED', reviewedByUserId: ctx.user.id, reviewedAt: new Date() },
    });
    await logAudit(tx, {
      userId: ctx.user.id,
      action: 'EDIT_REQUEST_APPROVED',
      entityType: editRequest.entityType,
      entityId: editRequest.entityId,
      oldValues: JSON.parse(editRequest.oldValues),
      newValues: JSON.parse(editRequest.newValues),
      ipAddress: ctx.ip,
      userAgent: ctx.ua,
    });
  });

  await notifyUsers(db, [editRequest.requestedByUserId], {
    type: 'EDIT_REQUEST_APPROVED',
    title: 'Your edit was approved',
    message: `Compliance approved your change to ${editRequest.entityType === 'Kpi' ? 'a KPI' : 'an assignment'}.`,
    entityType: editRequest.entityType,
    entityId: editRequest.entityId,
    link: '/admin',
  });

  return NextResponse.json({ ok: true });
});
