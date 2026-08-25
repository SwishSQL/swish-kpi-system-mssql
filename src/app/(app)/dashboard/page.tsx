'use client';

import { useEffect, useState } from 'react';
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid,
  LineChart, Line, Cell,
} from 'recharts';
import { useApp } from '@/components/AppContext';
import { api, fmt } from '@/lib/clientApi';
import { useIsMobile } from '@/hooks/useMediaQuery';

const BUCKET_META: [string, string, string][] = [
  ['EXCELLENT', 'Excellent (90–100%)', '#059669'],
  ['GOOD', 'Good (80–89.99%)', '#0e7490'],
  ['NEEDS_IMPROVEMENT', 'Needs Improvement (60–79.99%)', '#d97706'],
  ['CRITICAL', 'Critical (<60%)', '#dc2626'],
  ['NOT_SUBMITTED', 'Not Submitted', '#94a3b8'],
];

function scoreColor(s: number | null): string {
  if (s === null) return '#94a3b8';
  if (s >= 90) return '#059669';
  if (s >= 80) return '#0e7490';
  if (s >= 60) return '#d97706';
  return '#dc2626';
}

function submitRateColor(pct: number): string {
  if (pct >= 60) return '#059669';
  if (pct >= 25) return '#d97706';
  if (pct > 0) return '#dc2626';
  return '#94a3b8';
}

