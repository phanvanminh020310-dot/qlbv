'use client';

/**
 * Dashboard mặc định: lớp tổng quan vận hành cố định + Studio tùy biến bên
 * dưới. Không thay đổi/bỏ dữ liệu Studio có sẵn của từng người dùng.
 */
import { useQuery } from '@tanstack/react-query';
import { ChevronDown, LayoutPanelTop, Plus } from 'lucide-react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { CardBody, Skeleton } from '@/components/ui/card';
import { DashboardOverview } from '@/components/dashboard/dashboard-overview';
import { useAuth } from '@/lib/auth';
import { studioApi } from '@/lib/studio';
import { StudioPageFrame, useStudioMeta } from '@/components/studio/studio-page';

export default function DashboardPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const openSubs = searchParams.get('an-ban') === '1';
  const [studioOpen, setStudioOpen] = useState(openSubs);
  const canDesign = useAuth((state) => state.can)('studio.dashboard.view');

  const meta = useStudioMeta();
  const pages = useQuery({
    queryKey: ['studio', 'pages', 'DASHBOARD'],
    queryFn: () => studioApi.pages('DASHBOARD'),
  });
  const def = useQuery({
    queryKey: ['studio', 'default', 'DASHBOARD'],
    queryFn: () => studioApi.defaultPage('DASHBOARD'),
  });

  // Ưu tiên trang mặc định; nếu chưa có thì lấy trang đầu tiên người dùng được xem.
  const activePage =
    def.data && typeof def.data === 'object' && 'id' in def.data && def.data.id
      ? def.data
      : pages.data && pages.data.length > 0
        ? pages.data[0]
        : null;

  return (
    <div className="mx-auto max-w-[1680px] space-y-5">
      <DashboardOverview />

      <section className="overflow-hidden rounded-2xl border bg-[var(--card)] shadow-sm">
        <div className="flex flex-col gap-3 border-b px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-5">
          <button
            type="button"
            onClick={() => setStudioOpen((open) => !open)}
            className="flex min-w-0 flex-1 items-center gap-3 text-left"
            aria-expanded={studioOpen}
          >
            <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-[var(--accent)] text-[var(--primary)]">
              <LayoutPanelTop className="size-5" />
            </span>
            <span className="min-w-0">
              <span className="block text-base font-semibold">Bảng điều khiển tùy biến</span>
              <span className="block truncate text-xs text-[var(--muted-foreground)]">Mở các bảng phân tích Studio theo vai trò hoặc trang riêng của bạn.</span>
            </span>
            <ChevronDown className={`ml-auto size-4 shrink-0 text-[var(--muted-foreground)] transition-transform ${studioOpen ? 'rotate-180' : ''}`} />
          </button>
          {canDesign ? (
            <Button
              variant="outline"
              size="sm"
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
              <Plus className="size-4" /> Trang mới
            </Button>
          ) : null}
        </div>

        {studioOpen ? (
          <CardBody className="p-3 sm:p-5">
            {def.isLoading || pages.isLoading || meta.isLoading ? (
              <div className="space-y-3">
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
                  {Array.from({ length: 4 }, (_, index) => <Skeleton key={index} className="h-28" />)}
                </div>
                <Skeleton className="h-72" />
              </div>
            ) : !activePage ? (
              <div className="rounded-xl border border-dashed px-4 py-10 text-center text-sm text-[var(--muted-foreground)]">
                Chưa có bảng Studio nào được chia sẻ cho bạn. {canDesign ? 'Bấm “Trang mới” để tự thiết kế.' : 'Liên hệ quản trị viên để được cấp trang phù hợp.'}
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
                  const hit = (pages.data ?? []).find((page) => page.id === id);
                  if (hit) router.push(`/dashboard/trang/${id}`);
                }}
              />
            )}
          </CardBody>
        ) : null}
      </section>
    </div>
  );
}
