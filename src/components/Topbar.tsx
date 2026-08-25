'use client';

import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { useApp } from './AppContext';
import { api } from '@/lib/clientApi';

export default function Topbar() {
  const { me, month, setMonth, departmentId, setDepartmentId, q, setQ, refresh, setSidebarOpen, adminTab, departments } = useApp();
  const pathname = usePathname();
  const router = useRouter();
  const [bellOpen, setBellOpen] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [notifications, setNotifications] = useState<any[]>([]);
  const [unread, setUnread] = useState(0);
  const bellRef = useRef<HTMLDivElement>(null);

  /**
   * Only the screens that actually read these values show them. The admin
   * screens each filter their own data - a month picker above the user list
   * filtered nothing and simply looked broken.
   */
  const TOPBAR_FILTERS: Record<string, { search: boolean; month: boolean; department: boolean }> = {
    '/': { search: true, month: true, department: true },
    '/dashboard': { search: false, month: true, department: true },
  };
  const shown = TOPBAR_FILTERS[pathname] ?? { search: false, month: false, department: false };
  const anyFilterShown = shown.search || shown.month || shown.department;

  const TITLES: Record<string, string> = {
    '/': 'KPI Submissions',
    '/dashboard': 'Dashboard',
    '/admin': 'Administration',
  };
  const ADMIN_TITLES: Record<string, string> = {
    users: 'Users', departments: 'Departments', hierarchy: 'Reporting Hierarchy',
    kpis: 'KPI Library', assignments: 'KPI Assignments', periods: 'Submission Periods',
    permissions: 'Permissions', import: 'Import Data', audit: 'Audit Log',
  };
  const title =
    pathname === '/admin'
      ? ADMIN_TITLES[adminTab] || 'Administration'
      : TITLES[pathname] || 'SWiSH KPI';

  useEffect(() => {
    const load = () =>
      api('/api/notifications')
        .then((res) => {
          setNotifications(res.notifications);
          setUnread(res.unread);
        })
        .catch(() => {});
    load();
    const t = setInterval(load, 60000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (bellRef.current && !bellRef.current.contains(e.target as Node)) setBellOpen(false);
    }
    document.addEventListener('click', onClick);
    return () => document.removeEventListener('click', onClick);
  }, []);

  async function markAllRead() {
    await api('/api/notifications', { body: { all: true } }).catch(() => {});
    setUnread(0);
    setNotifications((n) => n.map((x) => ({ ...x, isRead: true })));
  }

  /**
   * Opens what the notification is about. The month and employee travel in the
   * query string, so the submissions screen lands on that card even when the
   * user was looking at another month.
   */
  async function openNotification(n: any) {
    if (!n.isRead) {
      setUnread((u) => Math.max(0, u - 1));
      setNotifications((list) => list.map((x) => (x.id === n.id ? { ...x, isRead: true } : x)));
      api('/api/notifications', { body: { ids: [n.id] } }).catch(() => {});
    }
    setBellOpen(false);
    if (!n.link) return;
    const url = new URL(n.link, window.location.origin);
    const m = url.searchParams.get('month');
    if (m) setMonth(m);
    // A full navigation would drop the month we just set, so route within the app.
    if (window.location.pathname !== url.pathname) router.push(url.pathname + url.search);
    else router.replace(url.pathname + url.search);
  }

  const activeFilters = (shown.search && q ? 1 : 0) + (shown.department && departmentId ? 1 : 0);

  const searchField = (
    <div className="relative flex-1 min-w-0">
      <span className="absolute inset-y-0 left-0 pl-2.5 flex items-center text-slate-400">
        <svg viewBox="0 0 24 24" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
          <circle cx="11" cy="11" r="7" />
          <path d="m20 20-3.5-3.5" />
        </svg>
      </span>
      <input
        className="input !pl-8 w-full !py-1.5 !text-[13px]"
        placeholder="Search employee or KPI…"
        value={q}
        onChange={(e) => setQ(e.target.value)}
      />
    </div>
  );

  const monthField = (
    <input
      type="month"
      className="input !py-1.5 !text-[13px] w-full sm:w-auto"
      value={month}
      onChange={(e) => e.target.value && setMonth(e.target.value)}
      title="Submission Month"
    />
  );

  const deptField = me!.canSwitchDepartments ? (
    <select
      className="input !py-1.5 !text-[13px] w-full sm:w-auto sm:max-w-[170px]"
      value={departmentId}
      onChange={(e) => setDepartmentId(e.target.value)}
      title="Department"
    >
      <option value="">All Departments</option>
      {departments.map((d) => (
        <option key={d.id} value={d.id}>{d.name}</option>
      ))}
    </select>
  ) : null;

  return (
    <header className="bg-white border-b border-slate-200 sticky top-0 z-40">
      <div className="flex items-center gap-2 px-3 sm:px-4 py-2.5">
        <button className="lg:hidden text-slate-600 p-1.5 -ml-1 shrink-0" onClick={() => setSidebarOpen(true)} aria-label="Open menu">
          <svg viewBox="0 0 24 24" className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <path d="M4 6h16M4 12h16M4 18h16" />
          </svg>
        </button>

        <h1 className="text-[15px] font-bold text-slate-800 tracking-tight truncate">{title}</h1>

        <div className="flex-1" />

        {/* Desktop controls */}
        <div className="hidden md:flex items-center gap-2">
          {shown.search && <div className="w-56">{searchField}</div>}
          {shown.month && monthField}
          {shown.department && deptField}
        </div>

        {/* Mobile: filter toggle */}
        <button
          className={`md:hidden relative text-slate-500 hover:text-slate-700 hover:bg-slate-100 rounded-lg p-2 transition shrink-0 ${anyFilterShown ? '' : 'hidden'}`}
          onClick={() => setFiltersOpen((v) => !v)}
          aria-label="Filters"
          aria-expanded={filtersOpen}
        >
          <svg viewBox="0 0 24 24" className="w-[18px] h-[18px]" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M3 5h18M6 12h12M10 19h4" />
          </svg>
          {activeFilters > 0 && (
            <span className="absolute top-0.5 right-0.5 bg-brand-600 text-white text-[9.5px] font-bold rounded-full w-4 h-4 flex items-center justify-center">
              {activeFilters}
            </span>
          )}
        </button>

        <button
          className="text-slate-500 hover:text-slate-700 hover:bg-slate-100 rounded-lg p-2 transition shrink-0"
          onClick={refresh}
          title="Refresh"
          aria-label="Refresh"
        >
          <svg viewBox="0 0 24 24" className="w-[18px] h-[18px]" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 12a9 9 0 1 1-2.6-6.3M21 4v5h-5" />
          </svg>
        </button>

        <div className="relative shrink-0" ref={bellRef}>
          <button
            className="relative text-slate-500 hover:text-slate-700 hover:bg-slate-100 rounded-lg p-2 transition"
            onClick={(e) => {
              e.stopPropagation();
              setBellOpen((v) => !v);
            }}
            title="Notifications"
            aria-label="Notifications"
          >
            <svg viewBox="0 0 24 24" className="w-[18px] h-[18px]" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M18 9a6 6 0 1 0-12 0c0 6-2.5 7-2.5 7h17S18 15 18 9M13.7 20a2 2 0 0 1-3.4 0" />
            </svg>
            {unread > 0 && (
              <span className="absolute top-0.5 right-0.5 bg-red-500 text-white text-[9.5px] font-bold rounded-full min-w-[16px] h-4 flex items-center justify-center px-0.5">
                {unread > 99 ? '99+' : unread}
              </span>
            )}
          </button>
          {bellOpen && (
            <div
              className="fixed sm:absolute left-2 right-2 sm:left-auto sm:right-0 top-14 sm:top-auto sm:mt-1.5 sm:w-80 card max-h-[70vh] sm:max-h-96 overflow-auto z-50 shadow-xl"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center justify-between px-3 py-2 border-b border-slate-100 sticky top-0 bg-white">
                <span className="text-[13px] font-bold">Notifications</span>
                <button className="text-[11px] text-brand-600 hover:underline" onClick={markAllRead}>
                  Mark all read
                </button>
              </div>
              {notifications.length === 0 && (
                <div className="p-6 text-[13px] text-slate-400 text-center">No notifications</div>
              )}
              {notifications.map((n) => (
                <button
                  key={n.id}
                  onClick={() => openNotification(n)}
                  className={`w-full text-left px-3 py-2 border-b border-slate-50 transition-colors ${
                    n.isRead ? 'hover:bg-slate-50' : 'bg-brand-50 hover:bg-brand-100'
                  } ${n.link ? 'cursor-pointer' : 'cursor-default'}`}
                >
                  <div className="flex items-start gap-2">
                    {!n.isRead && <span className="mt-1.5 w-1.5 h-1.5 rounded-full bg-brand-600 shrink-0" />}
                    <div className="min-w-0 flex-1">
                      <div className="text-[12px] font-semibold text-slate-700">{n.title}</div>
                      <div className="text-[11.5px] text-slate-500">{n.message}</div>
                      <div className="text-[10px] text-slate-400 mt-0.5">{new Date(n.createdAt).toLocaleString()}</div>
                    </div>
                    {n.link && <span className="text-slate-300 text-xs mt-0.5">›</span>}
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Mobile filter panel */}
      {filtersOpen && anyFilterShown && (
        <div className="md:hidden border-t border-slate-100 px-3 py-3 space-y-2 bg-slate-50">
          {shown.search && searchField}
          <div className="flex gap-2">
            {shown.month && <div className="flex-1">{monthField}</div>}
            {shown.department && deptField && <div className="flex-1">{deptField}</div>}
          </div>
          {activeFilters > 0 && (
            <button
              className="text-[12px] text-brand-600 hover:underline"
              onClick={() => {
                setQ('');
                setDepartmentId('');
              }}
            >
              Clear filters
            </button>
          )}
        </div>
      )}
    </header>
  );
}
