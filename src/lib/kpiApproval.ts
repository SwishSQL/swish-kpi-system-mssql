import { Prisma } from '@prisma/client';
import { db } from './db';
import { rollupStage, Stage } from './approvals';

type Tx = Prisma.TransactionClient;

/**
 * Recomputes an employee-month's stage from the KPIs inside it and writes it
 * back.
 *
 * Approval lives on the individual KPI now; SubmissionApproval.stage is a
 * summary of those, so it has to be refreshed after anything that moves a
 * single KPI. Everything that still reads the month-level stage - the approval
 * queue, the card badge, the submit guard in /api/submissions/submit - keeps
 * working through this one function.
 *
 * The month is only APPROVED when every KPI in it is; one KPI still awaiting
 * compliance holds the month there. Returns the stage it settled on, or null
 * when there is no approval row (nothing has been submitted for that month).
 */
export async function refreshMonthStage(
  tx: Tx,
  employeeProfileId: string,
  submissionMonth: string
): Promise<Stage | null> {
  const approval = await tx.submissionApproval.findUnique({
    where: { employeeProfileId_submissionMonth: { employeeProfileId, submissionMonth } },
  });
  if (!approval) return null;

  const rows = await tx.kpiSubmission.findMany({
    where: { employeeProfileId, submissionMonth, submissionStatus: { not: 'DRAFT' } },
    select: { stage: true },
  });
  // No recorded results left - leave the row where it is rather than declaring
  // an empty month approved. Clearing a month deletes the approval separately.
  if (rows.length === 0) return approval.stage as Stage;

  const stage = rollupStage(rows.map((r) => r.stage as Stage));
  if (stage !== approval.stage) {
    await tx.submissionApproval.update({ where: { id: approval.id }, data: { stage } });
  }
  return stage;
}

/**
 * The sign-off stamps on the month row, kept roughly in step with the KPIs so
 * the "line manager 8/11, dept manager 8/12" line under the card still means
 * something. A level's stamp is set once every KPI has passed that level.
 */
export async function refreshMonthStamps(
  tx: Tx,
  employeeProfileId: string,
  submissionMonth: string,
  userId: string,
  level: 'LINE_MANAGER' | 'DEPARTMENT_MANAGER' | 'COMPLIANCE'
) {
  const approval = await tx.submissionApproval.findUnique({
    where: { employeeProfileId_submissionMonth: { employeeProfileId, submissionMonth } },
  });
  if (!approval) return;

  const remaining = await tx.kpiSubmission.count({
    where: {
      employeeProfileId,
      submissionMonth,
      submissionStatus: { not: 'DRAFT' },
      stage: { in: STAGES_AT_OR_BELOW[level] },
    },
  });
  if (remaining > 0) return;

  const stamp = new Date();
  const patch: Record<string, unknown> =
    level === 'LINE_MANAGER'
      ? { lineManagerUserId: userId, lineManagerAt: stamp }
      : level === 'DEPARTMENT_MANAGER'
        ? { departmentManagerUserId: userId, departmentManagerAt: stamp }
        : { complianceUserId: userId, complianceAt: stamp };
  await tx.submissionApproval.update({ where: { id: approval.id }, data: patch });
}

/** Stages a KPI can still be sitting at when the given level has not finished with it. */
const STAGES_AT_OR_BELOW: Record<string, Stage[]> = {
  LINE_MANAGER: ['PENDING_LINE_MANAGER'],
  DEPARTMENT_MANAGER: ['PENDING_LINE_MANAGER', 'PENDING_DEPARTMENT_MANAGER'],
  COMPLIANCE: ['PENDING_LINE_MANAGER', 'PENDING_DEPARTMENT_MANAGER', 'PENDING_COMPLIANCE'],
};

/** Loads one KPI with everything the per-KPI routes need to judge and describe it. */
export function submissionWithContext(id: string) {
  return db.kpiSubmission.findUnique({
    where: { id },
    include: {
      kpiAssignment: { include: { kpi: true } },
      employee: { select: { id: true, employeeId: true, fullName: true, userId: true } },
    },
  });
}
