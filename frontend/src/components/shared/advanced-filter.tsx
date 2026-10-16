'use client';

import { useQuery } from '@tanstack/react-query';
import { BookmarkPlus, Filter, RotateCcw, Save, Trash2, X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Input, Label, Select } from '@/components/ui/input';
import { apiFetch } from '@/lib/api';
import { cn } from '@/lib/utils';

/**
 * Thanh lọc nâng cao dùng chung.
 *
 * Cấu hình trường lọc lấy từ API `/meta/filters/:resource`, nên thêm trường lọc mới ở
 * backend là giao diện tự có — không cần sửa trang. Bộ lọc được lưu dạng chuỗi
 * `field:op:value,…` đúng như backend mong đợi, kèm bộ điều kiện lưu sẵn (preset) theo
 * từng tài nguyên trong trình duyệt.
 */

interface FilterField {
  field: string;
  label: string;
  type: 'text' | 'number' | 'date' | 'datetime' | 'bool' | 'enum';
  defaultOp?: string;
  ops?: string[];
  options?: { value: string; label: string }[];
  optionsSource?: 'departments' | 'roles' | 'users' | 'hsbaWorkflows';
  group?: string;
  hint?: string;
}

interface FilterSpec {
  resource: string;
  label: string;
  fields: FilterField[];
  operators: Record<string, string>;
}

interface Condition {
  id: number;
  field: string;
  op: string;
  value: string;
}

export interface AdvancedFilterProps {
  /** Mã tài nguyên theo `/meta/filters` */
  resource: string;
  /** Chuỗi filters hiện tại (do trang quản lý) */
  value: string;
  onChange: (filters: string, meta?: { conditions: Condition[] }) => void;
  /** Bộ lọc cố định luôn gửi kèm (ví dụ: templateId=1) — không hiển thị để sửa */
  className?: string;
  /** Hiện luôn bảng điều kiện thay vì phải bấm nút */
  defaultOpen?: boolean;
}

let conditionSeq = 0;

/** Đọc bộ lọc đã lưu (preset) của một tài nguyên từ localStorage. */
function loadPresets(key: string): Record<string, string> {
  if (typeof window === 'undefined') return {};
  try {
    const parsed: unknown = JSON.parse(window.localStorage.getItem(key) ?? '{}');
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, string>) : {};
  } catch {
    return {};
  }
}

