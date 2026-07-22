#!/usr/bin/env bash
# 宝塔 / 自建服务器一键更新部署
# 用法：cd /www/ai-article && bash docker/deploy.sh

set -euo pipefail

APP_DIR="${APP_DIR:-/www/ai-article}"
DATA_DIR="${DATA_DIR:-/www/data/ai-article}"
IMAGE_NAME="${IMAGE_NAME:-wechat-ai-writer}"
CONTAINER_NAME="${CONTAINER_NAME:-ai-article}"
REPO_ZIP_URL="${REPO_ZIP_URL:-https://github.com/lp-Imagine/ai-article/archive/refs/heads/master.zip}"

cd "$APP_DIR"
mkdir -p "$DATA_DIR"

echo "==> 拉取最新代码"
if GIT_TERMINAL_PROMPT=0 git pull --ff-only origin master 2>/dev/null; then
  echo "git pull 成功"
else
  echo "git pull 失败，改用 zip 下载..."
  tmp="$(mktemp -d)"
  curl -fsSL -o "$tmp/repo.zip" "$REPO_ZIP_URL"
  unzip -q "$tmp/repo.zip" -d "$tmp"
  src="$(find "$tmp" -maxdepth 1 -type d -name 'ai-article-*' | head -1)"
  rsync -a --delete \
    --exclude '.git' \
    --exclude 'node_modules' \
    --exclude '.next' \
    "$src"/ "$APP_DIR"/
  rm -rf "$tmp"
  echo "zip 同步成功"
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
