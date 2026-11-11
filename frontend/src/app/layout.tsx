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
  // Các route này dựng PNG/manifest từ logo hiện tại trong CSDL khi trình duyệt yêu cầu.
  manifest: '/branding-manifest.webmanifest',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'default',
    title: 'QLBS',
  },
  icons: {
    apple: [{ url: '/branding-icon/180', sizes: '180x180', type: 'image/png' }],
    // Icon PWA 192/512 được khai báo trong branding-manifest.webmanifest động.
    icon: [{ url: '/branding-icon/32', sizes: '32x32', type: 'image/png' }],
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
