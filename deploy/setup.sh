#!/usr/bin/env bash
# taste-feed 국내 VM 원클릭 셋업 — Ubuntu 22.04/24.04 (ARM/x86) 기준.
# VM에 SSH 접속 후 이 스크립트를 실행하면 Docker 설치 → 앱 빌드 → 상시 가동까지 끝.
set -euo pipefail

REPO="https://github.com/comeva2kr/ai-command-bus.git"
APPDIR="$HOME/ai-command-bus"

echo "== 1) Docker 설치 =="
if ! command -v docker >/dev/null 2>&1; then
  curl -fsSL https://get.docker.com | sh
  sudo usermod -aG docker "$USER" || true
fi

echo "== 2) 소스 받기 =="
if [ -d "$APPDIR/.git" ]; then
  git -C "$APPDIR" pull --ff-only
else
  git clone "$REPO" "$APPDIR"
fi
cd "$APPDIR/deploy"

echo "== 3) 환경변수 (.env) =="
if [ ! -f .env ]; then
  # VAPID 키 생성 (웹푸시)
  KEYS=$(cd "$APPDIR" && node src/feed/push-keys.js 2>/dev/null || true)
  PUB=$(printf '%s\n' "$KEYS" | grep VAPID_PUBLIC_KEY | cut -d= -f2 | tr -d ' ')
  PRIV=$(printf '%s\n' "$KEYS" | grep VAPID_PRIVATE_KEY | cut -d= -f2 | tr -d ' ')
  ADMIN=$(head -c 24 /dev/urandom | base64 | tr -dc 'A-Za-z0-9' | head -c 32)
  cat > .env <<EOF
DOMAIN=${DOMAIN:-}
VAPID_PUBLIC_KEY=${PUB}
VAPID_PRIVATE_KEY=${PRIV}
VAPID_SUBJECT=mailto:comeva2kr@gmail.com
ADMIN_TOKEN=${ADMIN}
EOF
  echo ".env 생성됨 (ADMIN_TOKEN=$ADMIN — 관리자 콘솔용, 따로 보관)"
fi

echo "== 4) 방화벽 (80/443 열기) =="
sudo ufw allow 80/tcp  2>/dev/null || true
sudo ufw allow 443/tcp 2>/dev/null || true

echo "== 5) 빌드 + 상시 가동 =="
sudo docker compose --env-file .env up -d --build

echo "== 완료 =="
echo "헬스체크: curl -s http://localhost/api/health"
echo "도메인 연결 후 DOMAIN=your.domain 으로 .env 갱신하고 'docker compose up -d' 재실행하면 HTTPS 자동."
