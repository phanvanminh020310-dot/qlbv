import type { MetadataRoute } from 'next';

/** Manifest PWA: chỉ được phục vụ trên HTTPS ở môi trường thực. */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'QLBS — Quản lý Bệnh viện',
    short_name: 'QLBS',
    description: 'Phần mềm quản lý bệnh viện QLBS.',
    start_url: '/',
    scope: '/',
    display: 'standalone',
    background_color: '#f6f8fb',
    theme_color: '#0f766e',
    lang: 'vi',
    icons: [
      { src: '/icons/pwa-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icons/pwa-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/icons/pwa-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  };
}
