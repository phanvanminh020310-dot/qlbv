import { createElement } from 'react';
import { ImageResponse } from 'next/og';
import { brandingIconSource, getServerBranding } from '@/lib/branding-server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const revalidate = 0;

const SUPPORTED_SIZES = new Set([32, 180, 192, 512]);

/** PNG động cho favicon, Apple touch icon và manifest PWA. */
export async function GET(_request: Request, context: { params: Promise<{ size: string }> }) {
  const { size: rawSize } = await context.params;
  const size = Number(rawSize);
  if (!Number.isInteger(size) || !SUPPORTED_SIZES.has(size)) {
    return new Response('Kích thước icon không hợp lệ', { status: 404 });
  }

  const branding = await getServerBranding();
  const source = brandingIconSource(branding);
  const response = new ImageResponse(
    createElement(
      'div',
      {
        style: {
          width: '100%',
          height: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          overflow: 'hidden',
          background: '#ffffff',
        },
      },
      createElement('img', {
        src: source,
        width: `${size}px`,
        height: `${size}px`,
        style: { objectFit: 'contain' },
      }),
    ),
    { width: size, height: size },
  );
  response.headers.set('Cache-Control', 'no-store, max-age=0, must-revalidate');
  response.headers.set('X-Content-Type-Options', 'nosniff');
  return response;
}
