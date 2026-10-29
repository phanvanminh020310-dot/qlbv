'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertTriangle,
  CheckCircle2,
  Clock3,
  RefreshCw,
  ShieldAlert,
  ShieldCheck,
  Unlock,
  UsersRound,
} from 'lucide-react';
import { useMemo, useState } from 'react';
import { toast } from 'sonner';
import { PageHeader } from '@/components/shared/page-header';
import { Button } from '@/components/ui/button';
import { Badge, Card, CardBody, CardHeader, EmptyState, Skeleton } from '@/components/ui/card';
import { Dialog } from '@/components/ui/dialog';
import { Label, Textarea } from '@/components/ui/input';
import { apiFetch } from '@/lib/api';
import { useAuth } from '@/lib/auth';

interface ActiveGlobalRelease {
  id: string;
  operationId: string;
  roomCode: string;
  roomName: string;
  shiftEndAt: string;
  activatedAt: string;
  activatedBy: { username: string; fullName: string };
  reason: string;
  connectedTerminals: number;
}

interface ReleaseStatus {
  serverTime: number;
  active: ActiveGlobalRelease[];
}

interface ReleaseResult {
  operationId: string;
  activatedAt: string;
  message: string;
  connectedTerminals: number;
  affectedRooms: Array<{
    roomCode: string;
    roomName: string;
    shiftName: string;
    shiftEndMs: number;
    activeAssignments: number;
    connectedTerminals: number;
  }>;
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : 'Không thể thực hiện thao tác';
}

