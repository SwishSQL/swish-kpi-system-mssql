'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { api, fmt } from '@/lib/clientApi';
import { useApp } from '@/components/AppContext';
import BulkUpload from '@/components/admin/BulkUpload';

const EMPTY = {
  kpiCode: '', kpiName: '', description: '', calculationMethod: '', varianceIndicator: 'U',
  matrix: '', defaultTarget: '', targetText: '', defaultThreshold: '', defaultWeight: '', frequency: 'Monthly',
  responsibleDepartmentId: '', responsibleDepartmentText: '', formOfSubmission: '', scoreCap: '100',
  zeroActualIsPerfect: false,
};

export default function KpisTab() {
  const { departments, can, me } = useApp();
  const [allRows, setAllRows] = useState<any[]>([]);
  const [canManage, setCanManage] = useState(false);
  // A department head: may propose a KPI for their own department, but has
  // none of the org-wide library rights canManage carries.
  const [canPropose, setCanPropose] = useState(false);
  const [canApprove, setCanApprove] = useState(false);
  const [managedDepartmentIds, setManagedDepartmentIds] = useState<string[]>([]);
  const [q, setQ] = useState('');
  const [deptFilter, setDeptFilter] = useState('');
  const [freqFilter, setFreqFilter] = useState('');
  const [varFilter, setVarFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('active');
  const [approvalFilter, setApprovalFilter] = useState('');
  const [msg, setMsg] = useState('');
  const [form, setForm] = useState<any>(null); // null = closed, {id?} = editing/creating
  const [deleting, setDeleting] = useState<any>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [deleteError, setDeleteError] = useState('');
  const [reviewing, setReviewing] = useState<any>(null); // KPI open in the approve/reject dialog
  const [reviewReason, setReviewReason] = useState('');
  const [reviewBusy, setReviewBusy] = useState(false);

  const canDelete = me?.user.systemRole === 'SUPER_ADMIN' || me?.user.systemRole === 'ADMIN';
  const myDepartments = departments.filter((d: any) => managedDepartmentIds.includes(d.id));

  const load = useCallback(() => {
    api(`/api/kpis?q=${encodeURIComponent(q)}`)
      .then((r) => {
        setAllRows(r.kpis);
        setCanManage(r.canManage);
        setCanPropose(!!r.canPropose);
        setCanApprove(!!r.canApprove);
        setManagedDepartmentIds(r.managedDepartmentIds ?? []);
      })
      .catch((e) => setMsg(e.message));
  }, [q]);

  useEffect(() => {
    const t = setTimeout(load, 250);
    return () => clearTimeout(t);
  }, [load]);

  // Ownership is free text in the library, so the choices come from the data
  // rather than the department table - "Central Kitchen / HR" owns KPIs too.
  const ownerOptions = useMemo(
    () => [...new Set(allRows.map((k) => k.responsibleDepartmentText).filter(Boolean))].sort(),
    [allRows]
  );
  const freqOptions = useMemo(
    () => [...new Set(allRows.map((k) => k.frequency).filter(Boolean))].sort(),
    [allRows]
  );

  const rows = useMemo(() => {
    const filtered = allRows.filter((k) => {
      if (deptFilter && k.responsibleDepartmentText !== deptFilter) return false;
      if (freqFilter && k.frequency !== freqFilter) return false;
      if (varFilter && k.varianceIndicator !== varFilter) return false;
      if (statusFilter === 'active' && !k.isActive) return false;
      if (statusFilter === 'inactive' && k.isActive) return false;
      if (statusFilter === 'unassigned' && k.assignmentCount > 0) return false;
      if (approvalFilter && k.approvalStatus !== approvalFilter) return false;
      return true;
    });
    // Whoever can act on a pending KPI - approving it, or waiting to hear back
    // on their own proposal - needs it at the top, not buried somewhere in
    // seven hundred rows sorted by code.
    if (canApprove || canPropose) {
      const rank = (k: any) => (k.approvalStatus === 'PENDING' ? 0 : 1);
      return [...filtered].sort((a, b) => rank(a) - rank(b));
    }
    return filtered;
  }, [allRows, deptFilter, freqFilter, varFilter, statusFilter, approvalFilter, canApprove, canPropose]);
  const activeFilters =
    [deptFilter, freqFilter, varFilter, approvalFilter].filter(Boolean).length +
    (statusFilter !== 'active' ? 1 : 0);
  const pendingCount = allRows.filter((k) => k.approvalStatus === 'PENDING').length;

  async function confirmDelete() {
    if (!deleting) return;
    setDeleteBusy(true);
    setMsg('');
    try {
      const res = await api(`/api/kpis/${deleting.id}`, { method: 'DELETE', body: {} });
      setMsg(
        `✔ ${res.deleted} deleted` +
          (res.assignmentsRemoved ? `, along with ${res.assignmentsRemoved} assignment(s).` : '.')
      );
      setDeleting(null);
      load();
    } catch (err: any) {
      setDeleteError(err.message);
    } finally {
      setDeleteBusy(false);
    }
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setMsg('');
    const body = {
      ...form,
      defaultTarget: form.defaultTarget === '' ? null : Number(form.defaultTarget),
      defaultThreshold: form.defaultThreshold === '' ? null : Number(form.defaultThreshold),
      defaultWeight: form.defaultWeight === '' ? null : Number(form.defaultWeight),
      scoreCap: Number(form.scoreCap) || 100,
      responsibleDepartmentId: form.responsibleDepartmentId || null,
    };
    try {
      if (form.id) {
        const { id, kpiCode, ...patch } = body;
        await api(`/api/kpis/${form.id}`, { method: 'PATCH', body: patch });
      } else {
        const res = await api('/api/kpis', { body });
        if (res.approvalStatus === 'PENDING') {
          setMsg(`✔ ${body.kpiCode} submitted and awaiting approval from Compliance or an Admin.`);
        }
      }
      setForm(null);
      load();
    } catch (err: any) {
      setMsg(err.message);
    }
  }

  async function approveKpi(k: any) {
    try {
      await api(`/api/kpis/${k.id}/approve`, { body: {} });
      setMsg(`✔ ${k.kpiCode} approved and is now live.`);
      load();
    } catch (err: any) {
      setMsg(err.message);
    }
  }

  async function rejectKpi() {
    if (!reviewing) return;
    setReviewBusy(true);
    try {
      await api(`/api/kpis/${reviewing.id}/reject`, { body: { reason: reviewReason } });
      setMsg(`${reviewing.kpiCode} was rejected.`);
      setReviewing(null);
      setReviewReason('');
      load();
    } catch (err: any) {
      setMsg(err.message);
    } finally {
      setReviewBusy(false);
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <input className="input flex-1 min-w-[180px] sm:flex-none sm:w-56" placeholder="Search KPI code or name…" value={q} onChange={(e) => setQ(e.target.value)} />
        <select className="input !text-[13px] max-w-[190px]" value={deptFilter} onChange={(e) => setDeptFilter(e.target.value)}>
          <option value="">All responsible depts</option>
          {ownerOptions.map((d) => <option key={d} value={d}>{d}</option>)}
        </select>
        <select className="input !text-[13px]" value={freqFilter} onChange={(e) => setFreqFilter(e.target.value)}>
          <option value="">All frequencies</option>
          {freqOptions.map((f) => <option key={f} value={f}>{f}</option>)}
        </select>
        <select className="input !text-[13px]" value={varFilter} onChange={(e) => setVarFilter(e.target.value)}>
          <option value="">Both directions</option>
          <option value="U">↑ Higher is better</option>
          <option value="D">↓ Lower is better</option>
        </select>
        <select className="input !text-[13px]" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
          <option value="active">Active only</option>
          <option value="">Active and inactive</option>
          <option value="inactive">Inactive only</option>
          <option value="unassigned">Not assigned to anyone</option>
        </select>
        {(canApprove || canPropose) && (
          <select className="input !text-[13px]" value={approvalFilter} onChange={(e) => setApprovalFilter(e.target.value)}>
            <option value="">Any approval status</option>
            <option value="PENDING">Awaiting approval{pendingCount > 0 ? ` (${pendingCount})` : ''}</option>
            <option value="APPROVED">Approved</option>
            <option value="REJECTED">Rejected</option>
          </select>
        )}
        {activeFilters > 0 && (
          <button className="text-[12px] text-brand-600 hover:underline" onClick={() => { setDeptFilter(''); setFreqFilter(''); setVarFilter(''); setStatusFilter('active'); setApprovalFilter(''); }}>
            Clear
          </button>
        )}
        <span className="text-[12px] text-slate-400">{rows.length} of {allRows.length}</span>
        <div className="hidden sm:block flex-1" />
        {canManage && can('imports.run') && (
          <BulkUpload type="kpi_library" label="KPI Library" onDone={load} />
        )}
        {(canManage || canPropose) && (
          <button
            className="btn-primary"
            onClick={() =>
              setForm({
                ...EMPTY,
                // A department head's proposal is pinned to their own
                // department from the start - there's no other one they're
                // allowed to pick.
                responsibleDepartmentId: !canManage && myDepartments.length === 1 ? myDepartments[0].id : '',
              })
            }
          >
            + New KPI
          </button>
        )}
      </div>
      {msg && (
        <div
          className={`text-sm px-3 py-2 rounded-md border ${
            msg.startsWith('✔')
              ? 'bg-emerald-50 border-emerald-200 text-emerald-700'
              : 'bg-red-50 border-red-200 text-red-700'
          }`}
        >
          {msg}
        </div>
      )}

      {form && (
        <div
          className="fixed inset-0 bg-black/40 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4"
          onClick={() => setForm(null)}
        >
        <form
          onSubmit={save}
          onClick={(e) => e.stopPropagation()}
          className="card w-full sm:max-w-3xl max-h-[90vh] overflow-y-auto p-4 grid sm:grid-cols-2 lg:grid-cols-4 gap-3 rounded-b-none sm:rounded-lg"
        >
          <h3 className="sm:col-span-2 lg:col-span-4 font-bold text-slate-800">
            {form.id ? `Edit ${form.kpiCode}` : 'New KPI'}
          </h3>
          {!form.id && !canManage && (
            <p className="sm:col-span-2 lg:col-span-4 text-[12.5px] text-amber-700 bg-amber-50 border border-amber-200 rounded-md px-3 py-2 -mt-1">
              This is a proposal for your own department. It will not be assignable-and-scored
              until Compliance or an Admin approves it.
            </p>
          )}
          <div><label className="label">KPI Code *</label><input className="input w-full" required disabled={!!form.id} value={form.kpiCode} onChange={(e) => setForm({ ...form, kpiCode: e.target.value })} /></div>
          <div className="sm:col-span-1 lg:col-span-3"><label className="label">KPI Name *</label><input className="input w-full" required value={form.kpiName} onChange={(e) => setForm({ ...form, kpiName: e.target.value })} /></div>
          <div className="sm:col-span-2"><label className="label">Description</label><input className="input w-full" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></div>
          <div className="sm:col-span-2"><label className="label">Calculation Method</label><input className="input w-full" value={form.calculationMethod} onChange={(e) => setForm({ ...form, calculationMethod: e.target.value })} /></div>
          <div>
            <label className="label">Variance</label>
            <select className="input w-full" value={form.varianceIndicator} onChange={(e) => setForm({ ...form, varianceIndicator: e.target.value })}>
              <option value="U">U — Higher is better</option>
              <option value="D">D — Lower is better</option>
            </select>
          </div>
          <div><label className="label">Matrix / Unit</label><input className="input w-full" value={form.matrix} onChange={(e) => setForm({ ...form, matrix: e.target.value })} /></div>
          <div><label className="label">Target (as written)</label><input className="input w-full" placeholder="e.g. ≥95% accuracy" value={form.targetText} onChange={(e) => setForm({ ...form, targetText: e.target.value })} /></div>
          <div><label className="label">Default Target (number)</label><input className="input w-full" type="number" step="any" value={form.defaultTarget} onChange={(e) => setForm({ ...form, defaultTarget: e.target.value })} /></div>
          <div><label className="label">Default Threshold</label><input className="input w-full" type="number" step="any" value={form.defaultThreshold} onChange={(e) => setForm({ ...form, defaultThreshold: e.target.value })} /></div>
          <div><label className="label">Default Weight %</label><input className="input w-full" type="number" step="any" value={form.defaultWeight} onChange={(e) => setForm({ ...form, defaultWeight: e.target.value })} /></div>
          <div>
            <label className="label">Frequency</label>
            <select className="input w-full" value={form.frequency} onChange={(e) => setForm({ ...form, frequency: e.target.value })}>
              {['Monthly', 'Quarterly', 'Semi-Annual', 'Annual'].map((f) => <option key={f}>{f}</option>)}
            </select>
          </div>
          <div>
            <label className="label">Responsible Dept (as written)</label>
            <input className="input w-full" placeholder="e.g. Central Kitchen / HR" value={form.responsibleDepartmentText} onChange={(e) => setForm({ ...form, responsibleDepartmentText: e.target.value })} />
          </div>
          <div>
            <label className="label">{canManage ? 'Link to a department (optional)' : 'Department *'}</label>
            <select
              className="input w-full"
              required={!canManage}
              value={form.responsibleDepartmentId}
              onChange={(e) => setForm({ ...form, responsibleDepartmentId: e.target.value })}
            >
              {canManage && <option value="">—</option>}
              {(canManage ? departments : myDepartments).map((d: any) => (
                <option key={d.id} value={d.id}>{d.name}</option>
              ))}
            </select>
          </div>
          <div><label className="label">Form of Submission</label><input className="input w-full" value={form.formOfSubmission} onChange={(e) => setForm({ ...form, formOfSubmission: e.target.value })} /></div>
          <div><label className="label">Score Cap %</label><input className="input w-full" type="number" min={100} value={form.scoreCap} onChange={(e) => setForm({ ...form, scoreCap: e.target.value })} /></div>
          <div className="flex items-end pb-2">
            <label className="text-xs text-slate-600 flex items-center gap-1.5">
              <input type="checkbox" checked={form.zeroActualIsPerfect} onChange={(e) => setForm({ ...form, zeroActualIsPerfect: e.target.checked })} />
              Zero actual = perfect (D KPIs)
            </label>
          </div>
          <div className="sm:col-span-2 lg:col-span-4 flex gap-2">
            <button className="btn-primary">{form.id ? 'Save Changes' : 'Create KPI'}</button>
            <button type="button" className="btn-secondary" onClick={() => setForm(null)}>Cancel</button>
          </div>
        </form>
        </div>
      )}

      <div className="card table-scroll">
        <table className="w-full min-w-[950px]">
          <thead className="bg-slate-50">
            <tr>
              <th className="table-th">Code</th>
              <th className="table-th">Name</th>
              <th className="table-th">Var</th>
              <th className="table-th">Target</th>
              <th className="table-th">Thresh.</th>
              <th className="table-th">Wt%</th>
              <th className="table-th">Freq</th>
              <th className="table-th">Responsible Dept</th>
              <th className="table-th">Cap</th>
              <th className="table-th">Assigned</th>
              <th className="table-th">Status</th>
              {(canApprove || canPropose) && <th className="table-th">Approval</th>}
              {canApprove && <th className="table-th"></th>}
              {canManage && <th className="table-th"></th>}
            </tr>
          </thead>
          <tbody>
            {rows.map((k) => (
              <tr key={k.id} className="border-t border-slate-100">
                <td className="table-td font-mono text-xs">{k.kpiCode}</td>
                <td className="table-td max-w-[280px] truncate" title={k.kpiName}>{k.kpiName}</td>
                <td className="table-td">{k.varianceIndicator === 'U' ? '↑U' : '↓D'}</td>
                <td className="table-td text-xs max-w-[190px]">
                  {/* The library states many targets as prose; show it as written. */}
                  <span className="truncate block" title={k.targetText || undefined}>
                    {k.targetText || fmt(k.defaultTarget)}
                  </span>
                </td>
                <td className="table-td">{fmt(k.defaultThreshold)}</td>
                <td className="table-td">{fmt(k.defaultWeight)}</td>
                <td className="table-td text-xs">{k.frequency}</td>
                <td className="table-td text-xs max-w-[170px]">
                  <span className="truncate block" title={k.responsibleDepartmentText || undefined}>
                    {k.responsibleDepartmentText || k.responsibleDepartmentName || '—'}
                  </span>
                </td>
                <td className="table-td text-xs">{k.scoreCap}%</td>
                <td className="table-td">{k.assignmentCount}</td>
                <td className="table-td">
                  <span className={`badge ${k.isActive ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-200 text-slate-500'}`}>
                    {k.isActive ? 'Active' : 'Inactive'}
                  </span>
                </td>
                {(canApprove || canPropose) && (
                  <td className="table-td">
                    <span
                      className={`badge ${
                        k.approvalStatus === 'APPROVED'
                          ? 'bg-emerald-100 text-emerald-700'
                          : k.approvalStatus === 'REJECTED'
                            ? 'bg-red-100 text-red-700'
                            : 'bg-amber-100 text-amber-700'
                      }`}
                      title={k.approvalStatus === 'REJECTED' ? k.rejectionReason || undefined : undefined}
                    >
                      {k.approvalStatus === 'PENDING'
                        ? 'Awaiting approval'
                        : k.approvalStatus === 'REJECTED'
                          ? 'Rejected'
                          : 'Approved'}
                    </span>
                  </td>
                )}
                {canApprove && (
                  <td className="table-td whitespace-nowrap">
                    {k.approvalStatus === 'PENDING' && (
                      <>
                        <button className="btn-primary btn-xs mr-1" onClick={() => approveKpi(k)}>Approve</button>
                        <button className="btn-danger btn-xs" onClick={() => { setReviewing(k); setReviewReason(''); }}>Reject</button>
                      </>
                    )}
                  </td>
                )}
                {canManage && (
                  <td className="table-td whitespace-nowrap">
                    <button
                      className="btn-secondary btn-xs mr-1"
                      onClick={() =>
                        setForm({
                          id: k.id, kpiCode: k.kpiCode, kpiName: k.kpiName, description: k.description,
                          calculationMethod: k.calculationMethod, varianceIndicator: k.varianceIndicator,
                          matrix: k.matrix, defaultTarget: k.defaultTarget ?? '', targetText: k.targetText ?? '',
                          defaultThreshold: k.defaultThreshold ?? '',
                          defaultWeight: k.defaultWeight ?? '', frequency: k.frequency,
                          responsibleDepartmentId: k.responsibleDepartmentId ?? '',
                          responsibleDepartmentText: k.responsibleDepartmentText ?? '', formOfSubmission: k.formOfSubmission,
                          scoreCap: String(k.scoreCap), zeroActualIsPerfect: k.zeroActualIsPerfect,
                        })
                      }
                    >
                      Edit
                    </button>
                    <button
                      className={`btn-xs ${k.isActive ? 'btn-danger' : 'btn-primary'}`}
                      onClick={async () => {
                        await api(`/api/kpis/${k.id}`, { method: 'PATCH', body: { isActive: !k.isActive } });
                        load();
                      }}
                    >
                      {k.isActive ? 'Deactivate' : 'Activate'}
                    </button>
                    {canDelete && (
                      <button
                        className="btn-xs text-red-600 hover:text-red-700 hover:underline"
                        title="Delete permanently"
                        onClick={() => { setDeleting(k); setDeleteError(''); }}
                      >
                        Delete
                      </button>
                    )}
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {deleting && (
        <div
          className="fixed inset-0 bg-black/40 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4"
          onClick={() => !deleteBusy && setDeleting(null)}
        >
          <div
            className="card w-full sm:max-w-md p-5 rounded-b-none sm:rounded-lg"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="font-bold text-slate-800">Delete this KPI?</h3>
            <div className="mt-3 rounded-md bg-slate-50 border border-slate-200 px-3 py-2">
              <div className="font-mono text-[11px] text-slate-400">{deleting.kpiCode}</div>
              <div className="text-[13px] font-medium text-slate-700">{deleting.kpiName}</div>
              <div className="text-[11.5px] text-slate-500 mt-1">
                {deleting.assignmentCount > 0
                  ? `Assigned to ${deleting.assignmentCount} employee${deleting.assignmentCount === 1 ? '' : 's'} — those assignments go too.`
                  : 'Not assigned to anyone.'}
              </div>
            </div>

            <p className="text-[12.5px] text-slate-500 mt-3">
              This cannot be undone. If the KPI has ever been scored it will be refused —
              deactivate it instead, which keeps the history and stops it appearing in
              future months.
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
                {deleteBusy ? 'Deleting…' : 'Delete permanently'}
              </button>
            </div>
          </div>
        </div>
      )}

      {reviewing && (
        <div
          className="fixed inset-0 bg-black/40 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4"
          onClick={() => !reviewBusy && setReviewing(null)}
        >
          <div className="card w-full sm:max-w-md p-5 rounded-b-none sm:rounded-lg" onClick={(e) => e.stopPropagation()}>
            <h3 className="font-bold text-slate-800">Reject {reviewing.kpiCode}?</h3>
            <div className="mt-3 rounded-md bg-slate-50 border border-slate-200 px-3 py-2">
              <div className="text-[13px] font-medium text-slate-700">{reviewing.kpiName}</div>
              <div className="text-[11.5px] text-slate-500 mt-1">
                Proposed for {reviewing.responsibleDepartmentName || reviewing.responsibleDepartmentText || 'no department'}.
              </div>
            </div>
            <p className="text-[12.5px] text-slate-500 mt-3">
              The KPI stays in the library marked Rejected - it is not deleted - and the person
              who proposed it is told why.
            </p>
            <div className="mt-3">
              <label className="label">Reason (shown to the proposer)</label>
              <textarea
                className="input w-full"
                rows={3}
                value={reviewReason}
                onChange={(e) => setReviewReason(e.target.value)}
                placeholder="e.g. Duplicates KPI042, or: the target needs to be a number."
              />
            </div>
            <div className="flex gap-2 justify-end mt-4">
              <button className="btn-secondary" disabled={reviewBusy} onClick={() => setReviewing(null)}>Cancel</button>
              <button className="btn-danger" disabled={reviewBusy} onClick={rejectKpi}>
                {reviewBusy ? 'Rejecting…' : 'Reject'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
