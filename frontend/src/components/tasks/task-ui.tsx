'use client';

import { useQuery } from '@tanstack/react-query';
import { BarChart3, Check, ClipboardList, FolderKanban, LayoutDashboard, LayoutList, Paperclip, Search, SquareKanban, X, FileStack } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useMemo, useRef, useState, type ReactNode } from 'react';
import { Badge } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import {
  PRIORITY_LABEL,
  PRIORITY_TONE,
  STATUS_LABEL,
  STATUS_TONE,
  TASK_FILE_ACCEPT,
  TASK_FILE_MAX_MB,
  dueText,
  formatBytes,
  taskKeys,
  tasksApi,
  type AssignableUser,
  type TaskPriority,
  type TaskStatus,
} from '@/lib/tasks';

export function TaskStatusBadge({ status, label }: { status: TaskStatus; label?: string }) {
  return <Badge tone={STATUS_TONE[status]}>{label ?? STATUS_LABEL[status]}</Badge>;
}

export function PriorityBadge({ priority, compact }: { priority: TaskPriority; compact?: boolean }) {
  if (compact && priority === 'NORMAL') return null;
  return <Badge tone={PRIORITY_TONE[priority]}>{priority === 'URGENT' ? '⚡ ' : ''}{PRIORITY_LABEL[priority]}</Badge>;
}

export function DueBadge({ dueAt, status }: { dueAt: string | null; status: TaskStatus }) {
  const d = dueText(dueAt, status);
  const tone = d.tone === 'default' ? 'muted' : d.tone;
  return <Badge tone={tone}>{d.text}</Badge>;
}

export function ProgressBar({ value, className, color }: { value: number; className?: string; color?: string }) {
  const v = Math.max(0, Math.min(100, Math.round(value)));
  return (
    <div className={cn('h-1.5 w-full overflow-hidden rounded-full bg-[var(--muted)]', className)} title={`${v}%`}>
      <div className="h-full rounded-full transition-all" style={{ width: `${v}%`, background: color ?? (v >= 100 ? '#16a34a' : '#0f766e') }} />
    </div>
  );
}

export function Avatar({ name, size = 24 }: { name?: string | null; size?: number }) {
  const text = (name ?? '?').trim().split(/\s+/).slice(-1)[0]?.charAt(0).toUpperCase() ?? '?';
  let hash = 0;
  for (const ch of name ?? '') hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  const hue = hash % 360;
  return (
    <span
      className="inline-flex shrink-0 items-center justify-center rounded-full font-semibold text-white"
      style={{ width: size, height: size, fontSize: size * 0.45, background: `hsl(${hue} 55% 42%)` }}
      title={name ?? ''}
    >
      {text}
    </span>
  );
}

const SUBNAV = [
  { href: '/cong-viec', label: 'Tổng quan', icon: LayoutDashboard, exact: true },
  { href: '/cong-viec/danh-sach', label: 'Danh sách', icon: LayoutList },
  { href: '/cong-viec/kanban', label: 'Kanban', icon: SquareKanban },
  { href: '/cong-viec/du-an', label: 'Dự án', icon: FolderKanban },
  { href: '/cong-viec/bao-cao', label: 'Báo cáo', icon: BarChart3, permission: 'canReport' as const },
  { href: '/cong-viec/mau', label: 'Mẫu công việc', icon: FileStack, permission: 'canAssign' as const },
];

/** Thanh điều hướng con của phân hệ công việc. */
export function TaskSubnav() {
  const pathname = usePathname() ?? '';
  const meta = useQuery({ queryKey: taskKeys.meta, queryFn: tasksApi.meta, staleTime: 60_000 });
  const perms = meta.data?.permissions;
  return (
    <div className="thin-scroll -mt-1 mb-4 flex gap-1 overflow-x-auto border-b">
      {SUBNAV.filter((i) => !i.permission || perms?.[i.permission]).map((item) => {
        const active = item.exact ? pathname === item.href : pathname.startsWith(item.href);
        const Icon = item.icon;
        return (
          <Link
            key={item.href}
            href={item.href}
            className={cn(
              '-mb-px flex items-center gap-1.5 whitespace-nowrap border-b-2 px-3 py-2 text-sm transition-colors',
              active ? 'border-[var(--primary)] font-semibold text-[var(--primary)]' : 'border-transparent text-[var(--muted-foreground)] hover:text-[var(--foreground)]',
            )}
          >
            <Icon className="size-4" />
            {item.label}
          </Link>
        );
      })}
    </div>
  );
}

