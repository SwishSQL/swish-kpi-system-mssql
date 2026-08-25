import { db } from './db';
import { buildParentMap, getAncestors } from './hierarchy';

export type Stage =
  | 'PENDING_LINE_MANAGER'
  | 'PENDING_DEPARTMENT_MANAGER'
  | 'PENDING_COMPLIANCE'
  | 'APPROVED';

export const STAGE_ORDER: Stage[] = [
  'PENDING_LINE_MANAGER',
  'PENDING_DEPARTMENT_MANAGER',
  'PENDING_COMPLIANCE',
  'APPROVED',
];

export const STAGE_LABEL: Record<Stage, string> = {
  PENDING_LINE_MANAGER: 'Awaiting line manager',
  PENDING_DEPARTMENT_MANAGER: 'Awaiting department manager',
  PENDING_COMPLIANCE: 'Awaiting compliance',
  APPROVED: 'Approved',
};

/** Authority levels, ordered. A level may act on its own stage or any earlier one. */
export type Level = 'LINE_MANAGER' | 'DEPARTMENT_MANAGER' | 'COMPLIANCE';

const LEVEL_RANK: Record<Level, number> = {
  LINE_MANAGER: 0,
  DEPARTMENT_MANAGER: 1,
  COMPLIANCE: 2,
};

/**
 * Which stages each level may sign off, listed rather than derived from rank.
 *
 * Only the department manager is allowed to reach back a stage - that is the
 * one skip that was asked for. Compliance deliberately gets no such reach: it
 * is the final gate, and letting it act early would clear the two reviews
 * beneath it in a single click, which is exactly what the chain exists to
 * prevent.
 */
const ALLOWED_STAGES: Record<Level, Stage[]> = {
  LINE_MANAGER: ['PENDING_LINE_MANAGER'],
  DEPARTMENT_MANAGER: ['PENDING_LINE_MANAGER', 'PENDING_DEPARTMENT_MANAGER'],
  COMPLIANCE: ['PENDING_COMPLIANCE'],
};

/**
 * The stage a submission moves to once `level` signs off. A higher level acting
 * early absorbs the stages beneath it, so a department manager approving while
 * the line manager has not yet acted sends it straight to compliance.
 */
export function stageAfterApproval(level: Level): Stage {
  return STAGE_ORDER[LEVEL_RANK[level] + 1];
}

/** True when `level` is allowed to sign off while the record sits at `stage`. */
export function canActOnStage(level: Level, stage: Stage): boolean {
  if (stage === 'APPROVED') return false;
  return ALLOWED_STAGES[level].includes(stage);
}

/**
 * Where a submission enters the chain.
 *
 * A manager who keys the numbers in has, in effect, already reviewed them, so
 * their own level is skipped, and a missing line or department manager cannot
 * hold the record up. Compliance is excluded from that shortcut on purpose:
 * it enters data as an oversight convenience, not as line authority, so its
 * entries still travel up through the managers.
 */
export function entryStage(opts: {
  submitterLevels: Level[];
  hasLineManager: boolean;
  hasDepartmentManager: boolean;
}): Stage {
  let index = 0;
  if (!opts.hasLineManager) index = Math.max(index, 1);
  if (!opts.hasDepartmentManager) index = Math.max(index, 2);
  for (const level of opts.submitterLevels) {
    if (level === 'COMPLIANCE') continue;
    index = Math.max(index, LEVEL_RANK[level] + 1);
  }
  return STAGE_ORDER[Math.min(index, STAGE_ORDER.length - 1)];
}

export interface ActorAuthority {
  levels: Level[];
  isAdmin: boolean;
}

export type Actor = {
  profileId: string | null;
  employeeId: string | null;
  systemRole: string;
  perms: Set<string>;
};

/**
 * The reporting picture, read once. Screens that judge authority over a list of
 * people - the submissions page runs to hundreds - would otherwise re-read
 * every active profile per row.
 */
