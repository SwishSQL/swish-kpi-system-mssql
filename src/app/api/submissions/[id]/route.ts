import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { wrap, getCtx, ApiError } from '@/lib/api';
import { canAccessProfile } from '@/lib/access';
import { getPeriod, periodIsEditable } from '@/lib/submissions';
import { logAudit } from '@/lib/audit';
import { authorityOver, monthKey, monthWithinWindow, STAGE_LABEL, Stage } from '@/lib/approvals';

export const dynamic = 'force-dynamic';

/**
 * Clears one KPI result: the recorded value, its attachments and its comment,
 * putting the row back to Not started so it can be entered again.
 *
 * This is a correction tool, not a way around the approval chain. An employee
 * cannot clear a result once it has gone up for review - that is the reviewer's
 * copy of the numbers - and an approved month can only be cleared by someone
 * with review authority, whose action is recorded on the chain.
 */
export const DELETE = wrap(async (req: NextRequest, { params }: { params: { id: string } }) => {
  const ctx = await getCtx(req);

  const submission = await db.kpiSubmission.findUnique({
    where: { id: params.id },
    include: {
      kpiAssignment: { include: { kpi: true } },
      employee: { select: { id: true, employeeId: true, fullName: true } },
      _count: { select: { attachments: true } },
    },
  });
  if (!submission) throw new ApiError(404, 'Submission not found.');

  const canSubmit = await canAccessProfile(ctx, submission.employeeProfileId, true);
  if (!canSubmit) throw new ApiError(403, 'You cannot change results for this employee.');

  if (submission.submissionStatus === 'LOCKED') {
    throw new ApiError(409, 'This result is locked and cannot be cleared.');
  }

  const period = await getPeriod(submission.submissionMonth);
  const authority = await authorityOver(
    {
      profileId: ctx.profile?.id ?? null,
      employeeId: ctx.profile?.employeeId ?? null,
      systemRole: ctx.user.systemRole,
      perms: ctx.perms,
    },
    submission.employeeProfileId
  );
  const isReviewer = authority.levels.length > 0 || authority.isAdmin;

  const withinBacklog = monthWithinWindow(submission.submissionMonth, monthKey(new Date()), isReviewer);
  const editable = periodIsEditable(period, withinBacklog);
  if (!editable.editable) throw new ApiError(409, editable.reason || 'This month is not editable.');

  const approval = await db.submissionApproval.findUnique({
    where: {
      employeeProfileId_submissionMonth: {
        employeeProfileId: submission.employeeProfileId,
        submissionMonth: submission.submissionMonth,
      },
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

  // Anything else recorded for this employee-month decides whether the approval
  // chain still has something to review.
  const siblingCount = await db.kpiSubmission.count({
    where: {
      employeeProfileId: submission.employeeProfileId,
      submissionMonth: submission.submissionMonth,
      id: { not: submission.id },
      submissionStatus: { not: 'DRAFT' },
    },
  });

  await db.$transaction(async (tx) => {
    // Attachments go with it - the schema cascades them.
    await tx.kpiSubmission.delete({ where: { id: submission.id } });

    if (approval) {
      if (siblingCount === 0) {
        // Nothing left to sign off, so the chain closes rather than sitting
        // open on an empty month.
        await tx.submissionApproval.delete({ where: { id: approval.id } });
      } else {
        await tx.approvalEvent.create({
          data: {
            approvalId: approval.id,
            action: 'VALUES_EDITED',
            stage: approval.stage,
            userId: ctx.user.id,
            comment: `Cleared ${submission.kpiAssignment.kpi.kpiCode} (${submission.actualResult}).`,
          },
        });
      }
    }

    await logAudit(tx, {
      userId: ctx.user.id,
      action: 'SUBMISSION_CLEARED',
      entityType: 'KpiSubmission',
      entityId: submission.id,
      oldValues: {
        employeeId: submission.employee.employeeId,
        employeeName: submission.employee.fullName,
        month: submission.submissionMonth,
        kpiCode: submission.kpiAssignment.kpi.kpiCode,
        kpiName: submission.kpiAssignment.kpi.kpiName,
        actualResult: submission.actualResult,
        calculatedScore: submission.calculatedScore,
        submissionStatus: submission.submissionStatus,
        attachments: submission._count.attachments,
        approvalStage: approval?.stage ?? null,
      },
      ipAddress: ctx.ip,
      userAgent: ctx.ua,
    });
  });

  return NextResponse.json({
    ok: true,
    cleared: submission.kpiAssignment.kpi.kpiCode,
    approvalClosed: !!approval && siblingCount === 0,
  });
});
