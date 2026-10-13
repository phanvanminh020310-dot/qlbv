'use client';

/**
 * Studio — khung một trang (dashboard hoặc báo cáo tùy biến):
 *  - thanh công cụ: đổi trang, thêm ô, chỉnh sửa/xong, nhân bản, đổi tên,
 *    đặt mặc định, xoá; chấm trạng thái realtime.
 *  - dưới là StudioCanvas (xem / chỉnh sửa kéo-thả).
 * Quyền sửa trang dùng chung: chỉ SUPER_ADMIN/ADMIN (khớp backend).
 */
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  BellRing,
  Check,
  Copy,
  Pencil,
  Plus,
  Star,
  StarOff,
  Trash2,
  X,
} from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Input, Label, Select } from '@/components/ui/input';
import { Badge } from '@/components/ui/card';
import { useAuth } from '@/lib/auth';
import { apiFetch } from '@/lib/api';
import {
  BUILTIN_WIDGETS,
  newWidgetId,
  studioApi,
  WIDGET_TYPE_LABELS,
  type StudioLayout,
  type StudioPage,
  type StudioSourceMeta,
  type StudioVocabulary,
  type StudioWidget,
  type StudioWidgetType,
} from '@/lib/studio';
import { RealtimeDot, useRealtimeEvent } from '@/lib/realtime';
import { SOURCE_REALTIME_TOPIC } from '@/lib/studio';
import { StudioCanvas } from './studio-canvas';
import { SubscriptionsDialog } from './subscriptions-dialog';
import { WidgetConfigDialog } from './widget-config-dialog';

/* ---------------------------------------------------------------- helpers */

export function useStudioMeta() {
  return useQuery({
    queryKey: ['studio', 'sources'],
    queryFn: studioApi.sources,
    staleTime: 5 * 60_000,
  });
}

export function scopeBadge(scope: StudioPage['scope']) {
  if (scope === 'SYSTEM') return <Badge tone="brand">Hệ thống</Badge>;
  if (scope === 'ROLE') return <Badge tone="muted">Vai trò</Badge>;
  return <Badge tone="success">Của tôi</Badge>;

}


