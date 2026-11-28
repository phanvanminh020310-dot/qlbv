'use client';

import { AlignCenter, AlignJustify, AlignLeft, AlignRight, Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input, Label, Select } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { BUILTIN_FONTS, FALLBACK_VARIABLES, canonicalFont, nextId, type PrintDocument, type PrintElement } from './print-types';
import { tableColumnFor, type FieldItem } from './print-fields';

/** Nguồn danh sách cho bảng (vd `ds.<mã>` của nguồn dữ liệu) cùng các cột */
export interface ListSource {
  value: string;
  label: string;
  fields: Array<{ key: string; label: string; type: string }>;
}
import { cssFontFamily } from './print-fonts';

type Tab = 'position' | 'style' | 'box' | 'data' | 'advanced';

const TABS: { key: Tab; label: string }[] = [
  { key: 'position', label: 'Vị trí' },
  { key: 'style', label: 'Kiểu chữ' },
  { key: 'box', label: 'Khung & nền' },
  { key: 'data', label: 'Dữ liệu' },
  { key: 'advanced', label: 'Nâng cao' },
];

const FORMAT_TYPES = ['text', 'number', 'integer', 'currency', 'percent', 'date', 'datetime', 'bool', 'formula'];
const BINDING_SOURCES = [
  { value: 'field', label: 'Trường dữ liệu' },
  { value: 'row', label: 'Dòng dữ liệu' },
  { value: 'rows', label: 'Danh sách dòng' },
  { value: 'entry', label: 'Ô số liệu báo cáo' },
  { value: 'param', label: 'Tham số khi gọi in' },
  { value: 'system', label: 'Hệ thống' },
];

interface InspectorProps {
  doc: PrintDocument;
  element: PrintElement | null;
  onChange: (id: string, patch: Partial<PrintElement>) => void;
  onCommit: () => void;
  /** Danh sách họ font (GET /print/fonts) */
  fonts?: string[];
  /** Trường dữ liệu theo nguồn của mẫu (thay cho danh sách cố định) */
  fieldOptions?: FieldItem[];
  /** Nguồn danh sách cho bảng */
  listSources?: ListSource[];
}

function FontOptions({ fonts }: { fonts: string[] }) {
  return (
    <>
      {fonts.map((f) => (
        <option key={f} value={f} style={{ fontFamily: cssFontFamily(f) }}>
          {f}
          {f === 'Times New Roman' ? ' (mặc định)' : ''}
        </option>
      ))}
    </>
  );
}

