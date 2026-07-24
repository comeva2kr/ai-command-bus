#!/bin/bash
# Weekly quiz pipeline cron entrypoint — collect real hot items, generate a
# quiz draft, and stop at the approval queue.
#
# This script NEVER calls `weekly.js approve` and never publishes anything.
# Publishing is a human decision (QG5 in docs/quiz-loopgate.md) — this
# script's whole job ends at "초안 생성 + decision_queue 등록", exactly what
# `node src/quiz/weekly.js run` already does on its own. Do not add an
# approve call here under any circumstance.
#
# Intended to run unattended via launchd (see
# scripts/com.wrc.quiz-weekly.plist) — launchd redirects this script's
# stdout/stderr to a log file, so everything below just prints normally.
#
# Manual run: ./scripts/quiz-weekly-cron.sh   (from anywhere — REPO_DIR is
# derived from this script's own location, not the caller's cwd)

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_DIR"

log() {
  echo "[quiz-cron] $*"
}

notify() {
  # osascript's own failure (e.g. no GUI session — a headless CI box) must
  # never take the whole run down; the log file is the source of truth.
  osascript -e "display notification \"$2\" with title \"$1\"" >/dev/null 2>&1 || true
}

fail() {
  log "실패: $1"
  notify "주간 퀴즈 초안 실패" "$1"
  exit 1
}

log "시작 — REPO_DIR=$REPO_DIR"

# ANTHROPIC_API_KEY from macOS Keychain (see docs/quiz-cron.md for the
# one-time `security add-generic-password` setup). Missing key is not fatal
# — src/quiz/generate.js's generateQuiz() already falls back to the
# deterministic template quiz when no key is configured (guaranteed to pass
# every gate — see its tests), so the pipeline stays runnable either way.
if API_KEY="$(security find-generic-password -s wrc-quiz-anthropic -w 2>/dev/null)"; then
  export ANTHROPIC_API_KEY="$API_KEY"
  log "Keychain에서 ANTHROPIC_API_KEY 로드 완료"
else
  log "경고: 키 없음 (Keychain 'wrc-quiz-anthropic' 항목 없음) → 템플릿 폴백으로 진행"
fi

# --- 1) 실데이터 핫아이템 수집 ---------------------------------------------
DUMP_LOG="$(mktemp)"
trap 'rm -f "$DUMP_LOG" "${WEEKLY_LOG:-}"' EXIT

if ! node scripts/quiz-dump-hot-items.js >"$DUMP_LOG" 2>&1; then
  cat "$DUMP_LOG"
  fail "핫아이템 수집 실패 (scripts/quiz-dump-hot-items.js 오류 — 로그 위 참조)"
fi
cat "$DUMP_LOG"

DUMP_PATH="$(sed -nE 's/.*저장 완료 → (.*)$/\1/p' "$DUMP_LOG" | tail -1)"
if [[ -z "$DUMP_PATH" || ! -f "$DUMP_PATH" ]]; then
  fail "덤프 결과 파일 경로를 확인하지 못함"
fi
log "덤프 완료: $DUMP_PATH"

# --- 2) 초안 생성 + 승인 대기열 등록 (발행 아님) ----------------------------
WEEKLY_LOG="$(mktemp)"
if ! node src/quiz/weekly.js run "$DUMP_PATH" >"$WEEKLY_LOG" 2>&1; then
  cat "$WEEKLY_LOG"
  fail "주간 퀴즈 생성 실패 (루프게이트 미통과 또는 오류 — 로그 위 참조, 사람이 토픽 교체 판단)"
fi
cat "$WEEKLY_LOG"

# Extract "승인 대기: <제목> (<slug>)" from weekly.js's own success line:
#   [quiz] 초안 생성 (template): "2026w30 핫이슈 반응 유형테스트" → drafts/2026w30-1ghk4tv.json
DRAFT_LINE="$(grep -E '^\[quiz\] 초안 생성' "$WEEKLY_LOG" | tail -1)"
DRAFT_TITLE="$(echo "$DRAFT_LINE" | sed -nE 's/.*"([^"]*)".*/\1/p')"
DRAFT_SLUG="$(echo "$DRAFT_LINE" | sed -nE 's#.*drafts/([^.]+)\.json#\1#p')"

if [[ -z "$DRAFT_SLUG" ]]; then
  fail "초안 slug를 weekly.js 출력에서 추출하지 못함 (형식 변경 가능성 — 로그 위 참조)"
fi

log "초안 생성 완료: slug=$DRAFT_SLUG title=\"$DRAFT_TITLE\""
notify "주간 퀴즈 초안" "승인 대기: ${DRAFT_TITLE:-$DRAFT_SLUG} ($DRAFT_SLUG)"
log "완료 — 발행은 사람 승인만: node src/quiz/weekly.js approve $DRAFT_SLUG"
