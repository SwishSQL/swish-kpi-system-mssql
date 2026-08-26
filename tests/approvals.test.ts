import { describe, it, expect } from 'vitest';
import {
  canActOnStage,
  stageAfterApproval,
  stageBeforeApproval,
  rollupStage,
  entryStage,
  actionableLevel,
  allowedMonths,
  monthWithinWindow,
  shiftMonth,
  STAGE_ORDER,
} from '@/lib/approvals';

describe('stage progression', () => {
  it('walks staff -> line manager -> department manager -> compliance', () => {
    expect(stageAfterApproval('LINE_MANAGER')).toBe('PENDING_DEPARTMENT_MANAGER');
    expect(stageAfterApproval('DEPARTMENT_MANAGER')).toBe('PENDING_COMPLIANCE');
    expect(stageAfterApproval('COMPLIANCE')).toBe('APPROVED');
  });

  it('lets a department manager approve without the line manager', () => {
    // The requirement: a department manager can sign off an untouched submission.
    expect(canActOnStage('DEPARTMENT_MANAGER', 'PENDING_LINE_MANAGER')).toBe(true);
    // ...and doing so skips straight past the line manager stage.
    expect(stageAfterApproval('DEPARTMENT_MANAGER')).toBe('PENDING_COMPLIANCE');
  });

  it('stops a line manager reaching stages above them', () => {
    expect(canActOnStage('LINE_MANAGER', 'PENDING_LINE_MANAGER')).toBe(true);
    expect(canActOnStage('LINE_MANAGER', 'PENDING_DEPARTMENT_MANAGER')).toBe(false);
    expect(canActOnStage('LINE_MANAGER', 'PENDING_COMPLIANCE')).toBe(false);
    expect(canActOnStage('DEPARTMENT_MANAGER', 'PENDING_COMPLIANCE')).toBe(false);
  });

  // Regression: compliance once inherited the department manager's skip and
  // could approve a freshly submitted month in one click, clearing both
  // reviews beneath it. The skip belongs to the department manager alone.
  it('keeps compliance at the final gate, never reaching back', () => {
    expect(canActOnStage('COMPLIANCE', 'PENDING_LINE_MANAGER')).toBe(false);
    expect(canActOnStage('COMPLIANCE', 'PENDING_DEPARTMENT_MANAGER')).toBe(false);
    expect(canActOnStage('COMPLIANCE', 'PENDING_COMPLIANCE')).toBe(true);
    expect(actionableLevel(['COMPLIANCE'], 'PENDING_LINE_MANAGER')).toBeNull();
  });

  it('never acts on an already approved month', () => {
    for (const level of ['LINE_MANAGER', 'DEPARTMENT_MANAGER', 'COMPLIANCE'] as const) {
      expect(canActOnStage(level, 'APPROVED')).toBe(false);
    }
  });

  it('picks the highest level the actor holds', () => {
    expect(actionableLevel(['LINE_MANAGER', 'DEPARTMENT_MANAGER'], 'PENDING_LINE_MANAGER')).toBe('DEPARTMENT_MANAGER');
    expect(actionableLevel(['LINE_MANAGER'], 'PENDING_DEPARTMENT_MANAGER')).toBeNull();
    expect(actionableLevel([], 'PENDING_LINE_MANAGER')).toBeNull();
    // Someone holding every level still needs two steps to clear a fresh month.
    expect(actionableLevel(['LINE_MANAGER', 'DEPARTMENT_MANAGER', 'COMPLIANCE'], 'PENDING_LINE_MANAGER'))
      .toBe('DEPARTMENT_MANAGER');
    expect(actionableLevel(['LINE_MANAGER', 'DEPARTMENT_MANAGER', 'COMPLIANCE'], 'PENDING_COMPLIANCE'))
      .toBe('COMPLIANCE');
  });
});

