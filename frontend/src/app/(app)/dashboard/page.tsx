'use client';

/**
 * Bảng điều khiển — trang Studio mặc định (cá nhân → vai trò → hệ thống).
 * Người dùng có quyền thiết kế có thể chỉnh sửa trực tiếp hoặc nhân bản
 * thành bản riêng (kéo-thả, thêm ô, tự chọn nguồn số liệu).
 */
import { useQuery } from '@tanstack/react-query';
import { useRouter, useSearchParams } from 'next/navigation';
import { PageHeader } from '@/components/shared/page-header';
import { Skeleton } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/lib/auth';
import { studioApi } from '@/lib/studio';
import { StudioPageFrame, useStudioMeta } from '@/components/studio/studio-page';

export default function DashboardPage() {
  const router = useRouter();
  const user = useAuth((s) => s.user);
  const searchParams = useSearchParams();
  const openSubs = searchParams.get('an-ban') === '1';

  const meta = useStudioMeta();
  const pages = useQuery({
    queryKey: ['studio', 'pages', 'DASHBOARD'],
    queryFn: () => studioApi.pages('DASHBOARD'),
  });
  const def = useQuery({
    queryKey: ['studio', 'default', 'DASHBOARD'],
    queryFn: () => studioApi.defaultPage('DASHBOARD'),
  });

  const firstName = (user?.fullName ?? '').split(' ').slice(-1)[0] ?? '';

  // Ưu tiên trang mặc định; nếu chưa có trang mặc định thì lấy trang đầu tiên được phép xem
  const activePage =
    def.data && typeof def.data === 'object' && 'id' in def.data && def.data.id
      ? def.data
      : pages.data && pages.data.length > 0
        ? pages.data[0]
        : null;

  return (
    <div className="space-y-4">
      <PageHeader
        title={`Xin chào${firstName ? `, ${firstName}` : ''}`}
        description="Bảng điều khiển tuỳ biến — số liệu theo phạm vi được phép, tự cập nhật khi có thay đổi"
        actions={
          useAuth.getState().can('studio.dashboard.view') ? (
            <Button
              variant="outline"
              onClick={async () => {
                const created = await studioApi.createPage({
                  name: 'Bảng điều khiển của tôi',
                  kind: 'DASHBOARD',
                  layout: { widgets: [] },
                });
                await def.refetch();
                await pages.refetch();
                router.push(`/dashboard/trang/${created.id}`);
              }}
            >
              + Trang mới
            </Button>
          ) : undefined
        }
      />
      {def.isLoading || pages.isLoading || meta.isLoading ? (
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3 md:grid-cols-6">
            {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-24" />)}
          </div>
          <Skeleton className="h-72" />
        </div>
      ) : !activePage ? (
        <div className="rounded-[var(--radius-card)] border bg-[var(--card)] p-8 text-center text-sm text-[var(--muted-foreground)]">
          Chưa có bảng điều khiển nào. Bấm &quot;Trang mới&quot; để tự thiết kế.
        </div>
      ) : (
        <StudioPageFrame
          page={activePage}
          pages={pages.data ?? [activePage]}
          autoOpenSubscriptions={openSubs}
          sources={meta.data?.sources ?? []}
          vocabulary={meta.data?.vocabulary ?? { aggs: {}, filterOps: {}, datePresets: {}, buckets: {} } as never}
          allowDelete={false}
          onNavigate={(id) => {
            const hit = (pages.data ?? []).find((p) => p.id === id);
            if (hit) router.push(`/dashboard/trang/${id}`);
          }}
        />
      )}
    </div>
  );
}
