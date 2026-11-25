'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CalendarClock, Eye, Send } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Badge, Card, Skeleton } from '@/components/ui/card';
import { Switch } from '@/components/ui/input';
import { formatDateTime } from '@/lib/utils';
import { taskKeys, tasksApi } from '@/lib/tasks';

/** Thẻ “Tổng hợp công việc hàng tuần” ở trang Cá nhân: bật/tắt, xem trước, gửi thử. */
export function TaskDigestCard() {
  const qc = useQueryClient();
  const [showPreview, setShowPreview] = useState(false);
  const status = useQuery({ queryKey: taskKeys.digest, queryFn: tasksApi.digest });
  const toggle = useMutation({
    mutationFn: (enabled: boolean) => tasksApi.setDigest(enabled),
    onSuccess: (d) => {
      toast.success(d.enabled ? 'Đã bật nhận tổng hợp công việc hàng tuần' : 'Đã tắt tổng hợp công việc hàng tuần');
      void qc.invalidateQueries({ queryKey: taskKeys.digest });
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const send = useMutation({
    mutationFn: tasksApi.sendDigest,
    onSuccess: () => toast.success(status.data?.hasTelegram ? 'Đã gửi — kiểm tra chuông thông báo và Telegram' : 'Đã gửi vào chuông thông báo (bạn chưa liên kết Telegram)'),
    onError: (e: Error) => toast.error(e.message),
  });
  const st = status.data;

  return (
    <Card className="overflow-hidden">
      <div className="flex items-center justify-between border-b bg-slate-50/50 px-4 py-3 dark:bg-slate-900/40">
        <div className="flex items-center gap-2 text-sm font-semibold">
          <CalendarClock className="size-4 text-teal-600" />
          <span>Tổng hợp công việc hàng tuần</span>
        </div>
        {status.isLoading ? <Skeleton className="h-5 w-10" /> : st ? (
          <Switch checked={st.enabled} disabled={toggle.isPending || !st.globalEnabled} onCheckedChange={(v) => toggle.mutate(v)} />
        ) : null}
      </div>
      <div className="space-y-3 p-4 text-sm">
        {status.isLoading ? <Skeleton className="h-14" /> : !st ? null : !st.globalEnabled ? (
          <p className="text-xs leading-relaxed text-[var(--muted-foreground)]">Quản trị hệ thống đang tắt tính năng tổng hợp công việc hàng tuần.</p>
        ) : (
          <>
            <p className="text-xs leading-relaxed text-[var(--muted-foreground)]">
              Gửi vào <b>{st.schedule}</b> qua chuông thông báo{st.hasTelegram ? ' và Telegram' : ''}: việc đang làm, quá hạn, sắp đến hạn, chờ duyệt, việc đã giao và kết quả 7 ngày qua.
              Không có việc gì thì không gửi.
            </p>
            {!st.hasTelegram ? <Badge tone="warning" className="text-[11px]">Liên kết Telegram ở thẻ phía trên để nhận trên điện thoại</Badge> : null}
            {st.lastSentAt ? <div className="text-[11px] text-[var(--muted-foreground)]">Lần gửi gần nhất: {formatDateTime(st.lastSentAt)}</div> : null}
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="outline" className="text-xs" onClick={() => setShowPreview((v) => !v)}>
                <Eye className="mr-1 size-3.5" /> {showPreview ? 'Ẩn bản xem trước' : 'Xem trước'}
              </Button>
              <Button size="sm" variant="outline" className="text-xs" loading={send.isPending} onClick={() => send.mutate()}>
                <Send className="mr-1 size-3.5" /> Gửi thử cho tôi
              </Button>
            </div>
            {showPreview && st.preview ? (
              <div className="rounded-xl border bg-[var(--muted)]/60 p-3 text-xs">
                <div className="mb-1 font-semibold">🔔 {st.preview.title}</div>
                <pre className="whitespace-pre-wrap break-words font-sans leading-relaxed">{st.preview.body}</pre>
                {!st.preview.hasContent ? <div className="mt-1 italic text-[var(--muted-foreground)]">Hiện bạn không có việc nào — tuần này sẽ không gửi.</div> : null}
              </div>
            ) : null}
          </>
        )}
      </div>
    </Card>
  );
}
