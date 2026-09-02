import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { wrap, getCtx, requirePerm, ApiError } from '@/lib/api';
import { logAudit } from '@/lib/audit';
import { notifyUsers } from '@/lib/notify';

export const dynamic = 'force-dynamic';

/** Moves a department head's proposed KPI live: assignable, and due once assigned. */
export const POST = wrap(async (req: NextRequest, { params }: { params: { id: string } }) => {
  const ctx = await getCtx(req);
  requirePerm(ctx, 'kpi_library.approve');

  const kpi = await db.kpi.findUnique({ where: { id: params.id } });
  if (!kpi) throw new ApiError(404, 'KPI not found.');
  if (kpi.approvalStatus !== 'PENDING') {
    throw new ApiError(409, `${kpi.kpiCode} is not awaiting approval.`);
  }

  await db.$transaction(async (tx) => {
    await tx.kpi.update({
      where: { id: kpi.id },
      data: { approvalStatus: 'APPROVED', rejectionReason: '' },
    });
    await logAudit(tx, {
      userId: ctx.user.id,
      action: 'KPI_APPROVED',
      entityType: 'Kpi',
      entityId: kpi.id,
      oldValues: { approvalStatus: kpi.approvalStatus },
      newValues: { approvalStatus: 'APPROVED', kpiCode: kpi.kpiCode },
      ipAddress: ctx.ip,
      userAgent: ctx.ua,
    });
  });

  if (kpi.createdByUserId) {
    await notifyUsers(db, [kpi.createdByUserId], {
      type: 'KPI_APPROVED',
      title: 'Your proposed KPI was approved',
      message: `${kpi.kpiCode} - ${kpi.kpiName} is now live and can be assigned.`,
      entityType: 'Kpi',
      entityId: kpi.id,
      link: '/admin',
    });
  }

  return NextResponse.json({ ok: true, kpiCode: kpi.kpiCode, approvalStatus: 'APPROVED' });
});
