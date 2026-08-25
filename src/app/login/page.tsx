'use client';

import { useState } from 'react';
import { api } from '@/lib/clientApi';

export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      const res = await api<{ mustChangePassword: boolean }>('/api/auth/login', {
        body: { email, password },
      });
      window.location.href = res.mustChangePassword ? '/change-password' : '/';
    } catch (err: any) {
      setError(err.message);
      setBusy(false);
    }
  }

  return (
    <div className="min-h-screen flex bg-white">
      {/* Brand panel */}
      <div className="hidden lg:flex lg:w-[52%] relative overflow-hidden bg-gradient-to-br from-slate-950 via-[#062a38] to-brand-700 text-white flex-col justify-between p-12">
        {/* decorative grid */}
        <div
          className="absolute inset-0 opacity-[0.07]"
          style={{
            backgroundImage:
              'linear-gradient(rgba(255,255,255,.6) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,.6) 1px, transparent 1px)',
            backgroundSize: '44px 44px',
          }}
        />
        {/* glow accents */}
        <div className="absolute -top-32 -right-32 w-96 h-96 rounded-full bg-cyan-400/20 blur-3xl" />
        <div className="absolute -bottom-40 -left-24 w-[28rem] h-[28rem] rounded-full bg-brand-500/25 blur-3xl" />

        <div className="relative">
          <div className="flex items-center gap-3">
            <div className="w-11 h-11 rounded-xl bg-white/10 backdrop-blur flex items-center justify-center ring-1 ring-white/20">
              <svg viewBox="0 0 24 24" className="w-6 h-6" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
                <path d="M4 19 L4 12 M10 19 L10 7 M16 19 L16 10 M22 19 L22 4" className="text-cyan-300" />
              </svg>
            </div>
            <div>
              <div className="text-2xl font-black tracking-tight leading-none">SWiSH</div>
              <div className="text-[11px] uppercase tracking-[0.25em] text-cyan-300/80 mt-0.5">KPI Management</div>
            </div>
          </div>
        </div>

        <div className="relative max-w-md">
          <h1 className="text-4xl font-black leading-tight tracking-tight">
            Performance,
            <br />
            <span className="text-cyan-300">measured monthly.</span>
          </h1>
          <p className="mt-4 text-slate-300 text-sm leading-relaxed">
            Submit results, attach evidence, and track scores across every team and
            department — one system for the whole company.
          </p>

          <div className="mt-8 grid grid-cols-3 gap-3">
            {[
              ['Evidence-backed', 'Every KPI requires proof'],
              ['Live scoring', 'U/D scoring & thresholds'],
              ['Full visibility', 'Team & company dashboards'],
            ].map(([t, s]) => (
              <div key={t} className="rounded-xl bg-white/[0.06] ring-1 ring-white/10 backdrop-blur px-3.5 py-3">
                <div className="text-[13px] font-semibold text-white">{t}</div>
                <div className="text-[11px] text-slate-400 mt-1 leading-snug">{s}</div>
              </div>
            ))}
          </div>
        </div>

        <div className="relative text-[11px] text-slate-400">
          © {new Date().getFullYear()} SWiSH — Business Excellence
        </div>
      </div>

      {/* Form panel */}
      <div className="flex-1 flex items-center justify-center px-6 py-10 bg-slate-50 lg:bg-white">
        <div className="w-full max-w-[400px]">
          {/* compact brand for mobile */}
          <div className="lg:hidden flex items-center justify-center gap-2.5 mb-8">
            <div className="w-10 h-10 rounded-xl bg-brand-600 flex items-center justify-center">
              <svg viewBox="0 0 24 24" className="w-5 h-5 text-white" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
                <path d="M4 19 L4 12 M10 19 L10 7 M16 19 L16 10 M22 19 L22 4" />
              </svg>
            </div>
            <div>
              <div className="text-xl font-black text-slate-900 leading-none">SWiSH</div>
              <div className="text-[10px] uppercase tracking-[0.2em] text-brand-600">KPI Management</div>
            </div>
          </div>

          <h2 className="text-[26px] font-bold text-slate-900 tracking-tight">Welcome back</h2>
          <p className="text-sm text-slate-500 mt-1.5 mb-8">Sign in with your work email to continue.</p>

          <form onSubmit={submit} className="space-y-5">
            <div>
              <label htmlFor="email" className="block text-[13px] font-semibold text-slate-700 mb-1.5">
                Work Email
              </label>
              <div className="relative">
                <span className="absolute inset-y-0 left-0 pl-3.5 flex items-center text-slate-400">
                  <svg viewBox="0 0 24 24" className="w-[18px] h-[18px]" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="3" y="5" width="18" height="14" rx="2.5" />
                    <path d="m3.5 7 8.5 6 8.5-6" />
                  </svg>
                </span>
                <input
                  id="email"
                  type="email"
                  autoComplete="username"
                  autoFocus
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@company.com"
                  className="w-full rounded-xl border border-slate-300 bg-white pl-11 pr-4 py-3 text-[15px] text-slate-900 placeholder:text-slate-400 shadow-sm transition focus:outline-none focus:border-brand-500 focus:ring-4 focus:ring-brand-500/15"
                />
              </div>
            </div>

            <div>
              <label htmlFor="password" className="block text-[13px] font-semibold text-slate-700 mb-1.5">
                Password
              </label>
              <div className="relative">
                <span className="absolute inset-y-0 left-0 pl-3.5 flex items-center text-slate-400">
                  <svg viewBox="0 0 24 24" className="w-[18px] h-[18px]" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="4" y="10" width="16" height="10" rx="2.5" />
                    <path d="M8 10V7a4 4 0 0 1 8 0v3" />
                  </svg>
                </span>
                <input
                  id="password"
                  type={showPassword ? 'text' : 'password'}
                  autoComplete="current-password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  className="w-full rounded-xl border border-slate-300 bg-white pl-11 pr-12 py-3 text-[15px] text-slate-900 placeholder:text-slate-400 shadow-sm transition focus:outline-none focus:border-brand-500 focus:ring-4 focus:ring-brand-500/15"
                />
                <button
                  type="button"
                  tabIndex={-1}
                  onClick={() => setShowPassword((v) => !v)}
                  className="absolute inset-y-0 right-0 pr-3.5 flex items-center text-slate-400 hover:text-slate-600 transition"
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                >
                  {showPassword ? (
                    <svg viewBox="0 0 24 24" className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z" />
                      <circle cx="12" cy="12" r="3" />
                      <path d="M4 4l16 16" />
                    </svg>
                  ) : (
                    <svg viewBox="0 0 24 24" className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z" />
                      <circle cx="12" cy="12" r="3" />
                    </svg>
                  )}
                </button>
              </div>
            </div>

            {error && (
              <div className="flex items-start gap-2.5 rounded-xl bg-red-50 border border-red-200 text-red-700 text-[13px] px-3.5 py-3">
                <svg viewBox="0 0 24 24" className="w-4.5 h-4.5 w-[18px] h-[18px] shrink-0 mt-[1px]" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                  <circle cx="12" cy="12" r="9" />
                  <path d="M12 8v5M12 16.5v.5" />
                </svg>
                <span>{error}</span>
              </div>
            )}

            <button
              disabled={busy}
              className="w-full rounded-xl bg-brand-600 hover:bg-brand-700 active:bg-brand-900 text-white font-semibold text-[15px] py-3 shadow-lg shadow-brand-600/25 transition disabled:opacity-60 disabled:cursor-not-allowed flex items-center justify-center gap-2"
            >
              {busy && (
                <svg className="animate-spin w-4 h-4" viewBox="0 0 24 24" fill="none">
                  <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" className="opacity-25" />
                  <path d="M22 12a10 10 0 0 0-10-10" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
                </svg>
              )}
              {busy ? 'Signing in…' : 'Sign In'}
            </button>
          </form>

          <div className="mt-8 rounded-xl bg-slate-100/80 border border-slate-200 px-4 py-3.5">
            <div className="flex items-start gap-2.5">
              <svg viewBox="0 0 24 24" className="w-[18px] h-[18px] text-brand-600 shrink-0 mt-[1px]" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <circle cx="12" cy="12" r="9" />
                <path d="M12 11v5M12 7.5v.5" />
              </svg>
              <p className="text-[12.5px] leading-relaxed text-slate-600">
                <span className="font-semibold text-slate-700">First time here?</span>{' '}
                Sign in with your work email — your initial password is your{' '}
                <span className="font-semibold text-slate-700">Employee ID</span>. You will be
                asked to set a new password immediately.
              </p>
            </div>
          </div>

          <p className="lg:hidden text-[11px] text-slate-400 text-center mt-8">
            © {new Date().getFullYear()} SWiSH — Business Excellence
          </p>
        </div>
      </div>
    </div>
  );
}
