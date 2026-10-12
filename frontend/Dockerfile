# Không dùng dòng "# syntax=docker/dockerfile:1": nó bắt BuildKit tải + chạy một container
# phân tích Dockerfile từ Docker Hub, hay sập ("frontend grpc server closed unexpectedly")
# khi mạng chập chờn/thiếu RAM. Bộ phân tích tích hợp sẵn (Docker >= 20.10) đã hỗ trợ
# RUN --mount=type=cache.
# ---------- Bước 1: cài phụ thuộc ----------
FROM node:22-alpine AS deps
WORKDIR /app
ENV NODE_OPTIONS="--dns-result-order=ipv4first"
COPY package*.json ./
# Cache npm giữa các lần dựng (BuildKit) — chỉ cài lại khi package*.json đổi
RUN --mount=type=cache,id=qlbs-npm-web,target=/root/.npm,sharing=locked \
    npm ci --no-audit --no-fund --maxsockets=5 --fetch-retries=5 --fetch-retry-mintimeout=20000 --fetch-retry-maxtimeout=120000

# ---------- Bước 2: biên dịch Next.js ----------
FROM node:22-alpine AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
# Next.js ghi đích chuyển tiếp /api (rewrites) vào .next/routes-manifest.json NGAY LÚC
# BUILD — đặt biến ở runtime là không đủ. Mặc định trỏ tới service "api" trong compose.
ARG API_PROXY_TARGET=http://api:4000
ENV API_PROXY_TARGET=$API_PROXY_TARGET
# Giữ cache biên dịch của Next.js giữa các lần dựng → lần sau nhanh hơn nhiều
RUN --mount=type=cache,id=qlbs-next-cache,target=/app/.next/cache,sharing=locked npm run build

# ---------- Bước 3: ảnh chạy thật ----------
FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1
RUN apk add --no-cache tini
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/.next ./.next
COPY --from=build /app/public ./public
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/next.config.mjs ./next.config.mjs

USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=25s \
  CMD node -e "fetch('http://127.0.0.1:3000/login').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

ENTRYPOINT ["/sbin/tini", "--"]
CMD ["npm", "run", "start"]
