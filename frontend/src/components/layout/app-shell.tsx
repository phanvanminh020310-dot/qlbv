'use client';

import { useState, type ReactNode } from 'react';
import { Sidebar } from './sidebar';
import { Topbar } from './topbar';

/** Bố cục chính: menu dọc cố định trên máy tính, dạng ngăn kéo trên điện thoại. */
export function AppShell({ children }: { children: ReactNode }) {
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <div className="app-shell flex min-h-svh bg-[var(--background)]">
      <div className="hidden lg:block">
        <div className="sticky top-0 h-dvh">
          <Sidebar />
        </div>
      </div>

      {mobileOpen ? (
        <div className="app-viewport-fixed fixed inset-x-0 top-0 z-40 overflow-hidden lg:hidden">
          <div className="absolute inset-0 bg-black/45" onClick={() => setMobileOpen(false)} />
          <div className="absolute bottom-0 left-0 top-0">
            <Sidebar onNavigate={() => setMobileOpen(false)} />
          </div>
        </div>
      ) : null}

      <div className="app-shell-content flex min-w-0 flex-1 flex-col">
        <Topbar onOpenMenu={() => setMobileOpen(true)} />
        <main className="app-shell-main min-w-0 flex-1 p-3 lg:p-5">{children}</main>
        <footer className="app-shell-footer shrink-0 border-t px-4 py-3 text-center text-[11px] text-[var(--muted-foreground)]">
          QLBS — Phần mềm Quản lý Bệnh viện · Sửa hồ sơ bệnh án · Báo cáo khoa · Thiết kế bản in
        </footer>
      </div>
    </div>
  );
}
