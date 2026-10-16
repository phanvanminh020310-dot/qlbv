'use client';

/**
 * Studio — canvas lưới 12 cột.
 *  - Xem: hiển thị các ô theo bố cục.
 *  - Chỉnh sửa: kéo-thả đổi vị trí (kéo từ tay cầm ⠿), đổi rộng [−]/[+],
 *    đổi cao S/M/L, cấu hình ⚙, nhân bản ⧉, xoá ✕.
 */
import { useState, type CSSProperties, type DragEvent } from 'react';
import {
  Copy,
  GripVertical,
  Minus,
  Plus,
  Settings2,
  Trash2,
} from 'lucide-react';
import type { StudioDataSpec, StudioWidget } from '@/lib/studio';
import { WidgetBody, WIDGET_HEIGHTS } from './widget-view';
import { buildDrilldownSpec, describeDrilldown, type DrillPoint } from './drilldown-shared';
import { DrilldownDialog } from './drilldown-dialog';

interface StudioCanvasProps {
  widgets: StudioWidget[];
  editing: boolean;
  onChange?: (widgets: StudioWidget[]) => void;
  onConfig?: (widget: StudioWidget) => void;
}

/** Di chuyển phần tử từ vị trí from → chèn trước vị trí to */
export function moveItem<T>(list: T[], from: number, to: number): T[] {
  const next = [...list];
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item);
  return next;
}

