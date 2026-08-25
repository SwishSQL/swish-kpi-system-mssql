import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { db } from '@/lib/db';
import { wrap, getCtx, ApiError } from '@/lib/api';
import { canAccessProfile } from '@/lib/access';
import { getDueAssignments, getPeriod, periodIsEditable } from '@/lib/submissions';
import { computeScore, performanceStatus, weightedScore, normalizeManualInput } from '@/lib/scoring';
import { logAudit } from '@/lib/audit';
import { notifyUsers, managerUserIdsFor, complianceUserIds, submissionLink } from '@/lib/notify';
import { rateLimit } from '@/lib/rateLimit';
import {
  authorityOver,
  entryStage,
  monthKey,
  monthWithinWindow,
  STAGE_LABEL,
  Stage,
} from '@/lib/approvals';

export const dynamic = 'force-dynamic';

const bodySchema = z.object({
  employeeProfileId: z.string().min(1),
  month: z.string().regex(/^\d{4}-\d{2}$/),
  idempotencyKey: z.string().min(8).max(100),
  entries: z
    .array(
      z.object({
        kpiAssignmentId: z.string().min(1),
        actualResult: z.number().finite(),
        comment: z.string().max(2000).optional(),
        version: z.number().int().optional(),
      })
    )
    .min(1),
});

/**
 * One button per employee: validates ALL due KPIs, requires an actual
 * result and at least one attachment for every KPI, computes scores and
 * saves everything in one transaction. Idempotent and concurrency-safe.
 */
