import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { db } from '@/lib/db';
import { wrap, getCtx, ApiError } from '@/lib/api';
import { getVisibleScope } from '@/lib/access';
import {
  authorityOver,
  actionableLevel,
  stageAfterApproval,
  STAGE_LABEL,
  Stage,
  Level,
} from '@/lib/approvals';
import { logAudit } from '@/lib/audit';
import { notifyUsers, complianceUserIds, managerUserIdsFor, submissionLink } from '@/lib/notify';

export const dynamic = 'force-dynamic';

/** The approval queue for the actor: every employee-month they can sign off. */
export const GET = wrap(async (req: NextRequest) => {
  const ctx = await getCtx(req);
  const month = req.nextUrl.searchParams.get('month') || undefined;

  const scope = await getVisibleScope(ctx, false);
  const approvals = await db.submissionApproval.findMany({
    where: {
      ...(month ? { submissionMonth: month } : {}),
      ...(scope.employeeProfileIds ? { employeeProfileId: { in: scope.employeeProfileIds } } : {}),
      stage: { not: 'APPROVED' },
    },
    include: { employee: { include: { department: true } } },
    orderBy: [{ submittedAt: 'asc' }],
    take: 500,
  });

  const actor = {
    profileId: ctx.profile?.id ?? null,
    employeeId: ctx.profile?.employeeId ?? null,
    systemRole: ctx.user.systemRole,
    perms: ctx.perms,
  };

  const items = [];
  for (const a of approvals) {
    const authority = await authorityOver(actor, a.employeeProfileId);
    const level = actionableLevel(authority.levels, a.stage as Stage);
    if (!level) continue;
    items.push({
      approvalId: a.id,
      employeeProfileId: a.employeeProfileId,
      employeeName: a.employee.fullName,
      employeeId: a.employee.employeeId,
      department: a.employee.department?.name ?? null,
      month: a.submissionMonth,
      stage: a.stage,
      stageLabel: STAGE_LABEL[a.stage as Stage],
      submittedAt: a.submittedAt,
      actAs: level,
    });
  }

  return NextResponse.json({ items });
});

const bodySchema = z.object({
  employeeProfileId: z.string().min(1),
  month: z.string().regex(/^\d{4}-\d{2}$/),
  comment: z.string().max(1000).optional(),
});

/**
 * Sign off one employee-month. The actor's highest applicable level is used, so
 * a department manager approving an untouched submission clears the line
 * manager stage in the same step.
 */
export const POST = wrap(async (req: NextRequest) => {
  const ctx = await getCtx(req);
  const body = bodySchema.parse(await req.json());

  const approval = await db.submissionApproval.findUnique({
    where: {
      employeeProfileId_submissionMonth: {
        employeeProfileId: body.employeeProfileId,
        submissionMonth: body.month,
      },
    },
    include: { employee: { include: { department: true } } },
  });
  if (!approval) throw new ApiError(404, 'Nothing has been submitted for this employee and month.');
  if (approval.stage === 'APPROVED') throw new ApiError(409, 'This month is already fully approved.');

  const authority = await authorityOver(
    {
      profileId: ctx.profile?.id ?? null,
      employeeId: ctx.profile?.employeeId ?? null,
      systemRole: ctx.user.systemRole,
      perms: ctx.perms,
    },
    approval.employeeProfileId
  );
  const level = actionableLevel(authority.levels, approval.stage as Stage);
  if (!level) {
    throw new ApiError(403, `You cannot approve this submission at its current stage (${STAGE_LABEL[approval.stage as Stage]}).`);
  }

  const nextStage = stageAfterApproval(level);
  const stamp = new Date();
  const signOff: Record<Level, object> = {
    LINE_MANAGER: { lineManagerUserId: ctx.user.id, lineManagerAt: stamp },
    DEPARTMENT_MANAGER: { departmentManagerUserId: ctx.user.id, departmentManagerAt: stamp },
    COMPLIANCE: { complianceUserId: ctx.user.id, complianceAt: stamp },
  };

  await db.$transaction(async (tx) => {
    await tx.submissionApproval.update({
      where: { id: approval.id },
      data: { stage: nextStage, ...signOff[level] },
    });
    await tx.approvalEvent.create({
      data: {
        approvalId: approval.id,
        action: 'APPROVED',
        stage: nextStage,
        userId: ctx.user.id,
        comment: body.comment ?? '',
      },
    });

    // Final sign-off locks the month's rows for everyone.
    if (nextStage === 'APPROVED') {
      await tx.kpiSubmission.updateMany({
        where: { employeeProfileId: approval.employeeProfileId, submissionMonth: body.month },
        data: { submissionStatus: 'LOCKED', lockedAt: stamp },
      });
    }

    await logAudit(tx, {
      userId: ctx.user.id,
      action: 'SUBMISSION_APPROVED',
      entityType: 'SubmissionApproval',
      entityId: approval.id,
      oldValues: { stage: approval.stage },
      newValues: { stage: nextStage, level, employeeId: approval.employee.employeeId, month: body.month },
      ipAddress: ctx.ip,
      userAgent: ctx.ua,
    });

    if (nextStage === 'APPROVED') {
      if (approval.employee.userId) {
        await notifyUsers(tx, [approval.employee.userId], {
          type: 'SUBMISSION_APPROVED',
          title: 'Your KPI results are approved',
          message: `Compliance approved your results for ${body.month}. Your scores are now visible.`,
          entityType: 'SubmissionApproval',
          entityId: approval.id,
          link: submissionLink(body.month, approval.employeeProfileId),
        });
      }
    } else {
      // Tell whoever the next stage belongs to.
      const recipients =
        nextStage === 'PENDING_COMPLIANCE'
          ? await complianceUserIds()
          : await managerUserIdsFor(approval.employeeProfileId);
      await notifyUsers(tx, recipients, {
        type: 'APPROVAL_PENDING',
        title: 'Submission awaiting your approval',
        message: `${approval.employee.fullName} (${approval.employee.employeeId}) - ${body.month}. Stage: ${STAGE_LABEL[nextStage]}.`,
        entityType: 'SubmissionApproval',
        entityId: approval.id,
        link: submissionLink(body.month, approval.employeeProfileId),
      });
    }
  });

  return NextResponse.json({ ok: true, stage: nextStage, stageLabel: STAGE_LABEL[nextStage] });
});
