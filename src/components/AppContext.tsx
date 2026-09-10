'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { api, monthKeyNow, prevMonthKey, defaultMonthKey } from '@/lib/clientApi';

export interface Me {
  user: {
    id: string;
    employeeId: string;
    fullName: string;
    email: string;
    systemRole: string;
    mustChangePassword: boolean;
  };
  profile: {
    id: string;
    employeeId: string;
    departmentId: string | null;
    departmentName: string | null;
    position: string | null;
  } | null;
  permissions: string[];
  hasReports: boolean;
  managedDepartmentIds: string[];
  canSwitchDepartments: boolean;
}

interface AppState {
  me: Me | null;
  month: string;
  setMonth: (m: string) => void;
  departmentId: string;
  setDepartmentId: (d: string) => void;
  q: string;
  setQ: (q: string) => void;
  refreshKey: number;
  refresh: () => void;
  can: (perm: string) => boolean;
  departments: { id: string; name: string }[];
  adminTab: string;
  setAdminTab: (t: string) => void;
  sidebarOpen: boolean;
  setSidebarOpen: (v: boolean) => void;
  /** Set once at load for staff whose previous month still has nothing recorded. */
  pendingPrevMonth: string | null;
}

const Ctx = createContext<AppState | null>(null);

export function useApp(): AppState {
  const v = useContext(Ctx);
  if (!v) throw new Error('useApp outside provider');
  return v;
}

export function AppProvider({ children }: { children: React.ReactNode }) {
  const [me, setMe] = useState<Me | null>(null);
  // Last month, not the current one - see defaultMonthKey(). The effect below
  // still nudges staff with a banner if even last month is unrecorded; a
  // direct link (?month=...) always overrides this once /auth/me resolves,
  // same as before.
  const [month, setMonth] = useState(defaultMonthKey());
  const [departmentId, setDepartmentId] = useState('');
  const [q, setQ] = useState('');
  const [refreshKey, setRefreshKey] = useState(0);
  const [departments, setDepartments] = useState<{ id: string; name: string }[]>([]);
  const [adminTab, setAdminTab] = useState('');
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [pendingPrevMonth, setPendingPrevMonth] = useState<string | null>(null);

  useEffect(() => {
    api<Me>('/api/auth/me')
      .then((res) => {
        if (res.user.mustChangePassword) {
          window.location.href = '/change-password';
          return;
        }
        setMe(res);

        // Everyone already opens on last month by default (defaultMonthKey()
        // above) - this only decides whether staff still get the "you haven't
        // recorded last month" banner (page.tsx) if they end up on the current
        // month anyway (a query param, or switching manually). Reviewers/admins
        // don't get nudged - they're usually chasing this month's stragglers,
        // not catching up their own numbers - and a direct link (a
        // notification, a bookmark) always wins over this guess.
        const isReviewer =
          res.hasReports ||
          res.managedDepartmentIds.length > 0 ||
          res.permissions.includes('approvals.approve_compliance') ||
          res.user.systemRole === 'ADMIN' ||
          res.user.systemRole === 'SUPER_ADMIN';
        if (isReviewer) return;

        const current = monthKeyNow();
        const prev = prevMonthKey(current);
        api(`/api/submissions?month=${prev}`)
          .then((sub) => {
            const own = sub.employees?.[0];
            if (!own || own.rows.some((r: any) => r.submission)) return;
            setPendingPrevMonth(prev);
            // A direct link (a notification, a bookmark) always wins over this guess.
            const params = new URLSearchParams(window.location.search);
            if (!params.has('month') && !params.has('employee')) setMonth(prev);
          })
          .catch(() => {});
      })
      .catch(() => {});
    api('/api/departments')
      .then((res) => setDepartments(res.departments.filter((d: any) => d.isActive)))
      .catch(() => {});
  }, []);

  const refresh = useCallback(() => setRefreshKey((k) => k + 1), []);
  const can = useCallback((perm: string) => !!me?.permissions.includes(perm), [me]);

  const value = useMemo(
    () => ({
      me, month, setMonth, departmentId, setDepartmentId, q, setQ,
      refreshKey, refresh, can, departments,
      adminTab, setAdminTab, sidebarOpen, setSidebarOpen, pendingPrevMonth,
    }),
    [me, month, departmentId, q, refreshKey, refresh, can, departments, adminTab, sidebarOpen, pendingPrevMonth]
  );

  if (!me) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-100">
        <div className="flex items-center gap-3 text-slate-400 text-sm">
          <svg className="animate-spin w-5 h-5" viewBox="0 0 24 24" fill="none">
            <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" className="opacity-25" />
            <path d="M22 12a10 10 0 0 0-10-10" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
          </svg>
          Loading…
        </div>
      </div>
    );
  }
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