function localDate(value: string | number): string {
  return new Date(value).toLocaleString('vi-VN', {
    timeZone: 'Asia/Bangkok',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

/** A deliberately small, ADMIN-only control surface for a high-impact Kiosk release. */
export default function KioskEmergencyPage() {
  const user = useAuth((state) => state.user);
  const isAdmin = !!user?.isSuperAdmin || (user?.roles ?? []).includes('ADMIN');
  const queryClient = useQueryClient();
  const [reason, setReason] = useState('');
  const [confirmOpen, setConfirmOpen] = useState(false);
  const cleanReason = reason.trim();

  const status = useQuery({
    queryKey: ['kiosk-global-emergency-release'],
    queryFn: () => apiFetch<ReleaseStatus>('/kiosk/global-release'),
    enabled: isAdmin,
    refetchInterval: 12_000,
    staleTime: 5_000,
  });

  const activate = useMutation({
    mutationFn: () => apiFetch<ReleaseResult>('/kiosk/global-release', {
      method: 'POST',
      body: { reason: cleanReason },
    }),
    onSuccess: async (result) => {
      setConfirmOpen(false);
      setReason('');
      toast.success(result.message, {
        description: `${result.affectedRooms.length} phòng · ${result.connectedTerminals} máy trạm đang kết nối đã nhận lệnh ngay.`,
      });
      await queryClient.invalidateQueries({ queryKey: ['kiosk-global-emergency-release'] });
    },
    onError: (error) => toast.error(errorText(error)),
  });

  const sortedActive = useMemo(
    () => [...(status.data?.active ?? [])].sort((a, b) => a.shiftEndAt.localeCompare(b.shiftEndAt)),
    [status.data?.active],
  );

  if (!isAdmin) {
    return (
      <EmptyState
        title="Chức năng này chỉ dành cho quản trị hệ thống"
        description="Mở khẩn cấp toàn bộ Kiosk chỉ chấp nhận tài khoản có vai trò ADMIN hoặc SUPER_ADMIN. Máy chủ vẫn kiểm tra vai trò cho mọi yêu cầu, kể cả khi truy cập trực tiếp đường dẫn."
      />
    );
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title="Mở khẩn cấp toàn bộ Kiosk"
        description="Chỉ mở những phòng đang có ca trực đã công bố. Hết ca hoặc thay đổi bác sĩ/lịch trực, từng Kiosk tự trở lại màn hình khoá và yêu cầu xác thực bình thường."
        actions={
          <Button variant="outline" onClick={() => status.refetch()} loading={status.isFetching}>
            <RefreshCw /> Làm mới trạng thái
          </Button>
        }
      />

      <Card className="border-red-300 bg-red-50/60 dark:border-red-900 dark:bg-red-950/20">
        <CardBody className="flex gap-3 py-4 text-sm text-red-950 dark:text-red-100">
          <ShieldAlert className="mt-0.5 size-6 shrink-0" />
          <div className="space-y-1">
            <p><b>Thao tác vận hành khẩn cấp có phạm vi toàn bệnh viện.</b> Máy trạm đang kết nối nhận lệnh đích danh ngay; máy mất kết nối sẽ đối soát phiên đã lưu khi kết nối lại.</p>
            <p>Không sửa lịch trực, không tạo điểm danh, không thay thế xác thực khuôn mặt. Mỗi phòng chỉ được mở đến mốc kết thúc ca hiện hành và bị thu hồi ngay khi roster/bác sĩ thay đổi.</p>
          </div>
        </CardBody>
      </Card>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(360px,0.8fr)]">
        <Card>
          <CardHeader
            title="Kích hoạt mở khẩn cấp"
            description="Nhập lý do để lưu cùng người thực hiện, thời điểm và danh sách phòng chịu tác động trong Nhật ký kiểm toán."
            actions={<Badge tone="danger">ADMIN / SUPER_ADMIN</Badge>}
          />
          <CardBody className="space-y-4">
            <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-950 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-100">
              <div className="flex gap-2"><AlertTriangle className="mt-0.5 size-4 shrink-0" /><p>Chỉ dùng khi cần duy trì vận hành tức thì. Không có nút mở vĩnh viễn hoặc bỏ qua ranh giới ca.</p></div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="global-kiosk-reason">Lý do mở khẩn cấp *</Label>
              <Textarea
                id="global-kiosk-reason"
                rows={4}
                maxLength={500}
                value={reason}
                onChange={(event) => setReason(event.target.value)}
                placeholder="Ví dụ: Sự cố xác thực diện rộng tại các phòng khám, đang chờ CNTT khắc phục…"
              />
              <p className="text-xs text-[var(--muted-foreground)]">{cleanReason.length}/500 ký tự · tối thiểu 5 ký tự.</p>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-4">
              <p className="max-w-xl text-xs text-[var(--muted-foreground)]">Sau khi xác nhận, máy chủ kiểm tra ca hiện hành trước rồi mới lưu phiên và gửi lệnh. Nếu không thể ghi nhận an toàn, không máy nào được mở.</p>
              <Button variant="danger" disabled={cleanReason.length < 5} onClick={() => setConfirmOpen(true)}>
                <Unlock /> Mở toàn bộ Kiosk theo ca hiện tại
              </Button>
            </div>
          </CardBody>
        </Card>

        <Card>
          <CardHeader
            title="Cơ chế an toàn"
            description="Không cần thao tác thủ công để khoá lại."
          />
          <CardBody className="space-y-4 text-sm">
            <div className="flex gap-3"><ShieldCheck className="size-5 shrink-0 text-emerald-600" /><div><b>Kiểm tra đúng ca đã công bố</b><p className="mt-0.5 text-xs text-[var(--muted-foreground)]">Phòng không có ca hiện hành không được đưa vào lần mở khẩn cấp.</p></div></div>
            <div className="flex gap-3"><Clock3 className="size-5 shrink-0 text-emerald-600" /><div><b>Khoá lại tại ranh giới ca</b><p className="mt-0.5 text-xs text-[var(--muted-foreground)]">Mốc kết thúc sớm nhất của các phân công đang trực là hạn tuyệt đối.</p></div></div>
            <div className="flex gap-3"><UsersRound className="size-5 shrink-0 text-emerald-600" /><div><b>Thu hồi khi đổi roster/bác sĩ</b><p className="mt-0.5 text-xs text-[var(--muted-foreground)]">Chữ ký danh sách phân công được đối soát khi lịch thay đổi, khi Kiosk nhận SSE và khi Kiosk tự kiểm tra trạng thái.</p></div></div>
          </CardBody>
        </Card>
      </div>

      <Card>
        <CardHeader
          title="Phiên mở khẩn cấp đang hiệu lực"
          description={status.data ? `Đối soát lúc ${localDate(status.data.serverTime)} · tự làm mới mỗi 12 giây.` : 'Đang tải trạng thái từ máy chủ…'}
          actions={<Badge tone={sortedActive.length ? 'danger' : 'success'}>{sortedActive.length ? `${sortedActive.length} phòng đang mở` : 'Không có phiên mở'}</Badge>}
        />
        <CardBody className="space-y-3">
          {status.isLoading ? <Skeleton className="h-36 w-full" /> : null}
          {!status.isLoading && sortedActive.length === 0 ? (
            <div className="rounded-lg border border-dashed p-8 text-center text-sm text-[var(--muted-foreground)]"><ShieldCheck className="mx-auto mb-2 size-6 text-emerald-600" />Không có Kiosk nào đang được mở bằng chế độ khẩn cấp toàn cục.</div>
          ) : null}
          {sortedActive.map((release) => (
            <div key={release.id} className="grid gap-3 rounded-lg border p-3 md:grid-cols-[minmax(0,1fr)_auto] md:items-center">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2"><b>{release.roomName}</b><Badge tone="danger">{release.roomCode}</Badge><Badge tone="info">{release.connectedTerminals} máy đang kết nối</Badge></div>
                <p className="mt-1 break-words text-sm text-[var(--muted-foreground)]">Lý do: {release.reason}</p>
                <p className="mt-1 text-xs text-[var(--muted-foreground)]">Kích hoạt bởi {release.activatedBy.fullName} ({release.activatedBy.username}) lúc {localDate(release.activatedAt)}</p>
              </div>
              <div className="rounded-md bg-amber-50 px-3 py-2 text-right text-xs text-amber-950 dark:bg-amber-950/30 dark:text-amber-100"><span className="block font-medium">Tự khoá không muộn hơn</span><span>{localDate(release.shiftEndAt)}</span></div>
            </div>
          ))}
        </CardBody>
      </Card>

      <Dialog
        open={confirmOpen}
        onClose={() => { if (!activate.isPending) setConfirmOpen(false); }}
        title="Xác nhận mở khẩn cấp toàn bộ Kiosk"
        description="Lệnh sẽ áp dụng ngay cho mọi phòng có ca trực hiện hành sau khi máy chủ kiểm tra roster. Mọi chi tiết được ghi Nhật ký kiểm toán."
        footer={<><Button variant="ghost" disabled={activate.isPending} onClick={() => setConfirmOpen(false)}>Huỷ</Button><Button variant="danger" loading={activate.isPending} onClick={() => activate.mutate()}><CheckCircle2 /> Xác nhận mở khẩn cấp</Button></>}
      >
        <div className="space-y-3 text-sm">
          <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-red-950 dark:border-red-900 dark:bg-red-950/30 dark:text-red-100"><b>Phạm vi:</b> tất cả Kiosk thuộc các ca hiện tại, không chỉ các máy đang hiển thị ở danh sách.</div>
          <div><span className="text-[var(--muted-foreground)]">Lý do sẽ ghi:</span><p className="mt-1 whitespace-pre-wrap rounded-md bg-[var(--muted)] p-2">{cleanReason}</p></div>
          <p className="text-xs text-[var(--muted-foreground)]">Các Kiosk tự trở về quy trình xác thực bình thường khi hết ca hoặc roster/bác sĩ hiện hành thay đổi.</p>
        </div>
      </Dialog>
    </div>
  );
}
