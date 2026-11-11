import { brandingFromSettings, embeddedBrandImage, embeddedBrandMime, type Branding } from '@/lib/branding-assets';

const FALLBACK_ICON = `data:image/svg+xml;base64,${Buffer.from(`
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <rect width="512" height="512" rx="108" fill="#0f766e"/>
  <path fill="#fff" d="M162 116h188c20 0 36 16 36 36v236c0 20-16 36-36 36H162c-20 0-36-16-36-36V152c0-20 16-36 36-36Zm25 54v200h138V170H187Zm46 32h46v46h46v46h-46v46h-46v-46h-46v-46h46v-46Z"/>
</svg>`.trim()).toString('base64')}`;

function settingsOrigin(): string {
  return (process.env.API_PROXY_TARGET ?? 'http://127.0.0.1:4000').replace(/\/$/, '');
}

/** Asset route đọc API nội bộ lúc phục vụ yêu cầu, không đóng băng tên/logo khi build Docker. */
export async function getServerBranding(): Promise<Branding> {
  try {
    const response = await fetch(`${settingsOrigin()}/api/settings/public`, {
      cache: 'no-store',
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(3_000),
    });
    if (!response.ok) return brandingFromSettings();
    const value: unknown = await response.json();
    if (!value || typeof value !== 'object' || Array.isArray(value)) return brandingFromSettings();
    return brandingFromSettings(value as Record<string, unknown>);
  } catch {
    // Không để một API đang khởi động làm hỏng favicon/khả năng cài PWA.
    return brandingFromSettings();
  }
}

/** Không fetch URL quản trị nhập từ phía server; chỉ nhúng dữ liệu ảnh đã backend kiểm tra. */
export function brandingIconSource(branding: Branding): string {
  const mime = embeddedBrandMime(branding.logo);
  // next/og rasterize ổn định PNG/JPEG; WebP cũ được phục vụ nguyên gốc ở /branding-logo.
  return mime === 'image/png' || mime === 'image/jpeg' ? embeddedBrandImage(branding.logo) : FALLBACK_ICON;
}
