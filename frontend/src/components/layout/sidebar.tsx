'use client';

import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Blocks, ChevronRight, ChevronsDownUp, Hospital, Search, Sparkles, X } from 'lucide-react';
import { NAV_GROUPS, navHrefs, type NavGroup, type NavItem } from './nav';
import { apiFetch } from '@/lib/api';
import { getPublicBranding, PUBLIC_BRANDING_QUERY } from '@/lib/branding';
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
/** Khoá nhớ trạng thái mở của nhóm phân hệ (tách với mục cha con) */
const groupKey = (label: string) => `group:${label}`;
const EXTRA_GROUP = 'Tiện ích mở rộng';

/** So khớp không dấu để tìm nhanh chức năng */
const fold = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/gi, 'd')
    .toLowerCase();

function isActive(pathname: string, href?: string): boolean {
  if (!href) return false;
  return pathname === href || (href !== '/dashboard' && pathname.startsWith(href) && href.split('/').length > 2);
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
  const { data: branding } = useQuery({
    queryKey: PUBLIC_BRANDING_QUERY,
    queryFn: getPublicBranding,
    staleTime: 300_000,
  });

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
  const toggle = (label: string, value: boolean) => setMany({ [label]: value });
  const setMany = (patch: Record<string, boolean>) =>
    setOpen((prev) => {
      const next = { ...prev, ...patch };
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
      if (
        (item.permission || item.anyPermissions?.length) &&
        !(item.permission && can(item.permission)) &&
        !item.anyPermissions?.some((p) => can(p))
      )
        return [];
      if (item.children) {
        const children = visible(item.children);
        return children.length ? [{ ...item, children }] : [];
      }
      return [item];
    });
  const extraUtilities = (utilities ?? []).filter(
    (u) => u.route && !staticHrefs.has(u.route) && !(u.kind === 'BUILTIN' && staticHrefs.has(u.route)),
  );

  // Tìm nhanh: lọc mục theo tên (không dấu), tự mở mọi nhóm có kết quả
  const [query, setQuery] = useState('');
  const q = fold(query.trim());
  const matchItems = (items: NavItem[]): NavItem[] =>
    !q
      ? items
      : items.flatMap((item) => {
          if (fold(item.label).includes(q)) return [item];
          if (item.children) {
            const children = matchItems(item.children);
            return children.length ? [{ ...item, children }] : [];
          }
          return [];
        });

  /** Nhóm phân hệ chứa trang đang mở → tự mở nhóm đó khi chuyển trang */
  const activeGroup = useMemo(
    () => NAV_GROUPS.find((g) => navHrefs(g.items).some((h) => isActive(pathname, h)))?.label ?? null,
    [pathname],
  );
  useEffect(() => {
    if (!activeGroup) return;
    setOpen((prev) => {
      if (prev[groupKey(activeGroup)]) return prev;
      const next = { ...prev, [groupKey(activeGroup)]: true };
      try {
        localStorage.setItem(OPEN_KEY, JSON.stringify(next));
      } catch {
        /* bỏ qua */
      }
      return next;
    });
  }, [activeGroup]);
  const groupOpen = (group: Pick<NavGroup, 'label' | 'collapsible'>) =>
    group.collapsible === false || !!q || (open[groupKey(group.label)] ?? group.label === activeGroup);
  const collapseAll = () =>
    setMany(
      Object.fromEntries(
        [...NAV_GROUPS.map((g) => g.label), EXTRA_GROUP]
          .filter((l) => l !== activeGroup)
          .map((l) => [groupKey(l), false]),
      ),
    );
  const anyOpen = [...NAV_GROUPS, { label: EXTRA_GROUP, collapsible: true }].some(
    (g) => g.collapsible !== false && g.label !== activeGroup && open[groupKey(g.label)],
  );

  const groupHeader = (label: string, Icon: NavGroup['icon'], expanded: boolean, count: number, active: boolean) => (
    <button
      type="button"
      onClick={() => toggle(groupKey(label), !expanded)}
      aria-expanded={expanded}
      className={cn(
        'flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm font-semibold transition-colors hover:bg-[var(--muted)]',
        active ? 'text-[var(--primary)]' : 'text-[var(--foreground)]',
      )}
    >
      <Icon className="size-4 shrink-0" />
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {!expanded ? (
        <span className="rounded-full bg-[var(--muted)] px-1.5 text-[10px] font-medium text-[var(--muted-foreground)]">
          {count}
        </span>
      ) : null}
      <ChevronRight
        className={cn('size-4 shrink-0 text-[var(--muted-foreground)] transition-transform', expanded && 'rotate-90')}
      />
    </button>
  );

  return (
    <aside className="flex h-full w-72 shrink-0 flex-col border-r bg-[var(--card)]">
      <div className="flex items-center gap-2 border-b px-4 py-3">
        <div className="relative flex size-9 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-[var(--primary)] text-white">
          <Hospital className="size-5" />
          {branding?.logo ? (
            <img
              src={branding.logo}
              alt=""
              className="absolute inset-0 size-full bg-white object-contain"
              onError={(event) => {
                event.currentTarget.style.display = 'none';
              }}
            />
          ) : null}
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-semibold">{branding?.name ?? 'QLBS'}</div>
          <div className="truncate text-[11px] text-[var(--muted-foreground)]">
            {branding?.subtitle ?? 'Quản lý bệnh viện'}
          </div>
        </div>
        {onNavigate ? (
          <button type="button" onClick={onNavigate} className="rounded-lg p-1 lg:hidden" aria-label="Đóng menu">
            <X className="size-4" />
          </button>
        ) : null}
      </div>

      <div className="flex items-center gap-1 border-b px-3 py-2">
        <div className="relative min-w-0 flex-1">
          <Search className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-[var(--muted-foreground)]" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') setQuery('');
            }}
            placeholder="Tìm chức năng…"
            aria-label="Tìm chức năng trong menu"
            className="h-8 w-full rounded-lg border bg-[var(--background)] pl-7 pr-2 text-xs outline-none focus:ring-2 focus:ring-[var(--ring)]"
          />
        </div>
        <button
          type="button"
          onClick={collapseAll}
          disabled={!anyOpen}
          title="Thu gọn tất cả nhóm"
          aria-label="Thu gọn tất cả nhóm"
          className="rounded-lg p-1.5 text-[var(--muted-foreground)] hover:bg-[var(--muted)] disabled:opacity-40"
        >
          <ChevronsDownUp className="size-4" />
        </button>
      </div>

      <nav className="thin-scroll flex-1 space-y-1 overflow-y-auto px-3 py-3">
        {NAV_GROUPS.map((group) => {
          const items = matchItems(visible(group.items));
          if (items.length === 0) return null;
          const expanded = groupOpen(group);
          const count = navHrefs(items).length;
          return (
            <div key={group.label} className="space-y-1">
              {group.collapsible === false ? (
                <div className="px-2 pb-0.5 pt-1 text-[11px] font-semibold uppercase tracking-wider text-[var(--muted-foreground)]">
                  {group.label}
                </div>
              ) : (
                groupHeader(group.label, group.icon, expanded, count, group.label === activeGroup)
              )}
              {!expanded ? null : (
                <div className={cn('space-y-1', group.collapsible !== false && 'ml-3 border-l pl-2')}>
                  {items.map((item) => {
                    const Icon = item.icon;
                    if (item.children) {
                      const childActive = item.children.some((c) => isActive(pathname, c.href));
                      const expanded = !!q || (open[item.label] ?? childActive);
                      return (
                        <div key={item.label}>
                          <button
                            type="button"
                            onClick={() => toggle(item.label, !expanded)}
                            aria-expanded={expanded}
                            className={cn(
                              'flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm transition-colors hover:bg-[var(--muted)]',
                              childActive && !expanded
                                ? 'font-semibold text-[var(--primary)]'
                                : 'text-[var(--foreground)]',
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
              )}
            </div>
          );
        })}
        {extraUtilities.length > 0 && (!q || extraUtilities.some((u) => fold(u.name).includes(q))) ? (
          <div className="space-y-1">
            {groupHeader(
              EXTRA_GROUP,
              Blocks,
              groupOpen({ label: EXTRA_GROUP }),
              extraUtilities.length,
              extraUtilities.some((u) => pathname === u.route),
            )}
            {groupOpen({ label: EXTRA_GROUP }) || extraUtilities.some((u) => pathname === u.route) ? (
              <div className="ml-3 space-y-1 border-l pl-2">
                {extraUtilities
                  .filter((u) => !q || fold(u.name).includes(q))
                  .map((item) => {
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
                        {item.kind === 'BUILTIN' ? (
                          <Blocks className="size-4 shrink-0" />
                        ) : (
                          <Sparkles className="size-4 shrink-0" />
                        )}
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
