import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { db } from '@/lib/db';
import { wrap, getCtx, ApiError } from '@/lib/api';
import { logAudit } from '@/lib/audit';
import { notifyUsers, managerUserIdsFor, complianceUserIds, submissionLink } from '@/lib/notify';
import { refreshMonthStage, submissionWithContext } from '@/lib/kpiApproval';
import { stageBeforeApproval, STAGE_LABEL, Stage } from '@/lib/approvals';

export const dynamic = 'force-dynamic';

const bodySchema = z.object({ comment: z.string().max(1000).optional() });

/**
 * Sends ONE KPI back one step down the approval chain - the way out of a
 * sign-off given by mistake.
 *
 * Administrators only. A reviewer undoing their own approval, or a level
 * pulling back something already passed on, is how an approval chain stops
 * meaning anything; correcting a mistake is an administrative act and is
 * recorded as one.
 *
 * Only the named KPI moves. Its siblings, their stages and their values are
 * untouched, and nothing is deleted - the approval that is being undone stays
 * in the event history with the reversal recorded after it.
 */
export const POST = wrap(async (req: NextRequest, { params }: { params: { id: string } }) => {
  const ctx = await getCtx(req);
  const body = bodySchema.parse(await req.json().catch(() => ({})));

  if (ctx.user.systemRole !== 'SUPER_ADMIN' && ctx.user.systemRole !== 'ADMIN') {
    throw new ApiError(403, 'Only an administrator can send an approved KPI back a stage.');
  }

  const submission = await submissionWithContext(params.id);
  if (!submission) throw new ApiError(404, 'Result not found.');

  const kpiCode = submission.kpiAssignment.kpi.kpiCode;
  const currentStage = submission.stage as Stage;
  const previousStage = stageBeforeApproval(currentStage);
  if (!previousStage) {
    throw new ApiError(
      409,
      `${kpiCode} is already at the first stage (${STAGE_LABEL[currentStage]}) - there is nothing to send it back to.`
    );
  }

  const approval = await db.submissionApproval.findUnique({
    where: {
      employeeProfileId_submissionMonth: {
        employeeProfileId: submission.employeeProfileId,
        submissionMonth: submission.submissionMonth,
      },
    },
  });

  let monthStage: Stage | null = null;
  await db.$transaction(async (tx) => {
    await tx.kpiSubmission.update({
      where: { id: submission.id },
      data: {
        stage: previousStage,
        // Coming back from APPROVED means it is under review again, so the lock
        // that final approval applied has to come off or nobody can edit it.
        ...(submission.submissionStatus === 'LOCKED'
          ? { submissionStatus: 'UPDATED', lockedAt: null }
          : {}),
      },
    });

    if (approval) {
      await tx.approvalEvent.create({
        data: {
          approvalId: approval.id,
          action: 'REVERTED',
          stage: previousStage,
          kpiSubmissionId: submission.id,
          kpiCode,
          userId: ctx.user.id,
          comment:
            body.comment ??
            `Sent back from ${STAGE_LABEL[currentStage]} to ${STAGE_LABEL[previousStage]}.`,
        },
      });
      monthStage = await refreshMonthStage(
        tx,
        submission.employeeProfileId,
        submission.submissionMonth
      );
    }

    await logAudit(tx, {
      userId: ctx.user.id,
      action: 'KPI_REVERTED',
      entityType: 'KpiSubmission',
      entityId: submission.id,
      oldValues: { stage: currentStage, submissionStatus: submission.submissionStatus },
      newValues: {
        stage: previousStage,
        kpiCode,
        employeeId: submission.employee.employeeId,
        month: submission.submissionMonth,
        reason: body.comment ?? null,
      },
      ipAddress: ctx.ip,
      userAgent: ctx.ua,
    });
  });

  // Whoever owns the stage it landed back on needs to know it is theirs again.
  const link = submissionLink(submission.submissionMonth, submission.employeeProfileId);
  const recipients =
    previousStage === 'PENDING_COMPLIANCE'
      ? await complianceUserIds()
      : await managerUserIdsFor(submission.employeeProfileId);
  await notifyUsers(db, recipients, {
    type: 'APPROVAL_PENDING',
    title: 'A KPI was sent back for review',
    message: `${kpiCode} for ${submission.employee.fullName} (${submission.submissionMonth}) was returned to ${STAGE_LABEL[previousStage]} by ${ctx.user.fullName}.`,
    entityType: 'EmployeeProfile',
    entityId: submission.employeeProfileId,
    link,
  });

  return NextResponse.json({
    ok: true,
    kpiCode,
    stage: previousStage,
    stageLabel: STAGE_LABEL[previousStage],
    from: currentStage,
    monthStage,
    monthStageLabel: monthStage ? STAGE_LABEL[monthStage] : null,
  });
});
