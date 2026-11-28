'use client';

import { useSearchParams } from 'next/navigation';
import { Suspense } from 'react';
import { PageHeader } from '@/components/shared/page-header';
import { ModulePrintCenter } from '@/components/printing/module-print-center';
import { PrintParamsHost } from '@/components/printing/print-params-dialog';

function PrintCenter() {
  const moduleCode = useSearchParams().get('module') ?? '';
  return <ModulePrintCenter module={moduleCode || undefined} />;
}

export default function PrintCenterPage() {
  return (
    <div className="space-y-4">
      <PageHeader
        title="In ấn & báo cáo"
        description="Mọi mẫu in tự lấy dữ liệu đang ban hành (theo phân hệ, theo phạm vi khoa của bạn). Mẫu mới thiết kế trong “Thiết kế bản in” tự có ở đây."
      />
      <Suspense>
        <PrintCenter />
      </Suspense>
      <PrintParamsHost />
    </div>
  );
}
