'use client';

/**
 * TRÌNH THIẾT KẾ BẢN IN — giao diện toàn màn hình kiểu phần mềm thương mại:
 *
 *  ┌ Thanh tiêu đề: tên mẫu · Thông tin mẫu · Font chữ · Xem trước PDF · Lưu · Đóng ──────────────┐
 *  ├ Ribbon: Trang chủ (clipboard, định dạng chữ) · Chèn · Bố trí (căn/phân phối/lớp) · Trang · Xem ┤
 *  ├ Trái: Hộp công cụ | Trường dữ liệu | Đối tượng | Trang | JSON ── Giữa: khung vẽ ── Phải: thuộc tính ┤
 *  └ Thanh trạng thái: trang · khổ giấy · toạ độ con trỏ · đối tượng chọn · thu phóng ─────────────┘
 *
 * Phím tắt: Ctrl+Z/Y, Ctrl+C/X/V/D, Ctrl+A, Del, mũi tên (Shift ×10, Alt ×0.1), Ctrl+S, Ctrl+P,
 * Ctrl+±/0, Ctrl+L (khoá), Ctrl+]/[ (lớp), F1 (trợ giúp). Nhấp đúp để sửa chữ trực tiếp.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  AlignCenter,
  AlignCenterHorizontal,
  AlignCenterVertical,
  AlignEndHorizontal,
  AlignEndVertical,
  AlignHorizontalDistributeCenter,
  AlignJustify,
  AlignLeft,
  AlignRight,
  AlignStartHorizontal,
  AlignStartVertical,
  AlignVerticalDistributeCenter,
  AlignVerticalJustifyCenter,
  AlignVerticalJustifyEnd,
  AlignVerticalJustifyStart,
  ArrowDown,
  ArrowUp,
  Barcode,
  Bold,
  Braces,
  BringToFront,
  CalendarClock,
  ChevronDown,
  ChevronUp,
  ClipboardPaste,
  Copy,
  CopyPlus,
  Database,
  Expand,
  Eye,
  EyeOff,
  FileSearch,
  Files,
  Grid3x3,
  Hash,
  Image as ImageIcon,
  Info,
  Italic,
  Keyboard,
  Layers,
  Lock,
  Magnet,
  Minus,
  PenLine,
  Plus,
  QrCode,
  Redo2,
  Repeat,
  Ruler,
  Save,
  Scissors,
  Search,
  SendToBack,
  Settings2,
  Shrink,
  Square,
  StretchHorizontal,
  StretchVertical,
  Strikethrough,
  Table2,
  Trash2,
  Type,
  Underline,
  Undo2,
  Unlock,
  X,
  ZoomIn,
  ZoomOut,
  Crosshair,
  CaseSensitive,
} from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { DesignerCanvas, DND_MIME, type CanvasElement } from './designer-canvas';
import { DesignerInspector } from './designer-inspector';
import { FontManager } from './font-manager';
import { cssFontFamily, usePrintFonts } from './print-fonts';
import { buildSampleData } from './print-format';
import { PreviewDialog } from './preview-dialog';
import {
  DEFAULT_FONT,
  ELEMENT_TYPES,
  FALLBACK_VARIABLES,
  PAPER_SIZES_MM,
  canonicalFont,
  emptyDocument,
  nextId,
  normalizeDocument,
  paperDimensions,
  type ElementStyle,
  type PrintDocument,
  type PrintElement,
  type PrintPage,
} from './print-types';

interface DesignerProps {
  document: PrintDocument;
  readOnly?: boolean;
  /** Trả về Promise để trình thiết kế chỉ xoá cờ “chưa lưu” khi lưu thành công */
  onSave: (document: PrintDocument) => void | Promise<unknown>;
  /** Có thay đổi ngoài thiết kế (vd thông tin mẫu) chưa lưu */
  extraDirty?: boolean;
  saving?: boolean;
  extraActions?: ReactNode;
  /** Tên mẫu hiển thị trên thanh tiêu đề */
  title?: string;
  subtitle?: string;
  /** Đóng trình thiết kế (về danh sách) */
  onClose?: () => void;
  /** Nội dung hộp thoại “Thông tin mẫu” (mã, tên, loại chứng từ…) */
  infoPanel?: ReactNode;
  /** Điều khiển hộp “Thông tin mẫu” từ bên ngoài (vd mở khi thiếu mã/tên) */
  infoOpen?: boolean;
  setInfoOpen?: (open: boolean) => void;
  canManageFonts?: boolean;
}

type LeftTab = 'tools' | 'fields' | 'layers' | 'pages' | 'json';
type RibbonTab = 'home' | 'insert' | 'arrange' | 'page' | 'view';

const BASE_PX_PER_MM = 96 / 25.4;
const CLIPBOARD_KEY = 'qlbs.print.clipboard';

const TYPE_ICON: Record<string, ReactNode> = {
  text: <Type />,
  field: <Database />,
  table: <Table2 />,
  line: <Minus />,
  rect: <Square />,
  image: <ImageIcon />,
  qrcode: <QrCode />,
  barcode: <Barcode />,
  signature: <PenLine />,
  datetime: <CalendarClock />,
  pageNumber: <Hash />,
};

const TYPE_NAME: Record<string, string> = Object.fromEntries(ELEMENT_TYPES.map((t) => [t.type, t.label]));

const SYSTEM_FIELDS = [
  { key: 'system.date', label: 'Ngày in (dd/MM/yyyy)', type: 'text', group: 'Hệ thống' },
  { key: 'system.datetime', label: 'Ngày giờ in', type: 'text', group: 'Hệ thống' },
  { key: 'system.day', label: 'Ngày', type: 'text', group: 'Hệ thống' },
  { key: 'system.month', label: 'Tháng', type: 'text', group: 'Hệ thống' },
  { key: 'system.year', label: 'Năm', type: 'text', group: 'Hệ thống' },
  { key: 'system.page', label: 'Trang hiện tại', type: 'text', group: 'Hệ thống' },
  { key: 'system.pages', label: 'Tổng số trang', type: 'text', group: 'Hệ thống' },
];

const FONT_SIZES = [7, 8, 9, 10, 10.5, 11, 12, 13, 14, 15, 16, 18, 20, 22, 24, 26, 28, 32, 36, 48, 60, 72];

const MARGIN_PRESETS = [
  { label: 'Văn bản hành chính (T20 D20 T30 P15)', values: { top: 20, bottom: 20, left: 30, right: 15 } },
  { label: 'Chuẩn (T15 P15 D15 T20)', values: { top: 15, right: 15, bottom: 15, left: 20 } },
  { label: 'Hẹp (10 mm)', values: { top: 10, right: 10, bottom: 10, left: 10 } },
  { label: 'Đóng gáy trái (T35)', values: { top: 15, right: 15, bottom: 15, left: 35 } },
];

function deepMerge(a: Record<string, unknown>, b: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...a };
  for (const [k, v] of Object.entries(b ?? {})) {
    const cur = out[k];
    out[k] =
      v && typeof v === 'object' && !Array.isArray(v) && cur && typeof cur === 'object' && !Array.isArray(cur)
        ? deepMerge(cur as Record<string, unknown>, v as Record<string, unknown>)
        : v;
  }
  return out;
}

function isTyping(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el) return false;
  const tag = el.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable;
}

