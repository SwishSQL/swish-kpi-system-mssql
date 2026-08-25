import { describe, it, expect } from 'vitest';
import {
  buildChildrenMap,
  buildParentMap,
  getDescendants,
  getAncestors,
  validateManagerAssignment,
  isCrossDepartment,
} from '@/lib/hierarchy';

const nodes = [
  { employeeId: 'DM-1', directManagerEmployeeId: null, departmentId: 'd1' },
  { employeeId: 'LM-1', directManagerEmployeeId: 'DM-1', departmentId: 'd1' },
  { employeeId: 'LM-2', directManagerEmployeeId: 'DM-1', departmentId: 'd1' },
  { employeeId: 'E-1', directManagerEmployeeId: 'LM-1', departmentId: 'd1' },
  { employeeId: 'E-2', directManagerEmployeeId: 'LM-1', departmentId: 'd1' },
  { employeeId: 'E-3', directManagerEmployeeId: 'LM-2', departmentId: 'd2' },
];

describe('hierarchy recursion', () => {
  it('finds direct and indirect reports', () => {
    const cm = buildChildrenMap(nodes);
    const desc = getDescendants('DM-1', cm);
    expect(desc).toEqual(new Set(['LM-1', 'LM-2', 'E-1', 'E-2', 'E-3']));
    expect(getDescendants('LM-1', cm)).toEqual(new Set(['E-1', 'E-2']));
    expect(getDescendants('E-1', cm).size).toBe(0);
  });
  it('walks the manager chain upwards', () => {
    const pm = buildParentMap(nodes);
    expect(getAncestors('E-1', pm)).toEqual(['LM-1', 'DM-1']);
  });
});

describe('circular hierarchy prevention', () => {
  it('rejects self-reporting', () => {
    expect(validateManagerAssignment('E-1', 'E-1', nodes)).toMatch(/themselves/);
  });
  it('rejects reporting to a descendant', () => {
    expect(validateManagerAssignment('DM-1', 'E-2', nodes)).toMatch(/Circular/);
    expect(validateManagerAssignment('LM-1', 'E-1', nodes)).toMatch(/Circular/);
  });
  it('allows valid reassignment', () => {
    expect(validateManagerAssignment('E-1', 'LM-2', nodes)).toBeNull();
    expect(validateManagerAssignment('E-3', null, nodes)).toBeNull();
  });
  it('survives pre-existing bad data without infinite loops', () => {
    const bad = [
      { employeeId: 'A', directManagerEmployeeId: 'B' },
      { employeeId: 'B', directManagerEmployeeId: 'A' },
    ];
    const cm = buildChildrenMap(bad);
    expect(getDescendants('A', cm).size).toBeGreaterThan(0); // terminates
  });
});

describe('cross-department detection', () => {
  it('flags different departments', () => {
    expect(isCrossDepartment(nodes[5] as any, nodes[2] as any)).toBe(true);
    expect(isCrossDepartment(nodes[3] as any, nodes[1] as any)).toBe(false);
  });
});
