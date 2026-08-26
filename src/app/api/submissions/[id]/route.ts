import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { db } from '@/lib/db';
import { wrap, getCtx, ApiError } from '@/lib/api';
import { canAccessProfile } from '@/lib/access';
import { getPeriod, periodIsEditable } from '@/lib/submissions';
import { logAudit } from '@/lib/audit';
import { computeScore, performanceStatus, weightedScore, normalizeManualInput } from '@/lib/scoring';
import { refreshMonthStage, submissionWithContext } from '@/lib/kpiApproval';
import {
  authorityOver,
  actionableLevel,
  entryStage,
  monthKey,
  monthWithinWindow,
  STAGE_LABEL,
  Stage,
} from '@/lib/approvals';

export const dynamic = 'force-dynamic';

const patchSchema = z.object({
  actualResult: z.number().finite().optional(),
  comment: z.string().max(2000).optional(),
  /** Admin only: also send the KPI back to the start of the chain. */
  resetApproval: z.boolean().optional(),
});

/**
 * Edits ONE KPI's recorded result, independently of every other KPI the
 * employee holds.
 *
 * Who may edit depends on where the KPI has got to:
 *   - an administrator, at any stage, including after compliance has signed off
 *     (that is the way back from an approval given by mistake);
 *   - a reviewer, while the KPI sits at a stage they can act on;
 *   - the employee, until it leaves them for review.
 *
 * An administrator's edit deliberately leaves the stage alone - editing and
 * sending back are separate actions, and an admin fixing a typo on an approved
 * KPI should not silently drag the whole chain back through it. `resetApproval`
 * asks for that explicitly. A reviewer's edit does reset the KPI to its entry
 * stage, matching the rule the month-level submit has always used: a fresh set
 * of numbers needs fresh sign-offs.
 *
 * Nothing is deleted. The previous values go to the audit log and the approval
 * history stays as it was.
 */
