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
  applicationName: 'QLBS',
  manifest: '/manifest.webmanifest',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'default',
    title: 'QLBS',
  },
  icons: {
    apple: '/icons/pwa-192.png',
    icon: [
      { url: '/icons/pwa-192.png', sizes: '192x192', type: 'image/png' },
      { url: '/icons/pwa-512.png', sizes: '512x512', type: 'image/png' },
    ],
  },
  other: {
    google: 'notranslate',
  },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  minimumScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: 'cover',
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
