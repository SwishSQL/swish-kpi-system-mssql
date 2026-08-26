import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { db } from '@/lib/db';
import { wrap, getCtx, ApiError } from '@/lib/api';
import { logAudit } from '@/lib/audit';
import { notifyUsers, managerUserIdsFor, complianceUserIds, submissionLink } from '@/lib/notify';
import { refreshMonthStage, refreshMonthStamps, submissionWithContext } from '@/lib/kpiApproval';
import {
  authorityOver,
  actionableLevel,
  stageAfterApproval,
  STAGE_LABEL,
  Stage,
} from '@/lib/approvals';

export const dynamic = 'force-dynamic';

const bodySchema = z.object({ comment: z.string().max(1000).optional() });

/**
 * Signs off ONE KPI.
 *
 * The authority rules are exactly those used for the whole month - a level may
 * act on its own stage, a department manager may also reach back one - only
 * they are judged against this row's stage instead of the month's. Approving
 * one KPI leaves its siblings exactly where they were; the month-level stage
 * is recomputed afterwards as the least advanced KPI in it.
 */
export const POST = wrap(async (req: NextRequest, { params }: { params: { id: string } }) => {
  const ctx = await getCtx(req);
  const body = bodySchema.parse(await req.json().catch(() => ({})));

  const submission = await submissionWithContext(params.id);
  if (!submission) throw new ApiError(404, 'Result not found.');
  if (submission.submissionStatus === 'DRAFT') {
    throw new ApiError(409, 'This KPI has not been submitted yet, so there is nothing to approve.');
  }

  const kpiCode = submission.kpiAssignment.kpi.kpiCode;
  const currentStage = submission.stage as Stage;
  if (currentStage === 'APPROVED') {
    throw new ApiError(409, `${kpiCode} is already fully approved.`);
  }

  const authority = await authorityOver(
    {
      profileId: ctx.profile?.id ?? null,
      employeeId: ctx.profile?.employeeId ?? null,
      systemRole: ctx.user.systemRole,
      perms: ctx.perms,
    },
    submission.employeeProfileId
  );
  const level = actionableLevel(authority.levels, currentStage);
  if (!level) {
    throw new ApiError(
      403,
      `You cannot approve ${kpiCode} at its current stage (${STAGE_LABEL[currentStage]}).`
    );
  }

  const nextStage = stageAfterApproval(level);
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
        stage: nextStage,
        // A KPI that has cleared the last gate is finished, and locking it is
        // what stops it being edited by anyone but an administrator.
        ...(nextStage === 'APPROVED'
          ? { submissionStatus: 'LOCKED', lockedAt: new Date() }
          : {}),
      },
    });

    if (approval) {
      await tx.approvalEvent.create({
        data: {
          approvalId: approval.id,
          action: 'APPROVED',
          stage: nextStage,
          kpiSubmissionId: submission.id,
          kpiCode,
          userId: ctx.user.id,
          comment: body.comment ?? '',
        },
      });
      await refreshMonthStamps(
        tx,
        submission.employeeProfileId,
        submission.submissionMonth,
        ctx.user.id,
        level
      );
      monthStage = await refreshMonthStage(
        tx,
        submission.employeeProfileId,
        submission.submissionMonth
      );
    }

    await logAudit(tx, {
      userId: ctx.user.id,
      action: 'KPI_APPROVED',
      entityType: 'KpiSubmission',
      entityId: submission.id,
      oldValues: { stage: currentStage },
      newValues: {
        stage: nextStage,
        level,
        kpiCode,
        employeeId: submission.employee.employeeId,
        month: submission.submissionMonth,
      },
      ipAddress: ctx.ip,
      userAgent: ctx.ua,
    });
  });

  // Only tell people when the whole month moves; a per-KPI step would be noise
  // on a month with a dozen of them.
  if (monthStage && monthStage !== approval?.stage) {
    const link = submissionLink(submission.submissionMonth, submission.employeeProfileId);
    if (monthStage === 'APPROVED' && submission.employee.userId) {
      await notifyUsers(db, [submission.employee.userId], {
        type: 'SUBMISSION_APPROVED',
        title: 'Your KPI results are approved',
        message: `Compliance approved your results for ${submission.submissionMonth}. Your scores are now visible.`,
        entityType: 'EmployeeProfile',
        entityId: submission.employeeProfileId,
        link,
      });
    } else if (monthStage !== 'APPROVED') {
      const recipients =
        monthStage === 'PENDING_COMPLIANCE'
          ? await complianceUserIds()
          : await managerUserIdsFor(submission.employeeProfileId);
      await notifyUsers(db, recipients, {
        type: 'APPROVAL_PENDING',
        title: 'Submission awaiting your approval',
        message: `${submission.employee.fullName} (${submission.employee.employeeId}) - ${submission.submissionMonth}. Stage: ${STAGE_LABEL[monthStage]}.`,
        entityType: 'EmployeeProfile',
        entityId: submission.employeeProfileId,
        link,
      });
    }
  }

  return NextResponse.json({
    ok: true,
    kpiCode,
    stage: nextStage,
    stageLabel: STAGE_LABEL[nextStage],
    monthStage,
    monthStageLabel: monthStage ? STAGE_LABEL[monthStage] : null,
  });
});
