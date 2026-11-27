import http from 'node:http';
import https from 'node:https';
import { Readable } from 'node:stream';

/**
 * Chuyển tiếp nguyên luồng (streaming) một yêu cầu tải lên lớn sang API NestJS.
 *
 * Vì sao cần: proxy `rewrites()` của Next.js 15 sao chép thân yêu cầu để phục vụ
 * middleware và CẮT ở 10 MB (middlewareClientMaxBodySize) nhưng vẫn gửi nguyên
 * Content-Length. API khi đó chờ mãi phần còn lại → Nginx trả 504. Tăng giới hạn
 * thì Next lại giữ toàn bộ tệp trong RAM. Route này đọc thân yêu cầu theo luồng và
 * ghi thẳng sang API, không đệm, không giới hạn kích thước (API tự kiểm soát).
 */
const HOP_BY_HOP = new Set(['connection', 'keep-alive', 'proxy-authenticate', 'proxy-authorization', 'te', 'trailer', 'transfer-encoding', 'upgrade', 'host', 'expect']);
const TIMEOUT_MS = 30 * 60 * 1000;

export function apiTarget() {
  return (process.env.API_PROXY_TARGET ?? 'http://127.0.0.1:4000').replace(/\/+$/, '');
}

export async function streamToApi(request: Request, apiPath: string): Promise<Response> {
  const incoming = new URL(request.url);
  const target = new URL(`${apiTarget()}${apiPath}${incoming.search}`);
  const headers: Record<string, string> = {};
  request.headers.forEach((value, key) => { if (!HOP_BY_HOP.has(key.toLowerCase())) headers[key] = value; });
  const forwardedFor = request.headers.get('x-forwarded-for');
  headers['x-forwarded-host'] = request.headers.get('x-forwarded-host') ?? request.headers.get('host') ?? '';
  headers['x-forwarded-proto'] = request.headers.get('x-forwarded-proto') ?? incoming.protocol.replace(':', '');
  if (forwardedFor) headers['x-forwarded-for'] = forwardedFor;
  // Không có Content-Length (trình duyệt luôn gửi, nhưng phòng hờ) → dùng chunked.
  if (!headers['content-length']) headers['transfer-encoding'] = 'chunked';

  const client = target.protocol === 'https:' ? https : http;
  return new Promise<Response>((resolve) => {
    const upstream = client.request(target, { method: request.method, headers, timeout: TIMEOUT_MS }, (res) => {
      const out = new Headers();
      for (const [key, value] of Object.entries(res.headers)) {
        if (value === undefined || HOP_BY_HOP.has(key.toLowerCase()) || key.toLowerCase() === 'content-length') continue;
        if (Array.isArray(value)) value.forEach((item) => out.append(key, item)); else out.set(key, String(value));
      }
      resolve(new Response(Readable.toWeb(res) as ReadableStream, { status: res.statusCode ?? 502, headers: out }));
    });
    const fail = (status: number, message: string) => resolve(Response.json({ statusCode: status, message }, { status }));
    upstream.on('timeout', () => { upstream.destroy(new Error('timeout')); fail(504, 'Máy chủ xử lý tệp quá lâu (quá 30 phút). Vui lòng thử lại hoặc liên hệ CNTT.'); });
    upstream.on('error', (error) => fail(502, `Không chuyển được tệp tới máy chủ API: ${error.message}`));
    if (!request.body) { upstream.end(); return; }
    const body = Readable.fromWeb(request.body as import('node:stream/web').ReadableStream);
    body.on('error', (error) => upstream.destroy(error));
    body.pipe(upstream);
  });
}