export interface AuthorityContext {
  parentMap: Map<string, string | null>;
  byProfileId: Map<string, { employeeId: string; departmentManagerEmployeeId: string | null }>;
}

export async function loadAuthorityContext(): Promise<AuthorityContext> {
  const profiles = await db.employeeProfile.findMany({
    where: { isActive: true },
    select: {
      id: true,
      employeeId: true,
      directManagerEmployeeId: true,
      department: { select: { departmentManagerEmployeeId: true } },
    },
  });
  return {
    parentMap: buildParentMap(profiles),
    byProfileId: new Map(
      profiles.map((p) => [
        p.id,
        {
          employeeId: p.employeeId,
          departmentManagerEmployeeId: p.department?.departmentManagerEmployeeId ?? null,
        },
      ])
    ),
  };
}

/**
 * Which levels the actor holds over one employee. Line-manager authority runs
 * up the whole reporting branch, not just the immediate manager, so a skip
 * level manager can still act when the direct manager is away.
 */
export function authorityIn(
  context: AuthorityContext,
  actor: Actor,
  employeeProfileId: string
): ActorAuthority {
  const isAdmin = actor.systemRole === 'SUPER_ADMIN' || actor.systemRole === 'ADMIN';
  const levels: Level[] = [];

  const employee = context.byProfileId.get(employeeProfileId);
  if (!employee) return { levels: [], isAdmin };

  // Nobody signs off their own results.
  const isSelf = actor.profileId === employeeProfileId;

  if (!isSelf && actor.employeeId) {
    const ancestors = getAncestors(employee.employeeId, context.parentMap);
    if (ancestors.includes(actor.employeeId)) levels.push('LINE_MANAGER');
    if (employee.departmentManagerEmployeeId === actor.employeeId) {
      levels.push('DEPARTMENT_MANAGER');
    }
  }

  if (actor.perms.has('approvals.approve_compliance')) levels.push('COMPLIANCE');
  if (isAdmin) {
    for (const l of ['LINE_MANAGER', 'DEPARTMENT_MANAGER', 'COMPLIANCE'] as Level[]) {
      if (!levels.includes(l)) levels.push(l);
    }
  }
  return { levels, isAdmin };
}

/** Single-employee convenience for callers acting on one person at a time. */
export async function authorityOver(
  actor: Actor,
  employeeProfileId: string
): Promise<ActorAuthority> {
  return authorityIn(await loadAuthorityContext(), actor, employeeProfileId);
}

/** The highest level the actor may use against the current stage, or null. */
export function actionableLevel(levels: Level[], stage: Stage): Level | null {
  const usable = levels.filter((l) => canActOnStage(l, stage));
  if (usable.length === 0) return null;
  return usable.sort((a, b) => LEVEL_RANK[b] - LEVEL_RANK[a])[0];
}

// ---------------------------------------------------------------------------
// Submission window
// ---------------------------------------------------------------------------

export function monthKey(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

export function shiftMonth(key: string, delta: number): string {
  const [y, m] = key.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return monthKey(d);
}

export const STAFF_BACKLOG_MONTHS = 1;
export const MANAGER_BACKLOG_MONTHS = 3;

/**
 * Months a person may still submit for. Staff get the current month plus one
 * back; anyone with review authority gets three, so they can chase late
 * results. Locked periods are refused separately, whatever this returns.
 */
export function allowedMonths(currentMonth: string, isReviewer: boolean): string[] {
  const back = isReviewer ? MANAGER_BACKLOG_MONTHS : STAFF_BACKLOG_MONTHS;
  const out: string[] = [];
  for (let i = 0; i <= back; i++) out.push(shiftMonth(currentMonth, -i));
  return out;
}

export function monthWithinWindow(month: string, currentMonth: string, isReviewer: boolean): boolean {
  return allowedMonths(currentMonth, isReviewer).includes(month);
}
