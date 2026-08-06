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

# ── 배포 직후 고정 점검 (David 2026-08-06 "자꾸 됐다 안 됐다 하게 하지 말고
#    한 번 픽스된 건 냅둬 좀")
#
# 광고 하나를 사흘에 걸쳐 세 번 뒤집어 결국 원래 자리로 돌아왔다. 그 사이
# David는 두 번 깨진 화면을 봤다. 각 단계의 실수가 아니라 **이미 정해진 것을
# 새 입력이 올 때마다 다시 연 것**이 원인이다.
#
# 그래서 배포 때마다 자동으로 돈다. 실패해도 롤백은 하지 않는다 — 되돌리는
# 판단은 사람이 한다. 다만 **로그에 크게 남겨** 다음 배포 전에 반드시 보이게 한다.
sleep 12
if node /root/ai-command-bus/tools/preflight.mjs https://nowhot.kr > /tmp/preflight.out 2>&1; then
  echo "$(date -Is) preflight OK"
else
  echo "$(date -Is) ################ PREFLIGHT 실패 ################"
  cat /tmp/preflight.out
  echo "$(date -Is) ###############################################"
fi
