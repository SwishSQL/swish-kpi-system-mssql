import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { db } from '@/lib/db';
import { wrap, getCtx, ApiError } from '@/lib/api';
import { getPeriod } from '@/lib/submissions';
import { logAudit } from '@/lib/audit';
import { authorityOver } from '@/lib/approvals';

export const dynamic = 'force-dynamic';

const bodySchema = z.object({
  employeeProfileId: z.string().min(1),
  fromMonth: z.string().regex(/^\d{4}-\d{2}$/),
  toMonth: z.string().regex(/^\d{4}-\d{2}$/),
});

/**
 * Relabels everything an employee recorded for one month onto another -
 * the fix for the recurring mistake of entering last month's results under
 * the current month, which defaults open on the Submissions screen.
 *
 * Deliberately not offered to the employee themselves: authorityOver requires
 * review authority (their manager, department manager, compliance) or admin.
 * Nothing about the recorded numbers changes, only which month they sit under.
 */
export const POST = wrap(async (req: NextRequest) => {
  const ctx = await getCtx(req);
  const body = bodySchema.parse(await req.json());
  if (body.fromMonth === body.toMonth) throw new ApiError(400, 'The two months are the same.');

  const profile = await db.employeeProfile.findUnique({
    where: { id: body.employeeProfileId },
    select: { id: true, employeeId: true, fullName: true },
  });
  if (!profile) throw new ApiError(404, 'Employee not found.');

  const authority = await authorityOver(
    {
      profileId: ctx.profile?.id ?? null,
      employeeId: ctx.profile?.employeeId ?? null,
      systemRole: ctx.user.systemRole,
      perms: ctx.perms,
    },
    profile.id
  );
  if (!(authority.levels.length > 0 || authority.isAdmin)) {
    throw new ApiError(403, 'Only this employee\'s reviewer or an administrator can move a submission month.');
  }

  const toPeriod = await getPeriod(body.toMonth);
  if (toPeriod?.status === 'LOCKED') {
    throw new ApiError(409, `${body.toMonth} is locked and cannot receive moved results.`);
  }

  const fromSubs = await db.kpiSubmission.findMany({
    where: { employeeProfileId: profile.id, submissionMonth: body.fromMonth },
    include: { kpiAssignment: { select: { kpi: { select: { kpiCode: true } } } } },
  });
  if (fromSubs.length === 0) {
    throw new ApiError(404, `${profile.fullName} has nothing recorded for ${body.fromMonth}.`);
  }

  const targetConflict = await db.kpiSubmission.findFirst({
    where: { employeeProfileId: profile.id, submissionMonth: body.toMonth },
  });
  if (targetConflict) {
    throw new ApiError(
      409,
      `${profile.fullName} already has results recorded for ${body.toMonth} - move or clear those first so the two months don't merge.`
    );
  }

  const fromApproval = await db.submissionApproval.findUnique({
    where: { employeeProfileId_submissionMonth: { employeeProfileId: profile.id, submissionMonth: body.fromMonth } },
  });
  const toApprovalConflict = await db.submissionApproval.findUnique({
    where: { employeeProfileId_submissionMonth: { employeeProfileId: profile.id, submissionMonth: body.toMonth } },
  });

  await db.$transaction(async (tx) => {
    await tx.kpiSubmission.updateMany({
      where: { employeeProfileId: profile.id, submissionMonth: body.fromMonth },
      data: { submissionMonth: body.toMonth },
    });

    let approvalMoved = false;
    if (fromApproval && !toApprovalConflict) {
      await tx.submissionApproval.update({
        where: { id: fromApproval.id },
        data: { submissionMonth: body.toMonth },
      });
      approvalMoved = true;
    }

    await logAudit(tx, {
      userId: ctx.user.id,
      action: 'SUBMISSION_MONTH_CORRECTED',
      entityType: 'KpiSubmission',
      entityId: `${profile.employeeId}:${body.fromMonth}->${body.toMonth}`,
      oldValues: { submissionMonth: body.fromMonth, kpiCodes: fromSubs.map((s) => s.kpiAssignment.kpi.kpiCode) },
      newValues: { submissionMonth: body.toMonth, approvalMoved },
      ipAddress: ctx.ip,
      userAgent: ctx.ua,
    });
  });

  return NextResponse.json({
    ok: true,
    moved: fromSubs.length,
    codes: fromSubs.map((s) => s.kpiAssignment.kpi.kpiCode),
  });
});
