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
import { refreshMonthStage } from '@/lib/kpiApproval';

export const dynamic = 'force-dynamic';

/** Lowest authority first, for picking the highest level used in a bulk approve. */
const LEVEL_ORDER: Level[] = ['LINE_MANAGER', 'DEPARTMENT_MANAGER', 'COMPLIANCE'];

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
 * Sign off a whole employee-month in one step - every KPI in it that the actor
 * may currently act on.
 *
 * Approval lives on the individual KPI now, so this walks them rather than
 * stamping the month directly: each row advances by the actor's highest
 * applicable level, and the month's own stage is recomputed from what is left.
 * A KPI already past the actor (say compliance has taken one but not the rest)
 * is skipped rather than dragged backwards.
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

  const rows = await db.kpiSubmission.findMany({
    where: {
      employeeProfileId: approval.employeeProfileId,
      submissionMonth: body.month,
      submissionStatus: { not: 'DRAFT' },
    },
    include: { kpiAssignment: { select: { kpi: { select: { kpiCode: true } } } } },
  });

  const actionable = rows
    .map((r) => ({ row: r, level: actionableLevel(authority.levels, r.stage as Stage) }))
    .filter((x): x is { row: (typeof rows)[number]; level: Level } => x.level !== null);

  if (actionable.length === 0) {
    throw new ApiError(
      403,
      `There is nothing here for you to approve at the moment (${STAGE_LABEL[approval.stage as Stage]}).`
    );
  }

  const stamp = new Date();
  const signOff: Record<Level, object> = {
    LINE_MANAGER: { lineManagerUserId: ctx.user.id, lineManagerAt: stamp },
    DEPARTMENT_MANAGER: { departmentManagerUserId: ctx.user.id, departmentManagerAt: stamp },
    COMPLIANCE: { complianceUserId: ctx.user.id, complianceAt: stamp },
  };
  // The highest level used across the rows, for the month-level stamp.
  const topLevel = actionable
    .map((a) => a.level)
    .sort((x, y) => LEVEL_ORDER.indexOf(y) - LEVEL_ORDER.indexOf(x))[0];

  let nextStage: Stage = approval.stage as Stage;

  await db.$transaction(async (tx) => {
    for (const { row, level } of actionable) {
      const rowNext = stageAfterApproval(level);
      await tx.kpiSubmission.update({
        where: { id: row.id },
        data: {
          stage: rowNext,
          ...(rowNext === 'APPROVED' ? { submissionStatus: 'LOCKED', lockedAt: stamp } : {}),
        },
      });
      await tx.approvalEvent.create({
        data: {
          approvalId: approval.id,
          action: 'APPROVED',
          stage: rowNext,
          kpiSubmissionId: row.id,
          kpiCode: row.kpiAssignment.kpi.kpiCode,
          userId: ctx.user.id,
          comment: body.comment ?? '',
        },
      });
    }

    nextStage = (await refreshMonthStage(tx, approval.employeeProfileId, body.month)) ?? nextStage;
    await tx.submissionApproval.update({
      where: { id: approval.id },
      data: signOff[topLevel],
    });

    await logAudit(tx, {
      userId: ctx.user.id,
      action: 'SUBMISSION_APPROVED',
      entityType: 'SubmissionApproval',
      entityId: approval.id,
      oldValues: { stage: approval.stage },
      newValues: {
        stage: nextStage,
        level: topLevel,
        kpisApproved: actionable.map((a) => a.row.kpiAssignment.kpi.kpiCode),
        employeeId: approval.employee.employeeId,
        month: body.month,
      },
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
