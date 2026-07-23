#!/usr/bin/env bash
# 宝塔 / 自建服务器一键更新部署（Docker Compose：Postgres + App）
# 用法：cd /www/ai-article && bash docker/deploy.sh
#
# 环境变量：
#   SKIP_PULL=1
#   COOKIE_SECURE=0|1
#   PG_DATA_DIR=/www/data/ai-article-pg
#   POSTGRES_PASSWORD=...
#   JOB_MAX_CONCURRENT_PER_USER=2
#   JOB_DAILY_LIMIT=50
#   JOB_DAILY_LIMIT_ENABLED=1

set -euo pipefail

APP_DIR="${APP_DIR:-/www/ai-article}"
DATA_DIR="${DATA_DIR:-/www/data/ai-article}"
PG_DATA_DIR="${PG_DATA_DIR:-/www/data/ai-article-pg}"
IMAGE_NAME="${IMAGE_NAME:-wechat-ai-writer}"
CONTAINER_NAME="${CONTAINER_NAME:-ai-article}"
GITHUB_OWNER="${GITHUB_OWNER:-${REPO_OWNER:-lp-Imagine}}"
GITEE_OWNER="${GITEE_OWNER:-lp-imagine}"
REPO_NAME="${REPO_NAME:-ai-article}"
GITEE_REPO="${GITEE_REPO:-ai-article}"
BRANCH="${BRANCH:-master}"
GIT_TIMEOUT="${GIT_TIMEOUT:-30}"
CURL_TIMEOUT="${CURL_TIMEOUT:-90}"
SKIP_PULL="${SKIP_PULL:-0}"

# 国内机优先 Gitee / 代理，GitHub 直连放最后
ZIP_URLS=()
if [ -n "${REPO_ZIP_URL:-}" ]; then
  ZIP_URLS+=("$REPO_ZIP_URL")
fi
ZIP_URLS+=(
  "https://gitee.com/${GITEE_OWNER}/${GITEE_REPO}/repository/archive/${BRANCH}.zip"
  "https://ghproxy.net/https://github.com/${GITHUB_OWNER}/${REPO_NAME}/archive/refs/heads/${BRANCH}.zip"
  "https://mirror.ghproxy.com/https://github.com/${GITHUB_OWNER}/${REPO_NAME}/archive/refs/heads/${BRANCH}.zip"
  "https://github.com/${GITHUB_OWNER}/${REPO_NAME}/archive/refs/heads/${BRANCH}.zip"
)

cd "$APP_DIR"
mkdir -p "$DATA_DIR" "$PG_DATA_DIR"

run_with_timeout() {
  local secs="$1"
  shift
  if command -v timeout >/dev/null 2>&1; then
    timeout "$secs" "$@"
  elif command -v gtimeout >/dev/null 2>&1; then
    gtimeout "$secs" "$@"
  else
    "$@"
  fi
}

sync_from_zip() {
  local url="$1"
  local tmp
  tmp="$(mktemp -d)"
  echo "  尝试: $url"
  if ! curl -fsSL --connect-timeout 15 --max-time "$CURL_TIMEOUT" \
    -o "$tmp/repo.zip" "$url"; then
    rm -rf "$tmp"
    return 1
  fi
  unzip -q "$tmp/repo.zip" -d "$tmp"
  local src
  src="$(find "$tmp" -maxdepth 1 -type d ! -path "$tmp" | head -1)"
  if [ -z "$src" ]; then
    echo "  zip 解压后未找到源码目录"
    rm -rf "$tmp"
    return 1
  fi
  # 保留 .git，只覆盖业务文件；切勿在 zip 后再 git reset（fetch 失败会回退到旧 commit）
  rsync -a --delete \
    --exclude '.git' \
    --exclude 'node_modules' \
    --exclude '.next' \
    --exclude 'data' \
    --exclude '.data' \
    --exclude '.env' \
    --exclude '.env.local' \
    --exclude '.env.production' \
    "$src"/ "$APP_DIR"/
  rm -rf "$tmp"
  return 0
}

# 仅在 fetch 成功时 reset，避免「远程拉不到却硬回退到本地旧 origin/master」
align_git_if_fetch_ok() {
  if [ ! -d .git ]; then
    return 0
  fi
  echo "==> 尝试 git fetch（失败则保留当前文件，不强制 reset）"
  if run_with_timeout "$GIT_TIMEOUT" \
    env GIT_TERMINAL_PROMPT=0 git -c http.lowSpeedLimit=1000 -c http.lowSpeedTime=20 \
    fetch --depth 1 origin "$BRANCH"; then
    echo "==> fetch 成功，对齐到 origin/$BRANCH"
    git reset --hard "origin/$BRANCH"
    git clean -fd \
      -e data \
      -e .data \
      -e .env \
      -e .env.local \
      -e .env.production \
      2>/dev/null || true
    return 0
  fi
  echo "==> fetch 失败，跳过 reset（防止覆盖 zip 已更新的代码）"
  return 1
}

