import { describe, it, expect } from 'vitest';
import {
  DEFAULT_ROLE_PERMISSIONS,
  ALL_PERMISSION_CODES,
  resolvePermissions,
  manageableRoles,
} from '@/lib/permissions';

describe('role defaults', () => {
  it('super admin and admin hold every permission', () => {
    for (const code of ALL_PERMISSION_CODES) {
      expect(DEFAULT_ROLE_PERMISSIONS.SUPER_ADMIN).toContain(code);
      expect(DEFAULT_ROLE_PERMISSIONS.ADMIN).toContain(code);
    }
  });
  it('employee sees and submits only their own data', () => {
    const e = DEFAULT_ROLE_PERMISSIONS.EMPLOYEE;
    expect(e).toContain('submissions.view_own');
    expect(e).toContain('submissions.submit_own');
    expect(e).not.toContain('submissions.view_all');
    expect(e).not.toContain('submissions.view_department');
    expect(e).not.toContain('users.view');
  });
  it('compliance specialist has company-wide view and submit', () => {
    const c = DEFAULT_ROLE_PERMISSIONS.COMPLIANCE_SPECIALIST;
    expect(c).toContain('submissions.view_all');
    expect(c).toContain('submissions.submit_all');
    expect(c).toContain('dashboards.view_all');
    expect(c).toContain('reports.export');
    expect(c).not.toContain('permissions.manage');
    expect(c).not.toContain('kpi_library.manage'); // grantable via override only
  });
  it('hr admin manages users and hierarchy but not permissions', () => {
    const h = DEFAULT_ROLE_PERMISSIONS.HR_ADMIN;
    expect(h).toContain('users.create');
    expect(h).toContain('hierarchy.manage');
    expect(h).toContain('imports.run');
    expect(h).not.toContain('permissions.manage');
    expect(h).not.toContain('submissions.submit_all');
  });
  it('all default codes exist in the catalogue', () => {
    for (const role of Object.keys(DEFAULT_ROLE_PERMISSIONS) as (keyof typeof DEFAULT_ROLE_PERMISSIONS)[]) {
      for (const code of DEFAULT_ROLE_PERMISSIONS[role]) {
        expect(ALL_PERMISSION_CODES).toContain(code);
      }
    }
  });
});

describe('override resolution', () => {
  it('allow overrides add permissions', () => {
    const set = resolvePermissions(['a.view'], [{ code: 'b.manage', allowed: true }]);
    expect(set.has('a.view')).toBe(true);
    expect(set.has('b.manage')).toBe(true);
  });
  it('deny overrides remove role permissions', () => {
    const set = resolvePermissions(['a.view', 'b.manage'], [{ code: 'b.manage', allowed: false }]);
    expect(set.has('b.manage')).toBe(false);
  });
});

describe('role granting boundaries', () => {
  it('admins cannot create admins or super admins', () => {
    expect(manageableRoles('ADMIN')).not.toContain('ADMIN');
    expect(manageableRoles('ADMIN')).not.toContain('SUPER_ADMIN');
    expect(manageableRoles('ADMIN')).toContain('EMPLOYEE');
  });
  it('super admin can grant anything, employees nothing', () => {
    expect(manageableRoles('SUPER_ADMIN')).toContain('SUPER_ADMIN');
    expect(manageableRoles('EMPLOYEE')).toEqual([]);
  });
});
