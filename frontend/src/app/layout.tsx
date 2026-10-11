import type { Metadata, Viewport } from 'next';
import './globals.css';
import { Providers } from '@/components/providers';

export const metadata: Metadata = {
  title: {
    default: 'QLBS — Phần mềm Quản lý Bệnh viện',
    template: '%s · QLBS',
  },
  description:
    'Hệ thống quản lý bệnh viện: sửa hồ sơ bệnh án điện tử, báo cáo công tác của khoa, thiết kế bản in và quản trị tập trung.',
  other: {
    google: 'notranslate',
  },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: '#2563eb',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="vi" translate="no" className="notranslate" suppressHydrationWarning>
      <head>
        <meta name="google" content="notranslate" />
      </head>
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
