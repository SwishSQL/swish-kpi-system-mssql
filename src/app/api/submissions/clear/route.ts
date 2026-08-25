import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { db } from '@/lib/db';
import { wrap, getCtx, ApiError } from '@/lib/api';
import { canAccessProfile } from '@/lib/access';
import { getPeriod, periodIsEditable } from '@/lib/submissions';
import { logAudit } from '@/lib/audit';
import { authorityOver, monthKey, monthWithinWindow, STAGE_LABEL, Stage } from '@/lib/approvals';

export const dynamic = 'force-dynamic';

const bodySchema = z.object({
  employeeProfileId: z.string().min(1),
  month: z.string().regex(/^\d{4}-\d{2}$/),
});

/**
 * Clears everything one employee has recorded for a month in a single step:
 * every result, comment and attachment, and the approval chain that was opened
 * for them. The month goes back to Not started and can be entered again.
 *
 * Same rules as clearing a single row - staff cannot wipe results that have
 * already gone up for review, and a reviewer doing it leaves an audit trail.
 */
export const POST = wrap(async (req: NextRequest) => {
  const ctx = await getCtx(req);
  const body = bodySchema.parse(await req.json());

  const canSubmit = await canAccessProfile(ctx, body.employeeProfileId, true);
  if (!canSubmit) throw new ApiError(403, 'You cannot change results for this employee.');

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
  const isReviewer = authority.levels.length > 0 || authority.isAdmin;

  const period = await getPeriod(body.month);
  const withinBacklog = monthWithinWindow(body.month, monthKey(new Date()), isReviewer);
  const editable = periodIsEditable(period, withinBacklog);
  if (!editable.editable) throw new ApiError(409, editable.reason || 'This month is not editable.');

  const submissions = await db.kpiSubmission.findMany({
    where: { employeeProfileId: profile.id, submissionMonth: body.month },
    include: {
      kpiAssignment: { select: { kpi: { select: { kpiCode: true } } } },
      _count: { select: { attachments: true } },
    },
  });
  if (submissions.length === 0) {
    throw new ApiError(404, `${profile.fullName} has nothing recorded for ${body.month}.`);
  }

  const locked = submissions.filter((s) => s.submissionStatus === 'LOCKED');
  if (locked.length > 0) {
    throw new ApiError(
      409,
      `Locked and cannot be cleared: ${locked.map((s) => s.kpiAssignment.kpi.kpiCode).join(', ')}.`
    );
  }

  const approval = await db.submissionApproval.findUnique({
    where: {
      employeeProfileId_submissionMonth: { employeeProfileId: profile.id, submissionMonth: body.month },
    },
  });
  if (approval && !isReviewer) {
    throw new ApiError(
      409,
      approval.stage === 'APPROVED'
        ? 'These results are approved and can no longer be cleared.'
        : `These results are already under review (${STAGE_LABEL[approval.stage as Stage]}) and can no longer be cleared.`
    );
  }

  const codes = submissions.map((s) => s.kpiAssignment.kpi.kpiCode);
  const attachmentCount = submissions.reduce((sum, s) => sum + s._count.attachments, 0);

  await db.$transaction(async (tx) => {
    // Attachments and approval events cascade from these two deletes.
    await tx.kpiSubmission.deleteMany({
      where: { employeeProfileId: profile.id, submissionMonth: body.month },
    });
    if (approval) await tx.submissionApproval.delete({ where: { id: approval.id } });

    await logAudit(tx, {
      userId: ctx.user.id,
      action: 'SUBMISSION_MONTH_CLEARED',
      entityType: 'KpiSubmission',
      entityId: `${profile.employeeId}:${body.month}`,
      oldValues: {
        employeeId: profile.employeeId,
        employeeName: profile.fullName,
        month: body.month,
        kpiCodes: codes,
        results: submissions.map((s) => ({
          kpiCode: s.kpiAssignment.kpi.kpiCode,
          actualResult: s.actualResult,
          calculatedScore: s.calculatedScore,
          submissionStatus: s.submissionStatus,
        })),
        attachments: attachmentCount,
        approvalStage: approval?.stage ?? null,
      },
      ipAddress: ctx.ip,
      userAgent: ctx.ua,
    });
  });

  return NextResponse.json({
    ok: true,
    cleared: submissions.length,
    attachments: attachmentCount,
    codes,
  });
});
