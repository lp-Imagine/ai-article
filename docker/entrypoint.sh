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
./node_modules/.bin/prisma migrate deploy

echo "[entrypoint] Starting application..."
exec su-exec nextjs "$@"
