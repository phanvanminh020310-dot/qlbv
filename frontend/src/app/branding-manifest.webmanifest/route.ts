import { brandingIconUrl, brandingLogoUrl, embeddedBrandImage, embeddedBrandMime } from '@/lib/branding-assets';
import { getServerBranding } from '@/lib/branding-server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const revalidate = 0;

/** Manifest được đọc lúc trình duyệt cài/cập nhật PWA, nên luôn lấy nhận diện hiện tại từ CSDL. */
export async function GET() {
  const branding = await getServerBranding();
  const version = branding.iconRevision;
  const uploadedImage = embeddedBrandImage(branding.logo);
  const uploadedMime = embeddedBrandMime(branding.logo);
  const generatedPngIcons = [
    { src: brandingIconUrl(192, version), sizes: '192x192', type: 'image/png', purpose: 'any' },
    { src: brandingIconUrl(512, version), sizes: '512x512', type: 'image/png', purpose: 'any' },
    { src: brandingIconUrl(512, version), sizes: '512x512', type: 'image/png', purpose: 'maskable' },
  ];
  // Logo path/URL cũ không bị thay đổi. Logo WebP đã có từ trước vẫn phục vụ nguyên tệp; logo chọn mới được chuẩn hoá PNG.
  const icons = uploadedImage && uploadedMime !== 'image/webp'
    ? generatedPngIcons
    : uploadedImage
      ? [{ src: brandingLogoUrl(version), sizes: 'any', type: uploadedMime, purpose: 'any' }]
      : branding.logo
        ? [{ src: branding.logo, sizes: 'any', purpose: 'any' }]
        : generatedPngIcons;
  const manifest = {
    name: `${branding.name} — ${branding.subtitle}`,
    short_name: branding.name.slice(0, 24),
    description: `${branding.subtitle}: ${branding.hospitalName}.`,
    start_url: '/',
    scope: '/',
    display: 'standalone',
    background_color: '#f6f8fb',
    theme_color: '#0f766e',
    lang: 'vi',
    icons,
  };
  return new Response(JSON.stringify(manifest), {
    headers: {
      'Content-Type': 'application/manifest+json; charset=utf-8',
      'Cache-Control': 'no-store, max-age=0, must-revalidate',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}
