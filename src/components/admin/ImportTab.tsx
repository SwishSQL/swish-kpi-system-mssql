'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '@/lib/clientApi';

const TYPES = [
  ['skip', 'Skip this sheet'],
  ['departments', 'Departments'],
  ['employees', 'Employees / Team Structure'],
  ['kpi_library', 'KPI Library'],
  ['assignments', 'KPI Assignments'],
  ['submissions', 'KPI Submissions / Historical Results'],
] as const;

export default function ImportTab() {
  const fileRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [inspection, setInspection] = useState<any>(null);
  const [config, setConfig] = useState<any[]>([]);
  const [year, setYear] = useState(new Date().getFullYear());
  const [allowNoEmail, setAllowNoEmail] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [results, setResults] = useState<any[] | null>(null);
  const [jobs, setJobs] = useState<any[]>([]);
  const [previewSheet, setPreviewSheet] = useState<string | null>(null);

  const loadJobs = useCallback(() => {
    api('/api/imports').then((r) => setJobs(r.jobs)).catch(() => {});
  }, []);
  useEffect(loadJobs, [loadJobs]);

  async function inspect(f: File) {
    setBusy(true);
    setMsg('');
    setResults(null);
    setInspection(null);
    try {
      const form = new FormData();
      form.append('file', f);
      const res = await api('/api/imports/inspect', { form });
      setInspection(res);
      setConfig(
        res.sheets.map((s: any) => ({
          sheet: s.name,
          importType: s.guessedType === 'unknown' ? 'skip' : s.guessedType,
          mode: 'upsert',
          mapping: s.guessedMapping,
        }))
      );
    } catch (err: any) {
      setMsg(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function execute() {
    if (!file) return;
    if (!confirm('Run the import with the selected mappings? Valid rows are committed; failed rows are reported.')) return;
    setBusy(true);
    setMsg('');
    try {
      const form = new FormData();
      form.append('file', file);
      form.append(
        'config',
        JSON.stringify({
          year,
          allowProfileWithoutEmail: allowNoEmail,
          createMissingDepartments: true,
          createMissingKpis: true,
          sheets: config,
        })
      );
      const res = await api('/api/imports/execute', { form });
      setResults(res.results);
      loadJobs();
    } catch (err: any) {
      setMsg(err.message);
    } finally {
      setBusy(false);
    }
  }

  function downloadErrors(sheet: string, errors: any[]) {
    const csv = ['Row,Severity,Error', ...errors.map((e) => `${e.row},${e.severity},"${String(e.error).replace(/"/g, '""')}"`)].join('\r\n');
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `import-errors-${sheet}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  return (
    <div className="space-y-4">
      {/* Step 1: upload */}
      <div className="card p-4">
        <h3 className="text-sm font-bold text-slate-700 mb-2">Step 1 — Upload workbook</h3>
        <p className="text-xs text-slate-500 mb-3">
          Upload the Excel workbook (Employees / Team Structure, KPI Library, KPI Assignments, Submissions…).
          Sheets and columns are detected automatically; you confirm the mapping before anything is written.
        </p>
        <div className="flex flex-wrap items-center gap-3">
          <input
            ref={fileRef}
            type="file"
            accept=".xlsx,.xls,.xlsm,.csv"
            className="text-sm"
            onChange={(e) => {
              const f = e.target.files?.[0] ?? null;
              setFile(f);
              if (f) inspect(f);
            }}
          />
          <div className="flex items-center gap-1 text-xs text-slate-600">
            <span>Assignment year:</span>
            <input className="input w-20 !py-0.5" type="number" value={year} onChange={(e) => setYear(Number(e.target.value))} />
          </div>
          <label className="flex items-center gap-1.5 text-xs text-slate-600">
            <input type="checkbox" checked={allowNoEmail} onChange={(e) => setAllowNoEmail(e.target.checked)} />
            Allow employee profiles without email (no login account created)
          </label>
        </div>
        {busy && <div className="text-sm text-slate-400 mt-2">Working…</div>}
        {msg && <div className="text-sm px-3 py-2 mt-2 rounded-md border bg-red-50 border-red-200 text-red-700">{msg}</div>}
      </div>

      {/* Step 2: mapping */}
      {inspection && (
        <div className="card p-4">
          <h3 className="text-sm font-bold text-slate-700 mb-2">
            Step 2 — Review sheets & mappings ({inspection.fileName})
          </h3>
          <div className="space-y-4">
            {inspection.sheets.map((s: any, idx: number) => {
              const cfg = config[idx];
              const defs = cfg.importType !== 'skip' ? inspection.fieldDefs[cfg.importType] : [];
              return (
                <div key={s.name} className="border border-slate-200 rounded-md p-3">
                  <div className="flex flex-wrap items-center gap-2 mb-2">
                    <span className="font-semibold text-sm">{s.name}</span>
                    <span className="text-xs text-slate-400">{s.rowCount} rows</span>
                    <select
                      className="input !py-0.5 !text-xs"
                      value={cfg.importType}
                      onChange={(e) => {
                        const importType = e.target.value;
                        setConfig((prev) => {
                          const next = [...prev];
                          next[idx] = {
                            ...next[idx],
                            importType,
                            mapping: importType === 'skip' ? {} : guessClientMapping(inspection.fieldDefs[importType], s.headers),
                          };
                          return next;
                        });
                      }}
                    >
                      {TYPES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                    </select>
                    <select
                      className="input !py-0.5 !text-xs"
                      value={cfg.mode}
                      onChange={(e) => setConfig((prev) => { const n = [...prev]; n[idx] = { ...n[idx], mode: e.target.value }; return n; })}
                    >
                      <option value="upsert">Insert new + update existing</option>
                      <option value="insert">Insert new only (skip existing)</option>
                      <option value="update">Update existing only</option>
                    </select>
                    <button className="text-xs text-brand-600 hover:underline" onClick={() => setPreviewSheet(previewSheet === s.name ? null : s.name)}>
                      {previewSheet === s.name ? 'hide preview' : 'preview'}
                    </button>
                  </div>

                  {cfg.importType !== 'skip' && (
                    <div className="grid sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2">
                      {defs.map((d: any) => (
                        <div key={d.field}>
                          <label className="label !mb-0.5">
                            {d.label} {d.required && <span className="text-red-500">*</span>}
                          </label>
                          <select
                            className={`input w-full !py-0.5 !text-xs ${d.required && !cfg.mapping[d.field] ? '!border-red-400' : ''}`}
                            value={cfg.mapping[d.field] ?? ''}
                            onChange={(e) =>
                              setConfig((prev) => {
                                const n = [...prev];
                                n[idx] = { ...n[idx], mapping: { ...n[idx].mapping, [d.field]: e.target.value } };
                                if (!e.target.value) delete n[idx].mapping[d.field];
                                return n;
                              })
                            }
                          >
                            <option value="">— not mapped —</option>
                            {s.headers.map((h: string) => <option key={h} value={h}>{h}</option>)}
                          </select>
                        </div>
                      ))}
                    </div>
                  )}

                  {previewSheet === s.name && (
                    <div className="table-scroll mt-2 border-t border-slate-100 pt-2">
                      <table className="text-[11px]">
                        <thead>
                          <tr>{s.headers.map((h: string) => <th key={h} className="px-2 py-1 text-left font-semibold text-slate-500 whitespace-nowrap">{h}</th>)}</tr>
                        </thead>
                        <tbody>
                          {s.preview.map((row: any, i: number) => (
                            <tr key={i} className="border-t border-slate-50">
                              {s.headers.map((h: string) => <td key={h} className="px-2 py-1 whitespace-nowrap max-w-[200px] truncate">{row[h]}</td>)}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
          <div className="mt-3">
            <button className="btn-primary" disabled={busy || config.every((c) => c.importType === 'skip')} onClick={execute}>
              {busy ? 'Importing…' : 'Run Import'}
            </button>
          </div>
        </div>
      )}

      {/* Step 3: results */}
      {results && (
        <div className="card p-4">
          <h3 className="text-sm font-bold text-slate-700 mb-2">Step 3 — Import summary</h3>
          {results.map((r) => (
            <div key={r.jobId} className="border-t border-slate-100 py-2">
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <span className="font-semibold">{r.sheet}</span>
                <span className="badge bg-slate-100 text-slate-600">{r.importType}</span>
                <span className="text-emerald-600">{r.valid} imported</span>
                {r.failed > 0 && <span className="text-red-600">{r.failed} failed</span>}
                {r.errors.filter((e: any) => e.severity === 'warning').length > 0 && (
                  <span className="text-amber-600">{r.errors.filter((e: any) => e.severity === 'warning').length} warnings</span>
                )}
                <span className="text-xs text-slate-400">{JSON.stringify(r.summary)}</span>
                {r.errors.length > 0 && (
                  <button className="btn-secondary btn-xs" onClick={() => downloadErrors(r.sheet, r.errors)}>
                    ⬇ Error report
                  </button>
                )}
              </div>
              {r.errors.slice(0, 8).map((e: any, i: number) => (
                <div key={i} className={`text-xs ml-2 ${e.severity === 'error' ? 'text-red-600' : 'text-amber-600'}`}>
                  Row {e.row}: {e.error}
                </div>
              ))}
              {r.errors.length > 8 && <div className="text-xs text-slate-400 ml-2">… {r.errors.length - 8} more in the error report</div>}
            </div>
          ))}
        </div>
      )}

      {/* Job history */}
      <div className="card p-4">
        <h3 className="text-sm font-bold text-slate-700 mb-2">Import history</h3>
        {jobs.length === 0 && <div className="text-xs text-slate-400">No imports yet.</div>}
        <div className="table-scroll">
          <table className="w-full min-w-[700px]">
            <tbody>
              {jobs.map((j) => (
                <tr key={j.id} className="border-t border-slate-100 text-sm">
                  <td className="table-td text-xs whitespace-nowrap">{new Date(j.createdAt).toLocaleString()}</td>
                  <td className="table-td">{j.fileName} · <span className="text-slate-400">{j.sheet}</span></td>
                  <td className="table-td"><span className="badge bg-slate-100 text-slate-600">{j.importType}</span></td>
                  <td className="table-td">
                    <span className={`badge ${j.status === 'COMPLETED' ? 'bg-emerald-100 text-emerald-700' : j.status === 'FAILED' ? 'bg-red-100 text-red-700' : 'bg-slate-100 text-slate-500'}`}>{j.status}</span>
                  </td>
                  <td className="table-td text-xs">{j.validRows}/{j.totalRows} ok · {j.failedRows} failed</td>
                  <td className="table-td text-xs">{j.uploadedBy ?? '—'}</td>
                  <td className="table-td">
                    {Array.isArray(j.errorReport) && j.errorReport.length > 0 && (
                      <button className="btn-secondary btn-xs" onClick={() => downloadErrors(j.sheet, j.errorReport)}>⬇ errors</button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function guessClientMapping(defs: any[], headers: string[]): Record<string, string> {
  const mapping: Record<string, string> = {};
  const normalized = headers.map((h) => ({ raw: h, n: h.toLowerCase().replace(/\s+/g, ' ').trim() }));
  const used = new Set<string>();
  for (const def of defs) {
    let found: string | undefined;
    for (const syn of def.synonyms) {
      const exact = normalized.find((h) => h.n === syn && !used.has(h.raw));
      if (exact) { found = exact.raw; break; }
    }
    if (!found) {
      for (const syn of def.synonyms) {
        const partial = normalized.find((h) => h.n.includes(syn) && !used.has(h.raw));
        if (partial) { found = partial.raw; break; }
      }
    }
    if (found) { mapping[def.field] = found; used.add(found); }
  }
  return mapping;
}
