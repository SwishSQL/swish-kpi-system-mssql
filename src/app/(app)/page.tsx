'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useApp } from '@/components/AppContext';
import { api, fmt, monthKeyNow } from '@/lib/clientApi';

const PERF_BADGE: Record<string, string> = {
  TARGET_ACHIEVED: 'bg-emerald-100 text-emerald-700',
  BETWEEN_TARGET_AND_THRESHOLD: 'bg-amber-100 text-amber-700',
  BELOW_THRESHOLD: 'bg-red-100 text-red-700',
};
const PERF_LABEL: Record<string, string> = {
  TARGET_ACHIEVED: 'Target Achieved',
  BETWEEN_TARGET_AND_THRESHOLD: 'Between Target & Threshold',
  BELOW_THRESHOLD: 'Below Threshold',
};
const PERF_SHORT: Record<string, string> = {
  TARGET_ACHIEVED: 'On target',
  BETWEEN_TARGET_AND_THRESHOLD: 'Mid',
  BELOW_THRESHOLD: 'Below',
};
const STAGE_BADGE: Record<string, string> = {
  PENDING_LINE_MANAGER: 'bg-amber-100 text-amber-700',
  PENDING_DEPARTMENT_MANAGER: 'bg-orange-100 text-orange-700',
  PENDING_COMPLIANCE: 'bg-indigo-100 text-indigo-700',
  APPROVED: 'bg-emerald-100 text-emerald-700',
};
const LEVEL_LABEL: Record<string, string> = {
  LINE_MANAGER: 'Approve as line manager',
  DEPARTMENT_MANAGER: 'Approve as department manager',
  COMPLIANCE: 'Approve as compliance',
};

const SUB_BADGE: Record<string, string> = {
  NOT_STARTED: 'bg-slate-100 text-slate-500',
  DRAFT: 'bg-slate-100 text-slate-600',
  SUBMITTED: 'bg-brand-100 text-brand-700',
  UPDATED: 'bg-indigo-100 text-indigo-700',
  LOCKED: 'bg-slate-200 text-slate-600',
  REJECTED: 'bg-red-100 text-red-700',
  REOPENED: 'bg-amber-100 text-amber-700',
};

function previewScore(row: any, actualStr: string): { score: number; perf: string } | null {
  const actual = Number(actualStr);
  if (actualStr === '' || !Number.isFinite(actual)) return null;
  const cap = row.kpi.scoreCap > 0 ? row.kpi.scoreCap : 100;
  let score: number;
  if (row.kpi.varianceIndicator === 'U') {
    score = row.target === 0 ? cap : (actual / row.target) * 100;
  } else {
    if (actual === 0) score = row.kpi.zeroActualIsPerfect ? 100 : cap;
    else score = row.target === 0 ? 0 : (row.target / actual) * 100;
  }
  score = Math.max(0, Math.min(cap, score));
  let perf: string;
  if (row.kpi.varianceIndicator === 'U') {
    perf = actual >= row.target ? 'TARGET_ACHIEVED' : actual >= row.threshold ? 'BETWEEN_TARGET_AND_THRESHOLD' : 'BELOW_THRESHOLD';
  } else {
    perf = actual <= row.target ? 'TARGET_ACHIEVED' : actual <= row.threshold ? 'BETWEEN_TARGET_AND_THRESHOLD' : 'BELOW_THRESHOLD';
  }
  return { score: Math.round(score * 100) / 100, perf };
}

