#!/usr/bin/env bash
# 宝塔 / 自建服务器一键更新部署
# 用法：cd /www/ai-article && bash docker/deploy.sh
#
# 拉取顺序：git pull(origin) → GitHub zip → 代理 → Gitee 兜底
#
# 注意用户名大小写不同：
#   GitHub：https://github.com/lp-Imagine/ai-article.git
#   Gitee ：https://gitee.com/lp-imagine/ai-article.git
#
# 环境变量：
#   SKIP_PULL=1          跳过拉代码，只用本地目录重建镜像
#   GITHUB_OWNER=xxx     GitHub 用户名（默认 lp-Imagine）
#   GITEE_OWNER=xxx      Gitee 用户名（默认 lp-imagine，全小写）
#   REPO_ZIP_URL=...     指定单一 zip 地址（最高优先）
#   GIT_TIMEOUT=30       git pull 超时秒数
#   CURL_TIMEOUT=60      zip 下载超时秒数

set -euo pipefail

APP_DIR="${APP_DIR:-/www/ai-article}"
DATA_DIR="${DATA_DIR:-/www/data/ai-article}"
IMAGE_NAME="${IMAGE_NAME:-wechat-ai-writer}"
CONTAINER_NAME="${CONTAINER_NAME:-ai-article}"
# GitHub / Gitee 用户名大小写不同，勿混用
GITHUB_OWNER="${GITHUB_OWNER:-${REPO_OWNER:-lp-Imagine}}"
GITEE_OWNER="${GITEE_OWNER:-lp-imagine}"
REPO_NAME="${REPO_NAME:-ai-article}"
GITEE_REPO="${GITEE_REPO:-ai-article}"
BRANCH="${BRANCH:-master}"
GIT_TIMEOUT="${GIT_TIMEOUT:-30}"
CURL_TIMEOUT="${CURL_TIMEOUT:-60}"
SKIP_PULL="${SKIP_PULL:-0}"

# 顺序：自定义 URL → GitHub → GitHub 代理 → Gitee 兜底
ZIP_URLS=()
if [ -n "${REPO_ZIP_URL:-}" ]; then
  ZIP_URLS+=("$REPO_ZIP_URL")
fi
ZIP_URLS+=(
  "https://github.com/${GITHUB_OWNER}/${REPO_NAME}/archive/refs/heads/${BRANCH}.zip"
  "https://ghproxy.net/https://github.com/${GITHUB_OWNER}/${REPO_NAME}/archive/refs/heads/${BRANCH}.zip"
  "https://mirror.ghproxy.com/https://github.com/${GITHUB_OWNER}/${REPO_NAME}/archive/refs/heads/${BRANCH}.zip"
  "https://gitee.com/${GITEE_OWNER}/${GITEE_REPO}/repository/archive/${BRANCH}.zip"
)

cd "$APP_DIR"
mkdir -p "$DATA_DIR"

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
  # GitHub: ai-article-master；Gitee: ai-article-master 或 ai-article
  src="$(find "$tmp" -maxdepth 1 -type d ! -path "$tmp" | head -1)"
  if [ -z "$src" ]; then
    echo "  zip 解压后未找到源码目录"
    rm -rf "$tmp"
    return 1
  fi
  rsync -a --delete \
    --exclude '.git' \
    --exclude 'node_modules' \
    --exclude '.next' \
    "$src"/ "$APP_DIR"/
  rm -rf "$tmp"
  return 0
}

if [ "$SKIP_PULL" = "1" ]; then
  echo "==> 跳过拉代码（SKIP_PULL=1），使用本地 $APP_DIR"
else
  echo "==> 拉取最新代码（超时 ${GIT_TIMEOUT}s / curl ${CURL_TIMEOUT}s）"
  if command -v git >/dev/null 2>&1 && [ -d .git ]; then
    echo "  当前 origin: $(git remote get-url origin 2>/dev/null || echo '无')"
  fi
  pulled=0
  if run_with_timeout "$GIT_TIMEOUT" \
    env GIT_TERMINAL_PROMPT=0 git -c http.lowSpeedLimit=1000 -c http.lowSpeedTime=20 \
    pull --ff-only origin "$BRANCH"; then
    echo "git pull 成功"
    pulled=1
  else
    echo "git pull 失败或超时，改用 zip 下载..."
    for url in "${ZIP_URLS[@]}"; do
      if sync_from_zip "$url"; then
        echo "zip 同步成功"
        pulled=1
        break
      fi
      echo "  失败，试下一个地址..."
    done
  fi

  if [ "$pulled" -ne 1 ]; then
    echo
    echo "错误：无法拉取代码（GitHub / 代理 / Gitee 均失败）。"
    echo
    echo "可选处理："
    echo "  1) 确认已把仓库同步到 Gitee，且用户名正确："
    echo "       GITEE_OWNER=你的用户名 bash docker/deploy.sh"
    echo "  2) 本机上传代码后："
    echo "       SKIP_PULL=1 bash docker/deploy.sh"
    exit 1
  fi
fi

echo "==> 构建镜像 $IMAGE_NAME"
docker build -t "$IMAGE_NAME" .

echo "==> 重启容器 $CONTAINER_NAME"
docker stop "$CONTAINER_NAME" 2>/dev/null || true
docker rm "$CONTAINER_NAME" 2>/dev/null || true

docker run -d \
  --name "$CONTAINER_NAME" \
  --restart unless-stopped \
  -p 127.0.0.1:3000:3000 \
  -e DATABASE_URL="file:/data/prod.db" \
  -v "$DATA_DIR":/data \
  "$IMAGE_NAME"

echo "==> 等待启动"
sleep 3
docker ps --filter "name=$CONTAINER_NAME"
echo
docker logs "$CONTAINER_NAME" --tail 20
echo
echo "完成。浏览器刷新 http://你的IP 即可。"
