'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
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
  const [canReviewEdits, setCanReviewEdits] = useState(false);
  const [msg, setMsg] = useState('');
  // A department head's pending edit (EditRequest) open in the reject dialog.
  const [editReviewing, setEditReviewing] = useState<any>(null);
  const [editReviewReason, setEditReviewReason] = useState('');
  const [editReviewBusy, setEditReviewBusy] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [kpis, setKpis] = useState<any[]>([]);
  // One employee, any number of KPIs at once: picked is keyed by KPI id, and
  // each entry carries that KPI's own target/threshold/weight, since weights
  // have to add up to 100 across the employee and differ per KPI.
  const [employeeId, setEmployeeId] = useState('');
  const [picked, setPicked] = useState<Record<string, { target: string; threshold: string; weight: string }>>({});
  const [pickerQ, setPickerQ] = useState('');
  const [frequency, setFrequency] = useState(''); // '' = keep each KPI's own
  const [assigning, setAssigning] = useState(false);
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
      .then((r) => { setRows(r.assignments); setCanManage(r.canManage); setCanReviewEdits(!!r.canReviewEdits); })
      .catch((e) => setMsg(e.message));
  }, [year, deptFilter, q]);

  useEffect(() => {
    const t = setTimeout(load, 250);
    return () => clearTimeout(t);
  }, [load]);

  useEffect(() => {
    // The server already scopes this to a department head's own department;
    // a rejected KPI can never be assigned, so it's dropped here too rather
    // than only being refused on submit.
    api('/api/kpis')
      .then((r) => setKpis(r.kpis.filter((k: any) => k.isActive && k.approvalStatus !== 'REJECTED')))
      .catch(() => {});
  }, []);

  const kpiById = useMemo(() => new Map(kpis.map((k) => [k.id, k])), [kpis]);
  const deptName = departments.find((d: any) => d.id === deptFilter)?.name ?? '';

  /**
   * With a department picked, its own KPIs come first and the ones tied to no
   * department at all follow underneath - more than half the library has only
   * a free-text owner ("Production", "IT / Finance") and no real department
   * row, so hiding those outright would put them out of reach. Another
   * department's KPIs never show while a department is picked.
   */
  const pickerGroups = useMemo(() => {
    const term = pickerQ.trim().toLowerCase();
    const matches = (k: any) =>
      !term || k.kpiCode.toLowerCase().includes(term) || k.kpiName.toLowerCase().includes(term);
    if (!deptFilter) return [{ label: 'All KPIs', items: kpis.filter(matches) }];
    return [
      { label: deptName || 'This department', items: kpis.filter((k) => k.responsibleDepartmentId === deptFilter).filter(matches) },
      { label: 'No department', items: kpis.filter((k) => !k.responsibleDepartmentId).filter(matches) },
    ];
  }, [kpis, deptFilter, deptName, pickerQ]);

  function togglePick(k: any) {
    setPicked((prev) => {
      const next = { ...prev };
      if (next[k.id]) delete next[k.id];
      else
        next[k.id] = {
          target: k.defaultTarget != null ? String(k.defaultTarget) : '',
          threshold: k.defaultThreshold != null ? String(k.defaultThreshold) : '',
          weight: k.defaultWeight != null ? String(k.defaultWeight) : '',
        };
      return next;
    });
  }

  /** Weights have to total 100, and only 77 KPIs carry a default one. */
  function splitEvenly() {
    const ids = Object.keys(picked);
    if (!ids.length) return;
    const each = Math.round((100 / ids.length) * 100) / 100;
    setPicked((prev) => {
      const next = { ...prev };
      ids.forEach((id, i) => {
        const w = i === ids.length - 1 ? Math.round((100 - each * (ids.length - 1)) * 100) / 100 : each;
        next[id] = { ...next[id], weight: String(w) };
      });
      return next;
    });
  }

  /**
   * One request per KPI rather than a bulk endpoint, so every guard the single
   * assign already applies still runs per row - duplicate year, rejected KPI,
   * a department head's own-department limit - and each failure is reported
   * against its own KPI code. Whatever succeeded is unpicked; whatever failed
   * stays selected so it can be corrected and sent again.
   */
  async function assignAll(e: React.FormEvent) {
    e.preventDefault();
    const ids = Object.keys(picked);
    if (!ids.length) {
      setMsg('Pick at least one KPI first.');
      return;
    }
    setAssigning(true);
    setMsg('');
    const done: string[] = [];
    const failed: string[] = [];
    const failedIds = new Set<string>();
    for (const id of ids) {
      const k = kpiById.get(id);
      const v = picked[id];
      try {
        await api('/api/assignments', {
          body: {
            employeeId: employeeId.trim(),
            kpiId: id,
            year,
            target: Number(v.target),
            threshold: Number(v.threshold || v.target),
            weight: Number(v.weight),
            ...(frequency ? { frequency } : {}),
          },
        });
        done.push(k?.kpiCode ?? id);
      } catch (err: any) {
        failed.push(`${k?.kpiCode ?? id}: ${err.message}`);
        failedIds.add(id);
      }
    }
    setAssigning(false);
    if (done.length) {
      setPicked((prev) => {
        const next = { ...prev };
        for (const id of ids) if (!failedIds.has(id)) delete next[id];
        return next;
      });
    }
    setMsg(
      [
        done.length ? `✔ Assigned ${done.length} KPI${done.length === 1 ? '' : 's'} to ${employeeId.trim()}: ${done.join(', ')}.` : '',
        failed.length ? `Not assigned — ${failed.join(' | ')}` : '',
      ]
        .filter(Boolean)
        .join(' ')
    );
    if (!failed.length) {
      setShowCreate(false);
      setEmployeeId('');
      setPickerQ('');
      setFrequency('');
    }
    load();
  }

  // A department head's edit is already live (see the PATCH handler) - approve
  // just clears the flag; reject reverts target/threshold/weight and rescores
  // whatever wasn't already APPROVED. See EditRequest in schema.prisma.
  async function approveEdit(a: any) {
    try {
      await api(`/api/edit-requests/${a.pendingEditRequestId}/approve`, { body: {} });
      setMsg(`✔ ${a.kpiCode}'s edit for ${a.employeeName} was approved.`);
      load();
    } catch (err: any) {
      setMsg(err.message);
    }
  }

  async function rejectEdit() {
    if (!editReviewing) return;
    setEditReviewBusy(true);
    try {
      await api(`/api/edit-requests/${editReviewing.pendingEditRequestId}/reject`, { body: { reason: editReviewReason } });
      setMsg(`${editReviewing.kpiCode}'s edit for ${editReviewing.employeeName} was rejected and reverted.`);
      setEditReviewing(null);
      setEditReviewReason('');
      load();
    } catch (err: any) {
      setMsg(err.message);
    } finally {
      setEditReviewBusy(false);
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
      {msg && (
        <div
          className={`text-sm px-3 py-2 rounded-md border ${
            msg.startsWith('✔') ? 'bg-emerald-50 border-emerald-200 text-emerald-700' : 'bg-red-50 border-red-200 text-red-700'
          }`}
        >
          {msg}
        </div>
      )}

      {showCreate && (
        <form onSubmit={assignAll} className="card p-4 space-y-3">
          <div className="flex flex-wrap items-end gap-3">
            <div>
              <label className="label">Employee ID *</label>
              <input className="input" required value={employeeId} onChange={(e) => setEmployeeId(e.target.value)} />
            </div>
            <div>
              <label className="label">Frequency</label>
              <select className="input" value={frequency} onChange={(e) => setFrequency(e.target.value)}>
                <option value="">Each KPI&apos;s own</option>
                {['Monthly', 'Quarterly', 'Semi-Annual', 'Annual'].map((f) => <option key={f} value={f}>{f}</option>)}
              </select>
            </div>
            <div className="text-[11.5px] text-slate-400 pb-2">
              {deptFilter
                ? `Showing ${deptName} KPIs, then ones with no department — pick as many as you need.`
                : 'Pick as many KPIs as you need; filter by department above to narrow the list.'}
            </div>
          </div>

          <div>
            <label className="label">KPIs *</label>
            <input
              className="input w-full"
              placeholder="Search KPI code or name…"
              value={pickerQ}
              onChange={(e) => setPickerQ(e.target.value)}
            />
            <div className="mt-1.5 max-h-56 overflow-y-auto rounded-md border border-slate-200 divide-y divide-slate-100">
              {pickerGroups.every((g) => g.items.length === 0) && (
                <div className="px-3 py-3 text-[13px] text-slate-400">No KPI matches that search.</div>
              )}
              {pickerGroups.map((g) =>
                g.items.length === 0 ? null : (
                  <div key={g.label}>
                    <div className="px-3 py-1.5 bg-slate-50 text-[11px] font-semibold uppercase tracking-wide text-slate-500 sticky top-0">
                      {g.label} · {g.items.length}
                    </div>
                    {g.items.map((k: any) => (
                      <label
                        key={k.id}
                        className="flex items-center gap-2 px-3 py-1.5 hover:bg-slate-50 cursor-pointer text-[13px]"
                      >
                        <input type="checkbox" checked={!!picked[k.id]} onChange={() => togglePick(k)} />
                        <span className="font-mono text-[11px] text-slate-400 w-16 shrink-0">{k.kpiCode}</span>
                        <span className="truncate flex-1">{k.kpiName}</span>
                        {/* Which department owns it only needs saying when the
                            list isn't already narrowed to one. */}
                        {!deptFilter && (k.responsibleDepartmentName || k.responsibleDepartmentText) && (
                          <span className="text-[11px] text-slate-400 shrink-0 max-w-[140px] truncate">
                            {k.responsibleDepartmentName || k.responsibleDepartmentText}
                          </span>
                        )}
                        {k.approvalStatus === 'PENDING' && (
                          <span className="badge bg-amber-100 text-amber-700 shrink-0">Awaiting approval</span>
                        )}
                      </label>
                    ))}
                  </div>
                )
              )}
            </div>
          </div>

          {Object.keys(picked).length > 0 && (
            <div className="rounded-md border border-slate-200">
              <div className="flex items-center justify-between px-3 py-1.5 bg-slate-50">
                <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                  Selected · {Object.keys(picked).length}
                </span>
                <span className="flex items-center gap-2">
                  <span className="text-[11.5px] text-slate-500">
                    Weights total{' '}
                    <b>
                      {fmt(
                        Object.values(picked).reduce((s, v) => s + (Number(v.weight) || 0), 0)
                      )}
                      %
                    </b>
                  </span>
                  <button type="button" className="btn-secondary btn-xs" onClick={splitEvenly}>
                    Split 100% evenly
                  </button>
                </span>
              </div>
              <div className="divide-y divide-slate-100">
                {Object.keys(picked).map((id) => {
                  const k = kpiById.get(id);
                  const v = picked[id];
                  const set = (patch: Partial<typeof v>) =>
                    setPicked((prev) => ({ ...prev, [id]: { ...prev[id], ...patch } }));
                  return (
                    <div key={id} className="flex flex-wrap items-center gap-2 px-3 py-2">
                      <span className="font-mono text-[11px] text-slate-400 w-16 shrink-0">{k?.kpiCode}</span>
                      <span className="text-[13px] truncate flex-1 min-w-[140px]">{k?.kpiName}</span>
                      <label className="text-[11px] text-slate-500">
                        Target *
                        <input
                          className="input w-20 ml-1" type="number" step="any" required
                          value={v.target} onChange={(e) => set({ target: e.target.value })}
                        />
                      </label>
                      <label className="text-[11px] text-slate-500">
                        Thresh.
                        <input
                          className="input w-20 ml-1" type="number" step="any"
                          value={v.threshold} onChange={(e) => set({ threshold: e.target.value })}
                        />
                      </label>
                      <label className="text-[11px] text-slate-500">
                        Wt% *
                        <input
                          className="input w-20 ml-1" type="number" step="any" required
                          value={v.weight} onChange={(e) => set({ weight: e.target.value })}
                        />
                      </label>
                      <button
                        type="button"
                        className="text-slate-400 hover:text-red-600 px-1"
                        title="Remove from the list"
                        onClick={() => setPicked((prev) => { const next = { ...prev }; delete next[id]; return next; })}
                      >
                        ✕
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          <div className="flex gap-2">
            <button className="btn-primary" disabled={assigning || Object.keys(picked).length === 0}>
              {assigning ? 'Assigning…' : `Assign ${Object.keys(picked).length || ''} KPI${Object.keys(picked).length === 1 ? '' : 's'}`}
            </button>
            <button type="button" className="btn-secondary" onClick={() => { setShowCreate(false); setPicked({}); setPickerQ(''); }}>
              Cancel
            </button>
          </div>
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
              {canReviewEdits && <th className="table-th"></th>}
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
                  {a.kpiApprovalStatus === 'PENDING' && (
                    <span className="badge bg-amber-100 text-amber-700 ml-1.5">Awaiting approval</span>
                  )}
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
                  {a.pendingEditRequestId && (
                    <span className="badge bg-amber-100 text-amber-700 ml-1.5">Pending Compliance Review</span>
                  )}
                </td>
                {canReviewEdits && (
                  <td className="table-td whitespace-nowrap">
                    {a.pendingEditRequestId && (
                      <>
                        <button className="btn-primary btn-xs mr-1" onClick={() => approveEdit(a)}>Approve edit</button>
                        <button className="btn-danger btn-xs" onClick={() => { setEditReviewing(a); setEditReviewReason(''); }}>Reject edit</button>
                      </>
                    )}
                  </td>
                )}
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

      {editReviewing && (
        <div
          className="fixed inset-0 bg-black/40 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4"
          onClick={() => !editReviewBusy && setEditReviewing(null)}
        >
          <div className="card w-full sm:max-w-md p-5 rounded-b-none sm:rounded-lg" onClick={(e) => e.stopPropagation()}>
            <h3 className="font-bold text-slate-800">
              Reject the edit to {editReviewing.kpiCode} for {editReviewing.employeeName}?
            </h3>
            <p className="text-[12.5px] text-slate-500 mt-3">
              Target/threshold/weight revert to what they held before this edit, any submission
              that isn't already approved is rescored back, and the department head who made the
              change is told why.
            </p>
            <div className="mt-3">
              <label className="label">Reason (shown to whoever made the edit)</label>
              <textarea
                className="input w-full"
                rows={3}
                value={editReviewReason}
                onChange={(e) => setEditReviewReason(e.target.value)}
              />
            </div>
            <div className="flex gap-2 justify-end mt-4">
              <button className="btn-secondary" disabled={editReviewBusy} onClick={() => setEditReviewing(null)}>Cancel</button>
              <button className="btn-danger" disabled={editReviewBusy} onClick={rejectEdit}>
                {editReviewBusy ? 'Rejecting…' : 'Reject edit'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
