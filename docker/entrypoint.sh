#!/bin/sh
set -e

cd /app

if [ -z "$DATABASE_URL" ]; then
  echo "[entrypoint] ERROR: DATABASE_URL is required (postgresql://...)" >&2
  exit 1
fi

echo "[entrypoint] Running Prisma migrations..."
node ./node_modules/prisma/build/index.js migrate deploy

echo "[entrypoint] Starting application on PORT=${PORT:-3000}..."
exec su-exec nextjs "$@"