export function StudioCanvas({ widgets, editing, onChange, onConfig }: StudioCanvasProps) {
  const [dragId, setDragId] = useState<string | null>(null);
  const [dropId, setDropId] = useState<string | null>(null);
  /** Drill-down: spec records + widget nguồn (chỉ dùng ở chế độ xem) */
  const [drill, setDrill] = useState<{ spec: StudioDataSpec; title: string; desc: string } | null>(null);

  const patch = (id: string, changes: Partial<StudioWidget>) => {
    onChange?.(widgets.map((w) => (w.id === id ? { ...w, ...changes } : w)));
  };

  const handleDragStart = (event: DragEvent, id: string) => {
    setDragId(id);
    event.dataTransfer.effectAllowed = 'move';
    // Firefox đòi setData mới kích hoạt kéo
    event.dataTransfer.setData('text/plain', id);
  };

  const handleDrop = (event: DragEvent, targetId: string) => {
    event.preventDefault();
    if (dragId && dragId !== targetId) {
      const from = widgets.findIndex((w) => w.id === dragId);
      const to = widgets.findIndex((w) => w.id === targetId);
      if (from >= 0 && to >= 0) onChange?.(moveItem(widgets, from, to));
    }
    setDragId(null);
    setDropId(null);
  };

  if (!widgets.length) {
    return (
      <div className="flex h-40 items-center justify-center rounded-[var(--radius-card)] border border-dashed text-sm text-[var(--muted-foreground)]">
        {editing ? 'Trang trống — bấm "Thêm ô" để bắt đầu thiết kế' : 'Trang chưa có ô nào'}
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-12" data-testid="studio-canvas">
      {widgets.map((widget) => {
        const height = WIDGET_HEIGHTS[widget.h] ?? WIDGET_HEIGHTS.M;
        const showHeader = widget.type !== 'kpi' && widget.type !== 'text';
        const isDropTarget = dropId === widget.id && dragId !== widget.id;
        return (
          <div
            key={widget.id}
            data-widget-id={widget.id}
            className="col-span-1 min-w-0 sm:[grid-column:span_var(--studio-span)_/_span_var(--studio-span)]"
            style={{ '--studio-span': widget.w } as CSSProperties}
            onDragOver={(e) => {
              if (!editing || !dragId) return;
              e.preventDefault();
              setDropId(widget.id);
            }}
            onDragLeave={() => setDropId((cur) => (cur === widget.id ? null : cur))}
            onDrop={(e) => handleDrop(e, widget.id)}
          >
            <div
              className={`flex flex-col overflow-hidden rounded-[var(--radius-card)] border bg-[var(--card)] shadow-sm transition-shadow ${
                isDropTarget ? 'ring-2 ring-[var(--primary)]' : ''
              } ${editing ? 'border-dashed' : ''}`}
              style={{ height }}
            >
              {/* Header: tiêu đề + nhóm nút chỉnh sửa */}
              {showHeader || editing ? (
                <div className="flex items-center justify-between gap-1 border-b px-2 py-1.5">
                  <div className="flex min-w-0 items-center gap-1">
                    {editing ? (
                      <span
                        draggable
                        onDragStart={(e) => handleDragStart(e, widget.id)}
                        onDragEnd={() => { setDragId(null); setDropId(null); }}
                        className="cursor-grab rounded p-0.5 text-[var(--muted-foreground)] hover:bg-[var(--accent)] active:cursor-grabbing"
                        title="Kéo để đổi vị trí"
                      >
                        <GripVertical className="size-3.5" />
                      </span>
                    ) : null}
                    <span className="truncate text-sm font-semibold">{widget.title || '—'}</span>
                  </div>
                  {editing ? (
                    <div className="flex shrink-0 items-center gap-0.5">
                      <button
                        type="button"
                        title="Thu hẹp 1 cột"
                        className="rounded p-1 hover:bg-[var(--accent)]"
                        onClick={() => patch(widget.id, { w: Math.max(2, widget.w - 1) })}
                        disabled={widget.w <= 2}
                      >
                        <Minus className="size-3" />
                      </button>
                      <span className="w-7 text-center text-[10px] tabular-nums text-[var(--muted-foreground)]">{widget.w}/12</span>
                      <button
                        type="button"
                        title="Mở rộng 1 cột"
                        className="rounded p-1 hover:bg-[var(--accent)]"
                        onClick={() => patch(widget.id, { w: Math.min(12, widget.w + 1) })}
                        disabled={widget.w >= 12}
                      >
                        <Plus className="size-3" />
                      </button>
                      <select
                        title="Chiều cao"
                        className="rounded border bg-transparent px-1 py-0.5 text-[10px]"
                        value={widget.h}
                        onChange={(e) => patch(widget.id, { h: e.target.value as StudioWidget['h'] })}
                      >
                        <option value="S">Thấp</option>
                        <option value="M">Vừa</option>
                        <option value="L">Cao</option>
                      </select>
                      <button
                        type="button"
                        title="Cấu hình ô"
                        className="rounded p-1 hover:bg-[var(--accent)]"
                        onClick={() => onConfig?.(widget)}
                      >
                        <Settings2 className="size-3.5" />
                      </button>
                      <button
                        type="button"
                        title="Nhân bản ô"
                        className="rounded p-1 hover:bg-[var(--accent)]"
                        onClick={() => {
                          const copy: StudioWidget = {
                            ...widget,
                            id: `w${Math.random().toString(36).slice(2, 10)}`,
                            title: `${widget.title} (sao)`,
                          };
                          const idx = widgets.findIndex((w) => w.id === widget.id);
                          const next = [...widgets];
                          next.splice(idx + 1, 0, copy);
                          onChange?.(next);
                        }}
                      >
                        <Copy className="size-3.5" />
                      </button>
                      <button
                        type="button"
                        title="Xoá ô"
                        className="rounded p-1 text-rose-500 hover:bg-rose-50"
                        onClick={() => onChange?.(widgets.filter((w) => w.id !== widget.id))}
                      >
                        <Trash2 className="size-3.5" />
                      </button>
                    </div>
                  ) : null}
                </div>
              ) : null}
              <div className="min-h-0 flex-1 p-3">
                <WidgetBody
                  widget={widget}
                  onDrill={
                    !editing && widget.dataSpec?.source && widget.type !== 'text' && widget.type !== 'builtin'
                      ? (point: DrillPoint) => {
                          const ds = buildDrilldownSpec(widget.dataSpec as StudioDataSpec, point);
                          if (ds) setDrill({ spec: ds, title: widget.title || 'ô dữ liệu', desc: describeDrilldown(point) });
                        }
                      : undefined
                  }
                />
              </div>
            </div>
          </div>
        );
      })}
      <DrilldownDialog
        open={!!drill}
        onClose={() => setDrill(null)}
        title={`Bản ghi gốc — ${drill?.title ?? ''}`}
        description={drill?.desc || 'Theo bộ lọc của ô'}
        spec={drill?.spec ?? null}
      />
    </div>
  );
}
