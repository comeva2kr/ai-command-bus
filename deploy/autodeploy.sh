#!/usr/bin/env bash
# VM 자동배포 (David 2026-07-31: "터미널 계속 열어놔야 되잖아" 해소).
#
# cron이 1분마다 실행: origin/main에 새 커밋이 있을 때만 pull + app 재빌드.
# 로컬(맥)에서는 commit → push 만 하면 1분 안에 nowhot.kr에 반영된다 —
# SSH 접속이 전혀 필요 없다. 유저 DB는 도커 볼륨(feed-data), 시크릿은
# deploy/.env(untracked)라 git reset --hard 의 영향권 밖이다.
#
# 설치 (VM에서 1회):
#   chmod +x /root/ai-command-bus/deploy/autodeploy.sh
#   (crontab -l 2>/dev/null | grep -v autodeploy; echo '* * * * * flock -n /tmp/autodeploy.lock /root/ai-command-bus/deploy/autodeploy.sh >> /root/autodeploy.log 2>&1') | crontab -
set -euo pipefail

cd /root/ai-command-bus
git fetch origin main --quiet
LOCAL=$(git rev-parse HEAD)
REMOTE=$(git rev-parse origin/main)
[ "$LOCAL" = "$REMOTE" ] && exit 0

echo "$(date -Is) deploying ${REMOTE:0:9} (was ${LOCAL:0:9})"
git reset --hard origin/main --quiet
cd deploy
docker compose up -d --build app
echo "$(date -Is) deployed ${REMOTE:0:9}"
