'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '@/lib/clientApi';
import { useApp } from '@/components/AppContext';
import { useIsMobile } from '@/hooks/useMediaQuery';

interface Emp {
  id: string;
  employeeId: string;
  fullName: string;
  email: string | null;
  position: string | null;
  departmentId: string | null;
  departmentName: string | null;
  directManagerEmployeeId: string | null;
  isActive: boolean;
  directReports: number;
  totalReports: number;
  crossDepartmentOverride: boolean;
}

export default function HierarchyTab() {
  const { departments } = useApp();
  const isMobile = useIsMobile();
  const indent = isMobile ? 12 : 22;
  const [data, setData] = useState<{ employees: Emp[]; warnings: any; canManage: boolean } | null>(null);
  const [msg, setMsg] = useState('');
  const [search, setSearch] = useState('');
  const [deptFilter, setDeptFilter] = useState('');
  const [issueFilter, setIssueFilter] = useState('');
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [editing, setEditing] = useState<Emp | null>(null);

  const load = useCallback(() => {
    api('/api/hierarchy').then(setData).catch((e) => setMsg(e.message));
  }, []);
  useEffect(load, [load]);

  const { roots, childrenMap } = useMemo(() => {
    const emps = (data?.employees ?? []).filter((e) => e.isActive);
    const ids = new Set(emps.map((e) => e.employeeId));
    const childrenMap = new Map<string, Emp[]>();
    const roots: Emp[] = [];
    for (const e of emps) {
      if (e.directManagerEmployeeId && ids.has(e.directManagerEmployeeId)) {
        const arr = childrenMap.get(e.directManagerEmployeeId) ?? [];
        arr.push(e);
        childrenMap.set(e.directManagerEmployeeId, arr);
      } else {
        roots.push(e);
      }
    }
    return { roots, childrenMap };
  }, [data]);

  async function setManager(employeeId: string, managerEmployeeId: string | null, override = false) {
    setMsg('');
    try {
      await api('/api/hierarchy', {
        body: { action: 'set_manager', employeeId, managerEmployeeId, crossDepartmentOverride: override },
      });
      setEditing(null);
      load();
    } catch (err: any) {
      if (err.code === 'CROSS_DEPARTMENT') {
        if (confirm(`${err.message}\n\nProceed with cross-department reporting?`)) {
          return setManager(employeeId, managerEmployeeId, true);
        }
      } else {
        setMsg(err.message);
      }
    }
  }

  async function moveDept(employeeId: string, departmentId: string) {
    setMsg('');
    try {
      await api('/api/hierarchy', { body: { action: 'move_department', employeeId, departmentId: departmentId || null } });
      load();
    } catch (err: any) {
      setMsg(err.message);
    }
  }

  function matches(e: Emp): boolean {
    if (search) {
      const s = search.toLowerCase();
      if (!e.fullName.toLowerCase().includes(s) && !e.employeeId.toLowerCase().includes(s)) return false;
    }
    if (deptFilter && e.departmentId !== deptFilter) return false;
    if (issueFilter === 'no_manager' && e.directManagerEmployeeId) return false;
    if (issueFilter === 'managers' && e.totalReports === 0) return false;
    if (issueFilter === 'cross_department' && !e.crossDepartmentOverride) return false;
    return true;
  }
  const filtersActive = !!(search || deptFilter || issueFilter);

  const matchingEmployees = useMemo(
    () => (data?.employees ?? []).filter((e) => e.isActive && matches(e)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [data, search, deptFilter, issueFilter]
  );

  function renderNode(e: Emp, depth: number, flat = false): React.ReactNode {
    const children = flat ? [] : (childrenMap.get(e.employeeId) ?? []);
    const isCollapsed = collapsed[e.employeeId];
    const highlight = !flat && !!search && matches(e);
    return (
      <div key={e.id}>
        <div
          className={`flex items-center gap-1.5 sm:gap-2 py-1.5 px-2 rounded hover:bg-slate-50 ${highlight ? 'bg-amber-50' : ''}`}
          style={{ marginLeft: depth * indent }}
        >
          {children.length > 0 ? (
            <button
              className="w-4 text-slate-400"
              onClick={() => setCollapsed((p) => ({ ...p, [e.employeeId]: !isCollapsed }))}
            >
              {isCollapsed ? '▸' : '▾'}
            </button>
          ) : (
            <span className="w-4 text-slate-300">·</span>
          )}
          <span className="text-[13px] sm:text-sm font-medium text-slate-700 whitespace-nowrap">{e.fullName}</span>
          <span className="text-[11px] sm:text-xs text-slate-400 font-mono">{e.employeeId}</span>
          {e.position && <span className="hidden sm:inline text-xs text-slate-400">{e.position}</span>}
          <span className="hidden sm:inline badge bg-slate-100 text-slate-500">{e.departmentName ?? 'No dept'}</span>
          {e.totalReports > 0 && (
            <span className="badge bg-brand-100 text-brand-700" title={`${e.directReports} direct / ${e.totalReports} total reports`}>
              {e.directReports}d / {e.totalReports}t
            </span>
          )}
          {e.crossDepartmentOverride && <span className="badge bg-amber-100 text-amber-700">cross-dept</span>}
          {data?.canManage && (
            <button className="text-xs text-brand-600 hover:underline ml-auto" onClick={() => setEditing(e)}>
              edit
            </button>
          )}
        </div>
        {!isCollapsed && children.map((c) => renderNode(c, depth + 1))}
      </div>
    );
  }

  if (!data) return <div className="text-sm text-slate-400 py-8 text-center">Loading hierarchy…</div>;

  return (
    <div className="space-y-3">
      {msg && <div className="text-sm px-3 py-2 rounded-md border bg-red-50 border-red-200 text-red-700">{msg}</div>}

      <div className="flex flex-wrap gap-2 items-center">
        <input className="input w-full sm:w-56" placeholder="Search by name or Employee ID…" value={search} onChange={(e) => setSearch(e.target.value)} />
        <select className="input !text-[13px]" value={deptFilter} onChange={(e) => setDeptFilter(e.target.value)}>
          <option value="">All departments</option>
          {departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
        </select>
        <select className="input !text-[13px]" value={issueFilter} onChange={(e) => setIssueFilter(e.target.value)}>
          <option value="">Everyone</option>
          <option value="no_manager">Without a manager</option>
          <option value="managers">Managers only</option>
          <option value="cross_department">Reporting across departments</option>
        </select>
        {filtersActive && (
          <button className="text-[12px] text-brand-600 hover:underline" onClick={() => { setSearch(''); setDeptFilter(''); setIssueFilter(''); }}>
            Clear
          </button>
        )}
        <div className="flex-1" />
        {data.warnings.employeesWithoutManager.length > 0 && (
          <span className="badge bg-amber-100 text-amber-700" title={data.warnings.employeesWithoutManager.map((x: any) => x.fullName).join(', ')}>
            ⚠ {data.warnings.employeesWithoutManager.length} employees without manager
          </span>
        )}
        {data.warnings.departmentsWithoutManager.length > 0 && (
          <span className="badge bg-amber-100 text-amber-700" title={data.warnings.departmentsWithoutManager.map((x: any) => x.name).join(', ')}>
            ⚠ {data.warnings.departmentsWithoutManager.length} departments without manager
          </span>
        )}
      </div>

      {/* Filtering a tree by hiding branches leaves orphans dangling, so a
          filtered view drops to a flat list of the people who match. */}
      {filtersActive ? (
        <div className="card p-2 sm:p-3">
          <div className="text-[11px] text-slate-400 px-2 pb-1">
            {matchingEmployees.length} matching {matchingEmployees.length === 1 ? 'employee' : 'employees'}
          </div>
          {matchingEmployees.length === 0 && (
            <div className="text-sm text-slate-400 text-center py-6">Nobody matches these filters.</div>
          )}
          {matchingEmployees.map((e) => renderNode(e, 0, true))}
        </div>
      ) : (
        <div className="card p-2 sm:p-3 table-scroll">
          <div className="min-w-max">{roots.map((r) => renderNode(r, 0))}</div>
        </div>
      )}

      {editing && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4" onClick={() => setEditing(null)}>
          <div className="card w-full sm:max-w-md p-5 rounded-b-none sm:rounded-lg max-h-[85vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <h3 className="font-bold text-slate-800 mb-1">{editing.fullName}</h3>
            <p className="text-xs text-slate-400 mb-4">{editing.employeeId} · {editing.departmentName ?? 'No department'}</p>

            <label className="label">Direct Manager</label>
            <select
              className="input w-full mb-3"
              value={editing.directManagerEmployeeId ?? ''}
              onChange={(e) => setManager(editing.employeeId, e.target.value || null)}
            >
              <option value="">— No manager —</option>
              {data.employees
                .filter((x) => x.isActive && x.employeeId !== editing.employeeId)
                .map((x) => (
                  <option key={x.employeeId} value={x.employeeId}>
                    {x.fullName} ({x.employeeId}) — {x.departmentName ?? 'No dept'}
                  </option>
                ))}
            </select>

            <label className="label">Department</label>
            <select
              className="input w-full mb-4"
              value={editing.departmentId ?? ''}
              onChange={(e) => moveDept(editing.employeeId, e.target.value)}
            >
              <option value="">— None —</option>
              {departments.map((d) => (
                <option key={d.id} value={d.id}>{d.name}</option>
              ))}
            </select>

            <div className="flex justify-between">
              <button
                className="btn-danger btn-xs"
                onClick={async () => {
                  await api('/api/hierarchy', { body: { action: 'set_active', employeeId: editing.employeeId, isActive: false } });
                  setEditing(null);
                  load();
                }}
              >
                Deactivate employee
              </button>
              <button className="btn-secondary" onClick={() => setEditing(null)}>Close</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
