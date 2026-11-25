'use client';

import { useEffect, useState } from 'react';
import { create } from 'zustand';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Input, Label } from '@/components/ui/input';

/** Tham số do nguồn dữ liệu SQL của mẫu in khai báo (GET /print/resolve/:docType → params). */
export interface PrintParamField {
  name: string;
  label?: string;
  type: 'text' | 'number' | 'date' | 'boolean';
  required?: boolean;
  default?: string;
}

interface PendingRequest {
  title: string;
  fields: PrintParamField[];
  values: Record<string, unknown>;
  resolve: (v: Record<string, unknown> | null) => void;
}

const usePrintParamsStore = create<{ pending: PendingRequest | null; set: (p: PendingRequest | null) => void }>((set) => ({
  pending: null,
  set: (pending) => set({ pending }),
}));

const isEmpty = (v: unknown) => v === undefined || v === null || v === '';

/** Tham số bắt buộc chưa có giá trị (không tính tham số có mặc định). */
export function missingParams(fields: PrintParamField[], values: Record<string, unknown>): PrintParamField[] {
  return fields.filter((f) => f.required && isEmpty(values[f.name]) && isEmpty(f.default));
}

/** Mở hộp thoại hỏi tham số; trả về null khi người dùng huỷ. Cần có <PrintParamsHost /> trong cây giao diện. */
export function askPrintParams(title: string, fields: PrintParamField[], values: Record<string, unknown>): Promise<Record<string, unknown> | null> {
  return new Promise((resolve) => usePrintParamsStore.getState().set({ title, fields, values, resolve }));
}

export function PrintParamsHost() {
  const pending = usePrintParamsStore((s) => s.pending);
  const setPending = usePrintParamsStore((s) => s.set);
  const [vals, setVals] = useState<Record<string, string>>({});
  useEffect(() => {
    if (!pending) return;
    const next: Record<string, string> = {};
    for (const f of pending.fields) {
      const v = pending.values[f.name];
      next[f.name] = isEmpty(v) ? (f.default === 'today' ? new Date(Date.now() + 7 * 3600_000).toISOString().slice(0, 10) : (f.default ?? '')) : String(v);
    }
    setVals(next);
  }, [pending]);
  if (!pending) return null;
  const close = (result: Record<string, unknown> | null) => {
    pending.resolve(result);
    setPending(null);
  };
  const missing = pending.fields.filter((f) => f.required && !vals[f.name]);
  return (
    <Dialog
      open
      onClose={() => close(null)}
      size="sm"
      title="Chọn tham số in"
      description={pending.title}
      footer={
        <>
          <Button variant="outline" onClick={() => close(null)}>Huỷ</Button>
          <Button
            disabled={missing.length > 0}
            onClick={() => {
              const out: Record<string, unknown> = { ...pending.values };
              for (const f of pending.fields) {
                const v = vals[f.name] ?? '';
                out[f.name] = v === '' ? null : f.type === 'number' ? Number(v) : f.type === 'boolean' ? v === 'true' : v;
              }
              close(out);
            }}
          >
            In
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        {pending.fields.map((f) => (
          <div key={f.name}>
            <Label>{f.label || f.name}{f.required ? ' *' : ''}</Label>
            {f.type === 'boolean' ? (
              <label className="mt-1 flex items-center gap-2 text-sm">
                <input type="checkbox" checked={vals[f.name] === 'true'} onChange={(e) => setVals({ ...vals, [f.name]: e.target.checked ? 'true' : '' })} /> Có
              </label>
            ) : (
              <Input type={f.type === 'date' ? 'date' : f.type === 'number' ? 'number' : 'text'} value={vals[f.name] ?? ''} onChange={(e) => setVals({ ...vals, [f.name]: e.target.value })} />
            )}
          </div>
        ))}
      </div>
    </Dialog>
  );
}
