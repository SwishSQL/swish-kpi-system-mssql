'use client';

import { useCallback, useEffect, useState } from 'react';
import { api, fmt } from '@/lib/clientApi';
import { useApp } from '@/components/AppContext';
import BulkUpload from '@/components/admin/BulkUpload';

export default function AssignmentsTab() {
  const { departments } = useApp();
  const [year, setYear] = useState(new Date().getFullYear());
  const [deptFilter, setDeptFilter] = useState('');
  const [q, setQ] = useState('');
  const [rows, setRows] = useState<any[]>([]);
  const [canManage, setCanManage] = useState(false);
  const [msg, setMsg] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [kpis, setKpis] = useState<any[]>([]);
  const [form, setForm] = useState({ employeeId: '', kpiId: '', target: '', threshold: '', weight: '', frequency: 'Monthly' });
  const [edit, setEdit] = useState<any>(null);
  const [deleting, setDeleting] = useState<any>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [deleteError, setDeleteError] = useState('');

  async function confirmDelete() {
    if (!deleting) return;
    setDeleteBusy(true);
    setMsg('');
    try {
      const res = await api(`/api/assignments/${deleting.id}`, { method: 'DELETE', body: {} });
      setMsg(
        `✔ Removed ${res.removed}. ${res.employeeName ?? 'They'} now hold ${res.remainingKpis} KPI(s) ` +
          `totalling ${res.totalWeight}%${res.weightsValid ? '.' : ' — weights no longer add up to 100%.'}`
      );
      setDeleting(null);
      load();
    } catch (err: any) {
      setDeleteError(err.message);
    } finally {
      setDeleteBusy(false);
    }
  }

  const load = useCallback(() => {
    const params = new URLSearchParams({ year: String(year) });
    if (deptFilter) params.set('departmentId', deptFilter);
    if (q) params.set('q', q);
    api(`/api/assignments?${params}`)
      .then((r) => { setRows(r.assignments); setCanManage(r.canManage); })
      .catch((e) => setMsg(e.message));
  }, [year, deptFilter, q]);

  useEffect(() => {
    const t = setTimeout(load, 250);
    return () => clearTimeout(t);
  }, [load]);

  useEffect(() => {
    api('/api/kpis').then((r) => setKpis(r.kpis.filter((k: any) => k.isActive))).catch(() => {});
  }, []);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setMsg('');
    try {
      await api('/api/assignments', {
        body: {
          employeeId: form.employeeId.trim(),
          kpiId: form.kpiId,
          year,
          target: Number(form.target),
          threshold: Number(form.threshold || form.target),
          weight: Number(form.weight),
          frequency: form.frequency,
        },
      });
      setShowCreate(false);
      setForm({ employeeId: '', kpiId: '', target: '', threshold: '', weight: '', frequency: 'Monthly' });
      load();
    } catch (err: any) {
      setMsg(err.message);
    }
  }

  async function saveEdit(e: React.FormEvent) {
    e.preventDefault();
    try {
      await api(`/api/assignments/${edit.id}`, {
        method: 'PATCH',
        body: { target: Number(edit.target), threshold: Number(edit.threshold), weight: Number(edit.weight) },
      });
      setEdit(null);
      load();
    } catch (err: any) {
      setMsg(err.message);
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <select className="input" value={year} onChange={(e) => setYear(Number(e.target.value))}>
          {[year - 2, year - 1, year, year + 1].filter((v, i, a) => a.indexOf(v) === i).sort().map((y) => (
            <option key={y} value={y}>{y}</option>
          ))}
        </select>
        <select className="input" value={deptFilter} onChange={(e) => setDeptFilter(e.target.value)}>
          <option value="">All departments</option>
          {departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
        </select>
        <input className="input flex-1 min-w-[160px] sm:flex-none sm:w-56" placeholder="Search employee…" value={q} onChange={(e) => setQ(e.target.value)} />
        <div className="hidden sm:block flex-1" />
        {canManage && <BulkUpload type="assignments" label="KPI Assignments" onDone={load} />}
        {canManage && (
          <button className="btn-primary" onClick={() => setShowCreate((v) => !v)}>
            {showCreate ? 'Cancel' : '+ Assign KPI'}
          </button>
        )}
      </div>
      {msg && <div className="text-sm px-3 py-2 rounded-md border bg-red-50 border-red-200 text-red-700">{msg}</div>}

      {showCreate && (
        <form onSubmit={create} className="card p-4 flex flex-wrap items-end gap-3">
          <div><label className="label">Employee ID *</label><input className="input" required value={form.employeeId} onChange={(e) => setForm({ ...form, employeeId: e.target.value })} /></div>
          <div>
            <label className="label">KPI *</label>
            <select className="input w-72" required value={form.kpiId} onChange={(e) => {
              const k = kpis.find((x) => x.id === e.target.value);
              setForm({
                ...form, kpiId: e.target.value,
                target: k?.defaultTarget != null ? String(k.defaultTarget) : form.target,
                threshold: k?.defaultThreshold != null ? String(k.defaultThreshold) : form.threshold,
                weight: k?.defaultWeight != null ? String(k.defaultWeight) : form.weight,
                frequency: k?.frequency ?? form.frequency,
              });
            }}>
              <option value="">— select —</option>
              {kpis.map((k) => <option key={k.id} value={k.id}>{k.kpiCode} — {k.kpiName}</option>)}
            </select>
          </div>
          <div><label className="label">Target *</label><input className="input w-24" type="number" step="any" required value={form.target} onChange={(e) => setForm({ ...form, target: e.target.value })} /></div>
          <div><label className="label">Threshold</label><input className="input w-24" type="number" step="any" value={form.threshold} onChange={(e) => setForm({ ...form, threshold: e.target.value })} /></div>
          <div><label className="label">Weight % *</label><input className="input w-24" type="number" step="any" required value={form.weight} onChange={(e) => setForm({ ...form, weight: e.target.value })} /></div>
          <div>
            <label className="label">Frequency</label>
            <select className="input" value={form.frequency} onChange={(e) => setForm({ ...form, frequency: e.target.value })}>
              {['Monthly', 'Quarterly', 'Semi-Annual', 'Annual'].map((f) => <option key={f}>{f}</option>)}
            </select>
          </div>
          <button className="btn-primary">Assign</button>
        </form>
      )}

      <div className="card table-scroll">
        <table className="w-full min-w-[950px]">
          <thead className="bg-slate-50">
            <tr>
              <th className="table-th">Employee</th>
              <th className="table-th">Dept</th>
              <th className="table-th">KPI</th>
              <th className="table-th">Var</th>
              <th className="table-th">Target</th>
              <th className="table-th">Thresh.</th>
              <th className="table-th">Wt%</th>
              <th className="table-th">Total Wt</th>
              <th className="table-th">Freq</th>
              <th className="table-th">Status</th>
              {canManage && <th className="table-th"></th>}
            </tr>
          </thead>
          <tbody>
            {rows.map((a) => (
              <tr key={a.id} className="border-t border-slate-100">
                <td className="table-td">
                  <div className="font-medium">{a.employeeName}</div>
                  <div className="text-[10px] text-slate-400 font-mono">{a.employeeId}</div>
                </td>
                <td className="table-td text-xs">{a.departmentName ?? '—'}</td>
                <td className="table-td max-w-[260px]">
                  <span className="font-mono text-xs">{a.kpiCode}</span>
                  <div className="text-xs text-slate-500 truncate" title={a.kpiName}>{a.kpiName}</div>
                </td>
                <td className="table-td">{a.varianceIndicator === 'U' ? '↑U' : '↓D'}</td>
                <td className="table-td">{fmt(a.target)}</td>
                <td className="table-td">{fmt(a.threshold)}</td>
                <td className="table-td">{fmt(a.weight)}</td>
                <td className="table-td">
                  <span className={`badge ${Math.abs(a.employeeWeightTotal - 100) < 0.001 ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'}`}>
                    {fmt(a.employeeWeightTotal)}%
                  </span>
                </td>
                <td className="table-td text-xs">{a.frequency}</td>
                <td className="table-td">
                  <span className={`badge ${a.isActive ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-200 text-slate-500'}`}>
                    {a.isActive ? 'Active' : 'Inactive'}
                  </span>
                </td>
                {canManage && (
                  <td className="table-td whitespace-nowrap">
                    <button className="btn-secondary btn-xs mr-1" onClick={() => setEdit({ ...a })}>Edit</button>
                    <button
                      className="btn-xs text-red-600 hover:text-red-700 hover:underline mr-1"
                      title="Remove this KPI from this employee"
                      onClick={() => { setDeleting(a); setDeleteError(''); }}
                    >
                      Delete
                    </button>
                    <button
                      className={`btn-xs ${a.isActive ? 'btn-danger' : 'btn-primary'}`}
                      onClick={async () => {
                        await api(`/api/assignments/${a.id}`, { method: 'PATCH', body: { isActive: !a.isActive } });
                        load();
                      }}
                    >
                      {a.isActive ? 'Deactivate' : 'Activate'}
                    </button>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {edit && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4" onClick={() => setEdit(null)}>
          <form onSubmit={saveEdit} className="card w-full sm:max-w-sm p-5 space-y-3 rounded-b-none sm:rounded-lg" onClick={(e) => e.stopPropagation()}>
            <h3 className="font-bold text-slate-800">{edit.kpiCode} — {edit.employeeName}</h3>
            <div><label className="label">Target</label><input className="input w-full" type="number" step="any" value={edit.target} onChange={(e) => setEdit({ ...edit, target: e.target.value })} /></div>
            <div><label className="label">Threshold</label><input className="input w-full" type="number" step="any" value={edit.threshold} onChange={(e) => setEdit({ ...edit, threshold: e.target.value })} /></div>
            <div><label className="label">Weight %</label><input className="input w-full" type="number" step="any" value={edit.weight} onChange={(e) => setEdit({ ...edit, weight: e.target.value })} /></div>
            <div className="flex gap-2 justify-end">
              <button type="button" className="btn-secondary" onClick={() => setEdit(null)}>Cancel</button>
              <button className="btn-primary">Save</button>
            </div>
          </form>
        </div>
      )}

      {deleting && (
        <div
          className="fixed inset-0 bg-black/40 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4"
          onClick={() => !deleteBusy && setDeleting(null)}
        >
          <div
            className="card w-full sm:max-w-md p-5 rounded-b-none sm:rounded-lg"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="font-bold text-slate-800">Remove this KPI from this employee?</h3>

            <div className="mt-3 rounded-md bg-slate-50 border border-slate-200 px-3 py-2">
              <div className="text-[13px] font-medium text-slate-700">{deleting.employeeName}</div>
              <div className="text-[11px] text-slate-400 font-mono">{deleting.employeeId}</div>
              <div className="mt-1.5 text-[13px] text-slate-700">
                <span className="font-mono text-[11px] text-slate-400">{deleting.kpiCode}</span>{' '}
                {deleting.kpiName}
              </div>
              <div className="text-[11.5px] text-slate-500 mt-1">
                Weight {deleting.weight}% · target {deleting.target} · threshold {deleting.threshold}
              </div>
            </div>

            <p className="text-[12.5px] text-slate-500 mt-3">
              Only this employee is affected — the KPI stays in the library and on anyone else who
              holds it. Their remaining weights will total{' '}
              <b>{Math.round((deleting.employeeWeightTotal - deleting.weight) * 100) / 100}%</b>.
            </p>
            <p className="text-[12.5px] text-slate-500 mt-2">
              This cannot be undone. If any result has been recorded against it the delete will be
              refused — deactivate instead, which keeps the history.
            </p>

            {deleteError && (
              <div className="mt-3 rounded-md bg-red-50 border border-red-200 text-red-700 text-[12.5px] px-3 py-2">
                {deleteError}
              </div>
            )}

            <div className="flex gap-2 justify-end mt-4">
              <button className="btn-secondary" disabled={deleteBusy} onClick={() => setDeleting(null)}>
                Cancel
              </button>
              <button className="btn-danger" disabled={deleteBusy} onClick={confirmDelete}>
                {deleteBusy ? 'Removing…' : 'Remove permanently'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
