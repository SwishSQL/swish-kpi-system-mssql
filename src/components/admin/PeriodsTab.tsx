'use client';

import { useCallback, useEffect, useState } from 'react';
import { api } from '@/lib/clientApi';

export default function PeriodsTab() {
  const [periods, setPeriods] = useState<any[]>([]);
  const [msg, setMsg] = useState('');
  const [form, setForm] = useState({ month: new Date().getMonth() + 1, year: new Date().getFullYear(), deadlineAt: '' });

  const load = useCallback(() => {
    api('/api/periods').then((r) => setPeriods(r.periods)).catch((e) => setMsg(e.message));
  }, []);
  useEffect(load, [load]);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setMsg('');
    try {
      await api('/api/periods', {
        body: { month: Number(form.month), year: Number(form.year), deadlineAt: form.deadlineAt || null },
      });
      load();
    } catch (err: any) {
      setMsg(err.message);
    }
  }

  async function action(id: string, action: string) {
    setMsg('');
    try {
      await api(`/api/periods/${id}`, { method: 'PATCH', body: { action } });
      load();
    } catch (err: any) {
      setMsg(err.message);
    }
  }

  async function setDeadline(id: string) {
    const v = prompt('Deadline (YYYY-MM-DD, empty to clear):');
    if (v === null) return;
    try {
      await api(`/api/periods/${id}`, { method: 'PATCH', body: { action: 'update', deadlineAt: v ? `${v}T23:59:59` : null } });
      load();
    } catch (err: any) {
      setMsg(err.message);
    }
  }

  async function setGrace(id: string) {
    const v = prompt('Grace period end (YYYY-MM-DD, empty to clear):');
    if (v === null) return;
    try {
      await api(`/api/periods/${id}`, { method: 'PATCH', body: { action: 'update', gracePeriodEndsAt: v ? `${v}T23:59:59` : null } });
      load();
    } catch (err: any) {
      setMsg(err.message);
    }
  }

  const STATUS_BADGE: Record<string, string> = {
    OPEN: 'bg-emerald-100 text-emerald-700',
    CLOSED: 'bg-amber-100 text-amber-700',
    LOCKED: 'bg-slate-200 text-slate-600',
  };

  return (
    <div className="space-y-3">
      {msg && <div className="text-sm px-3 py-2 rounded-md border bg-red-50 border-red-200 text-red-700">{msg}</div>}
      <form onSubmit={create} className="card p-4 flex flex-wrap items-end gap-3">
        <div>
          <label className="label">Month</label>
          <select className="input" value={form.month} onChange={(e) => setForm({ ...form, month: Number(e.target.value) })}>
            {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => <option key={m} value={m}>{m}</option>)}
          </select>
        </div>
        <div><label className="label">Year</label><input className="input w-24" type="number" value={form.year} onChange={(e) => setForm({ ...form, year: Number(e.target.value) })} /></div>
        <div><label className="label">Deadline</label><input className="input" type="date" value={form.deadlineAt} onChange={(e) => setForm({ ...form, deadlineAt: e.target.value ? `${e.target.value}T23:59:59` : '' })} /></div>
        <button className="btn-primary">Open Month</button>
      </form>

      <div className="card table-scroll">
        <table className="w-full min-w-[750px]">
          <thead className="bg-slate-50">
            <tr>
              <th className="table-th">Period</th>
              <th className="table-th">Status</th>
              <th className="table-th">Deadline</th>
              <th className="table-th">Grace Until</th>
              <th className="table-th">Locked At</th>
              <th className="table-th">Actions</th>
            </tr>
          </thead>
          <tbody>
            {periods.map((p) => (
              <tr key={p.id} className="border-t border-slate-100">
                <td className="table-td font-semibold">{p.year}-{String(p.month).padStart(2, '0')}</td>
                <td className="table-td"><span className={`badge ${STATUS_BADGE[p.status]}`}>{p.status}</span></td>
                <td className="table-td text-xs">
                  {p.deadlineAt ? new Date(p.deadlineAt).toLocaleDateString() : '—'}
                  <button className="text-brand-600 hover:underline ml-1" onClick={() => setDeadline(p.id)}>edit</button>
                </td>
                <td className="table-td text-xs">
                  {p.gracePeriodEndsAt ? new Date(p.gracePeriodEndsAt).toLocaleDateString() : '—'}
                  <button className="text-brand-600 hover:underline ml-1" onClick={() => setGrace(p.id)}>edit</button>
                </td>
                <td className="table-td text-xs">{p.lockedAt ? new Date(p.lockedAt).toLocaleString() : '—'}</td>
                <td className="table-td whitespace-nowrap">
                  {p.status !== 'OPEN' && <button className="btn-primary btn-xs mr-1" onClick={() => action(p.id, p.status === 'LOCKED' ? 'reopen' : 'open')}>{p.status === 'LOCKED' ? 'Reopen' : 'Open'}</button>}
                  {p.status === 'OPEN' && <button className="btn-secondary btn-xs mr-1" onClick={() => action(p.id, 'close')}>Close</button>}
                  {p.status !== 'LOCKED' && <button className="btn-danger btn-xs" onClick={() => confirm(`Lock ${p.year}-${p.month}? All submissions become read-only.`) && action(p.id, 'lock')}>Lock</button>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