describe('where a submission enters the chain', () => {
  const chain = { hasLineManager: true, hasDepartmentManager: true };

  it('starts with the line manager when staff submit for themselves', () => {
    expect(entryStage({ submitterLevels: [], ...chain })).toBe('PENDING_LINE_MANAGER');
  });

  it('skips a manager\'s own level - nobody approves their own entry', () => {
    expect(entryStage({ submitterLevels: ['LINE_MANAGER'], ...chain })).toBe('PENDING_DEPARTMENT_MANAGER');
    expect(entryStage({ submitterLevels: ['DEPARTMENT_MANAGER'], ...chain })).toBe('PENDING_COMPLIANCE');
  });

  // Compliance keying numbers in is a convenience, not a review: the managers
  // must still see the month, so it must not self-approve on the way in.
  it('still routes compliance\'s own data entry through the managers', () => {
    expect(entryStage({ submitterLevels: ['COMPLIANCE'], ...chain })).toBe('PENDING_LINE_MANAGER');
    expect(entryStage({ submitterLevels: ['COMPLIANCE'], hasLineManager: false, hasDepartmentManager: true }))
      .toBe('PENDING_DEPARTMENT_MANAGER');
  });

  it('does not wait on a manager the employee does not have', () => {
    expect(entryStage({ submitterLevels: [], hasLineManager: false, hasDepartmentManager: true }))
      .toBe('PENDING_DEPARTMENT_MANAGER');
    expect(entryStage({ submitterLevels: [], hasLineManager: false, hasDepartmentManager: false }))
      .toBe('PENDING_COMPLIANCE');
    expect(entryStage({ submitterLevels: [], hasLineManager: true, hasDepartmentManager: false }))
      .toBe('PENDING_COMPLIANCE');
  });

  it('never returns a stage outside the chain', () => {
    const s = entryStage({ submitterLevels: ['DEPARTMENT_MANAGER'], hasLineManager: false, hasDepartmentManager: false });
    expect(STAGE_ORDER).toContain(s);
  });
});

describe('submission month window', () => {
  it('gives staff the current month and the one before it', () => {
    expect(allowedMonths('2026-07', false)).toEqual(['2026-07', '2026-06']);
  });

  it('gives reviewers three months of catch-up', () => {
    expect(allowedMonths('2026-07', true)).toEqual(['2026-07', '2026-06', '2026-05', '2026-04']);
  });

  it('rolls back across a year boundary', () => {
    expect(shiftMonth('2026-01', -1)).toBe('2025-12');
    expect(allowedMonths('2026-02', true)).toEqual(['2026-02', '2026-01', '2025-12', '2025-11']);
  });

  it('refuses months outside the window', () => {
    expect(monthWithinWindow('2026-05', '2026-07', false)).toBe(false);
    expect(monthWithinWindow('2026-05', '2026-07', true)).toBe(true);
    expect(monthWithinWindow('2026-08', '2026-07', true)).toBe(false); // no submitting ahead
  });
});

describe('sending a KPI back a stage', () => {
  it('steps back exactly one stage', () => {
    expect(stageBeforeApproval('APPROVED')).toBe('PENDING_COMPLIANCE');
    expect(stageBeforeApproval('PENDING_COMPLIANCE')).toBe('PENDING_DEPARTMENT_MANAGER');
    expect(stageBeforeApproval('PENDING_DEPARTMENT_MANAGER')).toBe('PENDING_LINE_MANAGER');
  });

  it('refuses to go below the first stage', () => {
    expect(stageBeforeApproval('PENDING_LINE_MANAGER')).toBeNull();
  });

  it('is the exact inverse of approving, one level at a time', () => {
    // Walking a KPI up by single levels and back down again must land where it
    // started - otherwise a revert would skip or repeat a reviewer.
    for (const stage of ['PENDING_LINE_MANAGER', 'PENDING_DEPARTMENT_MANAGER', 'PENDING_COMPLIANCE'] as const) {
      const levels = { PENDING_LINE_MANAGER: 'LINE_MANAGER', PENDING_DEPARTMENT_MANAGER: 'DEPARTMENT_MANAGER', PENDING_COMPLIANCE: 'COMPLIANCE' } as const;
      const up = stageAfterApproval(levels[stage]);
      expect(stageBeforeApproval(up)).toBe(stage);
    }
  });
});

describe('rolling KPI stages up to the month', () => {
  it('reports the least advanced KPI', () => {
    expect(rollupStage(['APPROVED', 'PENDING_COMPLIANCE', 'APPROVED'])).toBe('PENDING_COMPLIANCE');
    expect(rollupStage(['PENDING_COMPLIANCE', 'PENDING_LINE_MANAGER'])).toBe('PENDING_LINE_MANAGER');
  });

  it('only reports approved when every KPI is approved', () => {
    expect(rollupStage(['APPROVED', 'APPROVED'])).toBe('APPROVED');
    expect(rollupStage(['APPROVED', 'APPROVED', 'PENDING_DEPARTMENT_MANAGER'])).toBe(
      'PENDING_DEPARTMENT_MANAGER'
    );
  });

  it('is order-independent', () => {
    expect(rollupStage(['PENDING_LINE_MANAGER', 'APPROVED'])).toBe(
      rollupStage(['APPROVED', 'PENDING_LINE_MANAGER'])
    );
  });

  it('treats a single KPI as the month itself', () => {
    expect(rollupStage(['PENDING_DEPARTMENT_MANAGER'])).toBe('PENDING_DEPARTMENT_MANAGER');
  });
});