/** Bảng thuộc tính chi tiết cho phần tử đang chọn (và cho toàn trang khi chưa chọn gì). */
export function DesignerInspector({ doc, element, onChange, onCommit, fonts: fontList, fieldOptions, listSources }: InspectorProps) {
  const [tab, setTab] = useState<Tab>('position');
  const fonts = fontList?.length ? fontList : BUILTIN_FONTS;

  if (!element) {
    return <DocumentInspector doc={doc} onChange={onChange} onCommit={onCommit} fonts={fonts} />;
  }

  const style = element.style ?? {};
  const setStyle = (patch: Record<string, unknown>): void =>
    onChange(element.id, { style: { ...style, ...patch } });
  const setBinding = (patch: Record<string, unknown>): void =>
    onChange(element.id, { binding: { ...(element.binding ?? { source: 'field' }), ...patch } });
  const setFormat = (patch: Record<string, unknown>): void =>
    setBinding({ format: { ...(element.binding?.format ?? {}), ...patch } });
  const border = style.border ?? {};
  const setBorder = (side: 'top' | 'right' | 'bottom' | 'left', patch: Record<string, unknown>): void =>
    setStyle({ border: { ...border, [side]: { ...(border[side] ?? { width: 0.3, style: 'solid', color: '#111827' }), ...patch } } });

  const variables = fieldOptions ?? (doc.variables?.length ? doc.variables : FALLBACK_VARIABLES);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 flex-wrap gap-1 border-b px-2 py-1.5">
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setTab(t.key)}
            className={cn(
              'rounded-md px-2.5 py-1 text-xs font-medium transition-colors',
              tab === t.key
                ? 'bg-[var(--primary)] text-[var(--primary-foreground)]'
                : 'text-[var(--muted-foreground)] hover:bg-[var(--accent)]',
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-3">
        {tab === 'position' ? (
          <>
            <Row label="Tên phần tử">
              <Input
                className="h-8 text-xs"
                value={element.name ?? ''}
                onChange={(e) => onChange(element.id, { name: e.target.value })}
                onBlur={onCommit}
              />
            </Row>
            <div className="grid grid-cols-2 gap-2">
              <Num label="X (mm)" value={element.x} onChange={(v) => onChange(element.id, { x: v })} onCommit={onCommit} />
              <Num label="Y (mm)" value={element.y} onChange={(v) => onChange(element.id, { y: v })} onCommit={onCommit} />
              <Num label="Rộng (mm)" value={element.w} onChange={(v) => onChange(element.id, { w: v })} onCommit={onCommit} />
              <Num label="Cao (mm)" value={element.h} onChange={(v) => onChange(element.id, { h: v })} onCommit={onCommit} />
              <Num label="Lớp (z)" value={element.z ?? 0} onChange={(v) => onChange(element.id, { z: v })} onCommit={onCommit} />
              <Num
                label="Xoay (°)"
                value={element.rotation ?? 0}
                onChange={(v) => onChange(element.id, { rotation: v })}
                onCommit={onCommit}
              />
            </div>
            {['text', 'signature', 'rect', 'datetime', 'pageNumber', 'barcode', 'qrcode'].includes(element.type) ? (
              <Row
                label={
                  element.type === 'signature'
                    ? 'Tiêu đề ô ký (dòng 1 đậm, dòng sau nghiêng)'
                    : element.type === 'datetime'
                      ? 'Mẫu ngày giờ (dd/MM/yyyy HH:mm) hoặc chữ có {biến}'
                      : element.type === 'pageNumber'
                        ? 'Mẫu số trang: Trang {page}/{pages}'
                        : element.type === 'barcode' || element.type === 'qrcode'
                          ? 'Nội dung cố định (khi không gắn trường dữ liệu)'
                          : 'Nội dung chữ — chèn dữ liệu bằng {đường.dẫn}'
                }
              >
                <textarea
                  className="min-h-20 w-full rounded-lg border bg-[var(--background)] p-2 text-xs"
                  value={element.text ?? ''}
                  onChange={(e) => onChange(element.id, { text: e.target.value })}
                  onBlur={onCommit}
                />
              </Row>
            ) : null}
          </>
        ) : null}

        {tab === 'style' ? (
          <>
            <Row label="Font chữ">
              <Select
                className="h-8 text-xs"
                style={{ fontFamily: cssFontFamily(style.fontFamily ?? doc.defaultStyle?.fontFamily) }}
                value={canonicalFont(style.fontFamily ?? doc.defaultStyle?.fontFamily)}
                onChange={(e) => { setStyle({ fontFamily: e.target.value }); onCommit(); }}
              >
                <FontOptions fonts={Array.from(new Set([...fonts, canonicalFont(style.fontFamily ?? doc.defaultStyle?.fontFamily)]))} />
              </Select>
            </Row>
            <div className="grid grid-cols-2 gap-2">
              <Num label="Cỡ chữ (pt)" value={style.fontSize ?? 12} onChange={(v) => setStyle({ fontSize: v })} onCommit={onCommit} />
              <Num label="Giãn dòng" value={style.lineHeight ?? 1.3} step={0.05} onChange={(v) => setStyle({ lineHeight: v })} onCommit={onCommit} />
              <Num label="Giãn ký tự" value={style.letterSpacing ?? 0} step={0.1} onChange={(v) => setStyle({ letterSpacing: v })} onCommit={onCommit} />
              <Num label="Độ mờ" value={style.opacity ?? 1} step={0.05} onChange={(v) => setStyle({ opacity: v })} onCommit={onCommit} />
            </div>
            <div className="flex flex-wrap gap-1">
              <Toggle label="Đậm" active={!!style.bold} onClick={() => { setStyle({ bold: !style.bold }); onCommit(); }} className="font-bold" />
              <Toggle label="Nghiêng" active={!!style.italic} onClick={() => { setStyle({ italic: !style.italic }); onCommit(); }} className="italic" />
              <Toggle label="Gạch chân" active={!!style.underline} onClick={() => { setStyle({ underline: !style.underline }); onCommit(); }} className="underline" />
              <Toggle label="Gạch ngang" active={!!style.strike} onClick={() => { setStyle({ strike: !style.strike }); onCommit(); }} className="line-through" />
            </div>
            <Row label="Căn ngang">
              <div className="flex gap-1">
                {[
                  { v: 'left', icon: <AlignLeft /> },
                  { v: 'center', icon: <AlignCenter /> },
                  { v: 'right', icon: <AlignRight /> },
                  { v: 'justify', icon: <AlignJustify /> },
                ].map((a) => (
                  <Button
                    key={a.v}
                    size="sm"
                    variant={style.align === a.v ? 'default' : 'outline'}
                    onClick={() => { setStyle({ align: a.v }); onCommit(); }}
                  >
                    {a.icon}
                  </Button>
                ))}
              </div>
            </Row>
            <Row label="Căn dọc">
              <Select className="h-8 text-xs" value={style.verticalAlign ?? 'top'} onChange={(e) => { setStyle({ verticalAlign: e.target.value }); onCommit(); }}>
                <option value="top">Trên</option>
                <option value="middle">Giữa</option>
                <option value="bottom">Dưới</option>
              </Select>
            </Row>
            <Row label="Kiểu chữ hoa/thường">
              <Select className="h-8 text-xs" value={style.textTransform ?? 'none'} onChange={(e) => { setStyle({ textTransform: e.target.value }); onCommit(); }}>
                <option value="none">Giữ nguyên</option>
                <option value="uppercase">IN HOA</option>
                <option value="lowercase">in thường</option>
                <option value="capitalize">Viết Hoa Đầu Từ</option>
              </Select>
            </Row>
            <Row label="Màu chữ">
              <div className="flex items-center gap-2">
                <Input type="color" className="h-8 w-12 p-1" value={style.color ?? '#111827'} onChange={(e) => setStyle({ color: e.target.value })} onBlur={onCommit} />
                <Input className="h-8 flex-1 text-xs" value={style.color ?? '#111827'} onChange={(e) => setStyle({ color: e.target.value })} onBlur={onCommit} />
              </div>
            </Row>
            <div className="flex flex-wrap gap-3">
              <Check label="Tự thu nhỏ cỡ chữ cho vừa ô" checked={style.autoShrink !== false} onChange={(v) => { setStyle({ autoShrink: v }); onCommit(); }} />
              <Check label="Tự xuống dòng" checked={style.wrap !== false} onChange={(v) => { setStyle({ wrap: v }); onCommit(); }} />
            </div>
          </>
        ) : null}

        {tab === 'box' ? (
          <>
            <Row label="Màu nền">
              <div className="flex items-center gap-2">
                <Input type="color" className="h-8 w-12 p-1" value={style.backgroundColor ?? '#ffffff'} onChange={(e) => setStyle({ backgroundColor: e.target.value })} onBlur={onCommit} />
                <Button size="sm" variant="outline" onClick={() => { setStyle({ backgroundColor: undefined }); onCommit(); }}>
                  Bỏ nền
                </Button>
              </div>
            </Row>
            <div className="grid grid-cols-2 gap-2">
              <Num label="Đệm ngang (mm)" value={style.paddingX ?? 0} step={0.5} onChange={(v) => setStyle({ paddingX: v })} onCommit={onCommit} />
              <Num label="Đệm dọc (mm)" value={style.paddingY ?? 0} step={0.5} onChange={(v) => setStyle({ paddingY: v })} onCommit={onCommit} />
              <Num label="Bo góc (mm)" value={style.borderRadius ?? 0} step={0.5} onChange={(v) => setStyle({ borderRadius: v })} onCommit={onCommit} />
            </div>
            <div className="space-y-2">
              <div className="text-[11px] font-semibold uppercase tracking-wide text-[var(--muted-foreground)]">Đường viền</div>
              {(['top', 'right', 'bottom', 'left'] as const).map((side) => (
                <div key={side} className="grid grid-cols-[38px_52px_1fr_34px] items-center gap-1.5">
                  <span className="text-xs">{{ top: 'Trên', right: 'Phải', bottom: 'Dưới', left: 'Trái' }[side]}</span>
                  <Input
                    type="number"
                    step={0.1}
                    className="h-7 text-xs"
                    value={border[side]?.width ?? 0}
                    onChange={(e) => setBorder(side, { width: Number(e.target.value) })}
                    onBlur={onCommit}
                  />
                  <Select
                    className="h-7 text-xs"
                    value={border[side]?.style ?? 'solid'}
                    onChange={(e) => { setBorder(side, { style: e.target.value }); onCommit(); }}
                  >
                    <option value="solid">Liền</option>
                    <option value="dashed">Đứt</option>
                    <option value="dotted">Chấm</option>
                    <option value="double">Đôi</option>
                    <option value="none">Không</option>
                  </Select>
                  <Input type="color" className="h-7 p-0.5" value={border[side]?.color ?? '#111827'} onChange={(e) => setBorder(side, { color: e.target.value })} onBlur={onCommit} />
                </div>
              ))}
              <div className="flex gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    setStyle({
                      border: {
                        top: { width: 0.3, style: 'solid', color: '#111827' },
                        right: { width: 0.3, style: 'solid', color: '#111827' },
                        bottom: { width: 0.3, style: 'solid', color: '#111827' },
                        left: { width: 0.3, style: 'solid', color: '#111827' },
                      },
                    });
                    onCommit();
                  }}
                >
                  Viền cả 4 cạnh
                </Button>
                <Button size="sm" variant="ghost" onClick={() => { setStyle({ border: {} }); onCommit(); }}>
                  Xoá viền
                </Button>
              </div>
            </div>
            {element.type === 'image' ? (
              <Row label="Liên kết ảnh (URL hoặc đường dẫn)">
                <Input
                  className="h-8 text-xs"
                  value={element.image?.src ?? ''}
                  onChange={(e) => onChange(element.id, { image: { ...element.image, src: e.target.value } })}
                  onBlur={onCommit}
                  placeholder="/uploads/logo.png"
                />
              </Row>
            ) : null}
          </>
        ) : null}

        {tab === 'data' ? (
          <>
            <Row label="Nguồn dữ liệu">
              <Select
                className="h-8 text-xs"
                value={element.binding?.source ?? 'field'}
                onChange={(e) => { setBinding({ source: e.target.value }); onCommit(); }}
              >
                {BINDING_SOURCES.map((s) => (
                  <option key={s.value} value={s.value}>
                    {s.label}
                  </option>
                ))}
              </Select>
            </Row>
            <Row label="Trường dữ liệu">
              <Select
                className="h-8 text-xs"
                value={element.binding?.path ?? ''}
                onChange={(e) => { setBinding({ path: e.target.value }); onCommit(); }}
              >
                <option value="">— Chọn trường —</option>
                {element.binding?.path && !variables.some((v) => v.key === element.binding?.path) ? (
                  <option value={element.binding.path}>{element.binding.path}</option>
                ) : null}
                {Array.from(new Set(variables.map((v) => v.group ?? 'Khác'))).map((g) => (
                  <optgroup key={g} label={g}>
                    {variables
                      .filter((v) => (v.group ?? 'Khác') === g)
                      .map((v) => (
                        <option key={v.key} value={v.key}>
                          {v.label} ({v.key})
                        </option>
                      ))}
                  </optgroup>
                ))}
              </Select>
            </Row>
            <Row label="Hoặc nhập đường dẫn">
              <Input
                className="h-8 text-xs"
                value={element.binding?.path ?? ''}
                onChange={(e) => setBinding({ path: e.target.value })}
                onBlur={onCommit}
                placeholder="one.du_lieu.ho_ten / params.tu_ngay"
              />
            </Row>
            <div className="grid grid-cols-2 gap-2">
              <Row label="Định dạng">
                <Select
                  className="h-8 text-xs"
                  value={element.binding?.format?.type ?? 'text'}
                  onChange={(e) => { setFormat({ type: e.target.value }); onCommit(); }}
                >
                  {FORMAT_TYPES.map((t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ))}
                </Select>
              </Row>
              <Num
                label="Số chữ số thập phân"
                value={element.binding?.format?.decimals ?? 0}
                onChange={(v) => setFormat({ decimals: v })}
                onCommit={onCommit}
              />
            </div>
            <Row label="Kiểu hiển thị (pattern)">
              <Input
                className="h-8 text-xs"
                value={element.binding?.format?.pattern ?? ''}
                onChange={(e) => setFormat({ pattern: e.target.value })}
                onBlur={onCommit}
                placeholder="dd/MM/yyyy hoặc #,##0"
              />
            </Row>
            <div className="grid grid-cols-2 gap-2">
              <Row label="Tiền tố">
                <Input className="h-8 text-xs" value={element.binding?.format?.prefix ?? ''} onChange={(e) => setFormat({ prefix: e.target.value })} onBlur={onCommit} />
              </Row>
              <Row label="Hậu tố">
                <Input className="h-8 text-xs" value={element.binding?.format?.suffix ?? ''} onChange={(e) => setFormat({ suffix: e.target.value })} onBlur={onCommit} />
              </Row>
            </div>
            <Row label="Giá trị thay thế khi rỗng">
              <Input className="h-8 text-xs" value={element.binding?.format?.fallback ?? ''} onChange={(e) => setFormat({ fallback: e.target.value })} onBlur={onCommit} />
            </Row>
            <Row label="Biểu thức tính (nếu có)">
              <Input
                className="h-8 text-xs"
                value={element.binding?.format?.expression ?? ''}
                onChange={(e) => setFormat({ expression: e.target.value })}
                onBlur={onCommit}
                placeholder="hs + tq"
              />
            </Row>

            {element.type === 'table' ? <TableEditor element={element} onChange={onChange} onCommit={onCommit} listSources={listSources ?? []} /> : null}
          </>
        ) : null}

        {tab === 'advanced' ? (
          <>
            <Row label="Nhóm neo (in ở đầu/cuối trang)">
              <Select
                className="h-8 text-xs"
                value={element.anchor ?? 'body'}
                onChange={(e) => { onChange(element.id, { anchor: e.target.value as PrintElement['anchor'] }); onCommit(); }}
              >
                <option value="header">Đầu trang</option>
                <option value="body">Thân trang</option>
                <option value="footer">Chân trang</option>
              </Select>
            </Row>
            <Row label="Điều kiện hiển thị (biểu thức)">
              <Input
                className="h-8 text-xs"
                value={element.visibleWhen ?? ''}
                onChange={(e) => onChange(element.id, { visibleWhen: e.target.value })}
                onBlur={onCommit}
                placeholder="status == 'HOAN_TAT'"
              />
            </Row>
            <div className="flex flex-wrap gap-3">
              <Check
                label="Lặp lại trên mọi trang"
                checked={!!element.repeatOnEveryPage}
                onChange={(v) => { onChange(element.id, { repeatOnEveryPage: v }); onCommit(); }}
              />
              <Check
                label="Khoá vị trí"
                checked={!!element.locked}
                onChange={(v) => { onChange(element.id, { locked: v }); onCommit(); }}
              />
            </div>
            <Row label="Mã phần tử">
              <Input className="h-8 font-mono text-xs" value={element.id} readOnly />
            </Row>
          </>
        ) : null}
      </div>
    </div>
  );
}

