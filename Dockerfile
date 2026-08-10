# syntax=docker/dockerfile:1

FROM node:20-alpine AS base
RUN apk add --no-cache libc6-compat openssl

FROM base AS deps
WORKDIR /app
COPY package.json package-lock.json ./
# better-sqlite3 等原生模块：预编译包下载超时（国内网络）时回退源码编译，需要 Python/编译工具链
RUN apk add --no-cache python3 make g++ \
  && npm ci \
  && apk del --no-cache python3 make g++

FROM base AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
# next build 收集页面数据时会加载 Prisma；构建阶段无需真实数据库
ENV DATABASE_URL="postgresql://build:build@127.0.0.1:5432/build?schema=public"
RUN npx prisma generate
RUN npm run build

# Prisma CLI + transitive deps for `migrate deploy` in entrypoint
FROM builder AS prisma-cli
WORKDIR /app
COPY docker/bundle-prisma-cli.mjs ./docker/bundle-prisma-cli.mjs
RUN node docker/bundle-prisma-cli.mjs

FROM base AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV HOSTNAME=0.0.0.0
# 容器默认端口；可用环境变量 PORT 覆盖
ENV PORT=3000

RUN apk add --no-cache su-exec \
  && addgroup --system --gid 1001 nodejs \
  && adduser --system --uid 1001 nextjs

COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

COPY --from=builder /app/prisma ./prisma
COPY --from=prisma-cli /prisma-bundle/node_modules/ ./node_modules/
RUN test -f node_modules/effect/package.json \
  && test -f node_modules/prisma/build/index.js

COPY docker/entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

RUN mkdir -p /data && chown -R nextjs:nodejs /data

EXPOSE 3000

ENTRYPOINT ["/entrypoint.sh"]
CMD ["node", "server.js"]
