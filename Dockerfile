# syntax=docker/dockerfile:1

FROM node:20-alpine AS base
RUN apk add --no-cache libc6-compat openssl

FROM base AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM base AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN npx prisma generate
RUN npm run build

# Prisma CLI + transitive deps for `migrate deploy` in entrypoint
FROM builder AS prisma-cli
WORKDIR /app
RUN node <<'EOF'
const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

function collect(pkg, seen = new Set()) {
  if (seen.has(pkg)) return seen;
  seen.add(pkg);
  const parts = pkg.startsWith("@") ? pkg.split("/") : [pkg];
  const pkgJson = path.join("node_modules", ...parts, "package.json");
  if (!fs.existsSync(pkgJson)) return seen;
  const meta = JSON.parse(fs.readFileSync(pkgJson, "utf8"));
  for (const dep of Object.keys({
    ...(meta.dependencies || {}),
    ...(meta.optionalDependencies || {}),
  })) {
    collect(dep, seen);
  }
  return seen;
}

fs.mkdirSync("/prisma-bundle/node_modules", { recursive: true });
for (const pkg of collect("prisma")) {
  const parts = pkg.startsWith("@") ? pkg.split("/") : [pkg];
  const src = path.join("node_modules", ...parts);
  const dest = path.join("/prisma-bundle/node_modules", ...parts);
  if (!fs.existsSync(src)) continue;
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  execSync(`cp -r "${src}" "${dest}"`);
}
EOF

FROM base AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV HOSTNAME=0.0.0.0
# Railway 会注入 PORT；本地默认 3000
ENV PORT=3000

RUN apk add --no-cache su-exec \
  && addgroup --system --gid 1001 nodejs \
  && adduser --system --uid 1001 nextjs

COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

COPY --from=builder /app/prisma ./prisma
COPY --from=prisma-cli /prisma-bundle/node_modules/ ./node_modules/

COPY docker/entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

RUN mkdir -p /data && chown -R nextjs:nodejs /data

EXPOSE 3000

ENTRYPOINT ["/entrypoint.sh"]
CMD ["node", "server.js"]
