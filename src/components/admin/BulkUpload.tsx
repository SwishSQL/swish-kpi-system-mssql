'use client';

import { useRef, useState } from 'react';
import { api } from '@/lib/clientApi';

/**
 * Template download plus one-step upload, for screens where entering rows one
 * at a time is the bottleneck. The full Import Wizard still handles workbooks
 * whose columns need mapping.
 */
export default function BulkUpload({
  type,
  label,
  onDone,
}: {
  type: 'employees' | 'kpi_library' | 'assignments';
  label: string;
  onDone: () => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [mode, setMode] = useState<'upsert' | 'insert' | 'update'>('upsert');
  const [result, setResult] = useState<any>(null);
  const [error, setError] = useState('');

  async function upload(file: File) {
    setBusy(true);
    setError('');
    setResult(null);
    try {
      const form = new FormData();
      form.append('file', file);
      form.append('type', type);
      form.append('mode', mode);
      const res = await api('/api/imports/quick', { form });
      setResult(res);
      onDone();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  function downloadErrors() {
    const csv = ['Row,Severity,Error', ...result.errors.map((e: any) =>
      `${e.row},${e.severity},"${String(e.error).replace(/"/g, '""')}"`)].join('\r\n');
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${type}-import-errors.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  return (
    <>
      <button className="btn-secondary" onClick={() => setOpen(true)}>
        ⬆ Bulk upload
      </button>

      {open && (
        <div
          className="fixed inset-0 bg-black/40 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4"
          onClick={() => !busy && setOpen(false)}
        >
          <div
            className="card w-full sm:max-w-xl p-5 rounded-b-none sm:rounded-lg max-h-[90vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-2 mb-1">
              <h3 className="font-bold text-slate-800">Bulk upload — {label}</h3>
              <button className="text-slate-400 hover:text-slate-600 p-1" onClick={() => setOpen(false)}>✕</button>
            </div>
            <p className="text-[12.5px] text-slate-500 mb-4">
              Download the template, fill it in, then upload it here. Keep the header row exactly
              as it is — that is how each column is recognised.
            </p>

            <div className="flex flex-wrap gap-2 mb-4">
              <a className="btn-secondary btn-xs" href={`/api/imports/template?type=${type}`}>
                ⬇ Empty template
              </a>
              <a className="btn-secondary btn-xs" href={`/api/imports/template?type=${type}&withData=1`}>
                ⬇ Current data (edit and re-upload)
              </a>
            </div>

            <label className="label">If a row already exists</label>
            <select className="input w-full mb-4" value={mode} onChange={(e) => setMode(e.target.value as any)}>
              <option value="upsert">Add new rows and update existing ones</option>
              <option value="insert">Add new rows only, skip anything that exists</option>
              <option value="update">Update existing rows only</option>
            </select>

            <input
              ref={fileRef}
              type="file"
              accept=".csv,.xlsx,.xls,.xlsm"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) upload(f);
                e.target.value = '';
              }}
            />
            <button className="btn-primary w-full" disabled={busy} onClick={() => fileRef.current?.click()}>
              {busy ? 'Importing…' : 'Choose a file to upload'}
            </button>

            {error && (
              <div className="mt-3 rounded-md bg-red-50 border border-red-200 text-red-700 text-[13px] px-3 py-2">
                {error}
              </div>
            )}

            {result && (
              <div className="mt-3 rounded-md border border-slate-200 p-3">
                <div className="flex flex-wrap items-center gap-2 text-[13px]">
                  <span className="text-emerald-600 font-semibold">{result.valid} imported</span>
                  {result.failed > 0 && <span className="text-red-600 font-semibold">{result.failed} failed</span>}
                  {result.errors?.some((e: any) => e.severity === 'warning') && (
                    <span className="text-amber-600">
                      {result.errors.filter((e: any) => e.severity === 'warning').length} warnings
                    </span>
                  )}
                  <span className="text-slate-400">of {result.total} rows</span>
                  {result.errors?.length > 0 && (
                    <button className="btn-secondary btn-xs ml-auto" onClick={downloadErrors}>
                      ⬇ Error report
                    </button>
                  )}
                </div>
                {result.summary && Object.keys(result.summary).length > 0 && (
                  <div className="text-[11.5px] text-slate-500 mt-1.5">
                    {Object.entries(result.summary).map(([k, v]) => `${k}: ${v}`).join(' · ')}
                  </div>
                )}
                {result.errors?.slice(0, 6).map((e: any, i: number) => (
                  <div key={i} className={`text-[11.5px] mt-1 ${e.severity === 'error' ? 'text-red-600' : 'text-amber-600'}`}>
                    Row {e.row}: {e.error}
                  </div>
                ))}
                {result.errors?.length > 6 && (
                  <div className="text-[11.5px] text-slate-400 mt-1">
                    … {result.errors.length - 6} more in the error report
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}
