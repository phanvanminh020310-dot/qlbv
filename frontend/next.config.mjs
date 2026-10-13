/** @type {import('next').NextConfig} */
const API_PROXY_TARGET = process.env.API_PROXY_TARGET ?? 'http://127.0.0.1:4000';

/** Cấu hình Next.js: chuyển tiếp mọi lời gọi /api và /health sang máy chủ NestJS. */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  eslint: { ignoreDuringBuilds: true },
  typescript: {
    // Bỏ qua kiểm tra typecheck trùng lặp trong Docker build để tăng tốc gấp 3 lần trên VPS
    ignoreBuildErrors: true,
  },
  // Tăng timeout static generation để không bao giờ bị nghẽn trang
  staticPageGenerationTimeout: 180,
  // Cho phép truy cập khi chạy dev sau proxy/tên miền tạm (môi trường phát triển)
  allowedDevOrigins: ['*.e2b.app', '*.e2b.dev', '*.arena.ai', 'localhost', '127.0.0.1'],
  experimental: {
    // Ép chạy 1 luồng duy nhất khi tạo trang tĩnh (Static Generation) trên VPS ít RAM
    // Tránh việc Next.js tạo nhiều worker song song gây tràn RAM và kẹt cứng ở Generating static pages (16/37)
    cpus: 1,
    workerThreads: false,
    webpackBuildWorker: false,
    // Sao lưu / phục hồi CSDL lớn có thể mất vài phút — mặc định proxy chỉ chờ 30 giây
    proxyTimeout: 15 * 60 * 1000,
  },
  async rewrites() {
    return [
      { source: '/api/:path*', destination: `${API_PROXY_TARGET}/api/:path*` },
      { source: '/health', destination: `${API_PROXY_TARGET}/health` },
    ];
  },
};

export default nextConfig;