/** Chọn một hoặc nhiều nhân viên (tìm theo tên/chức danh/khoa). */
export function UserPicker({
  value,
  onChange,
  multiple,
  placeholder = 'Tìm nhân viên…',
  projectId,
  users: provided,
  disabled,
}: {
  value: number[];
  onChange: (ids: number[]) => void;
  multiple?: boolean;
  placeholder?: string;
  projectId?: number | null;
  users?: AssignableUser[];
  disabled?: boolean;
}) {
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const blurTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const query = useQuery({
    queryKey: ['tasks', 'assignable', projectId ?? 0],
    queryFn: () => tasksApi.assignable({ projectId: projectId ?? undefined }),
    enabled: !provided,
    staleTime: 60_000,
  });
  const users = provided ?? query.data ?? [];
  const byId = useMemo(() => new Map(users.map((u) => [u.id, u])), [users]);
  const norm = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'D').toLowerCase();
  const filtered = users.filter((u) => !q.trim() || norm(`${u.fullName} ${u.username} ${u.title} ${u.departmentName ?? ''}`).includes(norm(q.trim()))).slice(0, 60);
  const toggle = (id: number) => {
    if (multiple) onChange(value.includes(id) ? value.filter((v) => v !== id) : [...value, id]);
    else {
      onChange(value[0] === id ? [] : [id]);
      setOpen(false);
    }
  };
  return (
    <div className="relative">
      <div className={cn('flex min-h-9 flex-wrap items-center gap-1 rounded-lg border bg-[var(--card)] px-2 py-1', disabled && 'opacity-60')}>
        {value.map((id) => {
          const u = byId.get(id);
          return (
            <span key={id} className="inline-flex items-center gap-1 rounded-full bg-[var(--muted)] py-0.5 pl-0.5 pr-2 text-xs">
              <Avatar name={u?.fullName} size={18} />
              {u?.fullName ?? `#${id}`}
              {!disabled ? (
                <button type="button" className="text-[var(--muted-foreground)] hover:text-red-600" onClick={() => onChange(value.filter((v) => v !== id))} aria-label="Bỏ chọn">
                  <X className="size-3" />
                </button>
              ) : null}
            </span>
          );
        })}
        {!disabled && (multiple || value.length === 0) ? (
          <div className="flex min-w-[8rem] flex-1 items-center gap-1">
            <Search className="size-3.5 text-[var(--muted-foreground)]" />
            <input
              value={q}
              onChange={(e) => { setQ(e.target.value); setOpen(true); }}
              onFocus={() => setOpen(true)}
              onBlur={() => { blurTimer.current = setTimeout(() => setOpen(false), 150); }}
              placeholder={placeholder}
              className="h-7 w-full bg-transparent text-sm outline-none"
            />
          </div>
        ) : null}
      </div>
      {open && !disabled ? (
        <div
          className="absolute z-30 mt-1 max-h-72 w-full overflow-y-auto rounded-lg border bg-[var(--card)] p-1 shadow-lg"
          onMouseDown={() => { if (blurTimer.current) clearTimeout(blurTimer.current); }}
        >
          {query.isLoading ? <div className="p-2 text-xs text-[var(--muted-foreground)]">Đang tải…</div> : null}
          {filtered.length === 0 && !query.isLoading ? <div className="p-2 text-xs text-[var(--muted-foreground)]">Không có nhân viên phù hợp trong phạm vi giao việc</div> : null}
          {filtered.map((u) => (
            <button
              key={u.id}
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => toggle(u.id)}
              className={cn('flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-[var(--muted)]', value.includes(u.id) && 'bg-teal-50 dark:bg-teal-950')}
            >
              <Avatar name={u.fullName} size={26} />
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium">{u.fullName}</span>
                <span className="block truncate text-[11px] text-[var(--muted-foreground)]">{[u.title, u.departmentName].filter(Boolean).join(' · ')}</span>
              </span>
              {u.hasTelegram ? <span className="text-[10px] text-sky-600" title="Đã liên kết Telegram — nhận thông báo ngay">TG</span> : null}
              {value.includes(u.id) ? <Check className="size-4 text-teal-700" /> : null}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

/** Chọn tệp đính kèm (giữ danh sách, cho xoá từng tệp trước khi gửi). */
export function FilePicker({ files, onChange, label = 'Đính kèm tệp', compact }: { files: File[]; onChange: (f: File[]) => void; label?: string; compact?: boolean }) {
  const ref = useRef<HTMLInputElement>(null);
  return (
    <div className="space-y-1.5">
      <input
        ref={ref}
        type="file"
        multiple
        accept={TASK_FILE_ACCEPT}
        className="hidden"
        onChange={(e) => {
          const list = Array.from(e.target.files ?? []);
          onChange([...files, ...list].slice(0, 10));
          e.target.value = '';
        }}
      />
      <button
        type="button"
        onClick={() => ref.current?.click()}
        className={cn('inline-flex items-center gap-1.5 rounded-lg border border-dashed px-3 text-sm text-[var(--muted-foreground)] hover:border-teal-600 hover:text-teal-700', compact ? 'h-8' : 'h-9')}
      >
        <Paperclip className="size-4" /> {label}
      </button>
      {!compact ? <div className="text-[11px] text-[var(--muted-foreground)]">Ảnh, PDF, Word, Excel, PowerPoint, văn bản, nén — tối đa {TASK_FILE_MAX_MB}MB/tệp, 10 tệp.</div> : null}
      {files.length ? (
        <ul className="space-y-1">
          {files.map((f, i) => (
            <li key={`${f.name}-${i}`} className="flex items-center gap-2 rounded-md bg-[var(--muted)] px-2 py-1 text-xs">
              <Paperclip className="size-3" />
              <span className="min-w-0 flex-1 truncate">{f.name}</span>
              <span className={cn('text-[var(--muted-foreground)]', f.size > TASK_FILE_MAX_MB * 1024 * 1024 && 'font-semibold text-red-600')}>{formatBytes(f.size)}</span>
              <button type="button" onClick={() => onChange(files.filter((_, j) => j !== i))} aria-label="Bỏ tệp" className="hover:text-red-600">
                <X className="size-3" />
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

export function Field({ label, children, hint, className }: { label: ReactNode; children: ReactNode; hint?: ReactNode; className?: string }) {
  return (
    <label className={cn('block space-y-1', className)}>
      <span className="text-xs font-medium text-[var(--muted-foreground)]">{label}</span>
      {children}
      {hint ? <span className="block text-[11px] text-[var(--muted-foreground)]">{hint}</span> : null}
    </label>
  );
}

export function TaskEmptyIcon() {
  return <ClipboardList className="mx-auto size-10 text-[var(--muted-foreground)] opacity-40" />;
}