show_code_fingerprint() {
  echo "==> 当前代码指纹"
  if [ -f Dockerfile ]; then
    grep -n 'DATABASE_URL=' Dockerfile | head -3 || true
  fi
  if [ -f src/app/api/configs/route.ts ]; then
    grep -n 'export async function POST' src/app/api/configs/route.ts | head -2 || true
  fi
  git -C "$APP_DIR" rev-parse --short HEAD 2>/dev/null || true
}

if [ "$SKIP_PULL" = "1" ]; then
  echo "==> 跳过拉代码（SKIP_PULL=1），使用本地 $APP_DIR"
else
  echo "==> 拉取最新代码"
  pulled=0

  # 先尝试 git（仅 fetch 成功才 reset + pull）
  if align_git_if_fetch_ok; then
    if run_with_timeout "$GIT_TIMEOUT" \
      env GIT_TERMINAL_PROMPT=0 git -c http.lowSpeedLimit=1000 -c http.lowSpeedTime=20 \
      pull --ff-only origin "$BRANCH"; then
      echo "git pull 成功"
      pulled=1
    fi
  fi

  if [ "$pulled" -ne 1 ]; then
    echo "git 不可用或失败，改用 zip 下载..."
    for url in "${ZIP_URLS[@]}"; do
      if sync_from_zip "$url"; then
        echo "zip 同步成功（未执行 git reset）"
        pulled=1
        break
      fi
      echo "  失败，试下一个地址..."
    done
  fi

  if [ "$pulled" -ne 1 ]; then
    echo "错误：无法拉取代码。可用 SKIP_PULL=1 跳过。"
    exit 1
  fi
fi

show_code_fingerprint

# 代码更新后重新 exec 本脚本，避免「旧 deploy.sh 跑到一半被 zip 覆盖」仍走旧逻辑
if [ "${DEPLOY_REEXEC:-0}" != "1" ]; then
  export DEPLOY_REEXEC=1
  export SKIP_PULL=1
  echo "==> 使用最新 deploy.sh 继续部署"
  exec bash "$APP_DIR/docker/deploy.sh"
fi

# 兼容旧单容器：若还在跑则先停掉
docker stop "$CONTAINER_NAME" 2>/dev/null || true
docker rm "$CONTAINER_NAME" 2>/dev/null || true

export IMAGE_NAME
export PG_DATA_DIR
export COOKIE_SECURE="${COOKIE_SECURE:-0}"
export POSTGRES_USER="${POSTGRES_USER:-draftly}"
export POSTGRES_PASSWORD="${POSTGRES_PASSWORD:-draftly}"
export POSTGRES_DB="${POSTGRES_DB:-draftly}"
export JOB_MAX_CONCURRENT_PER_USER="${JOB_MAX_CONCURRENT_PER_USER:-2}"
export JOB_DAILY_LIMIT="${JOB_DAILY_LIMIT:-50}"
export JOB_DAILY_LIMIT_ENABLED="${JOB_DAILY_LIMIT_ENABLED:-1}"

echo "==> Docker Compose 构建并启动（Postgres + App）"
COMPOSE=(docker compose)
if ! docker compose version >/dev/null 2>&1; then
  if command -v docker-compose >/dev/null 2>&1; then
    COMPOSE=(docker-compose)
  else
    echo "错误：未找到 docker compose / docker-compose"
    exit 1
  fi
fi

if [ "${FORCE_REBUILD:-0}" = "1" ]; then
  echo "==> FORCE_REBUILD=1，app 镜像无缓存重建"
  "${COMPOSE[@]}" build --no-cache app
  "${COMPOSE[@]}" up -d
else
  "${COMPOSE[@]}" up -d --build
fi

echo "==> 等待启动"
sleep 5
docker compose ps 2>/dev/null || docker-compose ps
echo
docker compose logs app --tail 30 2>/dev/null || docker-compose logs app --tail 30
echo
echo "完成。"
echo "  HTTP：http://你的IP 或域名"
echo "  Postgres 数据：$PG_DATA_DIR"
echo "  若从旧 SQLite 迁数据：见 scripts/migrate-sqlite-to-postgres.ts"
echo "  HTTPS 后请用：COOKIE_SECURE=1 bash docker/deploy.sh"
