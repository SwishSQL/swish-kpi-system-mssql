'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useApp } from './AppContext';
import { api } from '@/lib/clientApi';

const I = {
  submissions: <path d="M9 12h6M9 16h6M9 8h2M5 4h14a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1Z" />,
  dashboard: <path d="M4 19V10M10 19V5M16 19v-6M20 19H4" />,
  users: <path d="M16 19v-1a4 4 0 0 0-8 0v1M12 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7ZM19 19v-1a3 3 0 0 0-2-2.8M15.5 4.3a3.5 3.5 0 0 1 0 6.4" />,
  departments: <path d="M3 20h18M5 20V8l5-4v16M14 20V10l5 3v7M8 9h1M8 12h1M8 15h1" />,
  hierarchy: <path d="M12 3v4M12 7H6v4M12 7h6v4M6 11v3M18 11v3M4 17h4v4H4zM10 17h4v4h-4zM16 17h4v4h-4z" />,
  kpis: <path d="M8 3v3M16 3v3M4 8h16M6 5h12a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2ZM8 13l2.5 2.5L16 10" />,
  assignments: <path d="M9 5h6M9 5a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2M9 5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2M9 12h6M9 16h4" />,
  periods: <path d="M8 3v3M16 3v3M4 9h16M5 5h14a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1ZM12 13v3l2 1" />,
  permissions: <path d="M12 3l7 3v5c0 4.4-3 8.4-7 9.5-4-1.1-7-5.1-7-9.5V6l7-3ZM9.5 12l2 2 3.5-3.5" />,
  import: <path d="M12 4v10M8 10l4 4 4-4M5 19h14" />,
  audit: <path d="M11 5H6a2 2 0 0 0-2 2v11a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2v-5M18.4 3.6a2 2 0 0 1 2.8 2.8L13 14.6 9 15.4l.8-4L18.4 3.6Z" />,
  logout: <path d="M15 12H4M8 8l-4 4 4 4M12 4h6a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1h-6" />,
};

function Icon({ d }: { d: React.ReactNode }) {
  return (
    <svg viewBox="0 0 24 24" className="w-[18px] h-[18px] shrink-0" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      {d}
    </svg>
  );
}