export function PrintDesigner({
  document: initial,
  readOnly,
  onSave,
  saving,
  extraActions,
  title,
  subtitle,
  onClose,
  infoPanel,
  infoOpen: infoOpenProp,
  setInfoOpen: setInfoOpenProp,
  canManageFonts = true,
  extraDirty = false,
}: DesignerProps) {
  const [doc, setDocState] = useState<PrintDocument>(() => normalizeDocument(initial));
  const docRef = useRef(doc);
  const committed = useRef(doc);
  const history = useRef<PrintDocument[]>([]);
  const future = useRef<PrintDocument[]>([]);
  const [, bump] = useState(0);
  const [dirty, setDirty] = useState(false);

  const [pageIndex, setPageIndex] = useState(0);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [zoom, setZoom] = useState(1);
  const [ribbon, setRibbon] = useState<RibbonTab>('home');
  const [leftTab, setLeftTab] = useState<LeftTab>('tools');
  const [showRulers, setShowRulers] = useState(true);
  const [smartGuides, setSmartGuides] = useState(true);
  const [showData, setShowData] = useState(false);
  const [showLeft, setShowLeft] = useState(true);
  const [showRight, setShowRight] = useState(true);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [cursor, setCursor] = useState<{ x: number; y: number } | null>(null);
  const [menu, setMenu] = useState<{ x: number; y: number; id: string | null } | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [fontsOpen, setFontsOpen] = useState(false);
  const [infoOpenLocal, setInfoOpenLocal] = useState(false);
  const infoOpen = infoOpenProp ?? infoOpenLocal;
  const setInfoOpen = setInfoOpenProp ?? setInfoOpenLocal;
  const [helpOpen, setHelpOpen] = useState(false);
  const [previewData, setPreviewData] = useState<string>(() => JSON.stringify(buildSampleData(normalizeDocument(initial)), null, 2));
  const [jsonText, setJsonText] = useState('');
  const [fieldQuery, setFieldQuery] = useState('');
  const [withLabel, setWithLabel] = useState(true);
  const [viewport, setViewport] = useState<{ width: number; height: number } | null>(null);
  const fitted = useRef(false);

  /* ------------------------------------------------------------ Trạng thái */

  const setDoc = (next: PrintDocument) => {
    docRef.current = next;
    setDocState(next);
  };

  useEffect(() => {
    const n = normalizeDocument(initial);
    docRef.current = n;
    committed.current = n;
    history.current = [];
    future.current = [];
    setDocState(n);
    setDirty(false);
    setSelectedIds([]);
    setPageIndex(0);
  }, [initial]);

  /** Thay đổi có ghi lịch sử (hoàn tác được) */
  const apply = useCallback((next: PrintDocument) => {
    if (committed.current !== docRef.current) history.current.push(committed.current);
    history.current.push(docRef.current);
    history.current = history.current.slice(-80);
    future.current = [];
    committed.current = next;
    setDoc(next);
    setDirty(true);
    bump((v) => v + 1);
  }, []);

  /** Thay đổi tạm thời khi kéo/gõ (chưa ghi lịch sử — chốt bằng commit) */
  const live = useCallback((next: PrintDocument) => {
    setDoc(next);
    setDirty(true);
  }, []);

  const commit = useCallback(() => {
    if (committed.current === docRef.current) return;
    history.current.push(committed.current);
    history.current = history.current.slice(-80);
    future.current = [];
    committed.current = docRef.current;
    bump((v) => v + 1);
  }, []);

  const undo = useCallback(() => {
    commit();
    const prev = history.current.pop();
    if (!prev) return;
    future.current.push(docRef.current);
    committed.current = prev;
    setDoc(prev);
    setDirty(true);
    bump((v) => v + 1);
  }, [commit]);

  const redo = useCallback(() => {
    const next = future.current.pop();
    if (!next) return;
    history.current.push(docRef.current);
    committed.current = next;
    setDoc(next);
    setDirty(true);
    bump((v) => v + 1);
  }, []);

  const pages: PrintPage[] = doc.pages?.length ? doc.pages : [{ id: 'page1', name: 'Trang 1', elements: [] }];
  const pIdx = Math.min(pageIndex, pages.length - 1);
  const page = pages[pIdx];
  const dims = paperDimensions({ paperSize: page.paperSize ?? doc.paperSize, orientation: page.orientation ?? doc.orientation, customSize: doc.customSize });
  const margins = page.margins ?? doc.margins;

  const canvasElements: CanvasElement[] = useMemo(
    () => [
      ...(page.elements ?? []),
      ...(doc.header?.elements ?? []).map((e) => ({ ...e, __band: 'header' as const })),
      ...(doc.footer?.elements ?? []).map((e) => ({ ...e, __band: 'footer' as const })),
    ],
    [page, doc.header, doc.footer],
  );
  const byId = useMemo(() => Object.fromEntries(canvasElements.map((e) => [e.id, e])), [canvasElements]);
  const selected = selectedIds.map((id) => byId[id]).filter(Boolean) as CanvasElement[];
  const primary = selected[0] ?? null;

  const usedFonts = useMemo(() => {
    const s = new Set<string>([canonicalFont(doc.defaultStyle?.fontFamily)]);
    canvasElements.forEach((e) => {
      if (e.style?.fontFamily) s.add(canonicalFont(e.style.fontFamily));
    });
    return Array.from(s);
  }, [canvasElements, doc.defaultStyle?.fontFamily]);
  const fonts = usePrintFonts(usedFonts);

  const sampleData = useMemo(() => {
    if (!showData) return null;
    // Dữ liệu tự sinh theo thiết kế hiện tại, ghi đè bằng JSON người dùng nhập (nếu hợp lệ)
    const base = buildSampleData(doc);
    try {
      return deepMerge(base, JSON.parse(previewData) as Record<string, unknown>);
    } catch {
      return base;
    }
  }, [showData, previewData, doc]);

  /** Áp dụng hàm biến đổi cho các phần tử (trang hiện tại + tiêu đề/chân trang) */
  const mapElements = (base: PrintDocument, ids: Set<string>, fn: (el: PrintElement) => PrintElement | null): PrintDocument => {
    const mapList = (list: PrintElement[] = []) =>
      list.flatMap((el) => {
        if (!ids.has(el.id)) return [el];
        const r = fn(el);
        return r ? [r] : [];
      });
    const basePages = base.pages?.length ? base.pages : pages;
    return {
      ...base,
      pages: basePages.map((p, i) => (i === pIdx ? { ...p, elements: mapList(p.elements) } : p)),
      header: base.header ? { ...base.header, elements: mapList(base.header.elements) } : base.header,
      footer: base.footer ? { ...base.footer, elements: mapList(base.footer.elements) } : base.footer,
    };
  };

  const patchElements = (patches: Record<string, Partial<PrintElement>>, record = false) => {
    const next = mapElements(docRef.current, new Set(Object.keys(patches)), (el) => ({ ...el, ...patches[el.id] }));
    if (record) apply(next);
    else live(next);
  };

  const updateSelected = (fn: (el: PrintElement) => PrintElement | null, ids = selectedIds) => {
    if (!ids.length) return;
    apply(mapElements(docRef.current, new Set(ids), fn));
  };

  const setStyleAll = (patch: Partial<ElementStyle>) => {
    if (!selectedIds.length) {
      apply({ ...docRef.current, defaultStyle: { ...(docRef.current.defaultStyle ?? {}), ...patch } });
      return;
    }
    updateSelected((el) => ({ ...el, style: { ...(el.style ?? {}), ...patch } }));
  };

  const addToPage = (els: PrintElement[]) => {
    const cur = docRef.current;
    const basePages = cur.pages?.length ? cur.pages : pages;
    apply({ ...cur, pages: basePages.map((p, i) => (i === pIdx ? { ...p, elements: [...p.elements, ...els] } : p)) });
    setSelectedIds(els.map((e) => e.id));
  };

  /* ------------------------------------------------------------ Tạo phần tử */

  const makeOfType = (type: string, x?: number, y?: number): PrintElement | null => {
    const t = ELEMENT_TYPES.find((e) => e.type === type);
    if (!t) return null;
    const el = t.make();
    const maxZ = Math.max(0, ...(page.elements ?? []).map((e) => e.z ?? 0));
    el.z = maxZ + 1;
    if (x !== undefined && y !== undefined) {
      el.x = Math.max(0, Math.min(x, dims.width - el.w));
      el.y = Math.max(0, Math.min(y, dims.height - el.h));
    } else {
      el.x = Math.round(Math.max(margins.left, (dims.width - el.w) / 2));
      el.y = Math.round(Math.max(margins.top, Math.min(dims.height / 3, dims.height - el.h - margins.bottom)));
    }
    if (type === 'table' || type === 'line') el.w = Math.min(el.w, dims.width - margins.left - margins.right);
    return el;
  };

  const makeField = (key: string, label: string, type: string, x?: number, y?: number): PrintElement => {
    const base = {
      x: x ?? margins.left,
      y: y ?? Math.round(dims.height / 3),
      z: Math.max(0, ...(page.elements ?? []).map((e) => e.z ?? 0)) + 1,
      h: 7,
    };
    if (withLabel) {
      return { id: nextId('text'), type: 'text', name: label, ...base, w: 90, text: `${label}: {${key}}`, style: { verticalAlign: 'middle' } };
    }
    return {
      id: nextId('field'),
      type: 'field',
      name: label,
      ...base,
      w: 60,
      binding: { source: 'field', path: key, format: { type: ['date', 'datetime', 'number', 'integer', 'currency', 'percent'].includes(type) ? type : 'text', fallback: '' } },
      style: { verticalAlign: 'middle' },
    };
  };

  const onDropCreate = (payload: string, x: number, y: number) => {
    if (readOnly) return;
    try {
      const p = JSON.parse(payload) as { kind: 'type'; type: string } | { kind: 'field'; key: string; label: string; type: string };
      const el = p.kind === 'type' ? makeOfType(p.type, x, y) : makeField(p.key, p.label, p.type, x, y);
      if (el) addToPage([el]);
    } catch {
      /* bỏ qua */
    }
  };

  /* ------------------------------------------------------------ Clipboard */

  const copySel = () => {
    if (!selected.length) return;
    const data = selected.map(({ __band, ...rest }) => {
      void __band;
      return rest;
    });
    window.localStorage.setItem(CLIPBOARD_KEY, JSON.stringify(data));
    toast.success(`Đã sao chép ${data.length} đối tượng`);
  };
  const removeSel = () => {
    if (!selected.length || readOnly) return;
    const lockedCount = selected.filter((e) => e.locked).length;
    const ids = selected.filter((e) => !e.locked).map((e) => e.id);
    if (!ids.length) {
      toast.error('Đối tượng đang khoá — mở khoá trước khi xoá');
      return;
    }
    updateSelected(() => null, ids);
    setSelectedIds([]);
    if (lockedCount) toast.message(`Bỏ qua ${lockedCount} đối tượng đang khoá`);
  };
  const cutSel = () => {
    copySel();
    removeSel();
  };
  const paste = (offset = 5) => {
    if (readOnly) return;
    try {
      const list = JSON.parse(window.localStorage.getItem(CLIPBOARD_KEY) ?? '[]') as PrintElement[];
      if (!list.length) {
        toast.message('Bộ nhớ tạm trống');
        return;
      }
      const els = list.map((e) => ({ ...e, id: nextId(e.type), x: e.x + offset, y: e.y + offset, locked: false }));
      addToPage(els);
    } catch {
      toast.error('Không dán được');
    }
  };
  const duplicateSel = () => {
    if (!selected.length || readOnly) return;
    addToPage(
      selected.map(({ __band, ...e }) => {
        void __band;
        return { ...e, id: nextId(e.type), x: e.x + 5, y: e.y + 5, locked: false };
      }),
    );
  };

  /* ------------------------------------------------------------ Bố trí */

  const vy = (el: PrintElement) => (el.anchor === 'footer' && el.y < 0 ? dims.height + el.y : el.y);
  const sy = (el: PrintElement, y: number) => (el.anchor === 'footer' && el.y < 0 ? y - dims.height : y);
  const r1 = (v: number) => Math.round(v * 10) / 10;

  const alignSel = (kind: 'left' | 'hcenter' | 'right' | 'top' | 'vcenter' | 'bottom') => {
    const els = selected.filter((e) => !e.locked);
    if (!els.length) return;
    const area =
      els.length === 1
        ? { x: margins.left, y: margins.top, w: dims.width - margins.left - margins.right, h: dims.height - margins.top - margins.bottom }
        : (() => {
            const x = Math.min(...els.map((e) => e.x));
            const y = Math.min(...els.map((e) => vy(e)));
            return { x, y, w: Math.max(...els.map((e) => e.x + e.w)) - x, h: Math.max(...els.map((e) => vy(e) + e.h)) - y };
          })();
    const patches: Record<string, Partial<PrintElement>> = {};
    els.forEach((e) => {
      if (kind === 'left') patches[e.id] = { x: r1(area.x) };
      if (kind === 'hcenter') patches[e.id] = { x: r1(area.x + (area.w - e.w) / 2) };
      if (kind === 'right') patches[e.id] = { x: r1(area.x + area.w - e.w) };
      if (kind === 'top') patches[e.id] = { y: r1(sy(e, area.y)) };
      if (kind === 'vcenter') patches[e.id] = { y: r1(sy(e, area.y + (area.h - e.h) / 2)) };
      if (kind === 'bottom') patches[e.id] = { y: r1(sy(e, area.y + area.h - e.h)) };
    });
    patchElements(patches, true);
  };

  const distribute = (axis: 'h' | 'v') => {
    const els = selected.filter((e) => !e.locked);
    if (els.length < 3) {
      toast.message('Chọn ít nhất 3 đối tượng để phân phối đều');
      return;
    }
    const sorted = [...els].sort((a, b) => (axis === 'h' ? a.x - b.x : vy(a) - vy(b)));
    const start = axis === 'h' ? sorted[0].x : vy(sorted[0]);
    const last = sorted[sorted.length - 1];
    const end = axis === 'h' ? last.x + last.w : vy(last) + last.h;
    const total = sorted.reduce((s, e) => s + (axis === 'h' ? e.w : e.h), 0);
    const gap = (end - start - total) / (sorted.length - 1);
    let cur = start;
    const patches: Record<string, Partial<PrintElement>> = {};
    sorted.forEach((e) => {
      patches[e.id] = axis === 'h' ? { x: r1(cur) } : { y: r1(sy(e, cur)) };
      cur += (axis === 'h' ? e.w : e.h) + gap;
    });
    patchElements(patches, true);
  };

  const sameSize = (what: 'w' | 'h' | 'both') => {
    if (selected.length < 2 || !primary) {
      toast.message('Chọn từ 2 đối tượng — đối tượng chọn đầu tiên làm chuẩn');
      return;
    }
    const patches: Record<string, Partial<PrintElement>> = {};
    selected.slice(1).forEach((e) => {
      if (e.locked) return;
      patches[e.id] = { ...(what !== 'h' ? { w: primary.w } : {}), ...(what !== 'w' ? { h: primary.h } : {}) };
    });
    patchElements(patches, true);
  };

  const zOrder = (kind: 'front' | 'back' | 'up' | 'down') => {
    if (!selected.length) return;
    const zs = canvasElements.map((e) => e.z ?? 0);
    const max = Math.max(0, ...zs);
    const min = Math.min(0, ...zs);
    updateSelected((el) => ({
      ...el,
      z: kind === 'front' ? max + 1 : kind === 'back' ? min - 1 : (el.z ?? 0) + (kind === 'up' ? 1 : -1),
    }));
  };

  const nudge = (dx: number, dy: number) => {
    const patches: Record<string, Partial<PrintElement>> = {};
    selected.forEach((e) => {
      if (!e.locked) patches[e.id] = { x: r1(e.x + dx), y: r1(e.y + dy) };
    });
    if (Object.keys(patches).length) patchElements(patches, true);
  };

  const toggleLock = () => updateSelected((el) => ({ ...el, locked: !primary?.locked }));
  const toggleHidden = () => updateSelected((el) => ({ ...el, meta: { ...(el.meta ?? {}), hidden: primary?.meta?.hidden !== true } }));

  /* ------------------------------------------------------------ Trang */

  const patchDoc = (patch: Partial<PrintDocument>) => apply({ ...docRef.current, ...patch });
  const setPages = (next: PrintPage[], index = pIdx) => {
    apply({ ...docRef.current, pages: next });
    setPageIndex(index);
    setSelectedIds([]);
  };
  const addPage = () => setPages([...pages, { id: nextId('page'), name: `Trang ${pages.length + 1}`, elements: [] }], pages.length);
  const duplicatePage = () => {
    const copy: PrintPage = { ...page, id: nextId('page'), name: `${page.name ?? 'Trang'} (bản sao)`, elements: page.elements.map((e) => ({ ...e, id: nextId(e.type) })) };
    const next = [...pages];
    next.splice(pIdx + 1, 0, copy);
    setPages(next, pIdx + 1);
  };
  const removePage = () => {
    if (pages.length === 1) {
      toast.error('Bản in phải có ít nhất một trang');
      return;
    }
    if (!window.confirm(`Xoá "${page.name ?? `Trang ${pIdx + 1}`}" và toàn bộ ${page.elements.length} đối tượng trên trang?`)) return;
    setPages(pages.filter((_, i) => i !== pIdx), Math.max(0, pIdx - 1));
  };
  const movePage = (dir: -1 | 1) => {
    const j = pIdx + dir;
    if (j < 0 || j >= pages.length) return;
    const next = [...pages];
    [next[pIdx], next[j]] = [next[j], next[pIdx]];
    setPages(next, j);
  };

  /* ------------------------------------------------------------ Thu phóng */

  const fitWidth = useCallback(() => {
    if (!viewport) return;
    setZoom(Math.max(0.25, Math.min(4, +(viewport.width / (dims.width * BASE_PX_PER_MM)).toFixed(3))));
  }, [viewport, dims.width]);
  const fitPage = useCallback(() => {
    if (!viewport) return;
    setZoom(Math.max(0.25, Math.min(4, +Math.min(viewport.width / (dims.width * BASE_PX_PER_MM), viewport.height / (dims.height * BASE_PX_PER_MM)).toFixed(3))));
  }, [viewport, dims.width, dims.height]);

  useEffect(() => {
    if (viewport && !fitted.current) {
      fitted.current = true;
      fitWidth();
    }
  }, [viewport, fitWidth]);

  const openPreview = () => {
    let parsed: Record<string, unknown> = {};
    try {
      parsed = JSON.parse(previewData) as Record<string, unknown>;
    } catch {
      /* JSON hỏng: dùng dữ liệu tự sinh */
    }
    setPreviewData(JSON.stringify(deepMerge(buildSampleData(docRef.current), parsed), null, 2));
    setPreviewOpen(true);
  };

  /* ------------------------------------------------------------ Lưu / đóng */

  const save = () => {
    if (readOnly) return;
    commit();
    const snapshot = docRef.current;
    void Promise.resolve(onSave(snapshot))
      .then(() => {
        if (docRef.current === snapshot) setDirty(false);
      })
      .catch(() => undefined);
  };

  const close = () => {
    if ((dirty || extraDirty) && !window.confirm('Thiết kế có thay đổi chưa lưu. Thoát mà không lưu?')) return;
    if (window.document.fullscreenElement) void window.document.exitFullscreen().catch(() => undefined);
    onClose?.();
  };

  const toggleBrowserFullscreen = () => {
    if (window.document.fullscreenElement) void window.document.exitFullscreen();
    else void window.document.documentElement.requestFullscreen().catch(() => toast.error('Trình duyệt không cho phép toàn màn hình'));
  };

  // Chặn cuộn trang nền + cảnh báo khi rời trang mà chưa lưu
  useEffect(() => {
    const prev = window.document.body.style.overflow;
    window.document.body.style.overflow = 'hidden';
    return () => {
      window.document.body.style.overflow = prev;
    };
  }, []);
  useEffect(() => {
    const h = (e: BeforeUnloadEvent) => {
      if (dirty || extraDirty) {
        e.preventDefault();
        e.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', h);
    return () => window.removeEventListener('beforeunload', h);
  }, [dirty, extraDirty]);

  /* ------------------------------------------------------------ Phím tắt */

  const keyHandler = useRef<(e: KeyboardEvent) => void>(() => undefined);
  keyHandler.current = (e: KeyboardEvent) => {
    if (previewOpen || fontsOpen || infoOpen || helpOpen) return;
    const mod = e.ctrlKey || e.metaKey;
    const k = e.key.toLowerCase();
    if (mod && k === 's') {
      e.preventDefault();
      save();
      return;
    }
    if (mod && k === 'p') {
      e.preventDefault();
      openPreview();
      return;
    }
    if (isTyping(e.target)) return;
    if (mod && (k === '=' || k === '+')) {
      e.preventDefault();
      setZoom((z) => Math.min(4, +(z * 1.2).toFixed(3)));
    } else if (mod && k === '-') {
      e.preventDefault();
      setZoom((z) => Math.max(0.25, +(z / 1.2).toFixed(3)));
    } else if (mod && k === '0') {
      e.preventDefault();
      fitPage();
    } else if (mod && k === 'z' && !e.shiftKey) {
      e.preventDefault();
      undo();
    } else if (mod && (k === 'y' || (k === 'z' && e.shiftKey))) {
      e.preventDefault();
      redo();
    } else if (mod && k === 'c') {
      e.preventDefault();
      copySel();
    } else if (mod && k === 'x') {
      e.preventDefault();
      cutSel();
    } else if (mod && k === 'v') {
      e.preventDefault();
      paste();
    } else if (mod && k === 'd') {
      e.preventDefault();
      duplicateSel();
    } else if (mod && k === 'a') {
      e.preventDefault();
      setSelectedIds(canvasElements.map((x) => x.id));
    } else if (mod && k === 'l') {
      e.preventDefault();
      toggleLock();
    } else if (mod && k === ']') {
      e.preventDefault();
      zOrder(e.shiftKey ? 'front' : 'up');
    } else if (mod && k === '[') {
      e.preventDefault();
      zOrder(e.shiftKey ? 'back' : 'down');
    } else if (mod && k === 'b') {
      e.preventDefault();
      setStyleAll({ bold: !primary?.style?.bold });
    } else if (mod && k === 'i') {
      e.preventDefault();
      setStyleAll({ italic: !primary?.style?.italic });
    } else if (mod && k === 'u') {
      e.preventDefault();
      setStyleAll({ underline: !primary?.style?.underline });
    } else if (k === 'delete' || k === 'backspace') {
      if (selected.length) {
        e.preventDefault();
        removeSel();
      }
    } else if (k === 'escape') {
      setMenu(null);
      setSelectedIds([]);
    } else if (k === 'f1' || (k === '?' && !mod)) {
      e.preventDefault();
      setHelpOpen(true);
    } else if (k === 'f2' || k === 'enter') {
      if (primary && ['text', 'signature', 'rect', 'datetime', 'pageNumber'].includes(primary.type)) {
        e.preventDefault();
        setEditingId(primary.id);
      }
    } else if (k.startsWith('arrow') && selected.length) {
      e.preventDefault();
      const step = e.shiftKey ? 10 : e.altKey ? 0.1 : 1;
      nudge(k === 'arrowleft' ? -step : k === 'arrowright' ? step : 0, k === 'arrowup' ? -step : k === 'arrowdown' ? step : 0);
    }
  };
  useEffect(() => {
    const h = (e: KeyboardEvent) => keyHandler.current(e);
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, []);

  useEffect(() => {
    if (!menu) return;
    const h = () => setMenu(null);
    window.addEventListener('pointerdown', h);
    return () => window.removeEventListener('pointerdown', h);
  }, [menu]);

  /* ------------------------------------------------------------ Giá trị ribbon */

  const st: ElementStyle = { ...(doc.defaultStyle ?? {}), ...(primary?.style ?? {}) };
  const curFont = canonicalFont(st.fontFamily ?? DEFAULT_FONT);
  const curSize = st.fontSize ?? 12;
  const variables = useMemo(() => {
    const list = doc.variables?.length ? doc.variables : FALLBACK_VARIABLES;
    const q = fieldQuery.trim().toLowerCase();
    const all = [...list.map((v) => ({ ...v, group: v.group ?? 'Khác' })), ...SYSTEM_FIELDS];
    const filtered = q ? all.filter((v) => v.key.toLowerCase().includes(q) || v.label.toLowerCase().includes(q)) : all;
    const groups = new Map<string, typeof filtered>();
    filtered.forEach((v) => groups.set(v.group, [...(groups.get(v.group) ?? []), v]));
    return Array.from(groups.entries());
  }, [doc.variables, fieldQuery]);

  const canUndo = history.current.length > 0 || committed.current !== doc;
  const canRedo = future.current.length > 0;
  const hasSel = selected.length > 0;

  /* ------------------------------------------------------------ Giao diện */

  return (
    <div className="app-viewport-fixed fixed inset-x-0 top-0 z-[45] flex flex-col overflow-hidden bg-[var(--background)] text-[var(--foreground)]" data-testid="print-designer">
      {/* Thanh tiêu đề */}
      <div className="flex h-11 shrink-0 items-center gap-2 border-b bg-[var(--card)] px-3">
        <div className="flex size-7 items-center justify-center rounded-md bg-[var(--primary)] text-[var(--primary-foreground)]">
          <Layers className="size-4" />
        </div>
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold leading-tight">{title || 'Thiết kế bản in'}</div>
          <div className="truncate text-[10px] leading-tight text-[var(--muted-foreground)]">{subtitle || 'Trình thiết kế bản in chuyên nghiệp'}</div>
        </div>
        <span className={cn('ml-2 rounded px-1.5 py-0.5 text-[10px] font-medium', dirty || extraDirty ? 'bg-amber-100 text-amber-800' : 'bg-emerald-100 text-emerald-800')}>
          {dirty || extraDirty ? '● Chưa lưu' : '✓ Đã lưu'}
        </span>
        <div className="ml-auto flex items-center gap-1.5">
          {infoPanel ? (
            <Button size="sm" variant="outline" onClick={() => setInfoOpen(true)}>
              <Settings2 /> Thông tin mẫu
            </Button>
          ) : null}
          <Button size="sm" variant="outline" onClick={() => setFontsOpen(true)}>
            <CaseSensitive /> Font chữ
          </Button>
          <Button size="sm" variant="outline" onClick={() => openPreview()} data-testid="btn-preview">
            <FileSearch /> Xem trước PDF
          </Button>
          {extraActions}
          <Button size="sm" onClick={save} disabled={readOnly} loading={saving} data-testid="btn-save">
            <Save /> Lưu
          </Button>
          <Button size="sm" variant="ghost" onClick={toggleBrowserFullscreen} title="Toàn màn hình trình duyệt">
            <Expand />
          </Button>
          {onClose ? (
            <Button size="sm" variant="ghost" onClick={close} title="Đóng trình thiết kế">
              <X />
            </Button>
          ) : null}
        </div>
      </div>

      {/* Ribbon */}
      <div className="shrink-0 border-b bg-[var(--card)]">
        <div className="flex items-end gap-0.5 px-2 pt-1">
          {(
            [
              ['home', 'Trang chủ'],
              ['insert', 'Chèn'],
              ['arrange', 'Bố trí'],
              ['page', 'Trang in'],
              ['view', 'Xem'],
            ] as [RibbonTab, string][]
          ).map(([k, l]) => (
            <button
              key={k}
              type="button"
              onClick={() => setRibbon(k)}
              className={cn(
                'rounded-t-md border border-b-0 px-3 py-1 text-xs font-medium',
                ribbon === k ? 'border-[var(--border)] bg-[var(--background)] text-[var(--primary)]' : 'border-transparent text-[var(--muted-foreground)] hover:text-[var(--foreground)]',
              )}
            >
              {l}
            </button>
          ))}
        </div>
        <div className="flex h-[76px] items-stretch gap-0 overflow-x-auto border-t bg-[var(--background)] px-1 py-1">
          {ribbon === 'home' ? (
            <>
              <Group label="Hoàn tác">
                <Big icon={<Undo2 />} label="Hoàn tác" onClick={undo} disabled={!canUndo} title="Ctrl+Z" />
                <Big icon={<Redo2 />} label="Làm lại" onClick={redo} disabled={!canRedo} title="Ctrl+Y" />
              </Group>
              <Group label="Bộ nhớ tạm">
                <Big icon={<ClipboardPaste />} label="Dán" onClick={() => paste()} disabled={readOnly} title="Ctrl+V" />
                <div className="flex flex-col gap-0.5">
                  <Small icon={<Scissors />} label="Cắt" onClick={cutSel} disabled={!hasSel} title="Ctrl+X" />
                  <Small icon={<Copy />} label="Sao chép" onClick={copySel} disabled={!hasSel} title="Ctrl+C" />
                  <Small icon={<CopyPlus />} label="Nhân bản" onClick={duplicateSel} disabled={!hasSel} title="Ctrl+D" />
                </div>
              </Group>
              <Group label={hasSel ? `Phông chữ (${selected.length} đối tượng)` : 'Phông chữ mặc định của bản in'}>
                <div className="flex flex-col gap-1">
                  <div className="flex gap-1">
                    <select
                      className="h-7 w-44 rounded border bg-[var(--card)] px-1 text-xs"
                      style={{ fontFamily: cssFontFamily(curFont) }}
                      value={curFont}
                      onChange={(e) => setStyleAll({ fontFamily: e.target.value })}
                      data-testid="ribbon-font"
                      title="Font chữ"
                    >
                      {Array.from(new Set([...fonts.families, curFont])).map((f) => (
                        <option key={f} value={f} style={{ fontFamily: cssFontFamily(f) }}>
                          {f}
                        </option>
                      ))}
                    </select>
                    <input
                      list="qlbs-font-sizes"
                      className="h-7 w-14 rounded border bg-[var(--card)] px-1 text-xs"
                      value={curSize}
                      onChange={(e) => {
                        const v = Number(e.target.value);
                        if (v > 0) setStyleAll({ fontSize: v });
                      }}
                      title="Cỡ chữ (pt)"
                    />
                    <datalist id="qlbs-font-sizes">
                      {FONT_SIZES.map((s) => (
                        <option key={s} value={s} />
                      ))}
                    </datalist>
                    <Tool icon={<ChevronUp />} title="Tăng cỡ chữ" onClick={() => setStyleAll({ fontSize: curSize + 1 })} />
                    <Tool icon={<ChevronDown />} title="Giảm cỡ chữ" onClick={() => setStyleAll({ fontSize: Math.max(4, curSize - 1) })} />
                  </div>
                  <div className="flex items-center gap-0.5">
                    <Tool icon={<Bold />} title="Đậm (Ctrl+B)" active={!!st.bold} onClick={() => setStyleAll({ bold: !st.bold })} />
                    <Tool icon={<Italic />} title="Nghiêng (Ctrl+I)" active={!!st.italic} onClick={() => setStyleAll({ italic: !st.italic })} />
                    <Tool icon={<Underline />} title="Gạch chân (Ctrl+U)" active={!!st.underline} onClick={() => setStyleAll({ underline: !st.underline })} />
                    <Tool icon={<Strikethrough />} title="Gạch ngang" active={!!st.strike} onClick={() => setStyleAll({ strike: !st.strike })} />
                    <label className="ml-1 flex items-center gap-0.5 text-[10px]" title="Màu chữ">
                      <span className="font-bold underline decoration-2" style={{ textDecorationColor: st.color ?? '#000' }}>
                        A
                      </span>
                      <input type="color" className="h-6 w-6 cursor-pointer rounded border p-0" value={st.color ?? '#000000'} onChange={(e) => setStyleAll({ color: e.target.value })} />
                    </label>
                    <label className="ml-1 flex items-center gap-0.5 text-[10px]" title="Màu nền">
                      <span className="rounded bg-yellow-200 px-0.5">Nền</span>
                      <input type="color" className="h-6 w-6 cursor-pointer rounded border p-0" value={st.backgroundColor ?? '#ffffff'} onChange={(e) => setStyleAll({ backgroundColor: e.target.value })} />
                    </label>
                    <select
                      className="ml-1 h-6 rounded border bg-[var(--card)] px-1 text-[11px]"
                      value={st.textTransform ?? 'none'}
                      onChange={(e) => setStyleAll({ textTransform: e.target.value as ElementStyle['textTransform'] })}
                      title="Chữ hoa/thường"
                    >
                      <option value="none">Aa</option>
                      <option value="uppercase">AA</option>
                      <option value="lowercase">aa</option>
                      <option value="capitalize">Ab Cd</option>
                    </select>
                  </div>
                </div>
              </Group>
              <Group label="Đoạn văn">
                <div className="flex flex-col gap-1">
                  <div className="flex gap-0.5">
                    <Tool icon={<AlignLeft />} title="Căn trái" active={(st.align ?? 'left') === 'left'} onClick={() => setStyleAll({ align: 'left' })} />
                    <Tool icon={<AlignCenter />} title="Căn giữa" active={st.align === 'center'} onClick={() => setStyleAll({ align: 'center' })} />
                    <Tool icon={<AlignRight />} title="Căn phải" active={st.align === 'right'} onClick={() => setStyleAll({ align: 'right' })} />
                    <Tool icon={<AlignJustify />} title="Căn đều hai bên" active={st.align === 'justify'} onClick={() => setStyleAll({ align: 'justify' })} />
                  </div>
                  <div className="flex gap-0.5">
                    <Tool icon={<AlignVerticalJustifyStart />} title="Căn trên" active={(st.verticalAlign ?? 'top') === 'top'} onClick={() => setStyleAll({ verticalAlign: 'top' })} />
                    <Tool icon={<AlignVerticalJustifyCenter />} title="Căn giữa dọc" active={st.verticalAlign === 'middle'} onClick={() => setStyleAll({ verticalAlign: 'middle' })} />
                    <Tool icon={<AlignVerticalJustifyEnd />} title="Căn dưới" active={st.verticalAlign === 'bottom'} onClick={() => setStyleAll({ verticalAlign: 'bottom' })} />
                    <select
                      className="h-6 rounded border bg-[var(--card)] px-1 text-[11px]"
                      value={String(st.lineHeight ?? 1.35)}
                      onChange={(e) => setStyleAll({ lineHeight: Number(e.target.value) })}
                      title="Giãn dòng"
                    >
                      {[1, 1.15, 1.2, 1.3, 1.35, 1.5, 1.75, 2].map((v) => (
                        <option key={v} value={v}>
                          ↕ {v}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
              </Group>
              <Group label="Khung viền">
                <div className="flex flex-col gap-0.5">
                  <Small
                    icon={<Square />}
                    label="Viền 4 cạnh"
                    disabled={!hasSel}
                    onClick={() => {
                      const b = { width: 0.3, style: 'solid' as const, color: '#000000' };
                      setStyleAll({ border: { top: b, right: b, bottom: b, left: b } });
                    }}
                  />
                  <Small
                    icon={<Minus />}
                    label="Viền dưới"
                    disabled={!hasSel}
                    onClick={() => setStyleAll({ border: { ...(st.border ?? {}), bottom: { width: 0.3, style: 'solid', color: '#000000' } } })}
                  />
                  <Small icon={<X />} label="Bỏ viền" disabled={!hasSel} onClick={() => setStyleAll({ border: {} })} />
                </div>
              </Group>
              <Group label="Sửa">
                <Big icon={<Trash2 />} label="Xoá" onClick={removeSel} disabled={!hasSel || readOnly} title="Delete" danger />
              </Group>
            </>
          ) : null}

          {ribbon === 'insert' ? (
            <>
              <Group label="Đối tượng (bấm để chèn, hoặc kéo thả vào trang)">
                {ELEMENT_TYPES.map((t) => (
                  <Big
                    key={t.type}
                    icon={TYPE_ICON[t.type] ?? <Square />}
                    label={t.label}
                    title={t.hint}
                    disabled={readOnly}
                    draggable
                    onDragStart={(e) => e.dataTransfer.setData(DND_MIME, JSON.stringify({ kind: 'type', type: t.type }))}
                    onClick={() => {
                      const el = makeOfType(t.type);
                      if (el) addToPage([el]);
                    }}
                  />
                ))}
              </Group>
            </>
          ) : null}

          {ribbon === 'arrange' ? (
            <>
              <Group label={selected.length > 1 ? 'Căn theo vùng chọn' : 'Căn theo lề trang'}>
                <div className="grid grid-cols-3 gap-0.5">
                  <Tool icon={<AlignStartVertical />} title="Căn trái" onClick={() => alignSel('left')} disabled={!hasSel} />
                  <Tool icon={<AlignCenterVertical />} title="Căn giữa ngang" onClick={() => alignSel('hcenter')} disabled={!hasSel} />
                  <Tool icon={<AlignEndVertical />} title="Căn phải" onClick={() => alignSel('right')} disabled={!hasSel} />
                  <Tool icon={<AlignStartHorizontal />} title="Căn trên" onClick={() => alignSel('top')} disabled={!hasSel} />
                  <Tool icon={<AlignCenterHorizontal />} title="Căn giữa dọc" onClick={() => alignSel('vcenter')} disabled={!hasSel} />
                  <Tool icon={<AlignEndHorizontal />} title="Căn dưới" onClick={() => alignSel('bottom')} disabled={!hasSel} />
                </div>
              </Group>
              <Group label="Phân phối & kích thước">
                <div className="flex flex-col gap-0.5">
                  <Small icon={<AlignHorizontalDistributeCenter />} label="Giãn đều ngang" onClick={() => distribute('h')} disabled={selected.length < 3} />
                  <Small icon={<AlignVerticalDistributeCenter />} label="Giãn đều dọc" onClick={() => distribute('v')} disabled={selected.length < 3} />
                </div>
                <div className="flex flex-col gap-0.5">
                  <Small icon={<StretchHorizontal />} label="Cùng chiều rộng" onClick={() => sameSize('w')} disabled={selected.length < 2} />
                  <Small icon={<StretchVertical />} label="Cùng chiều cao" onClick={() => sameSize('h')} disabled={selected.length < 2} />
                  <Small icon={<Square />} label="Cùng kích thước" onClick={() => sameSize('both')} disabled={selected.length < 2} />
                </div>
              </Group>
              <Group label="Thứ tự lớp">
                <Big icon={<BringToFront />} label="Lên trên cùng" onClick={() => zOrder('front')} disabled={!hasSel} title="Ctrl+Shift+]" />
                <Big icon={<SendToBack />} label="Xuống dưới cùng" onClick={() => zOrder('back')} disabled={!hasSel} title="Ctrl+Shift+[" />
                <div className="flex flex-col gap-0.5">
                  <Small icon={<ArrowUp />} label="Lên một lớp" onClick={() => zOrder('up')} disabled={!hasSel} />
                  <Small icon={<ArrowDown />} label="Xuống một lớp" onClick={() => zOrder('down')} disabled={!hasSel} />
                </div>
              </Group>
              <Group label="Trạng thái">
                <Big icon={primary?.locked ? <Unlock /> : <Lock />} label={primary?.locked ? 'Mở khoá' : 'Khoá'} onClick={toggleLock} disabled={!hasSel} title="Ctrl+L" />
                <Big icon={primary?.meta?.hidden === true ? <Eye /> : <EyeOff />} label={primary?.meta?.hidden === true ? 'Hiện khi in' : 'Ẩn khi in'} onClick={toggleHidden} disabled={!hasSel} />
                <Big
                  icon={<Repeat />}
                  label="Lặp mọi trang"
                  active={!!primary?.repeatOnEveryPage}
                  onClick={() => updateSelected((el) => ({ ...el, repeatOnEveryPage: !primary?.repeatOnEveryPage }))}
                  disabled={!hasSel}
                />
              </Group>
            </>
          ) : null}

          {ribbon === 'page' ? (
            <>
              <Group label="Khổ giấy">
                <div className="flex flex-col gap-1">
                  <select className="h-7 w-32 rounded border bg-[var(--card)] px-1 text-xs" value={doc.paperSize} onChange={(e) => patchDoc({ paperSize: e.target.value })} data-testid="ribbon-paper">
                    {Object.entries(PAPER_SIZES_MM).map(([k, v]) => (
                      <option key={k} value={k}>
                        {k} ({v.width}×{v.height})
                      </option>
                    ))}
                    <option value="Custom">Tuỳ chỉnh…</option>
                  </select>
                  <div className="flex gap-0.5">
                    <Tool icon={<span className="text-[10px] font-semibold">Dọc</span>} title="Khổ dọc" active={doc.orientation === 'portrait'} onClick={() => patchDoc({ orientation: 'portrait' })} />
                    <Tool icon={<span className="text-[10px] font-semibold">Ngang</span>} title="Khổ ngang" active={doc.orientation === 'landscape'} onClick={() => patchDoc({ orientation: 'landscape' })} />
                  </div>
                </div>
                {doc.paperSize === 'Custom' ? (
                  <div className="flex flex-col gap-1 text-[11px]">
                    <label className="flex items-center gap-1">
                      Rộng
                      <input type="number" className="h-6 w-16 rounded border bg-[var(--card)] px-1" value={doc.customSize?.width ?? 210} onChange={(e) => patchDoc({ customSize: { width: Number(e.target.value), height: doc.customSize?.height ?? 297 } })} />
                    </label>
                    <label className="flex items-center gap-1">
                      Cao&nbsp;
                      <input type="number" className="h-6 w-16 rounded border bg-[var(--card)] px-1" value={doc.customSize?.height ?? 297} onChange={(e) => patchDoc({ customSize: { width: doc.customSize?.width ?? 210, height: Number(e.target.value) } })} />
                    </label>
                  </div>
                ) : null}
              </Group>
              <Group label="Lề trang (mm)">
                <div className="grid grid-cols-2 gap-x-2 gap-y-0.5 text-[11px]">
                  {(['top', 'bottom', 'left', 'right'] as const).map((side) => (
                    <label key={side} className="flex items-center justify-between gap-1">
                      {{ top: 'Trên', bottom: 'Dưới', left: 'Trái', right: 'Phải' }[side]}
                      <input
                        type="number"
                        className="h-6 w-14 rounded border bg-[var(--card)] px-1"
                        value={doc.margins[side]}
                        onChange={(e) => live({ ...docRef.current, margins: { ...docRef.current.margins, [side]: Number(e.target.value) } })}
                        onBlur={commit}
                      />
                    </label>
                  ))}
                </div>
                <select
                  className="h-7 w-40 self-start rounded border bg-[var(--card)] px-1 text-[11px]"
                  value=""
                  onChange={(e) => {
                    const p = MARGIN_PRESETS.find((m) => m.label === e.target.value);
                    if (p) patchDoc({ margins: p.values });
                  }}
                >
                  <option value="">Mẫu lề…</option>
                  {MARGIN_PRESETS.map((m) => (
                    <option key={m.label} value={m.label}>
                      {m.label}
                    </option>
                  ))}
                </select>
              </Group>
              <Group label="Số trang tự động">
                <div className="flex flex-col gap-1 text-[11px]">
                  <label className="flex items-center gap-1">
                    <input type="checkbox" checked={!!doc.pageNumbering?.show} onChange={(e) => patchDoc({ pageNumbering: { position: 'bottom-center', format: 'Trang {page}/{pages}', ...(doc.pageNumbering ?? {}), show: e.target.checked } })} />
                    Hiện số trang
                  </label>
                  <select
                    className="h-6 rounded border bg-[var(--card)] px-1"
                    value={doc.pageNumbering?.position ?? 'bottom-center'}
                    onChange={(e) => patchDoc({ pageNumbering: { show: true, format: 'Trang {page}/{pages}', ...(doc.pageNumbering ?? {}), position: e.target.value } })}
                  >
                    <option value="bottom-center">Giữa chân trang</option>
                    <option value="bottom-right">Phải chân trang</option>
                    <option value="bottom-left">Trái chân trang</option>
                    <option value="top-right">Phải đầu trang</option>
                    <option value="top-left">Trái đầu trang</option>
                  </select>
                  <input
                    className="h-6 w-36 rounded border bg-[var(--card)] px-1"
                    value={doc.pageNumbering?.format ?? 'Trang {page}/{pages}'}
                    onChange={(e) => live({ ...docRef.current, pageNumbering: { show: true, position: 'bottom-center', ...(docRef.current.pageNumbering ?? {}), format: e.target.value } })}
                    onBlur={commit}
                  />
                </div>
              </Group>
              <Group label="Chữ mờ (watermark)">
                <div className="flex flex-col gap-1 text-[11px]">
                  <input
                    className="h-6 w-40 rounded border bg-[var(--card)] px-1"
                    placeholder="BẢN NHÁP / MẬT…"
                    value={doc.watermark?.text ?? ''}
                    onChange={(e) => live({ ...docRef.current, watermark: { opacity: 0.08, fontSize: 60, rotation: 45, ...(docRef.current.watermark ?? {}), text: e.target.value } })}
                    onBlur={commit}
                  />
                  <div className="flex items-center gap-1">
                    Mờ
                    <input
                      type="range"
                      min={0.02}
                      max={0.5}
                      step={0.02}
                      value={doc.watermark?.opacity ?? 0.08}
                      onChange={(e) => live({ ...docRef.current, watermark: { ...(docRef.current.watermark ?? {}), opacity: Number(e.target.value) } })}
                      onPointerUp={commit}
                    />
                  </div>
                  <div className="flex items-center gap-1">
                    Góc
                    <input
                      type="number"
                      className="h-6 w-14 rounded border bg-[var(--card)] px-1"
                      value={doc.watermark?.rotation ?? 45}
                      onChange={(e) => live({ ...docRef.current, watermark: { ...(docRef.current.watermark ?? {}), rotation: Number(e.target.value) } })}
                      onBlur={commit}
                    />
                    Cỡ
                    <input
                      type="number"
                      className="h-6 w-14 rounded border bg-[var(--card)] px-1"
                      value={doc.watermark?.fontSize ?? 60}
                      onChange={(e) => live({ ...docRef.current, watermark: { ...(docRef.current.watermark ?? {}), fontSize: Number(e.target.value) } })}
                      onBlur={commit}
                    />
                  </div>
                </div>
              </Group>
              <Group label="Trang thiết kế">
                <Big icon={<Plus />} label="Thêm trang" onClick={addPage} disabled={readOnly} />
                <Big icon={<Files />} label="Nhân bản trang" onClick={duplicatePage} disabled={readOnly} />
                <Big icon={<Trash2 />} label="Xoá trang" onClick={removePage} disabled={readOnly || pages.length < 2} danger />
              </Group>
            </>
          ) : null}

          {ribbon === 'view' ? (
            <>
              <Group label="Thu phóng">
                <Big icon={<ZoomIn />} label="Phóng to" onClick={() => setZoom((z) => Math.min(4, +(z * 1.2).toFixed(3)))} title="Ctrl +" />
                <Big icon={<ZoomOut />} label="Thu nhỏ" onClick={() => setZoom((z) => Math.max(0.25, +(z / 1.2).toFixed(3)))} title="Ctrl −" />
                <div className="flex flex-col gap-0.5">
                  <Small icon={<StretchHorizontal />} label="Vừa chiều rộng" onClick={fitWidth} />
                  <Small icon={<Shrink />} label="Vừa trang (Ctrl+0)" onClick={fitPage} />
                  <Small icon={<Crosshair />} label="Kích thước thật 100%" onClick={() => setZoom(1)} />
                </div>
              </Group>
              <Group label="Hiển thị">
                <Big icon={<Grid3x3 />} label="Lưới" active={doc.grid?.show !== false} onClick={() => patchDoc({ grid: { size: 5, snap: true, ...(doc.grid ?? {}), show: doc.grid?.show === false } })} />
                <Big icon={<Magnet />} label="Hít lưới" active={doc.grid?.snap !== false} onClick={() => patchDoc({ grid: { size: 5, show: true, ...(doc.grid ?? {}), snap: doc.grid?.snap === false } })} />
                <Big icon={<Crosshair />} label="Đường gióng" active={smartGuides} onClick={() => setSmartGuides((v) => !v)} title="Tự hít mép/tâm đối tượng khác (giữ Alt để tắt tạm)" />
                <Big icon={<Ruler />} label="Thước đo" active={showRulers} onClick={() => setShowRulers((v) => !v)} />
                <div className="flex flex-col gap-0.5 text-[11px]">
                  <label className="flex items-center gap-1">
                    Ô lưới
                    <select
                      className="h-6 rounded border bg-[var(--card)] px-1"
                      value={doc.grid?.size ?? 5}
                      onChange={(e) => patchDoc({ grid: { show: true, snap: true, ...(doc.grid ?? {}), size: Number(e.target.value) } })}
                    >
                      {[0.5, 1, 2, 2.5, 5, 10].map((v) => (
                        <option key={v} value={v}>
                          {v} mm
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
              </Group>
              <Group label="Dữ liệu">
                <Big icon={<Database />} label={showData ? 'Đang hiện dữ liệu mẫu' : 'Hiện dữ liệu mẫu'} active={showData} onClick={() => setShowData((v) => !v)} title="Khung vẽ hiển thị giá trị thật thay vì {tên trường}" />
              </Group>
              <Group label="Bố cục">
                <Big icon={<Layers />} label="Cột trái" active={showLeft} onClick={() => setShowLeft((v) => !v)} />
                <Big icon={<Settings2 />} label="Thuộc tính" active={showRight} onClick={() => setShowRight((v) => !v)} />
                <Big icon={<Keyboard />} label="Phím tắt" onClick={() => setHelpOpen(true)} title="F1" />
              </Group>
            </>
          ) : null}
        </div>
      </div>

      <div className="flex min-h-0 flex-1">
        {/* Cột trái */}
        {showLeft ? (
          <div className="flex w-64 shrink-0 flex-col border-r bg-[var(--card)]">
            <div className="grid shrink-0 grid-cols-5 border-b">
              {(
                [
                  ['tools', 'Công cụ', <Square key="i" className="size-3.5" />],
                  ['fields', 'Trường', <Database key="i" className="size-3.5" />],
                  ['layers', 'Đối tượng', <Layers key="i" className="size-3.5" />],
                  ['pages', 'Trang', <Files key="i" className="size-3.5" />],
                  ['json', 'JSON', <Braces key="i" className="size-3.5" />],
                ] as [LeftTab, string, ReactNode][]
              ).map(([k, l, icon]) => (
                <button
                  key={k}
                  type="button"
                  onClick={() => {
                    setLeftTab(k);
                    if (k === 'json') setJsonText(JSON.stringify(docRef.current, null, 2));
                  }}
                  className={cn('flex flex-col items-center gap-0.5 border-b-2 py-1.5 text-[10px]', leftTab === k ? 'border-[var(--primary)] text-[var(--primary)]' : 'border-transparent text-[var(--muted-foreground)] hover:text-[var(--foreground)]')}
                >
                  {icon}
                  {l}
                </button>
              ))}
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto p-2">
              {leftTab === 'tools' ? (
                <div className="space-y-2">
                  <p className="text-[11px] text-[var(--muted-foreground)]">Kéo thả vào trang, hoặc bấm để chèn vào giữa trang.</p>
                  <div className="grid grid-cols-2 gap-1.5">
                    {ELEMENT_TYPES.map((t) => (
                      <button
                        key={t.type}
                        type="button"
                        draggable={!readOnly}
                        disabled={readOnly}
                        onDragStart={(e) => e.dataTransfer.setData(DND_MIME, JSON.stringify({ kind: 'type', type: t.type }))}
                        onClick={() => {
                          const el = makeOfType(t.type);
                          if (el) addToPage([el]);
                        }}
                        title={t.hint}
                        data-testid={`tool-${t.type}`}
                        className="flex cursor-grab flex-col items-center gap-1 rounded-lg border bg-[var(--background)] px-1 py-2 text-[11px] transition-colors hover:border-[var(--primary)] hover:bg-[var(--accent)] active:cursor-grabbing disabled:opacity-50 [&_svg]:size-5 [&_svg]:text-[var(--primary)]"
                      >
                        {TYPE_ICON[t.type]}
                        {t.label}
                      </button>
                    ))}
                  </div>
                </div>
              ) : null}

              {leftTab === 'fields' ? (
                <div className="space-y-2">
                  <div className="relative">
                    <Search className="absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-[var(--muted-foreground)]" />
                    <Input className="h-7 pl-7 text-xs" placeholder="Tìm trường dữ liệu…" value={fieldQuery} onChange={(e) => setFieldQuery(e.target.value)} />
                  </div>
                  <label className="flex items-center gap-1.5 text-[11px]">
                    <input type="checkbox" checked={withLabel} onChange={(e) => setWithLabel(e.target.checked)} />
                    Chèn kèm nhãn (vd “Họ tên: …”)
                  </label>
                  {variables.map(([group, items]) => (
                    <div key={group}>
                      <div className="mb-0.5 text-[10px] font-semibold uppercase tracking-wide text-[var(--muted-foreground)]">{group}</div>
                      {items.map((v) => (
                        <div
                          key={v.key}
                          draggable={!readOnly}
                          onDragStart={(e) => e.dataTransfer.setData(DND_MIME, JSON.stringify({ kind: 'field', key: v.key, label: v.label, type: v.type }))}
                          onDoubleClick={() => addToPage([makeField(v.key, v.label, v.type)])}
                          className="flex cursor-grab items-center gap-1.5 rounded px-1.5 py-1 text-xs hover:bg-[var(--accent)]"
                          title={`Kéo vào trang hoặc nhấp đúp để chèn — {${v.key}}`}
                        >
                          <Database className="size-3 shrink-0 text-sky-600" />
                          <span className="min-w-0 flex-1 truncate">{v.label}</span>
                          <span className="max-w-[45%] truncate font-mono text-[9px] text-[var(--muted-foreground)]">{v.key}</span>
                        </div>
                      ))}
                    </div>
                  ))}
                  <p className="text-[10px] text-[var(--muted-foreground)]">
                    Trong ô chữ có thể gõ trực tiếp <code>{'{đường.dẫn}'}</code> để chèn dữ liệu. Danh sách trường lấy từ “variables” của mẫu (sửa ở tab JSON).
                  </p>
                </div>
              ) : null}

              {leftTab === 'layers' ? (
                <div className="space-y-0.5">
                  {canvasElements.length === 0 ? <p className="text-[11px] text-[var(--muted-foreground)]">Trang chưa có đối tượng.</p> : null}
                  {[...canvasElements]
                    .sort((a, b) => (b.z ?? 0) - (a.z ?? 0) || a.y - b.y)
                    .map((el) => (
                      <div
                        key={el.id}
                        onClick={(e) => {
                          if (e.shiftKey || e.ctrlKey || e.metaKey) setSelectedIds(selectedIds.includes(el.id) ? selectedIds.filter((i) => i !== el.id) : [...selectedIds, el.id]);
                          else setSelectedIds([el.id]);
                        }}
                        className={cn('group flex cursor-pointer items-center gap-1.5 rounded px-1.5 py-1 text-xs [&_svg]:size-3.5', selectedIds.includes(el.id) ? 'bg-[var(--primary)] text-[var(--primary-foreground)]' : 'hover:bg-[var(--accent)]')}
                      >
                        <span className="shrink-0 opacity-70">{TYPE_ICON[el.type] ?? <Square />}</span>
                        <span className={cn('min-w-0 flex-1 truncate', el.meta?.hidden === true && 'line-through opacity-60')}>
                          {el.name || TYPE_NAME[el.type] || el.type}
                          {el.__band ? <span className="ml-1 text-[9px] opacity-70">({el.__band === 'header' ? 'đầu trang' : 'chân trang'})</span> : null}
                        </span>
                        <button
                          type="button"
                          title={el.meta?.hidden === true ? 'Hiện khi in' : 'Ẩn khi in'}
                          className="opacity-60 hover:opacity-100"
                          onClick={(e) => {
                            e.stopPropagation();
                            updateSelected((x) => ({ ...x, meta: { ...(x.meta ?? {}), hidden: x.meta?.hidden !== true } }), [el.id]);
                          }}
                        >
                          {el.meta?.hidden === true ? <EyeOff /> : <Eye />}
                        </button>
                        <button
                          type="button"
                          title={el.locked ? 'Mở khoá' : 'Khoá'}
                          className={cn('hover:opacity-100', el.locked ? 'opacity-100' : 'opacity-30')}
                          onClick={(e) => {
                            e.stopPropagation();
                            updateSelected((x) => ({ ...x, locked: !x.locked }), [el.id]);
                          }}
                        >
                          {el.locked ? <Lock /> : <Unlock />}
                        </button>
                      </div>
                    ))}
                </div>
              ) : null}

              {leftTab === 'pages' ? (
                <div className="space-y-1.5">
                  {pages.map((p, i) => (
                    <div
                      key={p.id}
                      onClick={() => {
                        setPageIndex(i);
                        setSelectedIds([]);
                      }}
                      className={cn('cursor-pointer rounded-lg border p-2 text-xs', i === pIdx ? 'border-[var(--primary)] bg-[var(--accent)]' : 'hover:bg-[var(--accent)]/60')}
                    >
                      <div className="flex items-center justify-between">
                        <span className="font-medium">
                          {i + 1}. {p.name ?? `Trang ${i + 1}`}
                        </span>
                        <span className="text-[10px] text-[var(--muted-foreground)]">{p.elements.length} đối tượng</span>
                      </div>
                      {i === pIdx ? (
                        <Input
                          className="mt-1 h-6 text-[11px]"
                          value={p.name ?? ''}
                          onClick={(e) => e.stopPropagation()}
                          onChange={(e) => live({ ...docRef.current, pages: pages.map((x, xi) => (xi === i ? { ...x, name: e.target.value } : x)) })}
                          onBlur={commit}
                        />
                      ) : null}
                    </div>
                  ))}
                  <div className="grid grid-cols-5 gap-1">
                    <Button size="sm" variant="outline" className="col-span-2" onClick={addPage} disabled={readOnly}>
                      <Plus /> Thêm
                    </Button>
                    <Button size="sm" variant="outline" onClick={duplicatePage} title="Nhân bản trang" disabled={readOnly}>
                      <Files />
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => movePage(-1)} title="Lên" disabled={pIdx === 0}>
                      <ArrowUp />
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => movePage(1)} title="Xuống" disabled={pIdx === pages.length - 1}>
                      <ArrowDown />
                    </Button>
                  </div>
                  <Button size="sm" variant="outline" className="w-full text-[var(--danger)]" onClick={removePage} disabled={readOnly || pages.length < 2}>
                    <Trash2 /> Xoá trang đang chọn
                  </Button>
                  <p className="text-[10px] text-[var(--muted-foreground)]">
                    Mỗi trang thiết kế in ra một trang riêng. Bảng dài tự sang trang và lặp tiêu đề; đối tượng nằm dưới bảng tự dời xuống theo.
                  </p>
                </div>
              ) : null}

              {leftTab === 'json' ? (
                <div className="flex h-full flex-col gap-2">
                  <textarea
                    className="min-h-[300px] flex-1 rounded-md border bg-[var(--background)] p-2 font-mono text-[10px]"
                    spellCheck={false}
                    value={jsonText}
                    onChange={(e) => setJsonText(e.target.value)}
                  />
                  <div className="flex flex-wrap gap-1">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        try {
                          apply(normalizeDocument(JSON.parse(jsonText) as PrintDocument));
                          setSelectedIds([]);
                          toast.success('Đã áp dụng JSON');
                        } catch (err) {
                          toast.error(`JSON không hợp lệ: ${(err as Error).message}`);
                        }
                      }}
                    >
                      Áp dụng
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => setJsonText(JSON.stringify(docRef.current, null, 2))}>
                      Làm mới
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        const blob = new Blob([JSON.stringify(docRef.current, null, 2)], { type: 'application/json' });
                        const a = window.document.createElement('a');
                        a.href = URL.createObjectURL(blob);
                        a.download = `${title || 'thiet-ke-ban-in'}.json`;
                        a.click();
                        URL.revokeObjectURL(a.href);
                      }}
                    >
                      Tải tệp
                    </Button>
                    <label className="inline-flex h-8 cursor-pointer items-center rounded-md border px-2 text-xs hover:bg-[var(--accent)]">
                      Nạp tệp
                      <input
                        type="file"
                        accept="application/json,.json"
                        className="hidden"
                        onChange={(e) => {
                          const f = e.target.files?.[0];
                          if (f) void f.text().then((t) => setJsonText(t));
                        }}
                      />
                    </label>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="text-[var(--danger)]"
                      onClick={() => {
                        if (window.confirm('Thay toàn bộ thiết kế bằng mẫu trống?')) {
                          apply(emptyDocument());
                          setSelectedIds([]);
                        }
                      }}
                    >
                      Thiết kế trống
                    </Button>
                  </div>
                </div>
              ) : null}
            </div>
          </div>
        ) : null}

        {/* Khung vẽ */}
        <div className="flex min-w-0 flex-1 flex-col">
          {/* Thẻ trang */}
          <div className="flex h-7 shrink-0 items-center gap-0.5 overflow-x-auto border-b bg-[var(--card)] px-1">
            {pages.map((p, i) => (
              <button
                key={p.id}
                type="button"
                onClick={() => {
                  setPageIndex(i);
                  setSelectedIds([]);
                }}
                className={cn('whitespace-nowrap rounded px-2 py-0.5 text-[11px]', i === pIdx ? 'bg-[var(--primary)] text-[var(--primary-foreground)]' : 'text-[var(--muted-foreground)] hover:bg-[var(--accent)]')}
              >
                {p.name ?? `Trang ${i + 1}`}
              </button>
            ))}
            <button type="button" onClick={addPage} disabled={readOnly} className="rounded px-1.5 text-[var(--muted-foreground)] hover:bg-[var(--accent)]" title="Thêm trang">
              <Plus className="size-3.5" />
            </button>
          </div>
          <DesignerCanvas
            doc={doc}
            pageIndex={pIdx}
            pageCount={pages.length}
            elements={canvasElements}
            selectedIds={selectedIds}
            setSelection={(ids) => {
              setSelectedIds(ids);
              setMenu(null);
            }}
            onPatch={(p) => patchElements(p, false)}
            onCommit={commit}
            zoom={zoom}
            setZoom={setZoom}
            showGrid={doc.grid?.show !== false}
            snap={doc.grid?.snap !== false}
            showRulers={showRulers}
            smartGuides={smartGuides}
            data={sampleData}
            fontsVersion={fonts.version}
            readOnly={readOnly}
            onDropCreate={onDropCreate}
            onContextMenu={(e, id) => setMenu({ x: e.clientX, y: e.clientY, id })}
            onCursor={setCursor}
            editingId={editingId}
            setEditingId={setEditingId}
            onViewport={setViewport}
          />
        </div>

        {/* Cột phải: thuộc tính */}
        {showRight ? (
          <div className="flex w-80 shrink-0 flex-col border-l bg-[var(--card)]">
            <div className="flex h-8 shrink-0 items-center gap-1.5 border-b px-3 text-xs font-semibold">
              <Settings2 className="size-3.5" />
              {selected.length > 1 ? `${selected.length} đối tượng được chọn` : primary ? `Thuộc tính: ${primary.name || TYPE_NAME[primary.type] || primary.type}` : 'Thuộc tính bản in'}
            </div>
            <div className="min-h-0 flex-1">
              {selected.length > 1 ? (
                <div className="space-y-2 p-3 text-xs">
                  <p className="text-[var(--muted-foreground)]">
                    Đang chọn nhiều đối tượng. Dùng ribbon <b>Trang chủ</b> để đổi font/cỡ chữ/đậm/căn lề cho tất cả, hoặc <b>Bố trí</b> để căn thẳng hàng, giãn đều,
                    cùng kích thước. Đối tượng chọn đầu tiên (<b>{primary?.name || primary?.type}</b>) làm chuẩn.
                  </p>
                  <ul className="max-h-60 space-y-0.5 overflow-y-auto">
                    {selected.map((e) => (
                      <li key={e.id} className="flex items-center gap-1.5 rounded bg-[var(--muted)]/50 px-2 py-1 [&_svg]:size-3.5">
                        {TYPE_ICON[e.type]} <span className="truncate">{e.name || e.type}</span>
                        <span className="ml-auto tabular-nums text-[10px] text-[var(--muted-foreground)]">
                          {e.x.toFixed(1)}, {e.y.toFixed(1)}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : (
                <DesignerInspector
                  doc={doc}
                  element={primary}
                  fonts={fonts.families}
                  onChange={(id, patch) => {
                    if (id === '__document__') live({ ...docRef.current, ...(patch as unknown as Partial<PrintDocument>) });
                    else patchElements({ [id]: patch }, false);
                  }}
                  onCommit={commit}
                />
              )}
            </div>
          </div>
        ) : null}
      </div>

      {/* Thanh trạng thái */}
      <div className="flex h-7 shrink-0 items-center gap-3 border-t bg-[var(--card)] px-3 text-[11px] text-[var(--muted-foreground)]">
        <span>
          Trang {pIdx + 1}/{pages.length}
        </span>
        <span>
          {page.paperSize ?? doc.paperSize} · {(page.orientation ?? doc.orientation) === 'landscape' ? 'ngang' : 'dọc'} · {dims.width}×{dims.height} mm
        </span>
        <span className="tabular-nums">{cursor ? `X ${cursor.x.toFixed(1)} · Y ${cursor.y.toFixed(1)} mm` : 'X — · Y —'}</span>
        {primary && selected.length === 1 ? (
          <span className="tabular-nums">
            {primary.name || primary.type}: {primary.x.toFixed(1)}, {primary.y.toFixed(1)} · {primary.w.toFixed(1)}×{primary.h.toFixed(1)} mm
          </span>
        ) : selected.length > 1 ? (
          <span>{selected.length} đối tượng</span>
        ) : null}
        <span>Font mặc định: {canonicalFont(doc.defaultStyle?.fontFamily)}</span>
        <div className="ml-auto flex items-center gap-2">
          <button type="button" onClick={() => setHelpOpen(true)} className="flex items-center gap-1 hover:text-[var(--foreground)]">
            <Keyboard className="size-3.5" /> Phím tắt
          </button>
          <button type="button" onClick={() => setZoom((z) => Math.max(0.25, +(z / 1.2).toFixed(3)))}>
            <ZoomOut className="size-3.5" />
          </button>
          <input type="range" min={25} max={400} value={Math.round(zoom * 100)} onChange={(e) => setZoom(Number(e.target.value) / 100)} className="w-28" aria-label="Thu phóng" />
          <button type="button" onClick={() => setZoom((z) => Math.min(4, +(z * 1.2).toFixed(3)))}>
            <ZoomIn className="size-3.5" />
          </button>
          <button type="button" className="w-10 tabular-nums hover:text-[var(--foreground)]" onClick={fitPage} title="Vừa trang">
            {Math.round(zoom * 100)}%
          </button>
        </div>
      </div>

      {/* Menu chuột phải */}
      {menu ? (
        <div
          className="fixed z-[70] w-56 overflow-hidden rounded-lg border bg-[var(--card)] py-1 text-xs shadow-xl"
          style={{ left: Math.min(menu.x, window.innerWidth - 230), top: Math.min(menu.y, window.innerHeight - 380) }}
          onPointerDown={(e) => e.stopPropagation()}
        >
          {(
            [
              ['Cắt', 'Ctrl+X', cutSel, !hasSel],
              ['Sao chép', 'Ctrl+C', copySel, !hasSel],
              ['Dán', 'Ctrl+V', () => paste(), false],
              ['Nhân bản', 'Ctrl+D', duplicateSel, !hasSel],
              null,
              ['Sửa chữ', 'F2', () => primary && setEditingId(primary.id), !primary || !['text', 'signature', 'rect', 'datetime', 'pageNumber'].includes(primary.type)],
              ['Lên trên cùng', 'Ctrl+Shift+]', () => zOrder('front'), !hasSel],
              ['Xuống dưới cùng', 'Ctrl+Shift+[', () => zOrder('back'), !hasSel],
              [primary?.locked ? 'Mở khoá' : 'Khoá vị trí', 'Ctrl+L', toggleLock, !hasSel],
              [primary?.meta?.hidden === true ? 'Hiện khi in' : 'Ẩn khi in', '', toggleHidden, !hasSel],
              null,
              ['Chọn tất cả', 'Ctrl+A', () => setSelectedIds(canvasElements.map((x) => x.id)), false],
              ['Xoá', 'Del', removeSel, !hasSel],
            ] as ([string, string, () => void, boolean] | null)[]
          ).map((item, i) =>
            item ? (
              <button
                key={item[0]}
                type="button"
                disabled={item[3]}
                onClick={() => {
                  item[2]();
                  setMenu(null);
                }}
                className={cn('flex w-full items-center justify-between px-3 py-1.5 text-left hover:bg-[var(--accent)] disabled:opacity-40', item[0] === 'Xoá' && 'text-[var(--danger)]')}
              >
                {item[0]}
                <span className="text-[10px] text-[var(--muted-foreground)]">{item[1]}</span>
              </button>
            ) : (
              <div key={`sep${i}`} className="my-1 border-t" />
            ),
          )}
        </div>
      ) : null}

      <PreviewDialog open={previewOpen} onClose={() => setPreviewOpen(false)} doc={doc} data={previewData} setData={setPreviewData} title={title} />
      <FontManager open={fontsOpen} onClose={() => setFontsOpen(false)} canEdit={canManageFonts && !readOnly} />
      {infoPanel ? (
        <Dialog
          open={infoOpen}
          onClose={() => setInfoOpen(false)}
          size="lg"
          title="Thông tin mẫu in"
          description="Mã, tên, loại chứng từ và phạm vi áp dụng — lưu cùng thiết kế khi bấm Lưu"
          footer={<Button onClick={() => setInfoOpen(false)}>Xong</Button>}
        >
          {infoPanel}
        </Dialog>
      ) : null}
      <Dialog open={helpOpen} onClose={() => setHelpOpen(false)} title="Phím tắt & mẹo thiết kế" size="lg">
        <div className="grid gap-x-6 gap-y-1 text-xs sm:grid-cols-2">
          {[
            ['Ctrl + Z / Ctrl + Y', 'Hoàn tác / làm lại'],
            ['Ctrl + C / X / V', 'Sao chép / cắt / dán (dán được sang mẫu khác)'],
            ['Ctrl + D', 'Nhân bản đối tượng'],
            ['Ctrl + A', 'Chọn tất cả'],
            ['Delete', 'Xoá đối tượng chọn'],
            ['Mũi tên', 'Dịch 1 mm (Shift: 10 mm, Alt: 0,1 mm)'],
            ['Shift / Ctrl + bấm', 'Chọn thêm / bỏ chọn'],
            ['Kéo trên vùng trống', 'Khung chọn nhiều đối tượng'],
            ['Nhấp đúp / F2', 'Sửa chữ trực tiếp (Ctrl+Enter để xong, Esc huỷ)'],
            ['Giữ Alt khi kéo', 'Tắt hít lưới/đường gióng'],
            ['Shift khi kéo góc', 'Giữ tỉ lệ khung'],
            ['Ctrl + B / I / U', 'Đậm / nghiêng / gạch chân'],
            ['Ctrl + L', 'Khoá / mở khoá vị trí'],
            ['Ctrl + ] / [', 'Lên / xuống một lớp (thêm Shift: trên/dưới cùng)'],
            ['Ctrl + lăn chuột, Ctrl + ± / 0', 'Thu phóng / vừa trang'],
            ['Ctrl + S', 'Lưu thiết kế'],
            ['Ctrl + P', 'Xem trước PDF'],
            ['Chuột phải', 'Menu thao tác nhanh'],
          ].map(([k, v]) => (
            <div key={k} className="flex items-center justify-between gap-3 border-b py-1">
              <kbd className="rounded border bg-[var(--muted)] px-1.5 py-0.5 font-mono text-[10px]">{k}</kbd>
              <span className="text-right text-[var(--muted-foreground)]">{v}</span>
            </div>
          ))}
        </div>
        <div className="mt-3 flex gap-2 rounded-lg border border-sky-200 bg-sky-50 p-3 text-xs text-sky-900">
          <Info className="mt-0.5 size-4 shrink-0" />
          <div>
            Chèn dữ liệu vào chữ bằng <code>{'{đường.dẫn}'}</code>, vd <code>{'Họ tên: {request.patientName}'}</code>. Số trang: <code>{'{page}/{pages}'}</code>. Ngày in:{' '}
            <code>{'Ngày {system.day} tháng {system.month} năm {system.year}'}</code>. Khung vẽ dùng đúng font của bản PDF nên bố cục trên màn hình khớp bản in.
          </div>
        </div>
      </Dialog>
    </div>
  );
}

/* ------------------------------------------------------------------ Ribbon */

function Group({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex shrink-0 flex-col border-r px-2 last:border-r-0">
      <div className="flex flex-1 items-start gap-1">{children}</div>
      <div className="truncate pt-0.5 text-center text-[9px] uppercase tracking-wide text-[var(--muted-foreground)]">{label}</div>
    </div>
  );
}

function Big({
  icon,
  label,
  onClick,
  disabled,
  title,
  active,
  danger,
  draggable,
  onDragStart,
}: {
  icon: ReactNode;
  label: string;
  onClick: () => void;
  disabled?: boolean;
  title?: string;
  active?: boolean;
  danger?: boolean;
  draggable?: boolean;
  onDragStart?: (e: React.DragEvent) => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title ? `${label} (${title})` : label}
      draggable={draggable}
      onDragStart={onDragStart}
      className={cn(
        'flex h-[52px] min-w-[52px] max-w-[76px] flex-col items-center justify-center gap-0.5 rounded-md px-1.5 text-[10px] leading-tight transition-colors disabled:opacity-40 [&_svg]:size-5',
        active ? 'bg-[var(--primary)]/15 text-[var(--primary)] ring-1 ring-[var(--primary)]/40' : 'hover:bg-[var(--accent)]',
        danger && 'text-[var(--danger)]',
      )}
    >
      {icon}
      <span className="line-clamp-2 text-center">{label}</span>
    </button>
  );
}

function Small({ icon, label, onClick, disabled, title }: { icon: ReactNode; label: string; onClick: () => void; disabled?: boolean; title?: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title ? `${label} (${title})` : label}
      className="flex h-[17px] items-center gap-1 whitespace-nowrap rounded px-1 text-[11px] hover:bg-[var(--accent)] disabled:opacity-40 [&_svg]:size-3.5"
    >
      {icon}
      {label}
    </button>
  );
}

function Tool({ icon, title, onClick, active, disabled }: { icon: ReactNode; title: string; onClick: () => void; active?: boolean; disabled?: boolean }) {
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      disabled={disabled}
      className={cn(
        'flex h-6 min-w-6 items-center justify-center rounded px-1 disabled:opacity-40 [&_svg]:size-3.5',
        active ? 'bg-[var(--primary)]/15 text-[var(--primary)] ring-1 ring-[var(--primary)]/40' : 'hover:bg-[var(--accent)]',
      )}
    >
      {icon}
    </button>
  );
}
