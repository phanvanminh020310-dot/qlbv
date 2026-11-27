import { streamToApi } from '@/lib/server/stream-proxy';

// Gói đầy đủ .bundle.tar.gz (CSDL + HSBA/ảnh) có thể tới nhiều GB: chuyển tiếp theo luồng.
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 1800;

export function POST(request: Request) {
  return streamToApi(request, '/api/backups/upload/bundle');
}
