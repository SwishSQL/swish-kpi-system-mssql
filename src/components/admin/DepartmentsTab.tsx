'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '@/lib/clientApi';
import { useApp } from '@/components/AppContext';

export default function DepartmentsTab() {
  const { can } = useApp();
  const [allRows, setAllRows] = useState<any[]>([]);
  const [msg, setMsg] = useState('');
  const [q, setQ] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [form, setForm] = useState({ code: '', name: '', departmentManagerEmployeeId: '' });
  // null = closed. Holds the row being edited plus its working values.
  const [edit, setEdit] = useState<any>(null);
  const [editBusy, setEditBusy] = useState(false);
  const [editError, setEditError] = useState('');

  const rows = useMemo(
    () =>
      allRows.filter((d) => {
        if (q) {
          const s = q.toLowerCase();
          if (!d.name.toLowerCase().includes(s) && !d.code.toLowerCase().includes(s)) return false;
        }
        if (statusFilter === 'active' && !d.isActive) return false;
        if (statusFilter === 'inactive' && d.isActive) return false;
        if (statusFilter === 'no_manager' && d.departmentManagerEmployeeId) return false;
        if (statusFilter === 'empty' && d.employeeCount > 0) return false;
        return true;
      }),
    [allRows, q, statusFilter]
  );

  const load = useCallback(() => {
    api('/api/departments').then((r) => setAllRows(r.departments)).catch((e) => setMsg(e.message));
  }, []);
  useEffect(load, [load]);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setMsg('');
    try {
      await api('/api/departments', {
        body: { ...form, departmentManagerEmployeeId: form.departmentManagerEmployeeId || null },
      });
      setForm({ code: '', name: '', departmentManagerEmployeeId: '' });
      load();
    } catch (err: any) {
      setMsg(err.message);
    }
  }

  async function patch(id: string, body: any) {
    setMsg('');
    try {
      await api(`/api/departments/${id}`, { method: 'PATCH', body });
      load();
    } catch (err: any) {
      setMsg(err.message);
    }
  }

  function openEdit(d: any) {
    setEditError('');
    setEdit({
      id: d.id,
      code: d.code,
      name: d.name,
      departmentManagerEmployeeId: d.departmentManagerEmployeeId ?? '',
      isActive: d.isActive,
      employeeCount: d.employeeCount,
      originalName: d.name,
    });
  }

  async function saveEdit(e: React.FormEvent) {
    e.preventDefault();
    setEditError('');
    setEditBusy(true);
    try {
      await api(`/api/departments/${edit.id}`, {
        method: 'PATCH',
        body: {
          code: edit.code.trim(),
          name: edit.name.trim(),
          departmentManagerEmployeeId: edit.departmentManagerEmployeeId.trim() || null,
          isActive: edit.isActive,
        },
      });
      setEdit(null);
      setMsg('');
      load();
    } catch (err: any) {
      setEditError(err.message);
    } finally {
      setEditBusy(false);
    }
  }

  return (
    <div className="space-y-3">
      {msg && <div className="text-sm px-3 py-2 rounded-md border bg-red-50 border-red-200 text-red-700">{msg}</div>}

      <div className="flex flex-wrap items-center gap-2">
        <input className="input flex-1 min-w-[170px] sm:flex-none sm:w-56" placeholder="Search name or code…" value={q} onChange={(e) => setQ(e.target.value)} />
        <select className="input !text-[13px]" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
          <option value="">Any status</option>
          <option value="active">Active</option>
          <option value="inactive">Inactive</option>
          <option value="no_manager">Without a manager</option>
          <option value="empty">Without employees</option>
        </select>
        {(q || statusFilter) && (
          <button className="text-[12px] text-brand-600 hover:underline" onClick={() => { setQ(''); setStatusFilter(''); }}>Clear</button>
        )}
        <span className="text-[12px] text-slate-400">{rows.length} of {allRows.length}</span>
      </div>

      {can('departments.manage') && (
        <form onSubmit={create} className="card p-4 grid sm:grid-cols-2 lg:grid-cols-4 gap-3 items-end">
          <div><label className="label">Code *</label><input className="input w-full" required value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} /></div>
          <div><label className="label">Name *</label><input className="input w-full" required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
          <div><label className="label">Manager (Employee ID)</label><input className="input w-full" value={form.departmentManagerEmployeeId} onChange={(e) => setForm({ ...form, departmentManagerEmployeeId: e.target.value })} /></div>
          <button className="btn-primary w-full sm:w-auto">+ Add Department</button>
        </form>
      )}

      {/* Mobile cards */}
      <div className="md:hidden space-y-2">
        {rows.map((d) => (
          <div key={d.id} className="card p-3">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="font-semibold text-sm text-slate-800">{d.name}</div>
                <div className="text-[11px] text-slate-400 font-mono truncate">{d.code}</div>
              </div>
              <span className={`badge shrink-0 ${d.isActive ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-200 text-slate-500'}`}>
                {d.isActive ? 'Active' : 'Inactive'}
              </span>
            </div>
            <div className="mt-2">
              <div className="field"><span className="field-label">Employees</span><span className="field-value">{d.employeeCount}</span></div>
              <div className="field">
                <span className="field-label">Manager</span>
                <span className="field-value">
                  {can('departments.manage') ? (
                    <ManagerEditor dept={d} onSave={(v) => patch(d.id, { departmentManagerEmployeeId: v || null })} />
                  ) : (
                    d.departmentManagerName ?? d.departmentManagerEmployeeId ?? '—'
                  )}
                </span>
              </div>
            </div>
            {can('departments.manage') && (
              <div className="flex gap-1.5 mt-2.5">
                <button className="btn-secondary btn-xs" onClick={() => openEdit(d)}>Edit</button>
                <button className={`btn-xs ${d.isActive ? 'btn-danger' : 'btn-primary'}`} onClick={() => patch(d.id, { isActive: !d.isActive })}>
                  {d.isActive ? 'Deactivate' : 'Activate'}
                </button>
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Desktop table */}
      <div className="hidden md:block card table-scroll">
        <table className="w-full min-w-[700px]">
          <thead className="bg-slate-50">
            <tr>
              <th className="table-th">Code</th>
              <th className="table-th">Name</th>
              <th className="table-th">Department Manager</th>
              <th className="table-th">Employees</th>
              <th className="table-th">Status</th>
              {can('departments.manage') && <th className="table-th">Actions</th>}
            </tr>
          </thead>
          <tbody>
            {rows.map((d) => (
              <tr key={d.id} className="border-t border-slate-100">
                <td className="table-td font-mono text-xs">{d.code}</td>
                <td className="table-td font-medium">{d.name}</td>
                <td className="table-td">
                  {can('departments.manage') ? (
                    <ManagerEditor dept={d} onSave={(v) => patch(d.id, { departmentManagerEmployeeId: v || null })} />
                  ) : (
                    d.departmentManagerName ?? d.departmentManagerEmployeeId ?? '—'
                  )}
                </td>
                <td className="table-td">{d.employeeCount}</td>
                <td className="table-td">
                  <span className={`badge ${d.isActive ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-200 text-slate-500'}`}>
                    {d.isActive ? 'Active' : 'Inactive'}
                  </span>
                </td>
                {can('departments.manage') && (
                  <td className="table-td whitespace-nowrap">
                    <button className="btn-secondary btn-xs mr-1" onClick={() => openEdit(d)}>Edit</button>
                    <button className={`btn-xs ${d.isActive ? 'btn-danger' : 'btn-primary'}`} onClick={() => patch(d.id, { isActive: !d.isActive })}>
                      {d.isActive ? 'Deactivate' : 'Activate'}
                    </button>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Edit — opens over the row, like the other admin screens */}
      {edit && (
        <div
          className="fixed inset-0 bg-black/40 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4"
          onClick={() => !editBusy && setEdit(null)}
        >
          <form
            onSubmit={saveEdit}
            onClick={(e) => e.stopPropagation()}
            className="card w-full sm:max-w-md p-5 space-y-3 rounded-b-none sm:rounded-lg"
          >
            <h3 className="font-bold text-slate-800">Edit {edit.originalName}</h3>

            <div>
              <label className="label">Code *</label>
              <input className="input w-full" required value={edit.code} onChange={(e) => setEdit({ ...edit, code: e.target.value })} />
            </div>
            <div>
              <label className="label">Name *</label>
              <input className="input w-full" required value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} />
            </div>
            <div>
              <label className="label">Department Manager (Employee ID)</label>
              <input
                className="input w-full"
                placeholder="Leave empty for no manager"
                value={edit.departmentManagerEmployeeId}
                onChange={(e) => setEdit({ ...edit, departmentManagerEmployeeId: e.target.value })}
              />
              <p className="text-[11px] text-slate-400 mt-1">
                The manager approves this department&apos;s results, so leaving it empty holds their month at the
                department stage.
              </p>
            </div>
            <label className="flex items-center gap-2 text-sm text-slate-700">
              <input type="checkbox" checked={edit.isActive} onChange={(e) => setEdit({ ...edit, isActive: e.target.checked })} />
              Active
            </label>

            <div className="text-[11.5px] text-slate-500 bg-slate-50 border border-slate-200 rounded-md px-3 py-2">
              {edit.employeeCount} employee{edit.employeeCount === 1 ? '' : 's'} sit in this department. Renaming it
              changes the name everywhere it appears; it does not move anyone.
            </div>

            {editError && (
              <div className="rounded-md bg-red-50 border border-red-200 text-red-700 text-[12.5px] px-3 py-2">
                {editError}
              </div>
            )}

            <div className="flex gap-2 justify-end pt-1">
              <button type="button" className="btn-secondary" disabled={editBusy} onClick={() => setEdit(null)}>Cancel</button>
              <button className="btn-primary" disabled={editBusy}>{editBusy ? 'Saving…' : 'Save Changes'}</button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}

function ManagerEditor({ dept, onSave }: { dept: any; onSave: (v: string) => void }) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(dept.departmentManagerEmployeeId ?? '');
  if (!editing) {
    return (
      <button className="text-sm text-brand-600 hover:underline" onClick={() => setEditing(true)}>
        {dept.departmentManagerName ?? dept.departmentManagerEmployeeId ?? 'Assign manager'}
      </button>
    );
  }
  return (
    <span className="inline-flex gap-1">
      <input className="input !py-0.5 !text-xs w-24" value={value} onChange={(e) => setValue(e.target.value)} placeholder="Employee ID" />
      <button className="btn-primary btn-xs" onClick={() => { onSave(value); setEditing(false); }}>Save</button>
      <button className="btn-secondary btn-xs" onClick={() => setEditing(false)}>✕</button>
    </span>
  );
}
