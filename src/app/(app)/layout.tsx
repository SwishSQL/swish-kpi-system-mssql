'use client';

import { AppProvider } from '@/components/AppContext';
import Sidebar from '@/components/Sidebar';
import Topbar from '@/components/Topbar';

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <AppProvider>
      <div className="app-shell flex overflow-hidden bg-slate-100">
        <Sidebar />
        <div className="flex-1 flex flex-col min-w-0">
          <Topbar />
          <main className="flex-1 overflow-y-auto overflow-x-hidden px-3 py-3 sm:px-4 sm:py-4 md:px-6">
            {children}
          </main>
        </div>
      </div>
    </AppProvider>
  );
}