export default function DashboardPage() {
  const { month, departmentId, refreshKey, can } = useApp();
  const isMobile = useIsMobile();
  const [data, setData] = useState<any>(null);
  const [error, setError] = useState('');
  const [selected, setSelected] = useState<any>(null);

  useEffect(() => {
    const params = new URLSearchParams({ month });
    if (departmentId) params.set('departmentId', departmentId);
    api(`/api/dashboard?${params}`)
      .then((res) => {
        setData(res);
        setError('');
      })
      .catch((e) => setError(e.message));
  }, [month, departmentId, refreshKey]);

  if (error) return <div className="rounded-md bg-red-50 border border-red-200 text-red-700 text-sm px-3 py-2">{error}</div>;
  if (!data) return <div className="text-sm text-slate-400 py-10 text-center">Loading dashboard…</div>;

  const c = data.cards;
  const nameCut = isMobile ? 12 : 21;
  const rankingData = data.ranking.map((r: any) => ({
    ...r,
    label: r.name.length > nameCut ? r.name.slice(0, nameCut) + '…' : r.name,
    plotScore: r.score ?? 0,
  }));

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-[15px] sm:text-lg font-bold text-slate-800">{data.month}</h2>
        {can('reports.export') && (
          <a className="btn-secondary btn-xs" href={`/api/reports/export?month=${data.month}`}>
            ⬇ Export CSV
          </a>
        )}
      </div>

      {/* Cards */}
      <div className="grid grid-cols-2 xl:grid-cols-4 gap-2.5 sm:gap-3">
        <Card title="Overall Score" value={c.overallScore !== null ? `${fmt(c.overallScore)}%` : '—'}
          sub={c.strictScore !== null ? `Strict: ${fmt(c.strictScore)}%` : 'Completed average'} />
        <Card title="KPIs Submitted" value={`${fmt(c.kpiSubmitRate)}%`} sub={`${c.kpisSubmittedTotal} / ${c.kpisDueTotal} KPI rows`} />
        <Card title="Employees Complete" value={`${c.submittedEmployees} / ${c.totalEmployees}`} sub={`${fmt(c.completionRate)}% · ${c.approvedEmployees} approved`} />
        <Card title="Below Threshold" value={String(c.belowThresholdEmployees)} sub="≥1 KPI below" danger={c.belowThresholdEmployees > 0} />
      </div>

      <div className="grid xl:grid-cols-2 gap-4">
        {/* Ranking */}
        <div className="card p-3 sm:p-4">
          <h3 className="text-sm font-bold text-slate-700 mb-2">Employee Scores</h3>
          {rankingData.length === 0 ? (
            <div className="text-sm text-slate-400 py-8 text-center">No data</div>
          ) : (
            <ResponsiveContainer width="100%" height={Math.max(200, rankingData.length * (isMobile ? 24 : 28))}>
              <BarChart data={rankingData} layout="vertical" margin={{ left: 0, right: isMobile ? 12 : 30 }}>
                <CartesianGrid strokeDasharray="3 3" horizontal={false} />
                <XAxis type="number" domain={[0, 100]} tick={{ fontSize: isMobile ? 9 : 11 }} />
                <YAxis type="category" dataKey="label" width={isMobile ? 78 : 130} tick={{ fontSize: isMobile ? 9 : 11 }} />
                <Tooltip
                  formatter={(v: any, _n: any, p: any) =>
                    p.payload.score === null ? ['Not submitted', ''] : [`${v}%`, 'Score']
                  }
                />
                <Bar dataKey="plotScore" radius={[0, 4, 4, 0]} onClick={(d: any) => setSelected(d)} cursor="pointer">
                  {rankingData.map((r: any, i: number) => (
                    <Cell key={i} fill={scoreColor(r.score)} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          )}
          <p className="text-[11px] text-slate-400 mt-1">Grey = not submitted. Tap a bar for details.</p>
        </div>

        <div className="space-y-4">
          {/* Distribution */}
          <div className="card p-3 sm:p-4">
            <h3 className="text-sm font-bold text-slate-700 mb-3">Score Distribution</h3>
            <div className="space-y-2">
              {BUCKET_META.map(([key, label, color]) => {
                const count = data.distribution[key] ?? 0;
                const total = Math.max(1, c.totalEmployees);
                return (
                  <div key={key} className="flex items-center gap-2 text-[11px] sm:text-xs">
                    <span className="w-28 sm:w-56 text-slate-600 truncate" title={label}>{label}</span>
                    <div className="flex-1 bg-slate-100 rounded h-3 sm:h-4 overflow-hidden">
                      <div className="h-full rounded" style={{ width: `${(count / total) * 100}%`, backgroundColor: color }} />
                    </div>
                    <span className="w-7 text-right font-semibold">{count}</span>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Trend */}
          <div className="card p-3 sm:p-4">
            <h3 className="text-sm font-bold text-slate-700 mb-2">Monthly Trend</h3>
            <ResponsiveContainer width="100%" height={isMobile ? 150 : 180}>
              <LineChart data={data.trend} margin={{ left: -18, right: 12 }}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="month" tick={{ fontSize: isMobile ? 9 : 11 }} />
                <YAxis domain={[0, 100]} tick={{ fontSize: isMobile ? 9 : 11 }} />
                <Tooltip formatter={(v: any) => [`${v}%`, 'Avg score']} />
                <Line type="monotone" dataKey="avgScore" stroke="#0e7490" strokeWidth={2} connectNulls dot={{ r: 3 }} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      {/* Department comparison */}
      {data.departmentComparison?.length > 0 && (
        <div className="card p-3 sm:p-4">
          <div className="flex items-baseline justify-between gap-2 mb-2">
            <h3 className="text-sm font-bold text-slate-700">Department Compliance</h3>
            <span className="text-[11px] text-slate-400">Sorted by KPI submit rate, lowest first</span>
          </div>

          {/* Mobile list */}
          <div className="md:hidden divide-y divide-slate-100">
            {data.departmentComparison.map((d: any) => (
              <div key={d.department} className="py-2">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[13px] font-medium text-slate-700 truncate">{d.department}</span>
                  <span className="text-[13px] font-bold shrink-0" style={{ color: submitRateColor(d.submitRate) }}>
                    {fmt(d.submitRate)}%
                  </span>
                </div>
                <div className="flex items-center gap-2 mt-1">
                  <div className="flex-1 bg-slate-100 rounded h-1.5 overflow-hidden">
                    <div className="h-full rounded" style={{ width: `${d.submitRate}%`, backgroundColor: submitRateColor(d.submitRate) }} />
                  </div>
                </div>
                <div className="text-[11px] text-slate-400 mt-1">
                  {d.kpisSubmitted}/{d.kpisDue} KPIs · {d.employees} employees ·{' '}
                  <span className="text-emerald-600 font-medium">{d.approvedEmployees} approved</span> ·{' '}
                  <span className={d.notStartedEmployees > 0 ? 'text-red-500 font-medium' : ''}>{d.notStartedEmployees} not started</span>
                </div>
              </div>
            ))}
          </div>

          {/* Desktop table */}
          <div className="hidden md:block table-scroll">
            <table className="w-full">
              <thead>
                <tr>
                  <th className="table-th">Department</th>
                  <th className="table-th">Employees</th>
                  <th className="table-th">KPI Submit Rate</th>
                  <th className="table-th">Approved</th>
                  <th className="table-th">Not Started</th>
                  <th className="table-th">Avg Score</th>
                </tr>
              </thead>
              <tbody>
                {data.departmentComparison.map((d: any) => (
                  <tr key={d.department} className="border-t border-slate-100">
                    <td className="table-td font-medium">{d.department}</td>
                    <td className="table-td">{d.employees}</td>
                    <td className="table-td">
                      <div className="flex items-center gap-2 min-w-[160px]">
                        <div className="flex-1 bg-slate-100 rounded h-2 overflow-hidden">
                          <div className="h-full rounded" style={{ width: `${d.submitRate}%`, backgroundColor: submitRateColor(d.submitRate) }} />
                        </div>
                        <span className="font-semibold text-xs w-24 text-slate-600" style={{ color: submitRateColor(d.submitRate) }}>
                          {fmt(d.submitRate)}% <span className="text-slate-400 font-normal">({d.kpisSubmitted}/{d.kpisDue})</span>
                        </span>
                      </div>
                    </td>
                    <td className="table-td">
                      <span className={`badge ${d.approvedEmployees > 0 ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-500'}`}>
                        {d.approvedEmployees}
                      </span>
                    </td>
                    <td className="table-td">
                      <span className={`badge ${d.notStartedEmployees > 0 ? 'bg-red-100 text-red-700' : 'bg-slate-100 text-slate-500'}`}>
                        {d.notStartedEmployees}
                      </span>
                    </td>
                    <td className="table-td font-semibold" style={{ color: scoreColor(d.avgScore) }}>
                      {d.avgScore !== null ? `${fmt(d.avgScore)}%` : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Not submitted */}
      {data.notSubmitted?.length > 0 && (
        <div className="card p-3 sm:p-4">
          <h3 className="text-sm font-bold text-slate-700 mb-2">Not Submitted ({data.notSubmitted.length})</h3>
          <div className="flex flex-wrap gap-1.5">
            {data.notSubmitted.map((e: any) => (
              <span key={e.employeeId} className="badge bg-slate-100 text-slate-600">
                {e.name} ({e.submitted}/{e.assigned})
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Drill-down */}
      {selected && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4" onClick={() => setSelected(null)}>
          <div
            className="card w-full sm:max-w-lg p-5 rounded-b-none sm:rounded-lg"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-3 gap-2">
              <h3 className="font-bold text-slate-800 truncate">{selected.name}</h3>
              <button className="text-slate-400 hover:text-slate-600 p-1 shrink-0" onClick={() => setSelected(null)}>✕</button>
            </div>
            <div className="text-sm space-y-1">
              <div>Score: <b>{selected.score !== null ? `${fmt(selected.score)}%` : 'Not submitted'}</b></div>
              <div>KPIs submitted: {selected.submitted} / {selected.assigned}</div>
              {selected.belowThresholdKpis?.length > 0 && (
                <div className="text-red-600">Below threshold: {selected.belowThresholdKpis.join(', ')}</div>
              )}
            </div>
            <div className="mt-4 text-right">
              <a className="btn-primary btn-xs" href="/">Open in Submissions</a>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Card({ title, value, sub, danger }: { title: string; value: string; sub?: string; danger?: boolean }) {
  return (
    <div className="card p-3 sm:p-4">
      <div className="text-[10px] sm:text-[11px] font-semibold uppercase tracking-wide text-slate-400 truncate">{title}</div>
      <div className={`text-xl sm:text-2xl font-black mt-1 ${danger ? 'text-red-600' : 'text-slate-800'}`}>{value}</div>
      {sub && <div className="text-[10px] sm:text-[11px] text-slate-400 mt-0.5 truncate">{sub}</div>}
    </div>
  );
}
