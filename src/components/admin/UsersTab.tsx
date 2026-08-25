'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api } from '@/lib/clientApi';
import { useApp } from '@/components/AppContext';
import BulkUpload from '@/components/admin/BulkUpload';

const ROLES = ['SUPER_ADMIN', 'ADMIN', 'COMPLIANCE_SPECIALIST', 'HR_ADMIN', 'EMPLOYEE'];

export default function UsersTab() {
  const { can, departments } = useApp();
  const [allUsers, setAllUsers] = useState<any[]>([]);
  const [noAccount, setNoAccount] = useState<any[]>([]);
  const [q, setQ] = useState('');
  const [deptFilter, setDeptFilter] = useState('');
  const [roleFilter, setRoleFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [msg, setMsg] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [showNoAccount, setShowNoAccount] = useState(false);
  // Set when the form was opened from the "no account" list, so we can scroll
  // to it and say whose account is being created.
  const [prefilledFor, setPrefilledFor] = useState<string | null>(null);
  const [editing, setEditing] = useState<any>(null);
  const createFormRef = useRef<HTMLFormElement>(null);

  // The page scrolls inside <main>, not the window, so scrolling the window
  // left the form open above the fold and the click looked like it did nothing.
  useEffect(() => {
    if (!showCreate || !prefilledFor) return;
    const id = setTimeout(() => {
      createFormRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      createFormRef.current?.querySelector<HTMLInputElement>('input[type=email]')?.focus();
    }, 60);
    return () => clearTimeout(id);
  }, [showCreate, prefilledFor]);
  const [form, setForm] = useState({
    employeeId: '', fullName: '', email: '', systemRole: 'EMPLOYEE',
    departmentId: '', position: '', directManagerEmployeeId: '', temporaryPassword: '',
  });

  const load = useCallback(() => {
    api(`/api/users?q=${encodeURIComponent(q)}`)
      .then((r) => {
        setAllUsers(r.users);
        setNoAccount(r.employeesWithoutAccount ?? []);
      })
      .catch((e) => setMsg(e.message));
  }, [q]);

  useEffect(() => {
    const t = setTimeout(load, 250);
    return () => clearTimeout(t);
  }, [load]);

  // Filtering client-side keeps every control instant on a list this size,
  // and the search term is the only part the server needs to see.
  const users = useMemo(
    () =>
      allUsers.filter((u) => {
        if (deptFilter && (u.departmentId ?? '') !== deptFilter) return false;
        if (roleFilter && u.systemRole !== roleFilter) return false;
        if (statusFilter === 'active' && !u.isActive) return false;
        if (statusFilter === 'inactive' && u.isActive) return false;
        if (statusFilter === 'temp_password' && !u.mustChangePassword) return false;
        if (statusFilter === 'never_logged_in' && u.lastLoginAt) return false;
        return true;
      }),
    [allUsers, deptFilter, roleFilter, statusFilter]
  );
  const activeFilters = [deptFilter, roleFilter, statusFilter].filter(Boolean).length;

  async function createUser(e: React.FormEvent) {
    e.preventDefault();
    setMsg('');
    try {
      const res = await api('/api/users', {
        body: {
          ...form,
          departmentId: form.departmentId || null,
          position: form.position || null,
          directManagerEmployeeId: form.directManagerEmployeeId || null,
          temporaryPassword: form.temporaryPassword || null,
        },
      });
      setMsg(`✔ User created. ${res.note}`);
      setShowCreate(false);
      setPrefilledFor(null);
      setForm({ employeeId: '', fullName: '', email: '', systemRole: 'EMPLOYEE', departmentId: '', position: '', directManagerEmployeeId: '', temporaryPassword: '' });
      load();
    } catch (err: any) {
      setMsg(err.message);
    }
  }

  async function patch(id: string, body: any) {
    setMsg('');
    try {
      await api(`/api/users/${id}`, { method: 'PATCH', body });
      load();
    } catch (err: any) {
      setMsg(err.message);
    }
  }

  async function resetPassword(u: any) {
    if (!confirm(`Reset password for ${u.fullName}? The temporary password will be their Employee ID (${u.employeeId}).`)) return;
    try {
      const res = await api(`/api/users/${u.id}/reset-password`, { body: {} });
      setMsg(`✔ ${u.fullName}: ${res.note}`);
    } catch (err: any) {
      setMsg(err.message);
    }
  }

  const statusBadges = (u: any) => (
    <>
      <span className={`badge ${u.isActive ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-200 text-slate-500'}`}>
        {u.isActive ? 'Active' : 'Inactive'}
      </span>
      {u.mustChangePassword && <span className="badge bg-amber-100 text-amber-700 ml-1" title="Must change password">temp pw</span>}
    </>
  );

  async function saveEdit(e: React.FormEvent) {
    e.preventDefault();
    if (!editing) return;
    setMsg('');

    // Only send what actually changed. Always including the role would trip the
    // server's "cannot assign a role at or above your own" rule when an admin
    // edits a peer's name, which reads as a permissions error out of nowhere.
    const before = editing.original;
    const body: Record<string, unknown> = {};
    if (editing.fullName.trim() !== before.fullName) body.fullName = editing.fullName.trim();
    if (editing.email.trim() !== before.email) body.email = editing.email.trim();
    if (editing.systemRole !== before.systemRole) body.systemRole = editing.systemRole;
    if ((editing.departmentId || '') !== (before.departmentId || '')) body.departmentId = editing.departmentId || null;
    if ((editing.position || '').trim() !== (before.position || '')) body.position = editing.position?.trim() || null;

    if (Object.keys(body).length === 0) {
      setEditing(null);
      return;
    }
    try {
      await api(`/api/users/${editing.id}`, { method: 'PATCH', body });
      setMsg(`✔ ${editing.fullName} updated.`);
      setEditing(null);
      load();
    } catch (err: any) {
      setMsg(err.message);
    }
  }

  const actions = (u: any) => (
    <>
      {can('users.update') && (
        <button
          className="btn-secondary btn-xs"
          onClick={() =>
            setEditing({
              id: u.id,
              employeeId: u.employeeId,
              fullName: u.fullName,
              email: u.email,
              systemRole: u.systemRole,
              departmentId: u.departmentId ?? '',
              position: u.position ?? '',
              original: {
                fullName: u.fullName,
                email: u.email,
                systemRole: u.systemRole,
                departmentId: u.departmentId ?? '',
                position: u.position ?? '',
              },
            })
          }
        >
          Edit
        </button>
      )}
      {can('users.reset_password') && (
        <button className="btn-secondary btn-xs" onClick={() => resetPassword(u)}>Reset PW</button>
      )}
      {can('users.deactivate') && (
        <button className={`btn-xs ${u.isActive ? 'btn-danger' : 'btn-primary'}`} onClick={() => patch(u.id, { isActive: !u.isActive })}>
          {u.isActive ? 'Deactivate' : 'Activate'}
        </button>
      )}
    </>
  );

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <input className="input flex-1 min-w-[180px] sm:flex-none sm:w-56" placeholder="Search name, email or ID…" value={q} onChange={(e) => setQ(e.target.value)} />
        <select className="input !text-[13px]" value={deptFilter} onChange={(e) => setDeptFilter(e.target.value)}>
          <option value="">All departments</option>
          {departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
        </select>
        <select className="input !text-[13px]" value={roleFilter} onChange={(e) => setRoleFilter(e.target.value)}>
          <option value="">All roles</option>
          {ROLES.map((r) => <option key={r} value={r}>{r.replace(/_/g, ' ')}</option>)}
        </select>
        <select className="input !text-[13px]" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
          <option value="">Any status</option>
          <option value="active">Active</option>
          <option value="inactive">Inactive</option>
          <option value="temp_password">Still on temporary password</option>
          <option value="never_logged_in">Never logged in</option>
        </select>
        {activeFilters > 0 && (
          <button className="text-[12px] text-brand-600 hover:underline" onClick={() => { setDeptFilter(''); setRoleFilter(''); setStatusFilter(''); }}>
            Clear
          </button>
        )}
        <span className="text-[12px] text-slate-400">{users.length} of {allUsers.length}</span>
        <div className="hidden sm:block flex-1" />
        {can('users.create') && can('imports.run') && (
          <BulkUpload type="employees" label="Employees" onDone={load} />
        )}
        {can('users.create') && (
          <button className="btn-primary" onClick={() => { setShowCreate((v) => !v); setPrefilledFor(null); }}>
            {showCreate ? 'Cancel' : '+ New User'}
          </button>
        )}
      </div>
      {msg && <div className={`text-sm px-3 py-2 rounded-md border ${msg.startsWith('✔') ? 'bg-emerald-50 border-emerald-200 text-emerald-700' : 'bg-red-50 border-red-200 text-red-700'}`}>{msg}</div>}

      {noAccount.length > 0 && (
        <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2.5">
          <button
            className="flex items-center gap-2 text-left w-full"
            onClick={() => setShowNoAccount((v) => !v)}
          >
            <span className="text-amber-600">⚠</span>
            <span className="text-[13px] font-semibold text-amber-800">
              {noAccount.length} employees have no login account
            </span>
            <span className="text-[12px] text-amber-700">
              — {noAccount.filter((e) => e.kpiCount > 0).length} of them hold KPIs and cannot submit
            </span>
            <span className="ml-auto text-amber-600 text-xs">{showNoAccount ? '▾' : '▸'}</span>
          </button>

          {showNoAccount && (
            <div className="mt-2 space-y-1">
              <p className="text-[11.5px] text-amber-700 mb-1.5">
                Their profile was imported without a work email, so no account could be created.
                Add the email to give them access.
              </p>
              {noAccount.map((e) => (
                <div key={e.employeeProfileId} className="flex flex-wrap items-center gap-2 text-[12.5px] bg-white rounded px-2 py-1.5 border border-amber-100">
                  <span className="font-medium text-slate-700">{e.fullName}</span>
                  <span className="font-mono text-[11px] text-slate-400">{e.employeeId}</span>
                  <span className="text-slate-400">{e.department ?? 'No dept'}</span>
                  {e.kpiCount > 0 && (
                    <span className="badge bg-red-100 text-red-700">{e.kpiCount} KPIs, cannot submit</span>
                  )}
                  {can('users.create') && (
                    <button
                      className="btn-primary btn-xs ml-auto"
                      onClick={() => {
                        setForm({
                          employeeId: e.employeeId, fullName: e.fullName, email: '',
                          systemRole: 'EMPLOYEE', departmentId: e.departmentId ?? '',
                          position: e.position ?? '', directManagerEmployeeId: e.directManagerEmployeeId ?? '',
                          temporaryPassword: '',
                        });
                        setShowCreate(true);
                        setPrefilledFor(e.fullName);
                      }}
                    >
                      Create account
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {showCreate && (
        <form
          ref={createFormRef}
          onSubmit={createUser}
          className={`card p-4 grid sm:grid-cols-2 lg:grid-cols-4 gap-3 scroll-mt-4 ${
            prefilledFor ? 'ring-2 ring-brand-500' : ''
          }`}
        >
          {prefilledFor && (
            <div className="sm:col-span-2 lg:col-span-4 -mb-1 text-[13px] text-brand-700 bg-brand-50 border border-brand-100 rounded-md px-3 py-2">
              Creating an account for <b>{prefilledFor}</b> — enter their work email to finish.
            </div>
          )}
          <div><label className="label">Employee ID *</label><input className="input w-full" required value={form.employeeId} onChange={(e) => setForm({ ...form, employeeId: e.target.value })} /></div>
          <div><label className="label">Full Name *</label><input className="input w-full" required value={form.fullName} onChange={(e) => setForm({ ...form, fullName: e.target.value })} /></div>
          <div><label className="label">Work Email *</label><input className="input w-full" type="email" required value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></div>
          <div>
            <label className="label">System Role</label>
            <select className="input w-full" value={form.systemRole} onChange={(e) => setForm({ ...form, systemRole: e.target.value })}>
              {ROLES.map((r) => <option key={r} value={r}>{r.replace(/_/g, ' ')}</option>)}
            </select>
          </div>
          <div>
            <label className="label">Department</label>
            <select className="input w-full" value={form.departmentId} onChange={(e) => setForm({ ...form, departmentId: e.target.value })}>
              <option value="">—</option>
              {departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
          </div>
          <div><label className="label">Position</label><input className="input w-full" value={form.position} onChange={(e) => setForm({ ...form, position: e.target.value })} /></div>
          <div><label className="label">Direct Manager (Employee ID)</label><input className="input w-full" value={form.directManagerEmployeeId} onChange={(e) => setForm({ ...form, directManagerEmployeeId: e.target.value })} /></div>
          <div><label className="label">Temporary password (blank = Employee ID)</label><input className="input w-full" value={form.temporaryPassword} onChange={(e) => setForm({ ...form, temporaryPassword: e.target.value })} /></div>
          <div className="sm:col-span-2 lg:col-span-4 text-xs text-slate-500">
            The user signs in with their work email. The temporary password defaults to the Employee ID and must be changed on first login.
          </div>
          <div className="sm:col-span-2 lg:col-span-4"><button className="btn-primary w-full sm:w-auto">Create User</button></div>
        </form>
      )}

      {/* Mobile cards */}
      <div className="md:hidden space-y-2">
        {users.map((u) => (
          <div key={u.id} className="card p-3">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="font-semibold text-sm text-slate-800 truncate">{u.fullName}</div>
                <div className="text-[11px] text-slate-400 font-mono">{u.employeeId}</div>
              </div>
              <div className="shrink-0">{statusBadges(u)}</div>
            </div>
            <div className="mt-2">
              <div className="field"><span className="field-label">Email</span><span className="field-value truncate">{u.email}</span></div>
              <div className="field"><span className="field-label">Department</span><span className="field-value">{u.department ?? '—'}</span></div>
              <div className="field">
                <span className="field-label">Role</span>
                <span className="field-value">
                  {can('users.update') ? (
                    <select className="input !py-0.5 !text-xs" value={u.systemRole} onChange={(e) => patch(u.id, { systemRole: e.target.value })}>
                      {ROLES.map((r) => <option key={r} value={r}>{r.replace(/_/g, ' ')}</option>)}
                    </select>
                  ) : u.systemRole.replace(/_/g, ' ')}
                </span>
              </div>
              <div className="field"><span className="field-label">Last login</span><span className="field-value">{u.lastLoginAt ? new Date(u.lastLoginAt).toLocaleDateString() : 'Never'}</span></div>
            </div>
            <div className="flex gap-1.5 mt-2.5">{actions(u)}</div>
          </div>
        ))}
        {users.length === 0 && <div className="card p-8 text-center text-sm text-slate-400">No users found.</div>}
      </div>

      {/* Desktop table */}
      <div className="hidden md:block card table-scroll">
        <table className="w-full min-w-[900px]">
          <thead className="bg-slate-50">
            <tr>
              <th className="table-th">Employee ID</th>
              <th className="table-th">Name</th>
              <th className="table-th">Email</th>
              <th className="table-th">Role</th>
              <th className="table-th">Department</th>
              <th className="table-th">Status</th>
              <th className="table-th">Last Login</th>
              <th className="table-th">Actions</th>
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id} className="border-t border-slate-100">
                <td className="table-td font-mono text-xs">{u.employeeId}</td>
                <td className="table-td font-medium">{u.fullName}</td>
                <td className="table-td text-xs">{u.email}</td>
                <td className="table-td">
                  {can('users.update') ? (
                    <select className="input !py-0.5 !text-xs" value={u.systemRole} onChange={(e) => patch(u.id, { systemRole: e.target.value })}>
                      {ROLES.map((r) => <option key={r} value={r}>{r.replace(/_/g, ' ')}</option>)}
                    </select>
                  ) : u.systemRole.replace(/_/g, ' ')}
                </td>
                <td className="table-td text-xs">{u.department ?? '—'}</td>
                <td className="table-td">{statusBadges(u)}</td>
                <td className="table-td text-xs">{u.lastLoginAt ? new Date(u.lastLoginAt).toLocaleDateString() : 'Never'}</td>
                <td className="table-td whitespace-nowrap space-x-1">{actions(u)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {editing && (
        <div
          className="fixed inset-0 bg-black/40 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4"
          onClick={() => setEditing(null)}
        >
          <form
            onSubmit={saveEdit}
            className="card w-full sm:max-w-lg p-5 rounded-b-none sm:rounded-lg max-h-[90vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-2 mb-4">
              <div>
                <h3 className="font-bold text-slate-800">Edit user</h3>
                <p className="text-[11px] text-slate-400 mt-0.5 font-mono">{editing.employeeId}</p>
              </div>
              <button type="button" className="text-slate-400 hover:text-slate-600 p-1" onClick={() => setEditing(null)}>✕</button>
            </div>

            <div className="grid sm:grid-cols-2 gap-3">
              <div className="sm:col-span-2">
                <label className="label">Full Name *</label>
                <input className="input w-full" required value={editing.fullName} onChange={(e) => setEditing({ ...editing, fullName: e.target.value })} />
              </div>
              <div className="sm:col-span-2">
                <label className="label">Work Email *</label>
                <input className="input w-full" type="email" required value={editing.email} onChange={(e) => setEditing({ ...editing, email: e.target.value })} />
                <p className="text-[11px] text-slate-400 mt-1">This is the username they sign in with.</p>
              </div>
              <div>
                <label className="label">System Role</label>
                <select className="input w-full" value={editing.systemRole} onChange={(e) => setEditing({ ...editing, systemRole: e.target.value })}>
                  {ROLES.map((r) => <option key={r} value={r}>{r.replace(/_/g, ' ')}</option>)}
                </select>
              </div>
              <div>
                <label className="label">Department</label>
                <select className="input w-full" value={editing.departmentId} onChange={(e) => setEditing({ ...editing, departmentId: e.target.value })}>
                  <option value="">—</option>
                  {departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
                </select>
              </div>
              <div className="sm:col-span-2">
                <label className="label">Position</label>
                <input className="input w-full" value={editing.position} onChange={(e) => setEditing({ ...editing, position: e.target.value })} />
              </div>
            </div>

            <p className="text-[11px] text-slate-400 mt-3">
              The Employee ID cannot be changed here — it is the key every KPI assignment and
              reporting line hangs off. Reporting lines are managed under Hierarchy.
            </p>

            <div className="flex gap-2 justify-end mt-4">
              <button type="button" className="btn-secondary" onClick={() => setEditing(null)}>Cancel</button>
              <button className="btn-primary">Save changes</button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