export default function SubmissionsPage() {
  const { month, setMonth, departmentId, q, refreshKey, refresh, pendingPrevMonth } = useApp();
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState('');
  const [perfFilter, setPerfFilter] = useState('');
  const [error, setError] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  // Which department tab is open. '' is every department at once.
  const [deptTab, setDeptTab] = useState('');
  // The tabs come back with the data, so they are remembered while a narrower
  // request is in flight - otherwise the strip would empty out on every click.
  const [tabs, setTabs] = useState<any[]>([]);
  const [bannerDismissed, setBannerDismissed] = useState(false);
  const [openIds, setOpenIds] = useState<Set<string>>(new Set());
  // Employee a notification asked us to open, held until the data arrives.
  const [focusId, setFocusId] = useState<string | null>(null);
  const focusHandled = useRef(false);

  // Read straight from the URL rather than useSearchParams, which would force a
  // Suspense boundary around this client page purely for two optional params.
  useEffect(() => {
    const read = () => {
      const p = new URLSearchParams(window.location.search);
      const m = p.get('month');
      const emp = p.get('employee');
      if (m && /^\d{4}-\d{2}$/.test(m)) setMonth(m);
      if (emp) {
        focusHandled.current = false;
        setFocusId(emp);
      }
    };
    read();
    window.addEventListener('popstate', read);
    return () => window.removeEventListener('popstate', read);
  }, [setMonth]);

  const toggleEmployee = useCallback((id: string) => {
    setOpenIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const load = useCallback(() => {
    setLoading(true);
    const params = new URLSearchParams({ month, page: String(page), pageSize: String(pageSize) });
    if (q) params.set('q', q);
    if (deptTab) params.set('departmentId', deptTab);
    if (statusFilter) params.set('submissionStatus', statusFilter);
    if (perfFilter) params.set('performanceStatus', perfFilter);
    api(`/api/submissions?${params}`)
      .then((res) => {
        setData(res);
        setError('');
        if (res.departmentTabs) setTabs(res.departmentTabs);
        // A single employee — someone viewing their own KPIs — should not
        // have to click to reach the only card on the page.
        setOpenIds(res.employees?.length === 1 ? new Set([res.employees[0].profile.id]) : new Set());
        focusHandled.current = false;
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [month, q, deptTab, statusFilter, perfFilter, page, pageSize]);

  // The topbar's department picker and the tab strip are the same choice shown
  // twice; whichever one moves, the other follows.
  useEffect(() => { setDeptTab(departmentId); }, [departmentId]);

  // A filter change must not leave the reader stranded on a page that no
  // longer exists.
  useEffect(() => { setPage(1); }, [month, q, deptTab, statusFilter, perfFilter]);

  useEffect(() => {
    const t = setTimeout(load, q ? 300 : 0);
    return () => clearTimeout(t);
  }, [load, refreshKey]);

  // Once the month's data is on screen, open the card the notification pointed
  // at and bring it into view. Runs once per load so a later refresh does not
  // yank the user back to it.
  useEffect(() => {
    if (!focusId || !data || focusHandled.current) return;
    const found = (data.employees ?? []).some((e: any) => e.profile.id === focusId);
    if (!found) return;
    focusHandled.current = true;
    setOpenIds((prev) => new Set(prev).add(focusId));
    requestAnimationFrame(() => {
      document.getElementById(`emp-${focusId}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    });
  }, [focusId, data]);

  // Compliance and admins review department by department; everyone else sees a flat list.
  const groupedEmployees = useMemo(() => {
    const list: any[] = data?.employees ?? [];
    if (!data?.groupByDepartment) return [{ department: null as string | null, list }];
    const byDept = new Map<string, any[]>();
    for (const emp of list) {
      const key = emp.profile.departmentName ?? 'Unassigned';
      byDept.set(key, [...(byDept.get(key) ?? []), emp]);
    }
    return [...byDept.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([department, l]) => ({ department, list: l }));
  }, [data]);

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2 mb-3">
        <h2 className="text-[15px] sm:text-lg font-bold text-slate-800">{month}</h2>
        {data?.period ? (
          <span className={`badge ${data.period.status === 'OPEN' ? 'bg-emerald-100 text-emerald-700' : data.period.status === 'LOCKED' ? 'bg-slate-200 text-slate-600' : 'bg-amber-100 text-amber-700'}`}>
            {data.period.status}
          </span>
        ) : (
          !loading && <span className="badge bg-slate-200 text-slate-600">Month not opened</span>
        )}
        {data?.editable?.reason && (
          <span className="text-[11px] sm:text-xs text-amber-600 w-full sm:w-auto">{data.editable.reason}</span>
        )}
        <div className="hidden sm:block flex-1" />
        <div className="flex gap-2 w-full sm:w-auto">
          <select className="input !py-1 text-xs flex-1 min-w-0 sm:flex-none" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
            <option value="">All submission statuses</option>
            {['NOT_STARTED', 'DRAFT', 'SUBMITTED', 'UPDATED', 'LOCKED', 'REOPENED'].map((s) => (
              <option key={s} value={s}>{s.replace(/_/g, ' ')}</option>
            ))}
          </select>
          <select className="input !py-1 text-xs flex-1 min-w-0 sm:flex-none" value={perfFilter} onChange={(e) => setPerfFilter(e.target.value)}>
            <option value="">All performance statuses</option>
            {Object.keys(PERF_LABEL).map((s) => (
              <option key={s} value={s}>{PERF_LABEL[s]}</option>
            ))}
          </select>
        </div>
      </div>

      {pendingPrevMonth && month === monthKeyNow() && !bannerDismissed && (
        <div className="flex items-start gap-2.5 rounded-md bg-amber-50 border border-amber-200 text-amber-800 text-[13px] px-3 py-2.5 mb-3">
          <span className="shrink-0">⚠️</span>
          <div className="flex-1 min-w-0">
            You haven&apos;t recorded anything for <b>{pendingPrevMonth}</b> yet. If that&apos;s what you meant to submit
            just now, switch months first — entries here go under <b>{month}</b>.
          </div>
          <button
            className="btn-primary btn-xs shrink-0"
            onClick={() => setMonth(pendingPrevMonth)}
          >
            Switch to {pendingPrevMonth}
          </button>
          <button className="text-amber-600 hover:text-amber-800 shrink-0 text-base leading-none" onClick={() => setBannerDismissed(true)} title="Dismiss">
            ✕
          </button>
        </div>
      )}

      {/* Department tabs — three hundred people in one list is unreadable, and
          almost everyone arrives wanting a single department. */}
      {tabs.length > 1 && (
        <div className="dept-tabs mb-3">
          <div className="flex gap-1 overflow-x-auto pb-px -mb-px">
            <DeptTab
              label="All departments"
              count={tabs.reduce((s: number, t: any) => s + t.employees, 0)}
              active={deptTab === ''}
              onClick={() => setDeptTab('')}
            />
            {tabs.map((t: any) => (
              <DeptTab
                key={t.id ?? '_none'}
                label={t.name}
                count={t.employees}
                active={deptTab === t.id}
                onClick={() => setDeptTab(t.id ?? '')}
              />
            ))}
          </div>
        </div>
      )}

      {error && <div className="rounded-md bg-red-50 border border-red-200 text-red-700 text-sm px-3 py-2 mb-3">{error}</div>}
      {loading && <div className="text-sm text-slate-400 py-10 text-center">Loading…</div>}
      {!loading && data?.employees?.length === 0 && (
        <div className="card p-8 sm:p-10 text-center text-sm text-slate-400">
          No employees with KPIs due in this month match the current filters.
        </div>
      )}

      {!loading && data?.employees?.length > 1 && (
        <div className="flex items-center gap-2 mb-2 text-xs text-slate-500">
          <span>
            {data.pagination && data.pagination.totalPages > 1
              ? `${data.employees.length} of ${data.pagination.totalEmployees} employees`
              : `${data.employees.length} employees`}
          </span>
          <div className="flex-1" />
          <button
            className="text-brand-600 hover:underline"
            onClick={() => setOpenIds(new Set(data.employees.map((e: any) => e.profile.id)))}
          >
            Expand all
          </button>
          <span className="text-slate-300">·</span>
          <button className="text-brand-600 hover:underline" onClick={() => setOpenIds(new Set())}>
            Collapse all
          </button>
        </div>
      )}

      <div className="space-y-2">
        {groupedEmployees.map(({ department, list }) => (
          <div key={department ?? '_'} className="space-y-2">
            {department !== null && (
              <div className="flex items-center gap-2 pt-2 first:pt-0">
                <h3 className="text-[12px] font-bold uppercase tracking-wide text-slate-500">{department}</h3>
                <span className="text-[11px] text-slate-400">{list.length}</span>
                <div className="flex-1 h-px bg-slate-200" />
              </div>
            )}
            {list.map((emp: any) => (
              <EmployeeCard
                key={emp.profile.id}
                emp={emp}
                month={month}
                onSaved={refresh}
                open={openIds.has(emp.profile.id)}
                onToggle={() => toggleEmployee(emp.profile.id)}
                highlighted={focusId === emp.profile.id}
              />
            ))}
          </div>
        ))}
      </div>

      {/* The month can run to hundreds of people; sending them all at once was
          what made this screen slow, so it is served a page at a time. */}
      {!loading && data?.pagination && data.pagination.totalEmployees > 0 && (
        <div className="flex flex-wrap items-center gap-2 mt-4 pt-3 border-t border-slate-200 text-xs text-slate-500">
          <label className="flex items-center gap-1.5">
            <span className="hidden sm:inline">Per page</span>
            <select
              className="input !py-1 !px-2 text-xs w-auto"
              value={pageSize}
              onChange={(e) => {
                setPageSize(Number(e.target.value));
                setPage(1);
              }}
            >
              {[10, 20, 50, 100].map((n) => (
                <option key={n} value={n}>{n}</option>
              ))}
            </select>
          </label>
          <div className="flex-1" />
          <span>
            Page {data.pagination.page} of {data.pagination.totalPages}
            <span className="hidden sm:inline"> · {data.pagination.totalEmployees} employees</span>
          </span>
          <div className="flex gap-1">
            <button
              className="btn-secondary !py-1 !px-2.5 text-xs"
              disabled={data.pagination.page <= 1}
              onClick={() => setPage(data.pagination.page - 1)}
            >
              ‹ Prev
            </button>
            <button
              className="btn-secondary !py-1 !px-2.5 text-xs"
              disabled={data.pagination.page >= data.pagination.totalPages}
              onClick={() => setPage(data.pagination.page + 1)}
            >
              Next ›
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/** One department in the tab strip, with how many people sit behind it. */
function DeptTab({
  label,
  count,
  active,
  onClick,
}: {
  label: string;
  count: number;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={active ? 'page' : undefined}
      title={label}
      className={`group shrink-0 flex items-center gap-1.5 px-3 py-2 text-[12px] font-medium whitespace-nowrap border-b-2 transition-colors ${
        active
          ? 'border-brand-600 text-brand-700'
          : 'border-transparent text-slate-500 hover:text-slate-800 hover:border-slate-300'
      }`}
    >
      <span className="max-w-[190px] truncate">{label}</span>
      <span
        className={`rounded-full px-1.5 py-px text-[10px] font-semibold tabular-nums ${
          active ? 'bg-brand-100 text-brand-700' : 'bg-slate-100 text-slate-500 group-hover:bg-slate-200'
        }`}
      >
        {count}
      </span>
    </button>
  );
}

function EmployeeCard({
  emp,
  month,
  onSaved,
  open,
  onToggle,
  highlighted = false,
}: {
  emp: any;
  month: string;
  onSaved: () => void;
  open: boolean;
  onToggle: () => void;
  highlighted?: boolean;
}) {
  const { me } = useApp();
  const isAdmin = me?.user.systemRole === 'SUPER_ADMIN' || me?.user.systemRole === 'ADMIN';
  const [entries, setEntries] = useState<Record<string, { actual: string; comment: string }>>({});
  const [attachments, setAttachments] = useState<Record<string, any[]>>({});
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState(false);
  // Set to a target month string while the "move month" dialog is open; null when closed.
  const [moveTo, setMoveTo] = useState<string | null>(null);
  const [uploading, setUploading] = useState<Record<string, boolean>>({});
  const [clearing, setClearing] = useState<Record<string, boolean>>({});
  // Per-KPI action in flight, keyed by assignmentId.
  const [rowBusy, setRowBusy] = useState<Record<string, boolean>>({});
  // The KPI open in the per-row edit dialog, or null.
  const [editRow, setEditRow] = useState<any>(null);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const idemKey = useRef<string>('');

  useEffect(() => {
    const e: Record<string, { actual: string; comment: string }> = {};
    const a: Record<string, any[]> = {};
    for (const row of emp.rows) {
      e[row.assignmentId] = {
        actual:
          row.submission && row.submission.submissionStatus !== 'DRAFT'
            ? String(row.submission.actualResult)
            : '',
        comment: row.submission?.comment ?? '',
      };
      a[row.assignmentId] = row.submission?.attachments ?? [];
    }
    setEntries(e);
    setAttachments(a);
    idemKey.current =
      typeof crypto !== 'undefined' && 'randomUUID' in crypto
        ? crypto.randomUUID()
        : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  }, [emp]);

  const allFilled = emp.rows.every(
    (r: any) => entries[r.assignmentId]?.actual !== '' && entries[r.assignmentId]?.actual !== undefined
  );
  const allAttached = emp.rows.every((r: any) => (attachments[r.assignmentId] ?? []).length > 0);

  /**
   * Uploads one at a time rather than in parallel: the server counts existing
   * files to enforce the per-KPI limit and rejects duplicates by checksum, and
   * concurrent requests would race both checks.
   */
  async function uploadFiles(assignmentId: string, files: File[]) {
    setUploading((p) => ({ ...p, [assignmentId]: true }));
    const failures: string[] = [];
    for (const file of files) {
      const form = new FormData();
      form.append('file', file);
      form.append('kpiAssignmentId', assignmentId);
      form.append('month', month);
      try {
        const res = await api('/api/attachments', { form });
        setAttachments((prev) => ({
          ...prev,
          [assignmentId]: [...(prev[assignmentId] ?? []), res.attachment],
        }));
      } catch (err: any) {
        failures.push(`${file.name}: ${err.message}`);
      }
    }
    setUploading((p) => ({ ...p, [assignmentId]: false }));

    if (failures.length === 0) setMsg(null);
    else if (failures.length === files.length) setMsg({ kind: 'err', text: failures.join(' · ') });
    else setMsg({ kind: 'err', text: `${files.length - failures.length} uploaded. ${failures.join(' · ')}` });
  }

  async function removeAttachment(assignmentId: string, attId: string) {
    try {
      await api(`/api/attachments/${attId}`, { method: 'DELETE', body: {} });
      setAttachments((prev) => ({
        ...prev,
        [assignmentId]: (prev[assignmentId] ?? []).filter((a) => a.id !== attId),
      }));
    } catch (err: any) {
      setMsg({ kind: 'err', text: err.message });
    }
  }

  /**
   * Opens the per-KPI edit dialog. An administrator correcting something that
   * has already been approved gets the extra choice of whether the correction
   * should send it back round the chain.
   */
  function openRowEdit(row: any) {
    const sub = row.submission;
    setEditRow({
      assignmentId: row.assignmentId,
      submissionId: sub.id,
      code: row.kpi.code,
      name: row.kpi.name,
      target: row.target,
      threshold: row.threshold,
      stageLabel: sub.stageLabel,
      actual: String(sub.actualResult ?? ''),
      comment: sub.comment ?? '',
      canKeepApproval: isAdmin,
      resetApproval: !isAdmin,
    });
  }

  /** Signs off a single KPI, leaving its siblings exactly where they are. */
  async function approveRow(row: any) {
    setRowBusy((p) => ({ ...p, [row.assignmentId]: true }));
    try {
      const res = await api(`/api/submissions/${row.submission.id}/approve`, { body: {} });
      setMsg({ kind: 'ok', text: `${res.kpiCode}: ${res.stageLabel}.` });
      onSaved();
    } catch (err: any) {
      setMsg({ kind: 'err', text: err.message });
    } finally {
      setRowBusy((p) => ({ ...p, [row.assignmentId]: false }));
    }
  }

  /** Admin only: sends one KPI back a stage, the way out of a mistaken sign-off. */
  async function revertRow(row: any) {
    const ok = confirm(
      `Send ${row.kpi.code} back one stage?\n\n` +
        `It is currently at "${row.submission.stageLabel}". It will return to the previous ` +
        `stage and become editable again by whoever owns it. No values are lost and the ` +
        `approval history is kept.\n\nOnly this KPI is affected.`
    );
    if (!ok) return;
    setRowBusy((p) => ({ ...p, [row.assignmentId]: true }));
    try {
      const res = await api(`/api/submissions/${row.submission.id}/revert`, { body: {} });
      setMsg({ kind: 'ok', text: `${res.kpiCode} sent back to ${res.stageLabel}.` });
      onSaved();
    } catch (err: any) {
      setMsg({ kind: 'err', text: err.message });
    } finally {
      setRowBusy((p) => ({ ...p, [row.assignmentId]: false }));
    }
  }

  /** Saves the per-KPI edit dialog. */
  async function saveRowEdit() {
    if (!editRow) return;
    const value = Number(editRow.actual);
    if (editRow.actual === '' || !Number.isFinite(value)) {
      setMsg({ kind: 'err', text: 'Enter a number for the actual result.' });
      return;
    }
    setRowBusy((p) => ({ ...p, [editRow.assignmentId]: true }));
    try {
      const res = await api(`/api/submissions/${editRow.submissionId}`, {
        method: 'PATCH',
        body: {
          actualResult: value,
          comment: editRow.comment,
          ...(editRow.canKeepApproval ? { resetApproval: editRow.resetApproval } : {}),
        },
      });
      setMsg({
        kind: 'ok',
        text: `${res.kpiCode} updated — score ${fmt(res.score)}%${
          res.approvalReset ? ', sent back for re-approval' : ''
        }.`,
      });
      setEditRow(null);
      onSaved();
    } catch (err: any) {
      setMsg({ kind: 'err', text: err.message });
    } finally {
      setRowBusy((p) => ({ ...p, [editRow.assignmentId]: false }));
    }
  }

  /**
   * Wipes one KPI's recorded result - value, comment and evidence - so it can
   * be entered again from scratch. Only offered where something is actually
   * recorded; a Not started row has nothing to clear.
   */
  async function clearRow(row: any) {
    const id = row.submission?.id;
    if (!id) return;
    const files = (attachments[row.assignmentId] ?? []).length;
    const ok = confirm(
      `Clear ${row.kpi.code} for ${emp.profile.fullName} (${month})?\n\n` +
        `The recorded result${row.submission.actualResult !== undefined ? ` (${fmt(row.submission.actualResult)})` : ''}, its comment and ` +
        `${files} attachment${files === 1 ? '' : 's'} will be deleted and the KPI goes back to Not started.`
    );
    if (!ok) return;

    setClearing((p) => ({ ...p, [row.assignmentId]: true }));
    try {
      await api(`/api/submissions/${id}`, { method: 'DELETE', body: {} });
      setMsg({ kind: 'ok', text: `${row.kpi.code} cleared.` });
      onSaved();
    } catch (err: any) {
      setMsg({ kind: 'err', text: err.message });
    } finally {
      setClearing((p) => ({ ...p, [row.assignmentId]: false }));
    }
  }

  /** Same, for the whole month at once. */
  async function clearMonth() {
    const recorded = emp.rows.filter((r: any) => r.submission);
    const files = recorded.reduce(
      (sum: number, r: any) => sum + (attachments[r.assignmentId] ?? []).length,
      0
    );
    const ok = confirm(
      `Clear ALL of ${emp.profile.fullName}'s results for ${month}?\n\n` +
        `${recorded.length} KPI${recorded.length === 1 ? '' : 's'} (${recorded.map((r: any) => r.kpi.code).join(', ')}), ` +
        `${files} attachment${files === 1 ? '' : 's'} and the approval status will be deleted. ` +
        `The month goes back to Not started.`
    );
    if (!ok) return;

    setBusy(true);
    try {
      const res = await api('/api/submissions/clear', {
        body: { employeeProfileId: emp.profile.id, month },
      });
      setMsg({ kind: 'ok', text: `Cleared ${res.cleared} KPI${res.cleared === 1 ? '' : 's'} for ${month}.` });
      onSaved();
    } catch (err: any) {
      setMsg({ kind: 'err', text: err.message });
    } finally {
      setBusy(false);
    }
  }

  /**
   * Relabels this month's results onto a different month - the fix for
   * someone entering last month's numbers under the month the screen opened
   * on by default. Only offered to a reviewer or admin (see canMoveMonth),
   * never to the employee whose own mix-up this is correcting.
   */
  async function moveMonth() {
    if (!moveTo) return;
    setBusy(true);
    try {
      const res = await api('/api/submissions/move', {
        body: { employeeProfileId: emp.profile.id, fromMonth: month, toMonth: moveTo },
      });
      setMsg({ kind: 'ok', text: `Moved ${res.moved} KPI${res.moved === 1 ? '' : 's'} from ${month} to ${moveTo}.` });
      setMoveTo(null);
      onSaved();
    } catch (err: any) {
      setMsg({ kind: 'err', text: err.message });
    } finally {
      setBusy(false);
    }
  }

  async function submitAll() {
    setMsg(null);
    const missing = emp.rows.filter((r: any) => !entries[r.assignmentId]?.actual);
    if (missing.length) {
      setMsg({ kind: 'err', text: `Enter an actual result for: ${missing.map((r: any) => r.kpi.code).join(', ')}` });
      return;
    }
    const noAttach = emp.rows.filter((r: any) => (attachments[r.assignmentId] ?? []).length === 0);
    if (noAttach.length) {
      setMsg({ kind: 'err', text: `Attachment required for: ${noAttach.map((r: any) => r.kpi.code).join(', ')}` });
      return;
    }
    setBusy(true);
    try {
      await api('/api/submissions/submit', {
        body: {
          employeeProfileId: emp.profile.id,
          month,
          idempotencyKey: idemKey.current,
          entries: emp.rows.map((r: any) => ({
            kpiAssignmentId: r.assignmentId,
            actualResult: Number(entries[r.assignmentId].actual),
            comment: entries[r.assignmentId].comment || undefined,
            version: r.submission?.version,
          })),
        },
      });
      setMsg({ kind: 'ok', text: 'Saved successfully.' });
      onSaved();
    } catch (err: any) {
      setMsg({ kind: 'err', text: err.message });
    } finally {
      setBusy(false);
    }
  }

  /** Shared per-row view model so the table and the card view stay identical. */
  function viewModel(row: any) {
    const entry = entries[row.assignmentId] ?? { actual: '', comment: '' };
    const atts = attachments[row.assignmentId] ?? [];
    const saved = row.submission && row.submission.submissionStatus !== 'DRAFT';
    // Staff must not see a live score either - that would defeat hiding the
    // saved one until compliance signs off.
    const preview = emp.canSubmit && emp.scoresVisible ? previewScore(row, entry.actual) : null;
    return {
      entry,
      atts,
      saved,
      score: emp.scoresVisible ? (preview?.score ?? (saved ? row.submission.calculatedScore : null)) : null,
      perf: emp.scoresVisible ? (preview?.perf ?? (saved ? row.submission.performanceStatus : null)) : null,
      subStatus: row.submission?.submissionStatus ?? 'NOT_STARTED',
      isOpen: !!expanded[row.assignmentId],
    };
  }

  const setActual = (id: string, v: string) =>
    setEntries((p) => ({ ...p, [id]: { ...(p[id] ?? { actual: '', comment: '' }), actual: v } }));
  const setComment = (id: string, v: string) =>
    setEntries((p) => ({ ...p, [id]: { ...(p[id] ?? { actual: '', comment: '' }), comment: v } }));
  const toggle = (id: string) => setExpanded((p) => ({ ...p, [id]: !p[id] }));

  const submitButton = emp.canSubmit && (
    <button
      className="btn-primary w-full sm:w-auto"
      onClick={submitAll}
      disabled={busy || !allFilled || !allAttached}
      title={!allFilled ? 'Enter all actual results' : !allAttached ? 'Every KPI needs at least one attachment' : ''}
    >
      {busy ? 'Saving…' : emp.hasExisting ? 'Update' : 'Submit'}
    </button>
  );

  const total = emp.rows.length;
  const submittedCount = emp.rows.filter(
    (r: any) => r.submission && r.submission.submissionStatus !== 'DRAFT'
  ).length;
  const belowCount = emp.rows.filter(
    (r: any) => r.submission?.performanceStatus === 'BELOW_THRESHOLD'
  ).length;

  const progressBadge =
    submittedCount === 0
      ? { cls: 'bg-slate-100 text-slate-500', text: 'Not started' }
      : submittedCount < total
        ? { cls: 'bg-amber-100 text-amber-700', text: `${submittedCount}/${total} submitted` }
        : { cls: 'bg-emerald-100 text-emerald-700', text: 'Complete' };

  async function approve() {
    setMsg(null);
    setBusy(true);
    try {
      const res = await api('/api/approvals', {
        body: { employeeProfileId: emp.profile.id, month },
      });
      setMsg({ kind: 'ok', text: `Approved. Now: ${res.stageLabel}.` });
      onSaved();
    } catch (err: any) {
      setMsg({ kind: 'err', text: err.message });
    } finally {
      setBusy(false);
    }
  }

  // Always on show next to Submit so it can be found, but greyed out until the
  // month actually holds something - hiding it altogether left people hunting
  // for a button that was simply not applicable yet.
  const hasRecorded = emp.rows.some((r: any) => r.submission);
  const clearAllButton = emp.canSubmit && (
    <button
      className="btn-secondary w-full sm:w-auto !text-red-600 !border-red-200 hover:!bg-red-50"
      onClick={clearMonth}
      disabled={busy || !hasRecorded}
      title={
        hasRecorded
          ? `Delete everything ${emp.profile.fullName} has recorded for ${month}`
          : `Nothing is recorded for ${month} yet, so there is nothing to clear`
      }
    >
      {busy ? 'Working…' : '✕ Clear all'}
    </button>
  );

  // Only a reviewer/admin sees this - see canMoveMonth server-side. The
  // employee whose own mix-up this fixes is deliberately not offered it.
  const moveMonthButton = emp.canMoveMonth && (
    <button
      className="btn-secondary w-full sm:w-auto"
      onClick={() => setMoveTo(month)}
      disabled={busy || !hasRecorded}
      title={
        hasRecorded
          ? `Move ${emp.profile.fullName}'s ${month} results to a different month`
          : `Nothing is recorded for ${month} yet, so there is nothing to move`
      }
    >
      ↷ Move month
    </button>
  );

  /**
   * Takes the employee off the screen entirely - meant for rows left behind by
   * testing. The server refuses to delete anyone who has results recorded and
   * hides them instead, so this cannot quietly destroy real history.
   */
  async function removeEmployee() {
    const ok = confirm(
      `Remove ${emp.profile.fullName} (${emp.profile.employeeId}) from the system?\n\n` +
        `If nothing has ever been recorded for them, the record and its ${total} KPI assignment${total === 1 ? '' : 's'} are deleted permanently.\n` +
        `If they do have results, those are kept and the employee is only hidden from the screens.`
    );
    if (!ok) return;

    setBusy(true);
    try {
      const res = await api(`/api/employees/${emp.profile.id}`, { method: 'DELETE', body: {} });
      setMsg({
        kind: 'ok',
        text:
          res.mode === 'deleted'
            ? `${res.employeeName} deleted.`
            : `${res.employeeName} hidden. ${res.reason}`,
      });
      onSaved();
    } catch (err: any) {
      setMsg({ kind: 'err', text: err.message });
    } finally {
      setBusy(false);
    }
  }

  const removeButton = isAdmin && (
    <button
      className="btn-secondary w-full sm:w-auto !text-red-600 !border-red-200 hover:!bg-red-50"
      onClick={removeEmployee}
      disabled={busy}
      title={`Remove ${emp.profile.fullName} from the system - deleted outright only if nothing was ever recorded for them`}
    >
      {busy ? 'Working…' : '🗑 Remove employee'}
    </button>
  );

  const approveButton = emp.canApproveAs && (
    <button className="btn-primary w-full sm:w-auto" onClick={approve} disabled={busy}>
      {busy ? 'Working…' : '✓ ' + (LEVEL_LABEL[emp.canApproveAs] ?? 'Approve')}
    </button>
  );

  return (
    <div
      id={`emp-${emp.profile.id}`}
      className={`card overflow-hidden scroll-mt-4 ${
        highlighted ? 'ring-2 ring-brand-500 ring-offset-1' : ''
      }`}
    >
      {/* Header — click to expand this employee's KPIs */}
      <div className={`bg-slate-50 ${open ? 'border-b border-slate-200' : ''}`}>
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={open}
          className="w-full text-left px-3 py-2.5 hover:bg-slate-100 transition-colors"
        >
          <div className="flex items-center gap-2">
            <span className={`text-slate-400 text-xs shrink-0 transition-transform ${open ? 'rotate-90' : ''}`}>▶</span>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <span className="font-semibold text-slate-800 text-sm">{emp.profile.fullName}</span>
                <span className={`badge ${progressBadge.cls}`}>{progressBadge.text}</span>
                {emp.approval && (
                  <span className={`badge ${STAGE_BADGE[emp.approval.stage] ?? 'bg-slate-100 text-slate-600'}`}>
                    {emp.approval.stageLabel}
                  </span>
                )}
                {emp.complete && emp.finalScore !== null && (
                  <span className="badge bg-brand-100 text-brand-700 font-bold">Final {fmt(emp.finalScore)}%</span>
                )}
                {!emp.scoresVisible && submittedCount > 0 && (
                  <span className="badge bg-slate-100 text-slate-500" title="Your scores appear once compliance has approved this month.">
                    Score hidden until approved
                  </span>
                )}
                {belowCount > 0 && (
                  <span className="badge bg-red-100 text-red-700">{belowCount} below</span>
                )}
                {!emp.weightsValid && (
                  <span
                    className="badge bg-amber-100 text-amber-700"
                    title={`This employee's ${new Date(month + '-01').getFullYear()} KPI weights add up to ${emp.totalWeight}% instead of 100%, so the yearly score cannot reach 100%. Fix the weights under Admin → Assignments.`}
                  >
                    ⚠ Weights {emp.totalWeight}%
                  </span>
                )}
              </div>
              <div className="text-[11px] text-slate-400 mt-0.5 truncate">
                {emp.profile.employeeId} · {emp.profile.position ?? '—'} · {emp.profile.departmentName ?? 'No dept'} · {total} KPI{total === 1 ? '' : 's'}
              </div>
            </div>
          </div>
        </button>

        {open && (
          <div className="px-3 pb-2.5 -mt-1">
            <div className="hidden sm:flex items-center gap-2">
              {submitButton}
              {approveButton}
              {clearAllButton}
              {moveMonthButton}
              {removeButton}
            </div>
            {emp.approval && (
              <div className="text-[11px] text-slate-400 mt-1.5">
                Submitted {new Date(emp.approval.submittedAt).toLocaleDateString()}
                {emp.approval.lineManagerAt && ` · line manager ${new Date(emp.approval.lineManagerAt).toLocaleDateString()}`}
                {emp.approval.departmentManagerAt && ` · dept manager ${new Date(emp.approval.departmentManagerAt).toLocaleDateString()}`}
                {emp.approval.complianceAt && ` · compliance ${new Date(emp.approval.complianceAt).toLocaleDateString()}`}
              </div>
            )}
            {msg && (
              <div className={`text-xs mt-1.5 ${msg.kind === 'ok' ? 'text-emerald-600' : 'text-red-600'}`}>{msg.text}</div>
            )}
          </div>
        )}
      </div>

      {!open ? null : (
      <>
      {/* Mobile: one card per KPI */}
      <div className="lg:hidden divide-y divide-slate-100">
        {emp.rows.map((row: any) => {
          const vm = viewModel(row);
          return (
            <div key={row.assignmentId} className="p-3">
              <div className="flex items-start gap-2">
                <div className="min-w-0 flex-1">
                  <div className="font-mono text-[11px] text-slate-400">{row.kpi.code}</div>
                  <div className="text-[13px] font-medium text-slate-800 leading-snug">{row.kpi.name}</div>
                </div>
                <button className="text-slate-400 p-1 -mr-1 shrink-0" onClick={() => toggle(row.assignmentId)} aria-label="Details">
                  {vm.isOpen ? '▾' : '▸'}
                </button>
              </div>

              <div className="grid grid-cols-4 gap-1 mt-2 text-center">
                {[
                  ['Target', fmt(row.target)],
                  ['Thresh.', fmt(row.threshold)],
                  ['Weight', `${fmt(row.weight)}%`],
                  ['Dir.', row.kpi.varianceIndicator === 'U' ? '↑ U' : '↓ D'],
                ].map(([label, value]) => (
                  <div key={label} className="bg-slate-50 rounded-md py-1">
                    <div className="text-[9.5px] uppercase tracking-wide text-slate-400">{label}</div>
                    <div className="text-[12px] font-semibold text-slate-700">{value}</div>
                  </div>
                ))}
              </div>

              <div className="mt-2.5 flex items-center gap-2">
                {emp.canSubmit ? (
                  <input
                    type="number"
                    inputMode="decimal"
                    step="any"
                    className="input flex-1 !py-2"
                    placeholder="Actual result"
                    value={vm.entry.actual}
                    onChange={(e) => setActual(row.assignmentId, e.target.value)}
                  />
                ) : (
                  <div className="flex-1 text-sm">
                    Actual: <b>{vm.saved ? fmt(row.submission.actualResult) : '—'}</b>
                  </div>
                )}
                {vm.score !== null && vm.score !== undefined && (
                  <div className="text-right shrink-0">
                    <div className="text-[9.5px] uppercase tracking-wide text-slate-400">Score</div>
                    <div className="text-[15px] font-bold text-slate-800">{fmt(vm.score)}%</div>
                  </div>
                )}
              </div>

              <div className="mt-2 flex flex-wrap items-center gap-1.5">
                <AttachButton
                  canEdit={emp.canSubmit}
                  attachments={vm.atts}
                  onUpload={(files) => uploadFiles(row.assignmentId, files)}
                  uploading={!!uploading[row.assignmentId]}
                />
                <ClearButton
                  show={emp.canSubmit}
                  hasResult={!!row.submission}
                  busy={!!clearing[row.assignmentId]}
                  onClear={() => clearRow(row)}
                />
                <span className={`badge ${SUB_BADGE[vm.subStatus] ?? 'bg-slate-100 text-slate-500'}`}>
                  {vm.subStatus.replace(/_/g, ' ')}
                </span>
                {row.submission?.stage && (
                  <span className={`badge ${STAGE_BADGE[row.submission.stage] ?? 'bg-slate-100 text-slate-600'}`}>
                    {row.submission.stageLabel}
                  </span>
                )}
                {vm.perf && <span className={`badge ${PERF_BADGE[vm.perf]}`}>{PERF_LABEL[vm.perf]}</span>}
              </div>

              <div className="mt-2 flex flex-wrap items-center gap-1.5">
                <RowActions
                  row={row}
                  busy={!!rowBusy[row.assignmentId]}
                  onEdit={() => openRowEdit(row)}
                  onApprove={() => approveRow(row)}
                  onRevert={() => revertRow(row)}
                />
              </div>

              {vm.isOpen && (
                <RowDetails
                  row={row}
                  vm={vm}
                  canEdit={emp.canSubmit}
                  onComment={(v) => setComment(row.assignmentId, v)}
                  onRemove={(attId) => removeAttachment(row.assignmentId, attId)}
                />
              )}
            </div>
          );
        })}
      </div>

      {/* Desktop: compact table */}
      <div className="hidden lg:block table-scroll">
        <table className="w-full min-w-[1000px]">
          <thead className="bg-slate-50/60">
            <tr>
              <th className="table-th w-6"></th>
              <th className="table-th">Code</th>
              <th className="table-th">KPI</th>
              <th className="table-th">Target</th>
              <th className="table-th">Thresh.</th>
              <th className="table-th">Wt%</th>
              <th className="table-th">Var</th>
              <th className="table-th">Actual</th>
              <th className="table-th">Evidence</th>
              <th className="table-th">Score</th>
              <th className="table-th">Status</th>
              <th className="table-th">Actions</th>
            </tr>
          </thead>
          <tbody>
            {emp.rows.map((row: any) => {
              const vm = viewModel(row);
              return (
                <RowGroup key={row.assignmentId}>
                  <tr className="border-t border-slate-100 hover:bg-slate-50/50">
                    <td className="table-td">
                      <button className="text-slate-400 hover:text-slate-600" onClick={() => toggle(row.assignmentId)} title="Details">
                        {vm.isOpen ? '▾' : '▸'}
                      </button>
                    </td>
                    <td className="table-td font-mono text-xs whitespace-nowrap">{row.kpi.code}</td>
                    <td className="table-td max-w-[280px]">
                      <div className="truncate" title={row.kpi.name}>{row.kpi.name}</div>
                    </td>
                    <td className="table-td">{fmt(row.target)}</td>
                    <td className="table-td">{fmt(row.threshold)}</td>
                    <td className="table-td">{fmt(row.weight)}</td>
                    <td className="table-td">
                      <span title={row.kpi.varianceIndicator === 'U' ? 'Higher is better' : 'Lower is better'}>
                        {row.kpi.varianceIndicator === 'U' ? '↑ U' : '↓ D'}
                      </span>
                    </td>
                    <td className="table-td">
                      {emp.canSubmit ? (
                        <input
                          type="number"
                          step="any"
                          className="input w-24 !py-1"
                          value={vm.entry.actual}
                          onChange={(e) => setActual(row.assignmentId, e.target.value)}
                        />
                      ) : (
                        <span>{vm.saved ? fmt(row.submission.actualResult) : '—'}</span>
                      )}
                    </td>
                    <td className="table-td whitespace-nowrap">
                      <AttachButton
                        canEdit={emp.canSubmit}
                        attachments={vm.atts}
                        onUpload={(files) => uploadFiles(row.assignmentId, files)}
                        uploading={!!uploading[row.assignmentId]}
                      />
                      <ClearButton
                        show={emp.canSubmit}
                  hasResult={!!row.submission}
                        busy={!!clearing[row.assignmentId]}
                        onClear={() => clearRow(row)}
                      />
                    </td>
                    <td className="table-td font-semibold">
                      {vm.score !== null && vm.score !== undefined ? `${fmt(vm.score)}%` : '—'}
                    </td>
                    <td className="table-td">
                      <div className="flex flex-col gap-0.5">
                        <span className={`badge ${SUB_BADGE[vm.subStatus] ?? 'bg-slate-100 text-slate-500'}`}>
                          {vm.subStatus.replace(/_/g, ' ')}
                        </span>
                        {/* Where this KPI has reached on its own, which may differ
                            from every other row on the card. */}
                        {row.submission?.stage && (
                          <span className={`badge ${STAGE_BADGE[row.submission.stage] ?? 'bg-slate-100 text-slate-600'}`}>
                            {row.submission.stageLabel}
                          </span>
                        )}
                        {vm.perf && <span className={`badge ${PERF_BADGE[vm.perf]}`}>{PERF_SHORT[vm.perf]}</span>}
                      </div>
                    </td>
                    <td className="table-td whitespace-nowrap">
                      <RowActions
                        row={row}
                        busy={!!rowBusy[row.assignmentId]}
                        onEdit={() => openRowEdit(row)}
                        onApprove={() => approveRow(row)}
                        onRevert={() => revertRow(row)}
                      />
                    </td>
                  </tr>
                  {vm.isOpen && (
                    <tr className="bg-slate-50/70 border-t border-slate-100">
                      <td></td>
                      <td colSpan={11} className="px-3 py-3">
                        <RowDetails
                          row={row}
                          vm={vm}
                          canEdit={emp.canSubmit}
                          onComment={(v) => setComment(row.assignmentId, v)}
                          onRemove={(attId) => removeAttachment(row.assignmentId, attId)}
                        />
                      </td>
                    </tr>
                  )}
                </RowGroup>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Mobile action bar */}
      {(emp.canSubmit || emp.canApproveAs || isAdmin) && (
        <div className="sm:hidden p-3 border-t border-slate-200 bg-slate-50 space-y-2">
          {submitButton}
          {approveButton}
          {clearAllButton}
          {moveMonthButton}
          {removeButton}
        </div>
      )}
      </>
      )}

      {/* Per-KPI edit — this row only, whatever the rest of the card is doing */}
      {editRow && (
        <div
          className="fixed inset-0 bg-black/40 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4"
          onClick={() => !rowBusy[editRow.assignmentId] && setEditRow(null)}
        >
          <div
            className="card w-full sm:max-w-md p-5 space-y-3 rounded-b-none sm:rounded-lg"
            onClick={(e) => e.stopPropagation()}
          >
            <div>
              <h3 className="font-bold text-slate-800">Edit {editRow.code}</h3>
              <p className="text-[12px] text-slate-500 mt-0.5">{editRow.name}</p>
            </div>

            <div className="rounded-md bg-slate-50 border border-slate-200 px-3 py-2 text-[12px] text-slate-600 flex flex-wrap gap-x-4 gap-y-1">
              <span>Target <b>{fmt(editRow.target)}</b></span>
              <span>Threshold <b>{fmt(editRow.threshold)}</b></span>
              <span>Stage <b>{editRow.stageLabel}</b></span>
            </div>

            <div>
              <label className="label">Actual result</label>
              <input
                type="number"
                step="any"
                className="input w-full"
                value={editRow.actual}
                onChange={(e) => setEditRow({ ...editRow, actual: e.target.value })}
                autoFocus
              />
            </div>
            <div>
              <label className="label">Comment</label>
              <textarea
                className="input w-full"
                rows={2}
                value={editRow.comment}
                onChange={(e) => setEditRow({ ...editRow, comment: e.target.value })}
              />
            </div>

            {editRow.canKeepApproval ? (
              <label className="flex items-start gap-2 text-[12.5px] text-slate-700">
                <input
                  type="checkbox"
                  className="mt-0.5"
                  checked={editRow.resetApproval}
                  onChange={(e) => setEditRow({ ...editRow, resetApproval: e.target.checked })}
                />
                <span>
                  Send back for re-approval
                  <span className="block text-[11px] text-slate-400">
                    Leave unticked to correct the number without disturbing the sign-offs it
                    already has.
                  </span>
                </span>
              </label>
            ) : (
              <p className="text-[11.5px] text-slate-500">
                Changing the number returns this KPI to the start of the approval chain — fresh
                numbers need fresh sign-offs.
              </p>
            )}

            <p className="text-[11px] text-slate-400">
              Only {editRow.code} is affected. The previous value is kept in the audit log.
            </p>

            <div className="flex gap-2 justify-end pt-1">
              <button
                type="button"
                className="btn-secondary"
                disabled={!!rowBusy[editRow.assignmentId]}
                onClick={() => setEditRow(null)}
              >
                Cancel
              </button>
              <button
                className="btn-primary"
                disabled={!!rowBusy[editRow.assignmentId]}
                onClick={saveRowEdit}
              >
                {rowBusy[editRow.assignmentId] ? 'Saving…' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      )}

      {moveTo !== null && (
        <div
          className="fixed inset-0 bg-black/40 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4"
          onClick={() => !busy && setMoveTo(null)}
        >
          <div className="card w-full sm:max-w-sm p-5 space-y-3 rounded-b-none sm:rounded-lg" onClick={(e) => e.stopPropagation()}>
            <h3 className="font-bold text-slate-800">Move {emp.profile.fullName}&apos;s results</h3>
            <p className="text-[12.5px] text-slate-500">
              Moves every KPI recorded for <b>{month}</b> onto a different month. The values, comments and
              attachments stay the same — only the month changes.
            </p>
            <div>
              <label className="label">Move to</label>
              <input
                type="month"
                className="input w-full"
                value={moveTo}
                onChange={(e) => setMoveTo(e.target.value)}
              />
            </div>
            <div className="flex gap-2 justify-end pt-1">
              <button type="button" className="btn-secondary" disabled={busy} onClick={() => setMoveTo(null)}>Cancel</button>
              <button className="btn-primary" disabled={busy || !moveTo || moveTo === month} onClick={moveMonth}>
                {busy ? 'Moving…' : 'Move'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function RowDetails({
  row,
  vm,
  canEdit,
  onComment,
  onRemove,
}: {
  row: any;
  vm: any;
  canEdit: boolean;
  onComment: (v: string) => void;
  onRemove: (attId: string) => void;
}) {
  return (
    <div className="grid md:grid-cols-2 gap-3 md:gap-4 text-xs text-slate-600 mt-3 md:mt-0">
      <div className="space-y-1.5">
        <div><span className="font-semibold">Description:</span> {row.kpi.description || '—'}</div>
        <div><span className="font-semibold">Calculation:</span> {row.kpi.calculationMethod || '—'}</div>
        <div><span className="font-semibold">Matrix:</span> {row.kpi.matrix || '—'}</div>
        <div><span className="font-semibold">Frequency:</span> {row.frequency}</div>
        <div><span className="font-semibold">Form of submission:</span> {row.formOfSubmission || '—'}</div>
        {row.kpi.scoreCap > 100 && (
          <div><span className="font-semibold">Score cap:</span> {row.kpi.scoreCap}%</div>
        )}
        {row.submission && (
          <>
            <div>
              <span className="font-semibold">Submitted by:</span> {row.submission.submittedByName ?? '—'}
              {row.submission.submittedOnBehalf ? ' (on behalf)' : ''}
            </div>
            <div>
              <span className="font-semibold">Submitted at:</span>{' '}
              {new Date(row.submission.submittedAt).toLocaleString()} · v{row.submission.version}
            </div>
            {vm.saved && (
              <div><span className="font-semibold">Weighted score:</span> {fmt(row.submission.weightedScore, 3)}</div>
            )}
          </>
        )}
      </div>
      <div className="space-y-1.5">
        <div className="font-semibold">Attachments ({vm.atts.length})</div>
        {vm.atts.length === 0 && <div className="text-slate-400">No files attached yet — required before submit.</div>}
        {vm.atts.map((a: any) => (
          <div key={a.id} className="flex items-center gap-2">
            <a
              className="text-brand-600 hover:underline truncate flex-1 min-w-0"
              href={`/api/attachments/${a.id}?mode=view`}
              target="_blank"
              rel="noopener noreferrer"
            >
              📎 {a.originalFileName}
            </a>
            <span className="text-slate-400 shrink-0">{(a.fileSize / 1024).toFixed(0)} KB</span>
            <a className="text-brand-600 hover:underline shrink-0" href={`/api/attachments/${a.id}`}>
              download
            </a>
            {canEdit && (
              <button className="text-red-500 hover:underline shrink-0" onClick={() => onRemove(a.id)}>
                remove
              </button>
            )}
          </div>
        ))}
        <div className="font-semibold pt-1">Comment</div>
        {canEdit ? (
          <textarea
            className="input w-full !text-xs"
            rows={2}
            value={vm.entry.comment}
            onChange={(e) => onComment(e.target.value)}
          />
        ) : (
          <div>{row.submission?.comment || '—'}</div>
        )}
      </div>
    </div>
  );
}

function RowGroup({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}

const MAX_FILES_PER_KPI = 5;

/**
 * Per-KPI review actions. Each one acts on this row alone - approving,
 * correcting or sending back one KPI never touches the others the employee
 * holds. What appears is decided server-side per row (see canApproveAs /
 * canRevert / canEdit in the submissions API).
 */
function RowActions({
  row,
  busy,
  onEdit,
  onApprove,
  onRevert,
}: {
  row: any;
  busy: boolean;
  onEdit: () => void;
  onApprove: () => void;
  onRevert: () => void;
}) {
  const sub = row.submission;
  if (!sub) return null;
  const showEdit = sub.canEdit;
  const showApprove = !!sub.canApproveAs;
  const showRevert = sub.canRevert;
  if (!showEdit && !showApprove && !showRevert) return null;

  return (
    <span className="inline-flex items-center gap-1">
      {showEdit && (
        <button
          className="btn-secondary btn-xs"
          onClick={onEdit}
          disabled={busy}
          title={`Edit ${row.kpi.code} on its own`}
        >
          ✎ Edit
        </button>
      )}
      {showApprove && (
        <button
          className="btn-primary btn-xs"
          onClick={onApprove}
          disabled={busy}
          title={`${LEVEL_LABEL[sub.canApproveAs] ?? 'Approve'} — this KPI only`}
        >
          {busy ? '…' : '✓ Approve'}
        </button>
      )}
      {showRevert && (
        <button
          className="btn-secondary btn-xs !text-amber-700 !border-amber-200 hover:!bg-amber-50"
          onClick={onRevert}
          disabled={busy}
          title={`Send ${row.kpi.code} back one stage (administrator)`}
        >
          ↩ Back
        </button>
      )}
    </span>
  );
}

/**
 * Sits beside the evidence badge and throws away one KPI's recorded result.
 * Hidden when the row holds nothing, so it never reads as a way to delete the
 * KPI itself.
 */
function ClearButton({
  show,
  hasResult,
  busy,
  onClear,
}: {
  show: boolean;
  hasResult: boolean;
  busy: boolean;
  onClear: () => void;
}) {
  if (!show) return null;
  return (
    <button
      className="btn-secondary btn-xs !text-red-600 !border-red-200 hover:!bg-red-50 ml-1"
      onClick={onClear}
      disabled={busy || !hasResult}
      title={
        hasResult
          ? 'Delete this result and its attachments, back to Not started'
          : 'Nothing is recorded for this KPI yet, so there is nothing to clear'
      }
    >
      {busy ? 'Clearing…' : '✕ Clear'}
    </button>
  );
}

function AttachButton({
  canEdit,
  attachments,
  onUpload,
  uploading = false,
}: {
  canEdit: boolean;
  attachments: any[];
  onUpload: (files: File[]) => void;
  uploading?: boolean;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const n = attachments.length;
  const remaining = MAX_FILES_PER_KPI - n;
  const label = n === 0 ? 'Required' : `${n} attached`;
  return (
    <span className="inline-flex items-center gap-1">
      {canEdit && (
        <>
          <button
            className="btn-secondary btn-xs"
            onClick={() => inputRef.current?.click()}
            disabled={uploading || remaining <= 0}
            title={
              remaining <= 0
                ? `Maximum ${MAX_FILES_PER_KPI} files per KPI`
                : `Attach evidence — you can pick up to ${remaining} at once`
            }
          >
            {uploading ? 'Uploading…' : '📎 Attach'}
          </button>
          <input
            ref={inputRef}
            type="file"
            multiple
            className="hidden"
            accept=".pdf,.xls,.xlsx,.xlsm,.csv,.doc,.docx,.png,.jpg,.jpeg,.gif,.webp,.txt"
            onChange={(e) => {
              const files = Array.from(e.target.files ?? []);
              if (files.length) onUpload(files);
              e.target.value = '';
            }}
          />
        </>
      )}
      <span className={`badge ${n === 0 ? 'bg-red-100 text-red-600' : 'bg-emerald-100 text-emerald-700'}`}>{label}</span>
    </span>
  );
}
