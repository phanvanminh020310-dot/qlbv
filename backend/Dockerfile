# Không dùng dòng "# syntax=docker/dockerfile:1": nó bắt BuildKit tải + chạy một container
# phân tích Dockerfile từ Docker Hub, hay sập ("frontend grpc server closed unexpectedly")
# khi mạng chập chờn/thiếu RAM. Bộ phân tích tích hợp sẵn (Docker >= 20.10) đã hỗ trợ
# RUN --mount=type=cache.
# ---------- Bước 1: cài phụ thuộc ----------
FROM node:22-alpine AS deps
RUN apk add --no-cache libc6-compat
WORKDIR /app
ENV NODE_OPTIONS="--dns-result-order=ipv4first"
COPY package*.json ./
# Cài đặt phụ thuộc: tận dụng cache npm của BuildKit để tải siêu tốc (ưu tiên offline)
RUN --mount=type=cache,target=/root/.npm \
    npm ci --prefer-offline --no-audit --no-fund --fetch-retries=5 --fetch-retry-mintimeout=5000 --fetch-retry-maxtimeout=60000 \
    || (npm cache clean --force && npm install --prefer-offline --no-audit --no-fund)

# ---------- Bước 2: biên dịch TypeScript ----------
FROM node:22-alpine AS build
RUN apk add --no-cache libc6-compat
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NODE_OPTIONS="--max-old-space-size=1536 --dns-result-order=ipv4first"
RUN npm run build && npm prune --omit=dev --no-audit --no-fund

# ---------- Bước 3: ảnh chạy thật ----------
FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
# fontconfig + dejavu để PDF/bản in có đủ ký tự tiếng Việt khi dùng font hệ thống
RUN apk add --no-cache tini fontconfig ttf-dejavu && fc-cache -f
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/drizzle ./drizzle
COPY --from=build /app/scripts ./scripts
# scripts/*.ts chạy bằng tsx lúc khởi động (migrate + seed + demo) nên cần src/
# (seed.ts import ../src/config/env, ../src/db/schema, ../src/db/seed-data)
COPY --from=build /app/src ./src
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/tsconfig.json ./tsconfig.json

# Thư mục dữ liệu người dùng tải lên & sao lưu (gắn volume khi chạy thật)
RUN mkdir -p /app/uploads /app/backups && chown -R node:node /app/uploads /app/backups
USER node
EXPOSE 4000
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s \
  CMD node -e "fetch('http://127.0.0.1:4000/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

ENTRYPOINT ["/sbin/tini", "--"]
# Chạy migration + dữ liệu nền rồi mới khởi động API (idempotent, an toàn khi chạy lại)
CMD ["sh", "-c", "npx tsx scripts/migrate.ts && npx tsx scripts/seed.ts && node dist/main.js"]
