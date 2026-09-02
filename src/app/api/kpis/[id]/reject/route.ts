import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { db } from '@/lib/db';
import { wrap, getCtx, requirePerm, ApiError } from '@/lib/api';
import { logAudit } from '@/lib/audit';
import { notifyUsers } from '@/lib/notify';

export const dynamic = 'force-dynamic';

const bodySchema = z.object({ reason: z.string().max(1000).optional() });

/**
 * Turns down a department head's proposal. The KPI stays in the library,
 * marked REJECTED, rather than being deleted - it is a record of what was
 * asked for and why it was refused. A rejected KPI can never be assigned;
 * see the guard in POST /api/assignments.
 */
export const POST = wrap(async (req: NextRequest, { params }: { params: { id: string } }) => {
  const ctx = await getCtx(req);
  requirePerm(ctx, 'kpi_library.approve');
  const body = bodySchema.parse(await req.json().catch(() => ({})));

  const kpi = await db.kpi.findUnique({ where: { id: params.id } });
  if (!kpi) throw new ApiError(404, 'KPI not found.');
  if (kpi.approvalStatus !== 'PENDING') {
    throw new ApiError(409, `${kpi.kpiCode} is not awaiting approval.`);
  }

  const reason = body.reason?.trim() || 'No reason given.';

  await db.$transaction(async (tx) => {
    await tx.kpi.update({
      where: { id: kpi.id },
      data: { approvalStatus: 'REJECTED', rejectionReason: reason },
    });
    await logAudit(tx, {
      userId: ctx.user.id,
      action: 'KPI_REJECTED',
      entityType: 'Kpi',
      entityId: kpi.id,
      oldValues: { approvalStatus: kpi.approvalStatus },
      newValues: { approvalStatus: 'REJECTED', kpiCode: kpi.kpiCode, reason },
      ipAddress: ctx.ip,
      userAgent: ctx.ua,
    });
  });

  if (kpi.createdByUserId) {
    await notifyUsers(db, [kpi.createdByUserId], {
      type: 'KPI_REJECTED',
      title: 'Your proposed KPI was not approved',
      message: `${kpi.kpiCode} - ${kpi.kpiName}: ${reason}`,
      entityType: 'Kpi',
      entityId: kpi.id,
      link: '/admin',
    });
  }

  return NextResponse.json({ ok: true, kpiCode: kpi.kpiCode, approvalStatus: 'REJECTED' });
});
