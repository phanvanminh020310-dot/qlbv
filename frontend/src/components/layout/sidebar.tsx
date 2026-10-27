'use client';

import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Blocks, ChevronRight, Hospital, Sparkles, X } from 'lucide-react';
import { NAV_GROUPS, navHrefs, type NavItem } from './nav';
import { apiFetch } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { cn } from '@/lib/utils';

interface UtilityMenuItem {
  id: number;
  code: string;
  name: string;
  route: string | null;
  badge?: string | null;
  openInNewTab?: boolean;
  kind?: string;
  placement?: string;
}

const OPEN_KEY = 'qlbs.sidebar.open';

function isActive(pathname: string, href?: string): boolean {
  if (!href) return false;
  return (
    pathname === href || (href !== '/dashboard' && pathname.startsWith(href) && href.split('/').length > 2)
  );
}

const linkClass = (active: boolean) =>
  cn(
    'flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm transition-colors',
    active
      ? 'bg-[var(--accent)] font-semibold text-[var(--accent-foreground)]'
      : 'text-[var(--foreground)] hover:bg-[var(--muted)]',
  );

/** Menu dọc: tự ẩn mục không đủ quyền, tự thu gọn trên màn hình nhỏ. */
export function Sidebar({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();
  const can = useAuth((s) => s.can);
  const user = useAuth((s) => s.user);

  // Tiện ích mở rộng do quản trị viên khai báo — menu hiện theo quyền của từng người
  const { data: utilities } = useQuery({
    queryKey: ['utilities-menu', user?.id],
    enabled: !!user,
    queryFn: () => apiFetch<UtilityMenuItem[]>('/utilities/menu?placement=sidebar'),
    staleTime: 120_000,
  });

  const staticHrefs = new Set(NAV_GROUPS.flatMap((g) => navHrefs(g.items)));

  // Mục cha đang mở — nhớ giữa các lần tải trang; tự mở khi đang ở trang con
  const [open, setOpen] = useState<Record<string, boolean>>({});
  useEffect(() => {
    try {
      setOpen(JSON.parse(localStorage.getItem(OPEN_KEY) ?? '{}') as Record<string, boolean>);
    } catch {
      /* bỏ qua */
    }
  }, []);
  const toggle = (label: string, value: boolean) =>
    setOpen((prev) => {
      const next = { ...prev, [label]: value };
      try {
        localStorage.setItem(OPEN_KEY, JSON.stringify(next));
      } catch {
        /* bỏ qua */
      }
      return next;
    });

  /** Lọc theo quyền; mục cha chỉ hiện khi còn ít nhất 1 mục con */
  const visible = (items: NavItem[]): NavItem[] =>
    items.flatMap((item) => {
      const isAdmin = !!user?.isSuperAdmin || (user?.roles ?? []).includes('ADMIN');
      if (item.adminOnly && !isAdmin) return [];
      if ((item.permission || item.anyPermissions?.length) && !(item.permission && can(item.permission)) && !item.anyPermissions?.some(p => can(p))) return [];
      if (item.children) {
        const children = visible(item.children);
        return children.length ? [{ ...item, children }] : [];
      }
      return [item];
    });
  const extraUtilities = (utilities ?? []).filter(
    (u) => u.route && !staticHrefs.has(u.route) && !(u.kind === 'BUILTIN' && staticHrefs.has(u.route)),
  );

  return (
    <aside className="flex h-full w-72 shrink-0 flex-col border-r bg-[var(--card)]">
      <div className="flex items-center gap-2 border-b px-4 py-3">
        <div className="flex size-9 items-center justify-center rounded-xl bg-[var(--primary)] text-white">
          <Hospital className="size-5" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-semibold">QLBS</div>
          <div className="truncate text-[11px] text-[var(--muted-foreground)]">
            Quản lý bệnh viện
          </div>
        </div>
        {onNavigate ? (
          <button type="button" onClick={onNavigate} className="rounded-lg p-1 lg:hidden" aria-label="Đóng menu">
            <X className="size-4" />
          </button>
        ) : null}
      </div>

      <nav className="thin-scroll flex-1 space-y-4 overflow-y-auto px-3 py-4">
        {NAV_GROUPS.map((group) => {
          const items = visible(group.items);
          if (items.length === 0) return null;
          return (
            <div key={group.label} className="space-y-1">
              <div className="px-2 text-[11px] font-semibold uppercase tracking-wider text-[var(--muted-foreground)]">
                {group.label}
              </div>
              {items.map((item) => {
                const Icon = item.icon;
                if (item.children) {
                  const childActive = item.children.some((c) => isActive(pathname, c.href));
                  const expanded = open[item.label] ?? childActive;
                  return (
                    <div key={item.label}>
                      <button
                        type="button"
                        onClick={() => toggle(item.label, !expanded)}
                        aria-expanded={expanded}
                        className={cn(
                          'flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm transition-colors hover:bg-[var(--muted)]',
                          childActive && !expanded ? 'font-semibold text-[var(--primary)]' : 'text-[var(--foreground)]',
                        )}
                      >
                        <Icon className="size-4 shrink-0" />
                        <span className="truncate">{item.label}</span>
                        <ChevronRight
                          className={cn('ml-auto size-4 shrink-0 transition-transform', expanded && 'rotate-90')}
                        />
                      </button>
                      {expanded ? (
                        <div className="ml-4 mt-1 space-y-1 border-l pl-2">
                          {item.children.map((child) => {
                            const ChildIcon = child.icon;
                            return (
                              <Link
                                key={child.href}
                                href={child.href ?? '#'}
                                onClick={onNavigate}
                                className={linkClass(isActive(pathname, child.href))}
                              >
                                <ChildIcon className="size-4 shrink-0" />
                                <span className="truncate">{child.label}</span>
                              </Link>
                            );
                          })}
                        </div>
                      ) : null}
                    </div>
                  );
                }
                return (
                  <Link
                    key={item.href}
                    href={item.href ?? '#'}
                    onClick={onNavigate}
                    className={linkClass(isActive(pathname, item.href))}
                  >
                    <Icon className="size-4 shrink-0" />
                    <span className="truncate">{item.label}</span>
                  </Link>
                );
              })}
            </div>
          );
        })}
        {extraUtilities.length > 0 ? (
          <div className="space-y-1">
            <div className="px-2 text-[11px] font-semibold uppercase tracking-wider text-[var(--muted-foreground)]">
              Tiện ích mở rộng
            </div>
            {extraUtilities.map((item) => {
              const active = pathname === item.route;
              return (
                <Link
                  key={item.code}
                  href={item.route ?? '#'}
                  target={item.openInNewTab ? '_blank' : undefined}
                  rel={item.openInNewTab ? 'noreferrer' : undefined}
                  onClick={onNavigate}
                  className={cn(
                    'flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm transition-colors',
                    active
                      ? 'bg-[var(--accent)] font-semibold text-[var(--accent-foreground)]'
                      : 'text-[var(--foreground)] hover:bg-[var(--muted)]',
                  )}
                >
                  {item.kind === 'BUILTIN' ? <Blocks className="size-4 shrink-0" /> : <Sparkles className="size-4 shrink-0" />}
                  <span className="truncate">{item.name}</span>
                  {item.badge ? (
                    <span className="ml-auto rounded-full bg-[var(--accent)] px-1.5 text-[10px] text-[var(--accent-foreground)]">
                      {item.badge}
                    </span>
                  ) : null}
                </Link>
              );
            })}
          </div>
        ) : null}
      </nav>

      {user ? (
        <div className="border-t px-4 py-3 text-[11px] text-[var(--muted-foreground)]">
          <div className="truncate font-medium text-[var(--foreground)]">{user.fullName}</div>
          <div className="truncate">{user.departmentName || user.title || user.username}</div>
        </div>
      ) : null}
    </aside>
  );
}
