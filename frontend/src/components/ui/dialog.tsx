'use client';

import { X } from 'lucide-react';
import { useEffect, type ReactNode } from 'react';
import { cn } from '@/lib/utils';

/**
 * Hộp thoại đơn giản (không phụ thuộc thư viện ngoài) — dùng cho form thêm/sửa.
 */
export function Dialog({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  size = 'md',
}: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  description?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  size?: 'sm' | 'md' | 'lg' | 'xl' | 'full';
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose();
    };
    if (open) document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  const sizes: Record<string, string> = {
    sm: 'max-w-md',
    md: 'max-w-2xl',
    lg: 'max-w-4xl',
    xl: 'max-w-6xl',
    full: 'max-w-[95vw]',
  };

  return (
    <div className="app-viewport-fixed app-safe-overlay fixed inset-x-0 top-0 z-50 flex items-start justify-center overflow-y-auto bg-black/45 p-4 sm:items-center">
      <div
        className={cn(
          'my-4 w-full rounded-[var(--radius-card)] border bg-[var(--card)] shadow-xl',
          sizes[size],
        )}
        role="dialog"
        aria-modal="true"
      >
        <div className="flex items-start justify-between gap-4 border-b px-4 py-3">
          <div className="space-y-0.5">
            <div className="text-base font-semibold">{title}</div>
            {description ? (
              <div className="text-xs text-[var(--muted-foreground)]">{description}</div>
            ) : null}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1 text-[var(--muted-foreground)] hover:bg-[var(--muted)]"
            aria-label="Đóng"
          >
            <X className="size-4" />
          </button>
        </div>
        <div className="max-h-[calc(var(--qlbs-viewport-height,100dvh)-12rem)] overflow-y-auto px-4 py-4">{children}</div>
        {footer ? <div className="flex justify-end gap-2 border-t px-4 py-3">{footer}</div> : null}
      </div>
    </div>
  );
}

export function ConfirmDialog({
  open,
  title,
  message,
  confirmText = 'Xác nhận',
  loading,
  onConfirm,
  onClose,
}: {
  open: boolean;
  title: string;
  message: ReactNode;
  confirmText?: string;
  loading?: boolean;
  onConfirm: () => void;
  onClose: () => void;
}) {
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={title}
      size="sm"
      footer={
        <>
          <button className="rounded-lg border px-3 py-1.5 text-sm" onClick={onClose} type="button">
            Huỷ
          </button>
          <button
            className="rounded-lg bg-[var(--danger)] px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
            onClick={onConfirm}
            disabled={loading}
            type="button"
          >
            {loading ? 'Đang xử lý…' : confirmText}
          </button>
        </>
      }
    >
      <div className="text-sm">{message}</div>
    </Dialog>
  );
}
