import { streamToApi } from '@/lib/server/stream-proxy';

// Tải lên bản sao lưu (.json.gz) có thể vài chục–vài trăm MB: chuyển tiếp theo luồng,
// tránh giới hạn cắt 10 MB của proxy rewrites (xem lib/server/stream-proxy.ts).
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 1800;

export function POST(request: Request) {
  return streamToApi(request, '/api/backups/upload');
}
