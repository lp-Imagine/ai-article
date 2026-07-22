#!/bin/sh
set -e

cd /app

if [ -z "$DATABASE_URL" ]; then
  export DATABASE_URL="file:/data/prod.db"
fi

db_path="${DATABASE_URL#file:}"
db_dir="$(dirname "$db_path")"
mkdir -p "$db_dir"

echo "[entrypoint] Running Prisma migrations..."
node ./node_modules/prisma/build/index.js migrate deploy

# 迁移以 root 执行，确保 SQLite 文件对 nextjs 用户可写
if [ -n "$db_dir" ] && [ "$db_dir" != "." ]; then
  chown -R nextjs:nodejs "$db_dir" 2>/dev/null || true
fi
if [ -f "$db_path" ]; then
  chown nextjs:nodejs "$db_path" 2>/dev/null || true
fi

echo "[entrypoint] Starting application on PORT=${PORT:-3000}..."
exec su-exec nextjs "$@"
