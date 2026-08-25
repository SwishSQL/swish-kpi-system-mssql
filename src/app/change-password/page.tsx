'use client';

import { useEffect, useMemo, useState } from 'react';
import { api } from '@/lib/clientApi';

function strengthOf(pw: string): { score: number; label: string; color: string } {
  let score = 0;
  if (pw.length >= 8) score++;
  if (pw.length >= 12) score++;
  if (/[a-z]/.test(pw) && /[A-Z]/.test(pw)) score++;
  if (/[0-9]/.test(pw)) score++;
  if (/[^a-zA-Z0-9]/.test(pw)) score++;
  if (score <= 1) return { score, label: 'Weak', color: '#dc2626' };
  if (score === 2) return { score, label: 'Fair', color: '#d97706' };
  if (score === 3) return { score, label: 'Good', color: '#0e7490' };
  return { score, label: 'Strong', color: '#059669' };
}

export default function ChangePasswordPage() {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [show, setShow] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [forced, setForced] = useState(false);

  useEffect(() => {
    api('/api/auth/me')
      .then((res) => setForced(res.user.mustChangePassword))
      .catch(() => {});
  }, []);

  const strength = useMemo(() => strengthOf(next), [next]);
  const mismatch = confirm.length > 0 && next !== confirm;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    if (next !== confirm) {
      setError('New password and confirmation do not match.');
      return;
    }
    setBusy(true);
    try {
      await api('/api/auth/change-password', {
        body: { currentPassword: current, newPassword: next },
      });
      window.location.href = '/';
    } catch (err: any) {
      setError(err.message);
      setBusy(false);
    }
  }

  const inputCls =
    'w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-[15px] text-slate-900 placeholder:text-slate-400 shadow-sm transition focus:outline-none focus:border-brand-500 focus:ring-4 focus:ring-brand-500/15';

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-950 via-[#062a38] to-brand-700 px-4 py-10 relative overflow-hidden">
      <div
        className="absolute inset-0 opacity-[0.07]"
        style={{
          backgroundImage:
            'linear-gradient(rgba(255,255,255,.6) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,.6) 1px, transparent 1px)',
          backgroundSize: '44px 44px',
        }}
      />
      <div className="absolute -top-32 -right-32 w-96 h-96 rounded-full bg-cyan-400/20 blur-3xl" />
      <div className="absolute -bottom-40 -left-24 w-[28rem] h-[28rem] rounded-full bg-brand-500/25 blur-3xl" />

      <div className="relative w-full max-w-[440px]">
        <div className="flex items-center justify-center gap-2.5 mb-6">
          <div className="w-10 h-10 rounded-xl bg-white/10 ring-1 ring-white/20 backdrop-blur flex items-center justify-center">
            <svg viewBox="0 0 24 24" className="w-5 h-5 text-cyan-300" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
              <path d="M4 19 L4 12 M10 19 L10 7 M16 19 L16 10 M22 19 L22 4" />
            </svg>
          </div>
          <div>
            <div className="text-xl font-black text-white leading-none">SWiSH</div>
            <div className="text-[10px] uppercase tracking-[0.2em] text-cyan-300/80">KPI Management</div>
          </div>
        </div>

        <div className="bg-white rounded-2xl shadow-2xl p-8">
          <h1 className="text-[22px] font-bold text-slate-900 tracking-tight">Set a new password</h1>
          <p className="text-[13px] text-slate-500 mt-1.5 mb-6 leading-relaxed">
            {forced
              ? 'Your account is using the temporary password (your Employee ID). Choose a new secure password to continue.'
              : 'Choose a new secure password for your account.'}
          </p>

          <form onSubmit={submit} className="space-y-4">
            <div>
              <label className="block text-[13px] font-semibold text-slate-700 mb-1.5">
                Current password {forced && <span className="font-normal text-slate-400">(your Employee ID)</span>}
              </label>
              <input type={show ? 'text' : 'password'} className={inputCls} value={current} onChange={(e) => setCurrent(e.target.value)} required autoComplete="current-password" />
            </div>

            <div>
              <label className="block text-[13px] font-semibold text-slate-700 mb-1.5">New password</label>
              <input type={show ? 'text' : 'password'} className={inputCls} value={next} onChange={(e) => setNext(e.target.value)} required autoComplete="new-password" />
              {next && (
                <div className="mt-2 flex items-center gap-2">
                  <div className="flex-1 h-1.5 rounded-full bg-slate-100 overflow-hidden">
                    <div className="h-full rounded-full transition-all" style={{ width: `${(strength.score / 5) * 100}%`, backgroundColor: strength.color }} />
                  </div>
                  <span className="text-[11px] font-semibold" style={{ color: strength.color }}>{strength.label}</span>
                </div>
              )}
              <p className="text-[11px] text-slate-400 mt-1.5">
                At least 8 characters with letters and numbers. Cannot be your Employee ID.
              </p>
            </div>

            <div>
              <label className="block text-[13px] font-semibold text-slate-700 mb-1.5">Confirm new password</label>
              <input
                type={show ? 'text' : 'password'}
                className={`${inputCls} ${mismatch ? '!border-red-400 focus:!ring-red-500/15 focus:!border-red-400' : ''}`}
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                required
                autoComplete="new-password"
              />
              {mismatch && <p className="text-[11px] text-red-600 mt-1.5">Passwords do not match.</p>}
            </div>

            <label className="flex items-center gap-2 text-[12.5px] text-slate-500 select-none cursor-pointer">
              <input type="checkbox" checked={show} onChange={(e) => setShow(e.target.checked)} className="rounded border-slate-300" />
              Show passwords
            </label>

            {error && (
              <div className="flex items-start gap-2.5 rounded-xl bg-red-50 border border-red-200 text-red-700 text-[13px] px-3.5 py-3">
                <svg viewBox="0 0 24 24" className="w-[18px] h-[18px] shrink-0 mt-[1px]" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                  <circle cx="12" cy="12" r="9" />
                  <path d="M12 8v5M12 16.5v.5" />
                </svg>
                <span>{error}</span>
              </div>
            )}

            <button
              disabled={busy || mismatch}
              className="w-full rounded-xl bg-brand-600 hover:bg-brand-700 active:bg-brand-900 text-white font-semibold text-[15px] py-3 shadow-lg shadow-brand-600/25 transition disabled:opacity-60 disabled:cursor-not-allowed flex items-center justify-center gap-2"
            >
              {busy && (
                <svg className="animate-spin w-4 h-4" viewBox="0 0 24 24" fill="none">
                  <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" className="opacity-25" />
                  <path d="M22 12a10 10 0 0 0-10-10" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
                </svg>
              )}
              {busy ? 'Saving…' : 'Change Password'}
            </button>
          </form>
        </div>

        <p className="text-[11px] text-slate-400 text-center mt-6 relative">
          © {new Date().getFullYear()} SWiSH — Business Excellence
        </p>
      </div>
    </div>
  );
}
