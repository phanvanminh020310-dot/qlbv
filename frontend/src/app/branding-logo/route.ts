import { embeddedBrandImage, embeddedBrandMime } from '@/lib/branding-assets';
import { getServerBranding } from '@/lib/branding-server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const revalidate = 0;

/** Phục vụ nguyên tệp logo cũ (đặc biệt WebP) mà không để browser phải đọc Data URL lớn trong manifest. */
export async function GET() {
  const branding = await getServerBranding();
  const source = embeddedBrandImage(branding.logo);
  const mime = embeddedBrandMime(branding.logo);
  const encoded = source.split(',', 2)[1];
  if (!source || !mime || !encoded) return new Response(null, { status: 404 });
  return new Response(Buffer.from(encoded, 'base64'), {
    headers: {
      'Content-Type': mime,
      'Cache-Control': 'no-store, max-age=0, must-revalidate',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}
