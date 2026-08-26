'use client';

import { useCallback, useEffect, useState } from 'react';
import { api } from '@/lib/clientApi';

export default function AuditTab() {
  const [data, setData] = useState<any>(null);
  const [q, setQ] = useState('');
  const [action, setAction] = useState('');
  const [page, setPage] = useState(1);
  const [msg, setMsg] = useState('');
  const [openRow, setOpenRow] = useState<string | null>(null);

  const load = useCallback(() => {
    const params = new URLSearchParams({ page: String(page) });
    if (q) params.set('q', q);
    if (action) params.set('action', action);
    api(`/api/audit-logs?${params}`).then(setData).catch((e) => setMsg(e.message));
  }, [q, action, page]);

  useEffect(() => {
    const t = setTimeout(load, 250);
    return () => clearTimeout(t);
  }, [load]);

  const ACTIONS = [
    'LOGIN', 'LOGIN_FAILED', 'LOGOUT', 'PASSWORD_CHANGED', 'PASSWORD_RESET',
    'USER_CREATED', 'USER_UPDATED', 'USER_DEACTIVATED', 'USER_ACTIVATED',
    'HIERARCHY_MANAGER_CHANGED', 'HIERARCHY_DEPARTMENT_CHANGED',
    'DEPARTMENT_CREATED', 'DEPARTMENT_UPDATED',
    'KPI_CREATED', 'KPI_UPDATED', 'ASSIGNMENT_CREATED', 'ASSIGNMENT_UPDATED',
    'SUBMISSION_CREATED', 'SUBMISSION_UPDATED', 'SUBMISSION_APPROVED',
    'SUBMISSION_CLEARED', 'SUBMISSION_MONTH_CLEARED', 'SUBMISSION_MONTH_CORRECTED',
    'KPI_EDITED', 'KPI_APPROVED', 'KPI_REVERTED',
    'ASSIGNMENT_DELETED', 'KPI_DELETED',
    'EMPLOYEE_DELETED', 'EMPLOYEE_DEACTIVATED',
    'ATTACHMENT_UPLOADED', 'ATTACHMENT_REMOVED',
    'PERIOD_CREATED', 'PERIOD_OPEN', 'PERIOD_CLOSE', 'PERIOD_LOCK', 'PERIOD_REOPEN',
    'PERMISSIONS_ROLE_UPDATED', 'PERMISSIONS_OVERRIDE_UPDATED',
    'IMPORT_EXECUTED', 'REPORT_EXPORTED',
  ];

  return (
    <div className="space-y-3">
      {msg && <div className="text-sm px-3 py-2 rounded-md border bg-red-50 border-red-200 text-red-700">{msg}</div>}
      <div className="flex flex-wrap gap-2">
        <input className="input w-64" placeholder="Search user/entity…" value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} />
        <select className="input" value={action} onChange={(e) => { setAction(e.target.value); setPage(1); }}>
          <option value="">All actions</option>
          {ACTIONS.map((a) => <option key={a} value={a}>{a}</option>)}
        </select>
        <div className="flex-1" />
        {data && (
          <div className="flex items-center gap-2 text-sm text-slate-500">
            <button className="btn-secondary btn-xs" disabled={page <= 1} onClick={() => setPage(page - 1)}>←</button>
            Page {data.page} / {data.totalPages} ({data.totalCount})
            <button className="btn-secondary btn-xs" disabled={page >= data.totalPages} onClick={() => setPage(page + 1)}>→</button>
          </div>
        )}
      </div>

      <div className="card table-scroll">
        <table className="w-full min-w-[800px]">
          <thead className="bg-slate-50">
            <tr>
              <th className="table-th">Time</th>
              <th className="table-th">User</th>
              <th className="table-th">Action</th>
              <th className="table-th">Entity</th>
              <th className="table-th">IP</th>
              <th className="table-th"></th>
            </tr>
          </thead>
          <tbody>
            {data?.logs.map((l: any) => (
              <RowFragment key={l.id}>
                <tr className="border-t border-slate-100">
                  <td className="table-td text-xs whitespace-nowrap">{new Date(l.createdAt).toLocaleString()}</td>
                  <td className="table-td text-xs">{l.userName}</td>
                  <td className="table-td"><span className="badge bg-slate-100 text-slate-600 font-mono">{l.action}</span></td>
                  <td className="table-td text-xs">{l.entityType}{l.entityId ? ` · ${l.entityId.slice(0, 20)}` : ''}</td>
                  <td className="table-td text-xs">{l.ipAddress ?? '—'}</td>
                  <td className="table-td">
                    {(l.oldValues || l.newValues) && (
                      <button className="text-xs text-brand-600 hover:underline" onClick={() => setOpenRow(openRow === l.id ? null : l.id)}>
                        {openRow === l.id ? 'hide' : 'details'}
                      </button>
                    )}
                  </td>
                </tr>
                {openRow === l.id && (
                  <tr className="bg-slate-50">
                    <td colSpan={6} className="px-4 py-2">
                      <pre className="text-[10px] text-slate-600 whitespace-pre-wrap max-h-48 overflow-auto">
                        {JSON.stringify({ old: l.oldValues, new: l.newValues }, null, 2)}
                      </pre>
                    </td>
                  </tr>
                )}
              </RowFragment>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function RowFragment({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
