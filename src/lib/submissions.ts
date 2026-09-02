import { db } from './db';

export function parseMonthKey(monthKey: string): { year: number; month: number } {
  const m = /^(\d{4})-(\d{2})$/.exec(monthKey);
  if (!m) throw new Error('Invalid month format, expected YYYY-MM.');
  const year = Number(m[1]);
  const month = Number(m[2]);
  if (month < 1 || month > 12) throw new Error('Invalid month.');
  return { year, month };
}

export function monthBounds(monthKey: string): { start: Date; end: Date } {
  const { year, month } = parseMonthKey(monthKey);
  return {
    start: new Date(Date.UTC(year, month - 1, 1)),
    end: new Date(Date.UTC(year, month, 0, 23, 59, 59)),
  };
}

/**
 * Every active assignment is reportable every month.
 *
 * Frequency used to gate this - quarterly KPIs appeared only in Mar/Jun/Sep/Dec
 * - which meant the assignments screen listed three KPIs while the submission
 * screen showed two, with nothing on the page explaining the difference. The
 * owner's call is that frequency describes how often the measure is taken, not
 * which months accept a result, so it no longer hides rows.
 *
 * Kept as a function so the decision has one home if it is ever revisited.
 */
export function isDueInMonth(_frequency: string, _month: number): boolean {
  return true;
}

/** Active assignments due for the given month, with KPI details. */
export async function getDueAssignments(monthKey: string, employeeProfileIds: string[] | null) {
  const { year, month } = parseMonthKey(monthKey);
  const { start, end } = monthBounds(monthKey);
  const assignments = await db.kpiAssignment.findMany({
    where: {
      year,
      isActive: true,
      effectiveFrom: { lte: end },
      OR: [{ effectiveTo: null }, { effectiveTo: { gte: start } }],
      ...(employeeProfileIds ? { employeeProfileId: { in: employeeProfileIds } } : {}),
      employee: { isActive: true },
      // A department head's proposal can be assigned ahead of approval, but is
      // not due for a result until Compliance or an Admin approves it - it
      // starts appearing on its own the moment that happens.
      kpi: { isActive: true, approvalStatus: 'APPROVED' },
    },
    include: { kpi: true },
    orderBy: { kpi: { kpiCode: 'asc' } },
  });
  return assignments.filter((a) => isDueInMonth(a.frequency, month));
}

export async function getPeriod(monthKey: string) {
  const { year, month } = parseMonthKey(monthKey);
  return db.submissionPeriod.findUnique({ where: { year_month: { year, month } } });
}

export function periodIsEditable(
  period: { status: string; gracePeriodEndsAt: Date | null; deadlineAt: Date | null } | null,
  withinBacklog = false
): {
  editable: boolean;
  reason: string | null;
} {
  // A month inside the actor's catch-up window stays open even when the period
  // was never opened or has since been closed; only an explicit lock is final.
  if (period?.status === 'LOCKED') return { editable: false, reason: 'This submission month is locked.' };
  if (!period) {
    return withinBacklog
      ? { editable: true, reason: 'Catching up on a month that was never opened.' }
      : { editable: false, reason: 'This submission month has not been opened yet.' };
  }
  if (period.status === 'CLOSED') {
    return withinBacklog
      ? { editable: true, reason: 'This month is closed - submitting as a late entry.' }
      : { editable: false, reason: 'This submission month is closed.' };
  }
  if (period.deadlineAt && new Date() > period.deadlineAt) {
    if (period.gracePeriodEndsAt && new Date() <= period.gracePeriodEndsAt) {
      return { editable: true, reason: 'Deadline passed - submitting within the grace period.' };
    }
    if (period.gracePeriodEndsAt && new Date() > period.gracePeriodEndsAt) {
      return { editable: false, reason: 'The deadline and grace period for this month have passed.' };
    }
  }
  return { editable: true, reason: null };
}
