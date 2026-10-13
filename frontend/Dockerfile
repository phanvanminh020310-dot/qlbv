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
# Cài đặt phụ thuộc: tận dụng cache npm của BuildKit để tải siêu tốc
RUN --mount=type=cache,target=/root/.npm \
    npm ci --no-audit --no-fund --fetch-retries=5 --fetch-retry-mintimeout=5000 --fetch-retry-maxtimeout=60000 \
    || (npm cache clean --force && npm install --no-audit --no-fund)

# ---------- Bước 2: biên dịch Next.js ----------
FROM node:22-alpine AS build
RUN apk add --no-cache libc6-compat
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
ARG API_PROXY_TARGET=http://api:4000
ENV API_PROXY_TARGET=$API_PROXY_TARGET
# Tận dụng cache Next.js (.next/cache) để biên dịch gia tăng (Incremental Compilation), giảm 80% thời gian build
RUN --mount=type=cache,target=/app/.next/cache \
    npm run build

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
