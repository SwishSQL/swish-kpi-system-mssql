export type SystemRole =
  | 'SUPER_ADMIN'
  | 'ADMIN'
  | 'COMPLIANCE_SPECIALIST'
  | 'HR_ADMIN'
  | 'EMPLOYEE';

export interface PermissionDef {
  code: string;
  name: string;
  description: string;
}

export const PERMISSIONS: PermissionDef[] = [
  { code: 'users.view', name: 'View users', description: 'View user accounts' },
  { code: 'users.create', name: 'Create users', description: 'Create user accounts' },
  { code: 'users.update', name: 'Update users', description: 'Edit user accounts' },
  { code: 'users.deactivate', name: 'Deactivate users', description: 'Activate/deactivate accounts' },
  { code: 'users.reset_password', name: 'Reset passwords', description: 'Reset user passwords' },
  { code: 'departments.view', name: 'View departments', description: 'View departments' },
  { code: 'departments.manage', name: 'Manage departments', description: 'Create/edit departments and department managers' },
  { code: 'hierarchy.view', name: 'View hierarchy', description: 'View the reporting hierarchy' },
  { code: 'hierarchy.manage', name: 'Manage hierarchy', description: 'Change reporting relationships' },
  { code: 'kpi_library.view', name: 'View KPI library', description: 'View KPI definitions' },
  { code: 'kpi_library.manage', name: 'Manage KPI library', description: 'Create/edit KPI definitions' },
  { code: 'kpi_library.approve', name: 'Approve proposed KPIs', description: 'Approve or reject a KPI a department head has proposed' },
  { code: 'kpi_assignments.view', name: 'View KPI assignments', description: 'View employee KPI assignments' },
  { code: 'kpi_assignments.manage', name: 'Manage KPI assignments', description: 'Assign KPIs, edit targets/weights' },
  { code: 'submissions.view_own', name: 'View own submissions', description: 'View own KPI results' },
  { code: 'submissions.submit_own', name: 'Submit own results', description: 'Submit/update own KPI results' },
  { code: 'submissions.view_team', name: 'View team submissions', description: 'View results of the reporting branch' },
  { code: 'submissions.submit_team', name: 'Submit for team', description: 'Submit/update results for the reporting branch' },
  { code: 'submissions.view_department', name: 'View department submissions', description: 'View results of the whole department' },
  { code: 'submissions.submit_department', name: 'Submit for department', description: 'Submit/update results for the department' },
  { code: 'submissions.view_all', name: 'View all submissions', description: 'View all results company-wide' },
  { code: 'submissions.submit_all', name: 'Submit for anyone', description: 'Submit/update results for any employee' },
  { code: 'dashboards.view_own', name: 'View own dashboard', description: 'Personal dashboard' },
  { code: 'dashboards.view_team', name: 'View team dashboard', description: 'Team dashboard' },
  { code: 'dashboards.view_department', name: 'View department dashboard', description: 'Department dashboard' },
  { code: 'dashboards.view_all', name: 'View all dashboards', description: 'Company-wide dashboards' },
  { code: 'imports.run', name: 'Run imports', description: 'Import workbooks' },
  { code: 'reports.export', name: 'Export reports', description: 'Export CSV/Excel reports' },
  { code: 'approvals.approve_compliance', name: 'Approve as compliance', description: 'Give the final compliance sign-off on submitted results' },
  { code: 'approvals.view_all', name: 'View all approvals', description: 'See the approval queue company-wide' },
  { code: 'periods.manage', name: 'Manage periods', description: 'Open/close/lock/reopen submission months' },
  { code: 'audit_logs.view', name: 'View audit logs', description: 'View the audit trail' },
  { code: 'permissions.manage', name: 'Manage permissions', description: 'Edit role permissions and overrides' },
  { code: 'settings.manage', name: 'Manage settings', description: 'Edit system settings' },
];

export const ALL_PERMISSION_CODES = PERMISSIONS.map((p) => p.code);

const EMPLOYEE_BASE = [
  'submissions.view_own',
  'submissions.submit_own',
  'dashboards.view_own',
];

export const DEFAULT_ROLE_PERMISSIONS: Record<SystemRole, string[]> = {
  SUPER_ADMIN: ALL_PERMISSION_CODES,
  ADMIN: ALL_PERMISSION_CODES.filter((c) => c !== 'permissions.manage').concat(['permissions.manage']),
  COMPLIANCE_SPECIALIST: [
    ...EMPLOYEE_BASE,
    'users.view',
    'departments.view',
    'hierarchy.view',
    'kpi_library.view',
    'kpi_library.approve',
    'kpi_assignments.view',
    'submissions.view_all',
    'submissions.submit_all',
    'approvals.approve_compliance',
    'approvals.view_all',
    'dashboards.view_team',
    'dashboards.view_department',
    'dashboards.view_all',
    'reports.export',
  ],
  HR_ADMIN: [
    ...EMPLOYEE_BASE,
    'users.view',
    'users.create',
    'users.update',
    'users.deactivate',
    'users.reset_password',
    'departments.view',
    'departments.manage',
    'hierarchy.view',
    'hierarchy.manage',
    'kpi_library.view',
    'kpi_assignments.view',
    'submissions.view_all',
    'approvals.view_all',
    'dashboards.view_all',
    'dashboards.view_department',
    'dashboards.view_team',
    'imports.run',
    'reports.export',
  ],
  EMPLOYEE: EMPLOYEE_BASE,
};

/**
 * Effective permissions = role defaults (from DB) + user overrides.
 * Overrides with allowed=false remove a permission; allowed=true add one.
 */
export function resolvePermissions(
  rolePerms: string[],
  overrides: { code: string; allowed: boolean }[]
): Set<string> {
  const set = new Set(rolePerms);
  for (const o of overrides) {
    if (o.allowed) set.add(o.code);
    else set.delete(o.code);
  }
  return set;
}

/** Roles a user of the given role is allowed to grant/manage. */
export function manageableRoles(actorRole: SystemRole): SystemRole[] {
  if (actorRole === 'SUPER_ADMIN')
    return ['SUPER_ADMIN', 'ADMIN', 'COMPLIANCE_SPECIALIST', 'HR_ADMIN', 'EMPLOYEE'];
  if (actorRole === 'ADMIN') return ['COMPLIANCE_SPECIALIST', 'HR_ADMIN', 'EMPLOYEE'];
  if (actorRole === 'HR_ADMIN') return ['EMPLOYEE'];
  return [];
}