/** Nút "Thêm ô": chọn loại → thêm widget mới rỗng vào cuối trang */
function AddWidgetMenu({ onAdd }: { onAdd: (w: StudioWidget) => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);

  const add = (type: StudioWidgetType, builtin?: string) => {
    const defaults: Partial<StudioWidget> =
      type === 'kpi'
        ? { w: 3, h: 'S', title: 'Chỉ số mới' }
        : type === 'table'
          ? { w: 12, h: 'M', title: 'Bảng mới' }
          : type === 'text'
            ? { w: 12, h: 'S', title: 'Văn bản', options: { text: '' } }
            : type === 'builtin'
              ? { w: 6, h: 'M', title: BUILTIN_WIDGETS.find((b) => b.key === builtin)?.label ?? 'Tích hợp', builtin }
              : { w: 6, h: 'L', title: WIDGET_TYPE_LABELS[type] };
    onAdd({ id: newWidgetId(), type, title: defaults.title ?? '', w: defaults.w ?? 6, h: defaults.h ?? 'M', builtin: defaults.builtin, options: defaults.options });
    setOpen(false);
  };

  const chartTypes: StudioWidgetType[] = ['kpi', 'line', 'area', 'bar', 'barh', 'pie', 'donut', 'table'];

  return (
    <div className="relative" ref={ref}>
      <Button onClick={() => setOpen((v) => !v)}>
        <Plus className="size-4" /> Thêm ô
      </Button>
      {open ? (
        <div className="absolute right-0 z-40 mt-1 w-64 rounded-xl border bg-[var(--card)] p-2 shadow-lg">
          <div className="px-2 pb-1 pt-1 text-[11px] font-medium uppercase tracking-wide text-[var(--muted-foreground)]">
            Ô dữ liệu
          </div>
          {chartTypes.map((t) => (
            <button key={t} type="button" className="block w-full rounded-lg px-2 py-1.5 text-left text-sm hover:bg-[var(--accent)]" onClick={() => add(t)}>
              {WIDGET_TYPE_LABELS[t]}
            </button>
          ))}
          <div className="mt-1 border-t px-2 pb-1 pt-2 text-[11px] font-medium uppercase tracking-wide text-[var(--muted-foreground)]">
            Khác
          </div>
          <button type="button" className="block w-full rounded-lg px-2 py-1.5 text-left text-sm hover:bg-[var(--accent)]" onClick={() => add('text')}>
            Văn bản / tiêu đề
          </button>
          {BUILTIN_WIDGETS.map((b) => (
            <button key={b.key} type="button" className="block w-full rounded-lg px-2 py-1.5 text-left text-sm hover:bg-[var(--accent)]" onClick={() => add('builtin', b.key)}>
              {b.label}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

/* ----------------------------------------------------------- trang chính */

export interface StudioPageFrameProps {
  page: StudioPage;
  pages: StudioPage[];
  sources: StudioSourceMeta[];
  vocabulary: StudioVocabulary;
  /** Điều hướng khi chọn trang khác / sau khi tạo-nhân bản (mặc định: chuyển query ?id=) */
  onNavigate?: (id: number) => void;
  /** Cho phép xoá trang này không (backend vẫn kiểm lại) */
  allowDelete?: boolean;
  /** Mở ngay dialog ấn bản định kỳ (từ link thông báo) */
  autoOpenSubscriptions?: boolean;
}

export function StudioPageFrame({ page, pages, sources, vocabulary, onNavigate, allowDelete = true, autoOpenSubscriptions = false }: StudioPageFrameProps) {
  const user = useAuth((s) => s.user);
  const router = useRouter();
  const queryClient = useQueryClient();

  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<StudioWidget[]>(page?.layout?.widgets ?? []);
  const [configWidget, setConfigWidget] = useState<StudioWidget | null>(null);
  const [renameOpen, setRenameOpen] = useState(false);
  const [subsOpen, setSubsOpen] = useState(autoOpenSubscriptions);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  // Nếu đổi trang → nạp lại draft
  const pageId = page?.id;
  useEffect(() => {
    setEditing(false);
    setDraft(page?.layout?.widgets ?? []);
    setError('');
  }, [pageId, page?.layout?.widgets]);

  const isAdmin = !!user?.isSuperAdmin || (user?.roles ?? []).includes('ADMIN');
  const canEditPage = isAdmin || (page?.scope === 'PERSONAL' && page?.ownerId === user?.id);
  const canManage = useAuth((s) => s.can)(
    page?.kind === 'REPORT' ? 'studio.report.manage' : 'studio.dashboard.manage',
  );

  /* Realtime: có sự kiện thuộc các nguồn đang hiển thị → invalidate ô (có gom nhịp) */
  const topics = useMemo(() => {
    const set = new Set<string>(['notification']);
    for (const w of page?.layout?.widgets ?? []) {
      const topic = w.dataSpec?.source ? SOURCE_REALTIME_TOPIC[w.dataSpec.source] : undefined;
      if (topic) set.add(topic);
    }
    if ((page?.layout?.widgets ?? []).some((w) => w.type === 'builtin')) { set.add('hsba'); set.add('system'); }
    return [...set].join(',');
  }, [page?.layout?.widgets]);

  const invalidateTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useRealtimeEvent((event) => {
    if (!topics.split(',').includes(event.topic)) return;
    if (invalidateTimer.current) return;
    invalidateTimer.current = setTimeout(() => {
      invalidateTimer.current = null;
      void queryClient.invalidateQueries({ queryKey: ['studio-widget'] });
      void queryClient.invalidateQueries({ queryKey: ['dashboard-summary'] });
      if (event.topic === 'notification') void queryClient.invalidateQueries({ queryKey: ['notifications'] });
    }, 1_500);
  });

  const save = async (asLayout: StudioWidget[]) => {
    setSaving(true);
    setError('');
    try {
      const layout: StudioLayout = { widgets: asLayout };
      await studioApi.updatePage(page.id, { layout });
      await queryClient.invalidateQueries({ queryKey: ['studio'] });
      setEditing(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Lưu thất bại');
    } finally {
      setSaving(false);
    }
  };

  const navigate = (id: number) => onNavigate?.(id);

  const makePersonalCopy = async () => {
    const copy = await studioApi.duplicatePage(page.id);
    await queryClient.invalidateQueries({ queryKey: ['studio'] });
    navigate(copy.id);
  };

  return (
    <div className="space-y-4">
      {/* Thanh công cụ trang */}
      <div className="flex flex-wrap items-center gap-2">
        <Select
          className="max-w-64"
          value={String(page.id)}
          onChange={(e) => navigate(Number(e.target.value))}
          title="Chọn trang"
        >
          {pages.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}{p.isDefault ? ' ★' : ''}{p.scope === 'SYSTEM' ? ' (hệ thống)' : p.scope === 'ROLE' ? ` (${p.roleCode})` : ''}
            </option>
          ))}
        </Select>
        {scopeBadge(page.scope)}
        {page.isDefault ? <Badge tone="warning">Mặc định</Badge> : null}
        <RealtimeDot className="ml-1" />
        <div className="flex-1" />

        <Button
          variant="outline"
          title="Nhận Excel của trang này theo lịch (ấn bản định kỳ)"
          onClick={() => setSubsOpen(true)}
        >
          <BellRing className="size-4" /> Ấn bản
        </Button>

        {canManage ? (
          editing ? (
            <>
              <AddWidgetMenu onAdd={(w) => setDraft((d) => [...d, w])} />
              <Button variant="ghost" onClick={() => { setDraft(page?.layout?.widgets ?? []); setEditing(false); setError(''); }} disabled={saving}>
                <X className="size-4" /> Huỷ
              </Button>
              <Button onClick={() => void save(draft)} disabled={saving}>
                <Check className="size-4" /> {saving ? 'Đang lưu…' : 'Lưu bố cục'}
              </Button>
            </>
          ) : (
            <>
              {canEditPage ? (
                <Button variant="outline" onClick={() => setEditing(true)}>
                  <Pencil className="size-4" /> Chỉnh sửa
                </Button>
              ) : null}
              <Button variant="outline" onClick={() => void makePersonalCopy()} title="Nhân bản thành trang riêng của tôi để tuỳ biến">
                <Copy className="size-4" /> Nhân bản
              </Button>
              {canEditPage ? (
                <Button
                  variant="outline"
                  title={page.isDefault ? 'Bỏ mặc định' : 'Đặt làm mặc định'}
                  onClick={async () => {
                    await studioApi.setDefault(page.id, !page.isDefault);
                    await queryClient.invalidateQueries({ queryKey: ['studio'] });
                  }}
                >
                  {page.isDefault ? <StarOff className="size-4" /> : <Star className="size-4" />}
                  {page.isDefault ? 'Bỏ mặc định' : 'Mặc định'}
                </Button>
              ) : null}
              {canEditPage ? (
                <Button variant="outline" onClick={() => setRenameOpen(true)}>Thông tin trang</Button>
              ) : null}
              {canEditPage && allowDelete ? (
                <Button
                  variant="danger"
                  onClick={async () => {
                    if (!window.confirm(`Xoá trang "${page.name}"?`)) return;
                    try {
                      await studioApi.removePage(page.id);
                      await queryClient.invalidateQueries({ queryKey: ['studio'] });
                      router.refresh();
                    } catch (e) {
                      alert(e instanceof Error ? e.message : 'Xoá thất bại');
                    }
                  }}
                >
                  <Trash2 className="size-4" />
                </Button>
              ) : null}
            </>
          )
        ) : null}
      </div>

      {error ? (
        <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</div>
      ) : null}

      {/* Canvas */}
      <StudioCanvas
        widgets={editing ? draft : (page?.layout?.widgets ?? [])}
        editing={editing}
        onChange={setDraft}
        onConfig={(w) => setConfigWidget(w)}
      />

      {/* Hộp thoại cấu hình ô */}
      {configWidget ? (
        <WidgetConfigDialog
          open
          widget={configWidget}
          sources={sources}
          vocabulary={vocabulary}
          onClose={() => setConfigWidget(null)}
          onSave={(saved) => {
            setDraft((d) => d.map((w) => (w.id === saved.id ? saved : w)));
            setConfigWidget(null);
          }}
        />
      ) : null}

      <SubscriptionsDialog open={subsOpen} onClose={() => setSubsOpen(false)} page={page} />

      {/* Đổi tên/mô tả */}
      <RenameDialog
        open={renameOpen}
        page={page}
        onClose={() => setRenameOpen(false)}
        onSaved={async () => {
          await queryClient.invalidateQueries({ queryKey: ['studio'] });
          setRenameOpen(false);
        }}
      />
    </div>
  );
}

function RenameDialog({ open, page, onClose, onSaved }: { open: boolean; page: StudioPage; onClose: () => void; onSaved: () => void }) {
  const user = useAuth((s) => s.user);
  const isAdmin = !!user?.isSuperAdmin || (user?.roles ?? []).includes('ADMIN');
  const [name, setName] = useState(page.name);
  const [description, setDescription] = useState(page.description);
  const [scope, setScope] = useState<StudioPage['scope']>(page.scope);
  const [roleCode, setRoleCode] = useState(page.roleCode);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const roles = useQuery({
    queryKey: ['roles', 'for-studio'],
    queryFn: () => apiFetch<{ items: { code: string; name: string }[] }>('/roles?pageSize=100'),
    enabled: open && isAdmin,
    staleTime: 5 * 60_000,
  });

  useEffect(() => {
    if (open) {
      setName(page.name);
      setDescription(page.description);
      setScope(page.scope);
      setRoleCode(page.roleCode);
      setError('');
    }
  }, [open, page]);

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Thông tin trang"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Huỷ</Button>
          <Button
            disabled={busy || !name.trim() || (scope === 'ROLE' && !roleCode)}
            onClick={async () => {
              setBusy(true);
              setError('');
              try {
                await studioApi.updatePage(page.id, {
                  name: name.trim(),
                  description,
                  ...(isAdmin && scope !== page.scope ? { scope, roleCode } : {}),
                });
                onSaved();
              } catch (e) {
                setError(e instanceof Error ? e.message : 'Lưu thất bại');
              } finally {
                setBusy(false);
              }
            }}
          >
            Lưu
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        {error ? (
          <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</div>
        ) : null}
        <div>
          <Label>Tên trang</Label>
          <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={120} />
        </div>
        <div>
          <Label>Mô tả</Label>
          <Input value={description} onChange={(e) => setDescription(e.target.value)} maxLength={300} />
        </div>
        {isAdmin ? (
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Phạm vi chia sẻ</Label>
              <Select value={scope} onChange={(e) => setScope(e.target.value as StudioPage['scope'])}>
                <option value="PERSONAL">Cá nhân (riêng tôi)</option>
                <option value="ROLE">Theo vai trò</option>
                <option value="SYSTEM">Hệ thống (toàn bộ)</option>
              </Select>
            </div>
            {scope === 'ROLE' ? (
              <div>
                <Label>Vai trò</Label>
                <Select value={roleCode} onChange={(e) => setRoleCode(e.target.value)}>
                  <option value="">— chọn vai trò —</option>
                  {(roles.data?.items ?? []).map((r) => (
                    <option key={r.code} value={r.code}>{r.name}</option>
                  ))}
                </Select>
              </div>
            ) : <div />}
          </div>
        ) : null}
        {isAdmin && scope !== page.scope ? (
          <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
            Đổi phạm vi sẽ {scope === 'PERSONAL' ? 'gán trang về riêng bạn' : 'gỡ quyền sở hữu cá nhân'} — mọi người trong phạm vi mới sẽ thấy trang này.
          </div>
        ) : null}
      </div>
    </Dialog>
  );
}