export function AdvancedFilter({ resource, value, onChange, className, defaultOpen }: AdvancedFilterProps) {
  const presetsKey = `qlbs_filters_${resource}`;
  const [open, setOpen] = useState(!!defaultOpen);
  const [conditions, setConditions] = useState<Condition[]>(() => parseFilterString(value));
  const [presetName, setPresetName] = useState('');
  const [savingPreset, setSavingPreset] = useState(false);
  // Khởi tạo rỗng rồi mới đọc localStorage sau khi gắn vào DOM: tránh lỗi TDZ
  // (gọi hàm trước khi khai báo) và lệch hydrate giữa máy chủ và trình duyệt.
  const [presets, setPresets] = useState<Record<string, string>>({});
  useEffect(() => {
    setPresets(loadPresets(presetsKey));
  }, [presetsKey]);

  const spec = useQuery({
    queryKey: ['meta-filters', resource],
    queryFn: () => apiFetch<FilterSpec>(`/meta/filters/${resource}`),
    staleTime: 10 * 60 * 1000,
  });

  const departments = useQuery({
    queryKey: ['filter-options-departments'],
    staleTime: 5 * 60 * 1000,
    queryFn: () => apiFetch<{ id: number; name: string; level: number }[]>('/departments/options'),
  });

  const users = useQuery({
    queryKey: ['filter-options-users'],
    staleTime: 5 * 60 * 1000,
    queryFn: () => apiFetch<{ items: { id: number; fullName: string; username: string }[] }>('/users?pageSize=200'),
  });

  const workflows = useQuery({
    queryKey: ['filter-options-workflows'],
    staleTime: 5 * 60 * 1000,
    queryFn: () => apiFetch<{ items: { id: number; name: string }[] }>('/hsba/workflows'),
  });

  const roles = useQuery({
    queryKey: ['filter-options-roles'],
    staleTime: 5 * 60 * 1000,
    queryFn: () => apiFetch<{ items: { id: number; name: string }[] }>('/roles?pageSize=100'),
  });

  // Đồng bộ khi trang cha đổi bộ lọc từ bên ngoài (ví dụ: nút xoá nhanh)
  useEffect(() => {
    setConditions(parseFilterString(value));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  const fields = spec.data?.fields ?? [];
  const operators = spec.data?.operators ?? {};
  const grouped = useMemo(() => {
    const map = new Map<string, FilterField[]>();
    for (const f of fields) {
      const key = f.group ?? 'Khác';
      map.set(key, [...(map.get(key) ?? []), f]);
    }
    return [...map.entries()];
  }, [fields]);

  const fieldOf = (name: string): FilterField | undefined => fields.find((f) => f.field === name);

  const optionsFor = (field: FilterField): { value: string; label: string }[] => {
    if (field.options?.length) return field.options;
    switch (field.optionsSource) {
      case 'departments':
        return (departments.data ?? []).map((d) => ({ value: String(d.id), label: `${'—'.repeat(Math.max(0, (d.level ?? 1) - 1))} ${d.name}`.trim() }));
      case 'users':
        return (users.data?.items ?? []).map((u) => ({ value: String(u.id), label: `${u.fullName} (${u.username})` }));
      case 'hsbaWorkflows':
        return (workflows.data?.items ?? []).map((w) => ({ value: String(w.id), label: w.name }));
      case 'roles':
        return (roles.data?.items ?? []).map((r) => ({ value: String(r.id), label: r.name }));
      default:
        return [];
    }
  };

  const toFilterString = (list: Condition[]): string =>
    list
      .filter((c) => c.field && c.op)
      .filter((c) => c.op === 'isnull' || c.op === 'notnull' || c.value.trim() !== '')
      .map((c) => `${c.field}:${c.op}:${c.op === 'isnull' || c.op === 'notnull' ? '' : c.value.trim()}`)
      .join(',');

  const apply = (list: Condition[] = conditions): void => {
    onChange(toFilterString(list), { conditions: list });
    setOpen(false);
  };

  const addCondition = (field?: FilterField): void => {
    const first = field ?? fields[0];
    if (!first) {
      toast.error('Chưa tải được danh sách trường lọc');
      return;
    }
    setConditions((prev) => [
      ...prev,
      { id: (conditionSeq += 1), field: first.field, op: first.defaultOp ?? 'eq', value: '' },
    ]);
  };

  const removeCondition = (id: number): void => {
    const next = conditions.filter((c) => c.id !== id);
    setConditions(next);
    onChange(toFilterString(next));
  };

  const clearAll = (): void => {
    setConditions([]);
    onChange('', { conditions: [] });
  };

  const persistPresets = (next: Record<string, string>): void => {
    setPresets(next);
    window.localStorage.setItem(presetsKey, JSON.stringify(next));
  };

  const activeChips = parseFilterString(value).map((c) => {
    const field = fields.find((f) => f.field === c.field);
    const label = field?.label ?? c.field;
    const opLabel = operators[c.op] ?? c.op;
    const optionLabel = field ? optionsFor(field).find((o) => o.value === c.value)?.label : undefined;
    return {
      id: c.id,
      text:
        c.op === 'isnull' || c.op === 'notnull'
          ? `${label} ${opLabel}`
          : `${label} ${opLabel} “${optionLabel ?? c.value}”`,
    };
  });

  const activeCount = activeChips.length;

  return (
    <div className={cn('space-y-2', className)}>
      <div className="flex flex-wrap items-center gap-2">
        <Button variant={open ? 'default' : 'outline'} size="sm" onClick={() => setOpen((v) => !v)}>
          <Filter /> Bộ lọc nâng cao
          {activeCount > 0 ? (
            <span className="ml-1 rounded-full bg-[var(--primary-foreground)]/20 px-1.5 text-[11px] tabular-nums">
              {activeCount}
            </span>
          ) : null}
        </Button>

        {Object.keys(presets).length > 0 ? (
          <Select
            className="h-8 w-full sm:w-52 text-xs"
            value=""
            onChange={(e) => {
              const saved = presets[e.target.value];
              if (!saved) return;
              setConditions(parseFilterString(saved));
              onChange(saved);
              toast.success(`Đã áp dụng bộ lọc “${e.target.value}”`);
            }}
          >
            <option value="">Bộ lọc đã lưu…</option>
            {Object.keys(presets).map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </Select>
        ) : null}

        {activeCount > 0 ? (
          <>
            <Button variant="ghost" size="sm" onClick={clearAll}>
              <RotateCcw /> Xoá bộ lọc
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setPresetName('');
                setSavingPreset(true);
              }}
            >
              <BookmarkPlus /> Lưu bộ lọc
            </Button>
          </>
        ) : null}
      </div>

      {/* Chip điều kiện đang áp dụng */}
      {activeCount > 0 ? (
        <div className="flex flex-wrap gap-1.5">
          {activeChips.map((chip) => (
            <span
              key={chip.id}
              className="inline-flex items-center gap-1 rounded-full border bg-[var(--accent)] px-2 py-0.5 text-[11px]"
            >
              {chip.text}
              <button type="button" onClick={() => removeCondition(chip.id)} className="hover:text-[var(--danger)]">
                <X className="size-3" />
              </button>
            </span>
          ))}
        </div>
      ) : null}

      {/* Bảng dựng điều kiện */}
      {open ? (
        <div className="space-y-3 rounded-xl border bg-[var(--card)] p-3">
          {spec.isLoading ? (
            <div className="text-xs text-[var(--muted-foreground)]">Đang tải cấu hình bộ lọc…</div>
          ) : spec.isError ? (
            <div className="text-xs text-[var(--danger)]">
              Không tải được cấu hình bộ lọc: {(spec.error as Error).message}
            </div>
          ) : (
            <>
              {conditions.length === 0 ? (
                <div className="text-xs text-[var(--muted-foreground)]">
                  Chưa có điều kiện nào — bấm “Thêm điều kiện” để lọc sâu theo từng trường.
                </div>
              ) : null}

              {conditions.map((condition) => {
                const field = fieldOf(condition.field);
                const ops = field?.ops ?? ['eq', 'ne'];
                const needsValue = condition.op !== 'isnull' && condition.op !== 'notnull';
                const options = field ? optionsFor(field) : [];
                const multi = condition.op === 'in' || condition.op === 'nin';
                return (
                  <div key={condition.id} className="grid gap-2 sm:grid-cols-[minmax(0,14rem)_minmax(0,10rem)_minmax(0,1fr)_auto] sm:items-end">
                    <div className="min-w-0 space-y-1">
                      <Label className="text-[11px] text-[var(--muted-foreground)]">Trường</Label>
                      <Select
                        className="h-8 text-xs"
                        value={condition.field}
                        onChange={(e) => {
                          const next = fieldOf(e.target.value);
                          setConditions((prev) =>
                            prev.map((c) =>
                              c.id === condition.id
                                ? { ...c, field: e.target.value, op: next?.defaultOp ?? 'eq', value: '' }
                                : c,
                            ),
                          );
                        }}
                      >
                        {grouped.map(([group, list]) => (
                          <optgroup key={group} label={group}>
                            {list.map((f) => (
                              <option key={f.field} value={f.field}>
                                {f.label}
                              </option>
                            ))}
                          </optgroup>
                        ))}
                      </Select>
                    </div>

                    <div className="min-w-0 space-y-1">
                      <Label className="text-[11px] text-[var(--muted-foreground)]">Điều kiện</Label>
                      <Select
                        className="h-8 text-xs"
                        value={condition.op}
                        onChange={(e) =>
                          setConditions((prev) =>
                            prev.map((c) => (c.id === condition.id ? { ...c, op: e.target.value } : c)),
                          )
                        }
                      >
                        {ops.map((op) => (
                          <option key={op} value={op}>
                            {operators[op] ?? op}
                          </option>
                        ))}
                      </Select>
                    </div>

                    {needsValue ? (
                      <div className="min-w-0 space-y-1">
                        <Label className="text-[11px] text-[var(--muted-foreground)]">Giá trị</Label>
                        {field?.type === 'bool' ? (
                          <Select
                            className="h-8 text-xs"
                            value={condition.value || 'true'}
                            onChange={(e) =>
                              setConditions((prev) =>
                                prev.map((c) => (c.id === condition.id ? { ...c, value: e.target.value } : c)),
                              )
                            }
                          >
                            <option value="true">Có / Đúng</option>
                            <option value="false">Không / Sai</option>
                          </Select>
                        ) : options.length > 0 && !multi ? (
                          <Select
                            className="h-8 text-xs"
                            value={condition.value}
                            onChange={(e) =>
                              setConditions((prev) =>
                                prev.map((c) => (c.id === condition.id ? { ...c, value: e.target.value } : c)),
                              )
                            }
                          >
                            <option value="">— Chọn —</option>
                            {options.map((o) => (
                              <option key={o.value} value={o.value}>
                                {o.label}
                              </option>
                            ))}
                          </Select>
                        ) : multi && options.length > 0 ? (
                          <div className="flex flex-wrap gap-1 rounded-lg border p-1.5">
                            {options.map((o) => {
                              const selected = condition.value.split('|').includes(o.value);
                              return (
                                <button
                                  key={o.value}
                                  type="button"
                                  onClick={() => {
                                    const current = condition.value.split('|').filter(Boolean);
                                    const next = selected
                                      ? current.filter((v) => v !== o.value)
                                      : [...current, o.value];
                                    setConditions((prev) =>
                                      prev.map((c) =>
                                        c.id === condition.id ? { ...c, value: next.join('|') } : c,
                                      ),
                                    );
                                  }}
                                  className={cn(
                                    'rounded-full border px-2 py-0.5 text-[11px]',
                                    selected
                                      ? 'border-[var(--primary)] bg-[var(--primary)] text-[var(--primary-foreground)]'
                                      : 'hover:bg-[var(--accent)]',
                                  )}
                                >
                                  {o.label}
                                </button>
                              );
                            })}
                          </div>
                        ) : (
                          <Input
                            className="h-8 text-xs"
                            type={field?.type === 'number' ? 'number' : field?.type === 'date' ? 'date' : 'text'}
                            placeholder={multi ? 'Nhiều giá trị cách nhau bởi dấu |' : field?.hint ?? 'Nhập giá trị…'}
                            value={condition.value}
                            onChange={(e) =>
                              setConditions((prev) =>
                                prev.map((c) => (c.id === condition.id ? { ...c, value: e.target.value } : c)),
                              )
                            }
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') apply();
                            }}
                          />
                        )}
                        {multi && options.length === 0 ? (
                          <div className="text-[10px] text-[var(--muted-foreground)]">
                            Nhiều giá trị cách nhau bởi dấu |
                          </div>
                        ) : null}
                      </div>
                    ) : (
                      <div className="hidden sm:block" />
                    )}

                    <Button
                      variant="ghost"
                      size="sm"
                      className="justify-self-end text-[var(--danger)]"
                      onClick={() => {
                        const next = conditions.filter((c) => c.id !== condition.id);
                        setConditions(next);
                      }}
                    >
                      <Trash2 />
                    </Button>
                  </div>
                );
              })}

              <div className="flex flex-wrap items-center gap-2 border-t pt-3">
                <Button variant="outline" size="sm" onClick={() => addCondition()}>
                  Thêm điều kiện
                </Button>
                <Button size="sm" onClick={() => apply()}>
                  Áp dụng
                </Button>
                <Button variant="ghost" size="sm" onClick={() => setOpen(false)}>
                  Đóng
                </Button>
                {activeCount > 0 ? (
                  <span className="hidden ml-auto text-[11px] text-[var(--muted-foreground)] sm:inline">
                    Cú pháp gửi lên: <code className="font-mono">{toFilterString(conditions) || '—'}</code>
                  </span>
                ) : null}
              </div>
            </>
          )}
        </div>
      ) : null}

      {/* Lưu bộ lọc thành preset */}
      <Dialog
        open={savingPreset}
        onClose={() => setSavingPreset(false)}
        title="Lưu bộ lọc"
        description="Bộ lọc được lưu trong trình duyệt này để dùng lại nhanh"
        footer={
          <>
            <Button variant="outline" onClick={() => setSavingPreset(false)}>
              Huỷ
            </Button>
            <Button
              disabled={!presetName.trim()}
              onClick={() => {
                const name = presetName.trim();
                persistPresets({ ...presets, [name]: toFilterString(conditions) });
                setSavingPreset(false);
                toast.success(`Đã lưu bộ lọc “${name}”`);
              }}
            >
              <Save /> Lưu
            </Button>
          </>
        }
      >
        <div className="space-y-1.5">
          <Label htmlFor="preset-name">Tên bộ lọc *</Label>
          <Input
            id="preset-name"
            value={presetName}
            onChange={(e) => setPresetName(e.target.value)}
            placeholder="Ví dụ: Phiếu bị trả lại tuần này"
          />
          <div className="pt-1 text-[11px] text-[var(--muted-foreground)]">
            Điều kiện: <code className="font-mono">{toFilterString(conditions)}</code>
          </div>
        </div>
      </Dialog>
    </div>
  );
}

/** Đọc chuỗi filters của backend thành danh sách điều kiện để hiển thị/sửa lại. */
export function parseFilterString(value: string): Condition[] {
  if (!value?.trim()) return [];
  return value
    .split(',')
    .map((chunk) => chunk.trim())
    .filter(Boolean)
    .map((chunk) => {
      const [field = '', op = 'eq', ...rest] = chunk.split(':');
      return { id: (conditionSeq += 1), field: field.trim(), op: op.trim(), value: rest.join(':').trim() };
    })
    .filter((c) => c.field);
}