export const PATCH = wrap(async (req: NextRequest, { params }: { params: { id: string } }) => {
  const ctx = await getCtx(req);
  const body = patchSchema.parse(await req.json());
  if (body.actualResult === undefined && body.comment === undefined) {
    throw new ApiError(400, 'Nothing to change - send an actual result, a comment, or both.');
  }

  const submission = await submissionWithContext(params.id);
  if (!submission) throw new ApiError(404, 'Result not found.');

  const canSubmit = await canAccessProfile(ctx, submission.employeeProfileId, true);
  if (!canSubmit) throw new ApiError(403, 'You cannot change results for this employee.');

  const assignment = submission.kpiAssignment;
  const kpiCode = assignment.kpi.kpiCode;
  const currentStage = submission.stage as Stage;

  const authority = await authorityOver(
    {
      profileId: ctx.profile?.id ?? null,
      employeeId: ctx.profile?.employeeId ?? null,
      systemRole: ctx.user.systemRole,
      perms: ctx.perms,
    },
    submission.employeeProfileId
  );
  const isAdmin = authority.isAdmin;
  const isReviewer = authority.levels.length > 0;

  if (!isAdmin) {
    if (currentStage === 'APPROVED') {
      throw new ApiError(
        409,
        `${kpiCode} is approved and can no longer be edited. An administrator can send it back a stage first.`
      );
    }
    // A reviewer may only correct what is currently sitting with them; a
    // member of staff only before it has gone up at all.
    if (isReviewer) {
      if (!actionableLevel(authority.levels, currentStage)) {
        throw new ApiError(
          403,
          `${kpiCode} is at ${STAGE_LABEL[currentStage]} and is not yours to edit at this stage.`
        );
      }
    } else if (submission.submissionStatus !== 'DRAFT') {
      throw new ApiError(
        409,
        `${kpiCode} is already under review (${STAGE_LABEL[currentStage]}) and can no longer be changed.`
      );
    }
  }

  const period = await getPeriod(submission.submissionMonth);
  const withinBacklog = monthWithinWindow(
    submission.submissionMonth,
    monthKey(new Date()),
    isReviewer || isAdmin
  );
  const editable = periodIsEditable(period, withinBacklog);
  if (!editable.editable && !isAdmin) {
    throw new ApiError(409, editable.reason || 'This month is not editable.');
  }

  // Rescore only when the number actually moved.
  let scored: { actual: number; score: number; weighted: number; perf: string } | null = null;
  if (body.actualResult !== undefined) {
    const actual = normalizeManualInput(body.actualResult);
    const score = computeScore({
      variance: assignment.kpi.varianceIndicator as 'U' | 'D',
      actual,
      target: assignment.target,
      scoreCap: assignment.kpi.scoreCap,
      zeroActualIsPerfect: assignment.kpi.zeroActualIsPerfect,
    });
    scored = {
      actual,
      score,
      weighted: weightedScore(score, assignment.weight),
      perf: performanceStatus(
        assignment.kpi.varianceIndicator as 'U' | 'D',
        actual,
        assignment.target,
        assignment.threshold
      ),
    };
  }

  // Admin edits hold their place unless the reset is asked for; everyone else's
  // edit sends the KPI back to the start of the chain.
  const resetWanted = isAdmin ? body.resetApproval === true : true;
  const newStage: Stage = resetWanted
    ? entryStage({
        submitterLevels: authority.levels,
        hasLineManager: true,
        hasDepartmentManager: true,
      })
    : currentStage;

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
        ...(scored
          ? {
              actualResult: scored.actual,
              normalizedActualResult: scored.actual,
              calculatedScore: scored.score,
              weightedScore: scored.weighted,
              performanceStatus: scored.perf as any,
            }
          : {}),
        ...(body.comment !== undefined ? { comment: body.comment } : {}),
        stage: newStage,
        submissionStatus:
          newStage === 'APPROVED' && submission.submissionStatus === 'LOCKED' ? 'LOCKED' : 'UPDATED',
        ...(newStage !== 'APPROVED' ? { lockedAt: null } : {}),
        submittedByUserId: ctx.user.id,
        version: { increment: 1 },
      },
    });

    if (approval) {
      await tx.approvalEvent.create({
        data: {
          approvalId: approval.id,
          action: 'VALUES_EDITED',
          stage: newStage,
          kpiSubmissionId: submission.id,
          kpiCode,
          userId: ctx.user.id,
          comment: scored
            ? `${kpiCode}: ${submission.actualResult} -> ${scored.actual}${resetWanted ? ' (sent back for re-approval)' : ''}`
            : `${kpiCode}: comment updated`,
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
      action: 'KPI_EDITED',
      entityType: 'KpiSubmission',
      entityId: submission.id,
      oldValues: {
        actualResult: submission.actualResult,
        calculatedScore: submission.calculatedScore,
        weightedScore: submission.weightedScore,
        performanceStatus: submission.performanceStatus,
        comment: submission.comment,
        stage: currentStage,
        version: submission.version,
      },
      newValues: {
        ...(scored
          ? {
              actualResult: scored.actual,
              calculatedScore: scored.score,
              weightedScore: scored.weighted,
              performanceStatus: scored.perf,
            }
          : {}),
        ...(body.comment !== undefined ? { comment: body.comment } : {}),
        stage: newStage,
        kpiCode,
        employeeId: submission.employee.employeeId,
        month: submission.submissionMonth,
        editedByAdminOverride: isAdmin && currentStage === 'APPROVED',
      },
      ipAddress: ctx.ip,
      userAgent: ctx.ua,
    });
  });

  return NextResponse.json({
    ok: true,
    kpiCode,
    stage: newStage,
    stageLabel: STAGE_LABEL[newStage],
    score: scored?.score ?? submission.calculatedScore,
    performanceStatus: scored?.perf ?? submission.performanceStatus,
    approvalReset: resetWanted,
    monthStage,
  });
});

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