export const POST = wrap(async (req: NextRequest) => {
  const ctx = await getCtx(req);
  const body = bodySchema.parse(await req.json());

  if (!rateLimit(`submit:${ctx.user.id}`, 30, 60 * 1000)) {
    throw new ApiError(429, 'Too many submissions, slow down.');
  }

  const canSubmit = await canAccessProfile(ctx, body.employeeProfileId, true);
  if (!canSubmit) throw new ApiError(403, 'You cannot submit results for this employee.');

  const profile = await db.employeeProfile.findUnique({
    where: { id: body.employeeProfileId },
    include: { department: true },
  });
  if (!profile || !profile.isActive) throw new ApiError(404, 'Employee not found or inactive.');

  const authority = await authorityOver(
    {
      profileId: ctx.profile?.id ?? null,
      employeeId: ctx.profile?.employeeId ?? null,
      systemRole: ctx.user.systemRole,
      perms: ctx.perms,
    },
    profile.id
  );
  const isReviewer = authority.levels.length > 0;

  if (!monthWithinWindow(body.month, monthKey(new Date()), isReviewer)) {
    throw new ApiError(
      409,
      isReviewer
        ? 'Results can only be entered for the current month and the three months before it.'
        : 'You can only submit for the current month or the one before it.'
    );
  }

  const period = await getPeriod(body.month);
  const editable = periodIsEditable(period, true);
  if (!editable.editable) throw new ApiError(409, editable.reason || 'This month is not editable.');

  // Once a month is with a reviewer the employee no longer edits their own numbers;
  // a reviewer who disagrees corrects them in place.
  const existingApproval = await db.submissionApproval.findUnique({
    where: { employeeProfileId_submissionMonth: { employeeProfileId: profile.id, submissionMonth: body.month } },
  });
  if (existingApproval && !isReviewer) {
    throw new ApiError(
      409,
      existingApproval.stage === 'APPROVED'
        ? 'These results are approved and can no longer be changed.'
        : `These results are already under review (${STAGE_LABEL[existingApproval.stage as Stage]}) and can no longer be changed.`
    );
  }

  const dueAssignments = await getDueAssignments(body.month, [profile.id]);
  if (dueAssignments.length === 0) throw new ApiError(400, 'No KPIs are due for this employee in this month.');

  const entriesByAssignment = new Map(body.entries.map((e) => [e.kpiAssignmentId, e]));

  // 1) Every due KPI must have an actual result
  const missingResults = dueAssignments.filter((a) => !entriesByAssignment.has(a.id));
  if (missingResults.length > 0) {
    throw new ApiError(
      400,
      `Missing actual results for: ${missingResults.map((a) => a.kpi.kpiCode).join(', ')}`
    );
  }
  // Reject entries that do not belong to this employee/month
  for (const e of body.entries) {
    if (!dueAssignments.some((a) => a.id === e.kpiAssignmentId)) {
      throw new ApiError(400, 'An entry references a KPI that is not due for this employee in this month.');
    }
  }

  // 2) Every KPI must have at least one attachment (uploaded beforehand onto the draft/existing submission)
  const existingSubs = await db.kpiSubmission.findMany({
    where: {
      submissionMonth: body.month,
      kpiAssignmentId: { in: dueAssignments.map((a) => a.id) },
    },
    include: { _count: { select: { attachments: true } } },
  });
  const subByAssignment = new Map(existingSubs.map((s) => [s.kpiAssignmentId, s]));
  const missingAttachments = dueAssignments.filter(
    (a) => (subByAssignment.get(a.id)?._count.attachments ?? 0) === 0
  );
  if (missingAttachments.length > 0) {
    throw new ApiError(
      400,
      `Attachment required for: ${missingAttachments.map((a) => a.kpi.kpiCode).join(', ')}`,
      'MISSING_ATTACHMENTS'
    );
  }

  // Idempotency: if this exact request was already processed, return success.
  const alreadyProcessed =
    existingSubs.length > 0 && existingSubs.every((s) => s.idempotencyKey === body.idempotencyKey);
  if (alreadyProcessed && existingSubs.length === dueAssignments.length) {
    return NextResponse.json({ ok: true, idempotent: true });
  }

  const onBehalf = !ctx.profile || ctx.profile.id !== profile.id;
  const belowThresholdCodes: string[] = [];
  const isUpdate = existingSubs.some((s) => s.submissionStatus !== 'DRAFT');

  await db.$transaction(async (tx) => {
    for (const a of dueAssignments) {
      const entry = entriesByAssignment.get(a.id)!;
      const existing = subByAssignment.get(a.id);

      // Optimistic concurrency: reject when the row changed since the client loaded it.
      if (existing && entry.version !== undefined && existing.version !== entry.version) {
        throw new ApiError(
          409,
          `${a.kpi.kpiCode} was modified by someone else. Refresh and try again.`
        );
      }
      if (existing && existing.submissionStatus === 'LOCKED') {
        throw new ApiError(409, `${a.kpi.kpiCode} is locked and cannot be edited.`);
      }

      const actual = normalizeManualInput(entry.actualResult);
      const score = computeScore({
        variance: a.kpi.varianceIndicator as 'U' | 'D',
        actual,
        target: a.target,
        scoreCap: a.kpi.scoreCap,
        zeroActualIsPerfect: a.kpi.zeroActualIsPerfect,
      });
      const perf = performanceStatus(a.kpi.varianceIndicator as 'U' | 'D', actual, a.target, a.threshold);
      if (perf === 'BELOW_THRESHOLD') belowThresholdCodes.push(a.kpi.kpiCode);
      const weighted = weightedScore(score, a.weight);

      if (existing) {
        await tx.kpiSubmission.update({
          where: { id: existing.id },
          data: {
            actualResult: actual,
            normalizedActualResult: actual,
            calculatedScore: score,
            weightedScore: weighted,
            submissionStatus: existing.submissionStatus === 'DRAFT' ? 'SUBMITTED' : 'UPDATED',
            performanceStatus: perf,
            comment: entry.comment ?? existing.comment,
            submittedByUserId: ctx.user.id,
            submittedOnBehalfOfEmployee: onBehalf,
            version: { increment: 1 },
            idempotencyKey: body.idempotencyKey,
            submittedAt: existing.submissionStatus === 'DRAFT' ? new Date() : existing.submittedAt,
          },
        });
      } else {
        await tx.kpiSubmission.create({
          data: {
            employeeProfileId: profile.id,
            kpiAssignmentId: a.id,
            submissionMonth: body.month,
            actualResult: actual,
            normalizedActualResult: actual,
            calculatedScore: score,
            weightedScore: weighted,
            submissionStatus: 'SUBMITTED',
            performanceStatus: perf,
            comment: entry.comment ?? '',
            submittedByUserId: ctx.user.id,
            submittedOnBehalfOfEmployee: onBehalf,
            version: 1,
            idempotencyKey: body.idempotencyKey,
          },
        });
      }
    }

    // Open (or re-open) the approval chain for this employee-month.
    const stage = entryStage({
      submitterLevels: authority.levels,
      hasLineManager: !!profile.directManagerEmployeeId,
      hasDepartmentManager: !!profile.department?.departmentManagerEmployeeId,
    });
    const approval = await tx.submissionApproval.upsert({
      where: { employeeProfileId_submissionMonth: { employeeProfileId: profile.id, submissionMonth: body.month } },
      create: {
        employeeProfileId: profile.id,
        submissionMonth: body.month,
        stage,
        submittedByUserId: ctx.user.id,
      },
      update: {
        stage,
        submittedByUserId: ctx.user.id,
        submittedAt: new Date(),
        // A fresh set of numbers needs fresh sign-offs.
        lineManagerUserId: null, lineManagerAt: null,
        departmentManagerUserId: null, departmentManagerAt: null,
        complianceUserId: null, complianceAt: null,
      },
    });
    await tx.approvalEvent.create({
      data: {
        approvalId: approval.id,
        action: isUpdate ? 'VALUES_EDITED' : 'SUBMITTED',
        stage,
        userId: ctx.user.id,
        comment: onBehalf ? `Entered by ${ctx.user.fullName} on behalf of the employee.` : '',
      },
    });

    await logAudit(tx, {
      userId: ctx.user.id,
      action: isUpdate ? 'SUBMISSION_UPDATED' : 'SUBMISSION_CREATED',
      entityType: 'KpiSubmission',
      entityId: `${profile.employeeId}:${body.month}`,
      newValues: {
        employeeId: profile.employeeId,
        month: body.month,
        kpiCount: dueAssignments.length,
        onBehalf,
        approvalStage: stage,
      },
      ipAddress: ctx.ip,
      userAgent: ctx.ua,
    });

    // Notifications
    const managerIds = await managerUserIdsFor(profile.id);
    if (onBehalf && profile.userId) {
      await notifyUsers(tx, [profile.userId], {
        type: 'MANAGER_SUBMITTED',
        title: 'Results submitted on your behalf',
        message: `${ctx.user.fullName} submitted your KPI results for ${body.month}.`,
        entityType: 'KpiSubmission',
        entityId: profile.id,
        link: submissionLink(body.month, profile.id),
      });
    }
    // The line manager and department manager are told because it is now their
    // turn; compliance is told about every submission company-wide.
    await notifyUsers(tx, managerIds, {
      type: isUpdate ? 'SUBMISSION_UPDATED' : 'SUBMISSION_COMPLETED',
      title: isUpdate ? 'Submission updated - approval needed' : 'Submission awaiting your approval',
      message: `${profile.fullName} (${profile.employeeId}) ${isUpdate ? 'updated' : 'submitted'} KPI results for ${body.month}. Stage: ${STAGE_LABEL[stage]}.`,
      entityType: 'EmployeeProfile',
      entityId: profile.id,
      link: submissionLink(body.month, profile.id),
    });
    const complianceIds = (await complianceUserIds()).filter((id) => !managerIds.includes(id));
    await notifyUsers(tx, complianceIds, {
      type: 'SUBMISSION_COMPLETED',
      title: 'New KPI submission',
      message: `${profile.fullName} (${profile.employeeId}, ${profile.department?.name ?? 'no department'}) submitted results for ${body.month}. Stage: ${STAGE_LABEL[stage]}.`,
      entityType: 'EmployeeProfile',
      entityId: profile.id,
      link: submissionLink(body.month, profile.id),
    });
    if (belowThresholdCodes.length > 0) {
      await notifyUsers(tx, managerIds, {
        type: 'BELOW_THRESHOLD',
        title: 'KPI below threshold',
        message: `${profile.fullName}: below threshold on ${belowThresholdCodes.join(', ')} for ${body.month}.`,
        entityType: 'EmployeeProfile',
        entityId: profile.id,
        link: submissionLink(body.month, profile.id),
      });
    }
  });

  return NextResponse.json({ ok: true });
});
