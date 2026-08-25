'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '@/lib/clientApi';

const ROLES = ['SUPER_ADMIN', 'ADMIN', 'COMPLIANCE_SPECIALIST', 'HR_ADMIN', 'EMPLOYEE'];
/** Locked in the UI at all times (even for a Super Admin viewer) — a
 *  fat-fingered uncheck here could lock every Super Admin out of the
 *  system, so it's never editable from this screen. Backend already
 *  rejects it too (see /api/permissions), this just avoids the dead-end. */
const LOCKED_ROLE = 'SUPER_ADMIN';

const CATEGORY_LABELS: Record<string, string> = {
  users: 'Users',
  departments: 'Departments',
  hierarchy: 'Hierarchy',
  kpi_library: 'KPI Library',
  kpi_assignments: 'KPI Assignments',
  submissions: 'Submissions',
  dashboards: 'Dashboards',
  imports: 'Imports',
  reports: 'Reports',
  approvals: 'Approvals',
  periods: 'Periods',
  audit_logs: 'Audit Log',
  permissions: 'Permissions',
  settings: 'Settings',
};

function categoryOf(code: string): string {
  const key = code.split('.')[0];
  return CATEGORY_LABELS[key] ?? key.replace(/_/g, ' ');
}

export default function PermissionsTab() {
  const [data, setData] = useState<any>(null);
  const [matrix, setMatrix] = useState<Record<string, Set<string>>>({});
  const [msg, setMsg] = useState('');
  const [dirtyRoles, setDirtyRoles] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState('');
  const [override, setOverride] = useState({ email: '', code: '', allowed: 'true' });
  const [users, setUsers] = useState<any[]>([]);

  const load = useCallback(() => {
    api('/api/permissions')
      .then((r) => {
        setData(r);
        const m: Record<string, Set<string>> = {};
        for (const role of ROLES) m[role] = new Set(r.matrix[role] ?? []);
        setMatrix(m);
        setDirtyRoles(new Set());
      })
      .catch((e) => setMsg(e.message));
    api('/api/users').then((r) => setUsers(r.users)).catch(() => {});
  }, []);
  useEffect(load, [load]);

  // Warn before leaving the page/tab with unsaved changes — the old
  // per-column Save buttons made it easy to toggle a role, wander off to
  // another tab, and lose the edit without noticing.
  useEffect(() => {
    if (dirtyRoles.size === 0) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [dirtyRoles]);

  const filteredPermissions = useMemo(() => {
    if (!data) return [];
    const q = search.trim().toLowerCase();
    if (!q) return data.permissions;
    return data.permissions.filter(
      (p: any) =>
        p.code.toLowerCase().includes(q) ||
        p.name.toLowerCase().includes(q) ||
        p.description.toLowerCase().includes(q)
    );
  }, [data, search]);

  const groups = useMemo(() => {
    const byCategory = new Map<string, any[]>();
    for (const p of filteredPermissions) {
      const cat = categoryOf(p.code);
      (byCategory.get(cat) ?? byCategory.set(cat, []).get(cat)!).push(p);
    }
    return Array.from(byCategory.entries());
  }, [filteredPermissions]);

  function toggle(role: string, code: string) {
    if (role === LOCKED_ROLE) return;
    setMatrix((prev) => {
      const next = { ...prev, [role]: new Set(prev[role]) };
      if (next[role].has(code)) next[role].delete(code);
      else next[role].add(code);
      return next;
    });
    setDirtyRoles((prev) => new Set(prev).add(role));
  }

  /** Header checkbox per role — checks/unchecks every currently-visible
   *  (filtered) permission at once, so a big "grant this whole category"
   *  change doesn't need dozens of individual clicks. */
  function toggleAllForRole(role: string) {
    if (role === LOCKED_ROLE) return;
    const visibleCodes = filteredPermissions.map((p: any) => p.code);
    const allChecked = visibleCodes.every((c: string) => matrix[role]?.has(c));
    setMatrix((prev) => {
      const next = { ...prev, [role]: new Set(prev[role]) };
      for (const c of visibleCodes) {
        if (allChecked) next[role].delete(c);
        else next[role].add(c);
      }
      return next;
    });
    setDirtyRoles((prev) => new Set(prev).add(role));
  }

  async function saveAll() {
    setMsg('');
    setSaving(true);
    const roles = [...dirtyRoles];
    try {
      await Promise.all(
        roles.map((role) => api('/api/permissions', { body: { type: 'role', role, codes: [...matrix[role]] } }))
      );
      setMsg(`✔ Saved ${roles.length} role${roles.length === 1 ? '' : 's'}: ${roles.map((r) => r.replace(/_/g, ' ')).join(', ')}.`);
      setDirtyRoles(new Set());
    } catch (err: any) {
      setMsg(err.message);
    } finally {
      setSaving(false);
    }
  }

  function discardChanges() {
    if (!data) return;
    const m: Record<string, Set<string>> = {};
    for (const role of ROLES) m[role] = new Set(data.matrix[role] ?? []);
    setMatrix(m);
    setDirtyRoles(new Set());
    setMsg('');
  }

  async function addOverride(e: React.FormEvent) {
    e.preventDefault();
    const user = users.find((u) => u.email === override.email);
    if (!user) {
      setMsg('User not found for that email.');
      return;
    }
    try {
      await api('/api/permissions', {
        body: { type: 'override', userId: user.id, code: override.code, allowed: override.allowed === 'true' },
      });
      load();
    } catch (err: any) {
      setMsg(err.message);
    }
  }

  async function removeOverride(o: any) {
    try {
      await api('/api/permissions', { body: { type: 'override', userId: o.userId, code: o.code, allowed: null } });
      load();
    } catch (err: any) {
      setMsg(err.message);
    }
  }

  if (!data) return <div className="text-sm text-slate-400 py-8 text-center">Loading permissions…</div>;

  return (
    <div className="space-y-4 pb-16">
      {msg && (
        <div className={`text-sm px-3 py-2 rounded-md border ${msg.startsWith('✔') ? 'bg-emerald-50 border-emerald-200 text-emerald-700' : 'bg-red-50 border-red-200 text-red-700'}`}>
          {msg}
        </div>
      )}

      <input
        className="input w-full max-w-sm"
        placeholder="Search permissions…"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
      />

      <div className="card table-scroll">
        <table className="w-full min-w-[900px]">
          <thead className="bg-slate-50">
            <tr>
              <th className="table-th">Permission</th>
              {ROLES.map((r) => {
                const locked = r === LOCKED_ROLE;
                const visibleCodes = filteredPermissions.map((p: any) => p.code);
                const allChecked = visibleCodes.length > 0 && visibleCodes.every((c: string) => matrix[r]?.has(c));
                return (
                  <th key={r} className="table-th text-center">
                    <div className="flex flex-col items-center gap-1">
                      <span className="flex items-center gap-1">
                        {r.replace(/_/g, ' ')}
                        {locked && <span title="Locked — always has every permission">🔒</span>}
                        {!locked && dirtyRoles.has(r) && (
                          <span className="w-1.5 h-1.5 rounded-full bg-amber-500" title="Unsaved changes" />
                        )}
                      </span>
                      {!locked && (
                        <label className="flex items-center gap-1 text-[10px] font-normal text-slate-400 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={allChecked}
                            onChange={() => toggleAllForRole(r)}
                          />
                          all
                        </label>
                      )}
                    </div>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {groups.length === 0 && (
              <tr>
                <td colSpan={ROLES.length + 1} className="table-td text-center text-slate-400 py-8">
                  No permissions match “{search}”.
                </td>
              </tr>
            )}
            {groups.map(([category, perms]) => (
              <FragmentGroup key={category} category={category} perms={perms} roles={ROLES} lockedRole={LOCKED_ROLE} matrix={matrix} toggle={toggle} />
            ))}
          </tbody>
        </table>
      </div>

      {dirtyRoles.size > 0 && (
        <div className="fixed bottom-0 left-0 right-0 z-20 bg-white border-t border-slate-200 shadow-[0_-2px_8px_rgba(0,0,0,0.06)] px-6 py-3 flex items-center gap-3">
          <span className="text-sm text-slate-600">
            {dirtyRoles.size} role{dirtyRoles.size === 1 ? '' : 's'} with unsaved changes
          </span>
          <div className="ml-auto flex items-center gap-2">
            <button className="btn-secondary" onClick={discardChanges} disabled={saving}>
              Discard
            </button>
            <button className="btn-primary" onClick={saveAll} disabled={saving}>
              {saving ? 'Saving…' : 'Save changes'}
            </button>
          </div>
        </div>
      )}

      <div className="card p-4">
        <h3 className="text-sm font-bold text-slate-700 mb-2">User Overrides</h3>
        <form onSubmit={addOverride} className="flex flex-wrap items-end gap-2 mb-3">
          <div>
            <label className="label">User email</label>
            <input className="input w-64" list="perm-users" value={override.email} onChange={(e) => setOverride({ ...override, email: e.target.value })} />
            <datalist id="perm-users">
              {users.map((u) => <option key={u.id} value={u.email}>{u.fullName}</option>)}
            </datalist>
          </div>
          <div>
            <label className="label">Permission</label>
            <select className="input" value={override.code} onChange={(e) => setOverride({ ...override, code: e.target.value })}>
              <option value="">— select —</option>
              {data.permissions.map((p: any) => <option key={p.code} value={p.code}>{p.code}</option>)}
            </select>
          </div>
          <div>
            <label className="label">Effect</label>
            <select className="input" value={override.allowed} onChange={(e) => setOverride({ ...override, allowed: e.target.value })}>
              <option value="true">Allow</option>
              <option value="false">Deny</option>
            </select>
          </div>
          <button className="btn-primary" disabled={!override.email || !override.code}>Add Override</button>
        </form>
        {data.overrides.length === 0 && <div className="text-xs text-slate-400">No overrides.</div>}
        {data.overrides.map((o: any) => (
          <div key={o.id} className="flex items-center gap-2 text-sm border-t border-slate-100 py-1.5">
            <span className="font-medium">{o.userName}</span>
            <span className="text-xs text-slate-400">{o.userEmail}</span>
            <span className="font-mono text-xs">{o.code}</span>
            <span className={`badge ${o.allowed ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-700'}`}>
              {o.allowed ? 'ALLOW' : 'DENY'}
            </span>
            <button className="text-red-500 text-xs hover:underline ml-auto" onClick={() => removeOverride(o)}>remove</button>
          </div>
        ))}
      </div>
    </div>
  );
}

/** One category section: a sticky sub-header row + its permission rows. */
function FragmentGroup({
  category,
  perms,
  roles,
  lockedRole,
  matrix,
  toggle,
}: {
  category: string;
  perms: any[];
  roles: string[];
  lockedRole: string;
  matrix: Record<string, Set<string>>;
  toggle: (role: string, code: string) => void;
}) {
  return (
    <>
      <tr>
        <td colSpan={roles.length + 1} className="bg-slate-100/70 px-3 py-1 text-[11px] font-bold uppercase tracking-wide text-slate-500">
          {category}
        </td>
      </tr>
      {perms.map((p) => (
        <tr key={p.code} className="border-t border-slate-100">
          <td className="table-td">
            <div className="font-mono text-xs">{p.code}</div>
            <div className="text-[10px] text-slate-400">{p.description}</div>
          </td>
          {roles.map((r) => (
            <td key={r} className="table-td text-center">
              <input
                type="checkbox"
                checked={r === lockedRole ? true : matrix[r]?.has(p.code) ?? false}
                disabled={r === lockedRole}
                onChange={() => toggle(r, p.code)}
                className={r === lockedRole ? 'opacity-40 cursor-not-allowed' : ''}
              />
            </td>
          ))}
        </tr>
      ))}
    </>
  );
}