export default function Sidebar() {
  const { me, can, adminTab, setAdminTab, sidebarOpen, setSidebarOpen } = useApp();
  const pathname = usePathname();
  const router = useRouter();

  const adminItems = [
    { key: 'users', label: 'Users', icon: I.users, show: can('users.view') },
    { key: 'departments', label: 'Departments', icon: I.departments, show: can('departments.view') },
    { key: 'hierarchy', label: 'Hierarchy', icon: I.hierarchy, show: can('hierarchy.view') },
    { key: 'kpis', label: 'KPI Library', icon: I.kpis, show: can('kpi_library.view') },
    { key: 'assignments', label: 'Assignments', icon: I.assignments, show: can('kpi_assignments.view') },
    { key: 'periods', label: 'Periods', icon: I.periods, show: can('periods.manage') },
    { key: 'permissions', label: 'Permissions', icon: I.permissions, show: can('permissions.manage') },
    { key: 'import', label: 'Import Data', icon: I.import, show: can('imports.run') },
    { key: 'audit', label: 'Audit Log', icon: I.audit, show: can('audit_logs.view') },
  ].filter((x) => x.show);

  async function logout() {
    await api('/api/auth/logout', { body: {} }).catch(() => {});
    window.location.href = '/login';
  }

  const mainLink = (href: string, label: string, icon: React.ReactNode) => {
    const active = pathname === href;
    return (
      <Link
        href={href}
        onClick={() => setSidebarOpen(false)}
        className={`flex items-center gap-3 rounded-lg px-3 py-2.5 text-[13.5px] font-medium transition ${
          active
            ? 'bg-brand-600 text-white shadow-lg shadow-brand-600/20'
            : 'text-slate-300 hover:bg-white/[0.06] hover:text-white'
        }`}
      >
        <Icon d={icon} />
        {label}
      </Link>
    );
  };

  const body = (
    <div className="flex flex-col h-full">
      {/* Logo */}
      <div className="flex items-center gap-2.5 px-4 pt-5 pb-6">
        <div className="w-9 h-9 rounded-xl bg-white/10 ring-1 ring-white/15 flex items-center justify-center">
          <svg viewBox="0 0 24 24" className="w-5 h-5 text-cyan-300" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
            <path d="M4 19 L4 12 M10 19 L10 7 M16 19 L16 10 M22 19 L22 4" />
          </svg>
        </div>
        <div>
          <div className="text-[17px] font-black text-white leading-none tracking-tight">SWiSH</div>
          <div className="text-[9.5px] uppercase tracking-[0.22em] text-cyan-300/70 mt-0.5">KPI Management</div>
        </div>
      </div>

      {/* Main nav */}
      <nav className="px-3 space-y-1">
        {mainLink('/', 'Submissions', I.submissions)}
        {mainLink('/dashboard', 'Dashboard', I.dashboard)}
      </nav>

      {/* Admin group */}
      {adminItems.length > 0 && (
        <>
          <div className="px-6 mt-6 mb-2 text-[10px] font-bold uppercase tracking-[0.18em] text-slate-500">
            Administration
          </div>
          <nav className="px-3 space-y-0.5 overflow-y-auto flex-1 min-h-0 pb-4">
            {adminItems.map((item) => {
              const active = pathname === '/admin' && (adminTab || adminItems[0].key) === item.key;
              return (
                <button
                  key={item.key}
                  onClick={() => {
                    setAdminTab(item.key);
                    setSidebarOpen(false);
                    if (pathname !== '/admin') router.push('/admin');
                  }}
                  className={`w-full flex items-center gap-3 rounded-lg px-3 py-2 text-[13px] font-medium transition text-left ${
                    active
                      ? 'bg-white/[0.1] text-white ring-1 ring-white/10'
                      : 'text-slate-400 hover:bg-white/[0.05] hover:text-slate-200'
                  }`}
                >
                  <Icon d={item.icon} />
                  {item.label}
                </button>
              );
            })}
          </nav>
        </>
      )}

      {adminItems.length === 0 && <div className="flex-1" />}

      {/* User card */}
      <div className="p-3 border-t border-white/[0.07]">
        <div className="flex items-center gap-2.5 px-2 py-2">
          <div className="w-9 h-9 rounded-full bg-gradient-to-br from-cyan-400 to-brand-600 flex items-center justify-center text-white text-sm font-bold shrink-0">
            {me!.user.fullName.trim().charAt(0).toUpperCase()}
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-[13px] font-semibold text-white truncate">{me!.user.fullName}</div>
            <div className="text-[10.5px] text-slate-400 truncate">
              {me!.user.systemRole.replace(/_/g, ' ')}
            </div>
          </div>
          <button onClick={logout} title="Logout" className="text-slate-400 hover:text-red-400 transition p-1.5">
            <Icon d={I.logout} />
          </button>
        </div>
        <a
          href="/change-password"
          className="block text-center text-[11px] text-slate-500 hover:text-slate-300 transition pb-1"
        >
          Change password
        </a>
      </div>
    </div>
  );

  return (
    <>
      {/* Desktop */}
      <aside className="hidden lg:flex w-60 shrink-0 flex-col bg-slate-950 border-r border-slate-800/60">
        {body}
      </aside>

      {/* Mobile drawer */}
      {sidebarOpen && (
        <div className="lg:hidden fixed inset-0 z-50">
          <div className="absolute inset-0 bg-black/50" onClick={() => setSidebarOpen(false)} />
          <aside className="absolute inset-y-0 left-0 w-64 bg-slate-950 shadow-2xl">{body}</aside>
        </div>
      )}
    </>
  );
}
