/**
 * Pure hierarchy utilities operating on flat lists of employee profiles.
 * The hierarchy links by employeeId (business key, preserved as text).
 */
export interface HNode {
  employeeId: string;
  directManagerEmployeeId: string | null;
  departmentId?: string | null;
  isActive?: boolean;
}

export function buildChildrenMap(nodes: HNode[]): Map<string, string[]> {
  const map = new Map<string, string[]>();
  for (const n of nodes) {
    if (!n.directManagerEmployeeId) continue;
    const arr = map.get(n.directManagerEmployeeId) ?? [];
    arr.push(n.employeeId);
    map.set(n.directManagerEmployeeId, arr);
  }
  return map;
}

/** All direct + indirect reports of a manager (excludes the manager). */
export function getDescendants(managerEmployeeId: string, childrenMap: Map<string, string[]>): Set<string> {
  const out = new Set<string>();
  const stack = [...(childrenMap.get(managerEmployeeId) ?? [])];
  while (stack.length) {
    const id = stack.pop()!;
    if (out.has(id)) continue; // safety against pre-existing bad data
    out.add(id);
    for (const c of childrenMap.get(id) ?? []) stack.push(c);
  }
  return out;
}

/** Chain of managers above an employee (direct manager first). */
export function getAncestors(employeeId: string, parentMap: Map<string, string | null>): string[] {
  const out: string[] = [];
  const seen = new Set<string>([employeeId]);
  let cur = parentMap.get(employeeId) ?? null;
  while (cur && !seen.has(cur)) {
    out.push(cur);
    seen.add(cur);
    cur = parentMap.get(cur) ?? null;
  }
  return out;
}

export function buildParentMap(nodes: HNode[]): Map<string, string | null> {
  const map = new Map<string, string | null>();
  for (const n of nodes) map.set(n.employeeId, n.directManagerEmployeeId ?? null);
  return map;
}

/**
 * Returns an error string when assigning newManagerId as the direct manager
 * of employeeId would be invalid (self-reporting or a circular structure,
 * including reporting to one of the employee's own descendants).
 */
export function validateManagerAssignment(
  employeeId: string,
  newManagerId: string | null,
  nodes: HNode[]
): string | null {
  if (!newManagerId) return null;
  if (newManagerId === employeeId) return 'An employee cannot report to themselves.';
  const childrenMap = buildChildrenMap(nodes);
  const descendants = getDescendants(employeeId, childrenMap);
  if (descendants.has(newManagerId))
    return 'Circular reporting: the selected manager is a descendant of this employee.';
  return null;
}

/** True when manager and employee belong to different departments. */
export function isCrossDepartment(
  employee: HNode,
  manager: HNode | undefined
): boolean {
  if (!manager) return false;
  if (!employee.departmentId || !manager.departmentId) return false;
  return employee.departmentId !== manager.departmentId;
}
