'use client';

import { useMemo } from 'react';
import { useApp } from '@/components/AppContext';
import UsersTab from '@/components/admin/UsersTab';
import DepartmentsTab from '@/components/admin/DepartmentsTab';
import HierarchyTab from '@/components/admin/HierarchyTab';
import KpisTab from '@/components/admin/KpisTab';
import AssignmentsTab from '@/components/admin/AssignmentsTab';
import PeriodsTab from '@/components/admin/PeriodsTab';
import PermissionsTab from '@/components/admin/PermissionsTab';
import ImportTab from '@/components/admin/ImportTab';
import AuditTab from '@/components/admin/AuditTab';

export default function AdminPage() {
  const { can, adminTab } = useApp();

  const tabs = useMemo(
    () =>
      [
        { key: 'users', show: can('users.view'), el: <UsersTab /> },
        { key: 'departments', show: can('departments.view'), el: <DepartmentsTab /> },
        { key: 'hierarchy', show: can('hierarchy.view'), el: <HierarchyTab /> },
        { key: 'kpis', show: can('kpi_library.view'), el: <KpisTab /> },
        { key: 'assignments', show: can('kpi_assignments.view'), el: <AssignmentsTab /> },
        { key: 'periods', show: can('periods.manage'), el: <PeriodsTab /> },
        { key: 'permissions', show: can('permissions.manage'), el: <PermissionsTab /> },
        { key: 'import', show: can('imports.run'), el: <ImportTab /> },
        { key: 'audit', show: can('audit_logs.view'), el: <AuditTab /> },
      ].filter((t) => t.show),
    [can]
  );

  if (tabs.length === 0) {
    return <div className="card p-10 text-center text-sm text-slate-400">You do not have access to admin screens.</div>;
  }

  const active = tabs.find((t) => t.key === adminTab) ?? tabs[0];
  return <div key={active.key}>{active.el}</div>;
}
