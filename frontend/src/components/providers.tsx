'use client';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';
import { Toaster } from 'sonner';
import { MaintenanceOverlay } from './maintenance-overlay';
import { PwaInstallPrompt } from './pwa-install-prompt';
import { MobileViewportStabilizer } from './mobile-viewport-stabilizer';

/**
 * Bọc ứng dụng với React Query (cache dữ liệu, tự làm mới) và khu vực hiện thông báo.
 */
export function Providers({ children }: { children: ReactNode }) {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 30_000,
            retry: 1,
            refetchOnWindowFocus: false,
          },
        },
      }),
  );

  return (
    <QueryClientProvider client={client}>
      <MobileViewportStabilizer />
      {children}
      <Toaster position="top-right" richColors closeButton />
      <MaintenanceOverlay />
      <PwaInstallPrompt />
    </QueryClientProvider>
  );
}