/* --------------------------------------------------------- Thuộc tính tài liệu */

function DocumentInspector({
  doc,
  onChange,
  onCommit,
  fonts,
}: {
  doc: PrintDocument;
  onChange: (id: string, patch: Partial<PrintElement>) => void;
  onCommit: () => void;
  fonts: string[];
}) {
  const patchDoc = (patch: Record<string, unknown>): void =>
    onChange('__document__', patch as unknown as Partial<PrintElement>);
  const margins = doc.margins;

  return (
    <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-3">
      <div className="text-xs text-[var(--muted-foreground)]">
        Chưa chọn phần tử nào — đang chỉnh thuộc tính chung của bản in.
      </div>
      <div className="grid grid-cols-2 gap-2">
        <Num label="Lề trên (mm)" value={margins.top} onChange={(v) => patchDoc({ margins: { ...margins, top: v } })} onCommit={onCommit} />
        <Num label="Lề dưới (mm)" value={margins.bottom} onChange={(v) => patchDoc({ margins: { ...margins, bottom: v } })} onCommit={onCommit} />
        <Num label="Lề trái (mm)" value={margins.left} onChange={(v) => patchDoc({ margins: { ...margins, left: v } })} onCommit={onCommit} />
        <Num label="Lề phải (mm)" value={margins.right} onChange={(v) => patchDoc({ margins: { ...margins, right: v } })} onCommit={onCommit} />
      </div>
      {doc.paperSize === 'Custom' ? (
        <div className="grid grid-cols-2 gap-2">
          <Num label="Rộng giấy (mm)" value={doc.customSize?.width ?? 210} onChange={(v) => patchDoc({ customSize: { width: v, height: doc.customSize?.height ?? 297 } })} onCommit={onCommit} />
          <Num label="Cao giấy (mm)" value={doc.customSize?.height ?? 297} onChange={(v) => patchDoc({ customSize: { width: doc.customSize?.width ?? 210, height: v } })} onCommit={onCommit} />
        </div>
      ) : null}
      <div className="space-y-2 rounded-lg border p-3">
        <div className="text-[11px] font-semibold uppercase tracking-wide text-[var(--muted-foreground)]">Lưới thiết kế</div>
        <Num label="Ô lưới (mm)" value={doc.grid?.size ?? 5} onChange={(v) => patchDoc({ grid: { ...(doc.grid ?? {}), size: v } })} onCommit={onCommit} />
        <div className="flex gap-3">
          <Check label="Hiện lưới" checked={doc.grid?.show !== false} onChange={(v) => patchDoc({ grid: { ...(doc.grid ?? {}), show: v } })} />
          <Check label="Hít lưới" checked={doc.grid?.snap !== false} onChange={(v) => patchDoc({ grid: { ...(doc.grid ?? {}), snap: v } })} />
        </div>
      </div>
      <div className="space-y-2 rounded-lg border p-3">
        <div className="text-[11px] font-semibold uppercase tracking-wide text-[var(--muted-foreground)]">Đánh số trang</div>
        <Check
          label="In số trang"
          checked={!!doc.pageNumbering?.show}
          onChange={(v) => patchDoc({ pageNumbering: { ...(doc.pageNumbering ?? {}), show: v } })}
        />
        <Row label="Vị trí">
          <Select
            className="h-8 text-xs"
            value={doc.pageNumbering?.position ?? 'bottom-center'}
            onChange={(e) => { patchDoc({ pageNumbering: { ...(doc.pageNumbering ?? {}), position: e.target.value } }); onCommit(); }}
          >
            <option value="bottom-center">Giữa chân trang</option>
            <option value="bottom-right">Phải chân trang</option>
            <option value="bottom-left">Trái chân trang</option>
            <option value="top-right">Phải đầu trang</option>
            <option value="top-left">Trái đầu trang</option>
          </Select>
        </Row>
        <Row label="Định dạng">
          <Input
            className="h-8 text-xs"
            value={doc.pageNumbering?.format ?? '{page}/{pages}'}
            onChange={(e) => patchDoc({ pageNumbering: { ...(doc.pageNumbering ?? {}), format: e.target.value } })}
            onBlur={onCommit}
          />
        </Row>
      </div>
      <div className="space-y-2 rounded-lg border p-3">
        <div className="text-[11px] font-semibold uppercase tracking-wide text-[var(--muted-foreground)]">Chữ mờ (watermark)</div>
        <Row label="Nội dung">
          <Input
            className="h-8 text-xs"
            value={doc.watermark?.text ?? ''}
            onChange={(e) => patchDoc({ watermark: { ...(doc.watermark ?? {}), text: e.target.value } })}
            onBlur={onCommit}
            placeholder="BẢN NHÁP / LƯU HÀNH NỘI BỘ"
          />
        </Row>
        <div className="grid grid-cols-2 gap-2">
          <Num label="Cỡ chữ" value={doc.watermark?.fontSize ?? 60} onChange={(v) => patchDoc({ watermark: { ...(doc.watermark ?? {}), fontSize: v } })} onCommit={onCommit} />
          <Num label="Độ mờ" value={doc.watermark?.opacity ?? 0.08} step={0.02} onChange={(v) => patchDoc({ watermark: { ...(doc.watermark ?? {}), opacity: v } })} onCommit={onCommit} />
        </div>
      </div>
      <div className="space-y-2 rounded-lg border p-3">
        <div className="text-[11px] font-semibold uppercase tracking-wide text-[var(--muted-foreground)]">Kiểu chữ mặc định</div>
        <Row label="Font">
          <Select
            className="h-8 text-xs"
            style={{ fontFamily: cssFontFamily(doc.defaultStyle?.fontFamily) }}
            value={canonicalFont(doc.defaultStyle?.fontFamily)}
            onChange={(e) => { patchDoc({ defaultStyle: { ...(doc.defaultStyle ?? {}), fontFamily: e.target.value } }); onCommit(); }}
          >
            <FontOptions fonts={Array.from(new Set([...fonts, canonicalFont(doc.defaultStyle?.fontFamily)]))} />
          </Select>
        </Row>
        <div className="grid grid-cols-2 gap-2">
          <Num label="Cỡ chữ (pt)" value={doc.defaultStyle?.fontSize ?? 12} onChange={(v) => patchDoc({ defaultStyle: { ...(doc.defaultStyle ?? {}), fontSize: v } })} onCommit={onCommit} />
          <Num label="Giãn dòng" value={doc.defaultStyle?.lineHeight ?? 1.3} step={0.05} onChange={(v) => patchDoc({ defaultStyle: { ...(doc.defaultStyle ?? {}), lineHeight: v } })} onCommit={onCommit} />
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------- Sửa bảng động */

const LEGACY_SOURCES: Array<{ value: string; label: string }> = [
  { value: 'rows', label: 'Danh sách dòng báo cáo' },
  { value: 'entries', label: 'Ô số liệu' },
  { value: 'signatures', label: 'Chữ ký' },
  { value: 'custom', label: 'Dữ liệu truyền vào' },
];

function TableEditor({
  element,
  onChange,
  onCommit,
  listSources,
}: {
  element: PrintElement;
  onChange: (id: string, patch: Partial<PrintElement>) => void;
  onCommit: () => void;
  listSources: ListSource[];
}) {
  const table = element.table;
  if (!table) return null;
  const current = listSources.find((s) => s.value === table.dataSource);
  const known = [...listSources.map((s) => s.value), ...LEGACY_SOURCES.map((s) => s.value)];
  const datalistId = `cols-${element.id}`;
  const setTable = (patch: Record<string, unknown>): void =>
    onChange(element.id, { table: { ...table, ...patch } });

  return (
    <div className="space-y-2 rounded-lg border p-2">
      <div className="text-[11px] font-semibold uppercase tracking-wide text-[var(--muted-foreground)]">
        Cấu hình bảng
      </div>
      <Row label="Nguồn dòng">
        <Select className="h-8 text-xs" value={table.dataSource} onChange={(e) => { setTable({ dataSource: e.target.value }); onCommit(); }}>
          {listSources.length ? (
            <optgroup label="Nguồn dữ liệu của mẫu">
              {listSources.map((s) => (
                <option key={s.value} value={s.value}>
                  {s.label} ({s.value})
                </option>
              ))}
            </optgroup>
          ) : null}
          {!known.includes(table.dataSource) ? <option value={table.dataSource}>{table.dataSource}</option> : null}
          <optgroup label="Dữ liệu do màn hình nghiệp vụ gửi">
            {LEGACY_SOURCES.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </optgroup>
        </Select>
      </Row>
      {current?.fields.length ? (
        <datalist id={datalistId}>
          {current.fields.map((f) => (
            <option key={f.key} value={f.key}>
              {f.label}
            </option>
          ))}
        </datalist>
      ) : null}
      <div className="flex flex-wrap gap-3">
        <Check label="Lặp tiêu đề mỗi trang" checked={table.repeatHeader !== false} onChange={(v) => { setTable({ repeatHeader: v }); onCommit(); }} />
        <Check label="Có dòng tổng" checked={!!table.totalRow} onChange={(v) => { setTable({ totalRow: v }); onCommit(); }} />
        <Check label="Sọc xen kẽ" checked={!!table.zebra} onChange={(v) => { setTable({ zebra: v }); onCommit(); }} />
        <Check label="Cột số thứ tự" checked={!!table.showIndex} onChange={(v) => { setTable({ showIndex: v }); onCommit(); }} />
      </div>

      <div className="space-y-1.5">
        {table.columns.map((col, index) => (
          <div key={col.id} className="space-y-1 rounded-md bg-[var(--muted)]/50 p-2">
            <div className="flex items-center gap-1.5">
              <Input
                className="h-7 flex-1 text-xs"
                value={col.title}
                onChange={(e) => {
                  const columns = table.columns.map((c, i) => (i === index ? { ...c, title: e.target.value } : c));
                  setTable({ columns });
                }}
                onBlur={onCommit}
                placeholder="Tiêu đề cột"
              />
              <Input
                type="number"
                className="h-7 w-16 text-xs"
                value={col.width}
                onChange={(e) => {
                  const columns = table.columns.map((c, i) => (i === index ? { ...c, width: Number(e.target.value) } : c));
                  setTable({ columns });
                }}
                onBlur={onCommit}
                title="Chiều rộng (mm)"
              />
              <Select
                className="h-7 w-20 text-xs"
                value={col.align ?? 'left'}
                onChange={(e) => {
                  const columns = table.columns.map((c, i) =>
                    i === index ? { ...c, align: e.target.value as 'left' } : c,
                  );
                  setTable({ columns });
                  onCommit();
                }}
              >
                <option value="left">Trái</option>
                <option value="center">Giữa</option>
                <option value="right">Phải</option>
              </Select>
              <Button
                size="sm"
                variant="ghost"
                className="text-[var(--danger)]"
                onClick={() => { setTable({ columns: table.columns.filter((_, i) => i !== index) }); onCommit(); }}
              >
                <Trash2 />
              </Button>
            </div>
            <div className="flex items-center gap-1.5">
              <Select
                className="h-7 w-24 text-xs"
                value={col.binding?.source ?? 'row'}
                onChange={(e) => {
                  const columns = table.columns.map((c, i) =>
                    i === index ? { ...c, binding: { ...(c.binding ?? {}), source: e.target.value } } : c,
                  );
                  setTable({ columns });
                  onCommit();
                }}
              >
                {BINDING_SOURCES.map((s) => (
                  <option key={s.value} value={s.value}>
                    {s.label}
                  </option>
                ))}
              </Select>
              <Input
                className="h-7 flex-1 font-mono text-[11px]"
                value={col.binding?.path ?? ''}
                onChange={(e) => {
                  const columns = table.columns.map((c, i) =>
                    i === index ? { ...c, binding: { ...(c.binding ?? { source: 'row' }), path: e.target.value } } : c,
                  );
                  setTable({ columns });
                }}
                onBlur={onCommit}
                list={current?.fields.length ? datalistId : undefined}
                title={current?.fields.find((f) => f.key === col.binding?.path)?.label}
                placeholder={current?.fields.length ? 'Chọn cột dữ liệu…' : 'rowLabel / value / index'}
              />
            </div>
          </div>
        ))}
        <Button
          size="sm"
          variant="outline"
          onClick={() => {
            setTable({
              columns: [...table.columns, { id: nextId('col'), title: 'Cột mới', width: 30, align: 'left', binding: { source: 'row', path: 'value' } }],
            });
            onCommit();
          }}
        >
          <Plus /> Thêm cột
        </Button>
        {current?.fields.length ? (
          <Select
            className="h-8 text-xs"
            value=""
            onChange={(e) => {
              const f = current.fields.find((x) => x.key === e.target.value);
              if (!f) return;
              setTable({ columns: [...table.columns, tableColumnFor(f, 30)] });
              onCommit();
            }}
          >
            <option value="">＋ Thêm cột từ “{current.label}”…</option>
            {current.fields.map((f) => (
              <option key={f.key} value={f.key}>
                {f.label} ({f.key})
              </option>
            ))}
          </Select>
        ) : null}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------- Phụ trợ */

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <Label className="text-[11px] text-[var(--muted-foreground)]">{label}</Label>
      {children}
    </div>
  );
}

function Num({
  label,
  value,
  onChange,
  onCommit,
  step = 1,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  onCommit: () => void;
  step?: number;
}) {
  return (
    <div className="space-y-1">
      <Label className="text-[11px] text-[var(--muted-foreground)]">{label}</Label>
      <Input
        type="number"
        step={step}
        className="h-8 text-xs"
        value={Number.isFinite(value) ? value : 0}
        onChange={(e) => onChange(Number(e.target.value))}
        onBlur={onCommit}
      />
    </div>
  );
}

function Check({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex items-center gap-2 text-xs">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      {label}
    </label>
  );
}

function Toggle({
  label,
  active,
  onClick,
  className,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
  className?: string;
}) {
  return (
    <Button size="sm" variant={active ? 'default' : 'outline'} className={className} onClick={onClick}>
      {label}
    </Button>
  );
}
