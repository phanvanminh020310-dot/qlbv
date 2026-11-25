import type { ReactNode } from 'react';
import { PrintParamsHost } from '@/components/printing/print-params-dialog';

export default function TaskModuleLayout({ children }: { children: ReactNode }) {
  return (
    <>
      {children}
      <PrintParamsHost />
    </>
  );
}
