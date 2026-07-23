# 인수인계 (HANDOFF) — 내 취향 피드

> 새 세션(특히 **로컬 Claude Code**)은 이 문서를 먼저 읽고 이어서 작업한다.
> 코드는 전부 **main에 머지 완료** (PR #4, 2026-07-23). 새 작업은 main에서 새 브랜치.

## 제품 목적 (한 줄)

수많은 실제 커뮤니티·뉴스에서 **지금 진짜 화제인 글**만 모아, **개인 취향에 맞게 선별**해서, 모바일 우선 웹(PWA)으로 **매끄럽게** 보여주는 개인 맞춤형 커뮤니티 피드. jagei.co.kr의 발전형. 최우선 목표는 합법 범위 내 수익화 가능한 프로덕트.

## 절대 원칙

1. **샘플·더미·하드코딩 콘텐츠 금지.** 실데이터만. 시드 데이터셋은 `FEED_DEV=1`일 때만 활성(격리 완료).
2. **법적 안전 모델 유지** (`docs/legal.md`): 아웃링크 필수(프레이밍 금지), 발췌 ≤200자(모든 수집 항목에 강제, `content.js`), 본문 복제 금지, 대량 크롤링 금지 — 공식 RSS/API·robots 허용·유저 제출만.
3. 403 = 네트워크 정책 거부 → 우회 금지, 보고만.
4. 커밋 메시지·코드에 모델 ID 넣지 말 것.

## 완료된 것 (2026-07-23 기준, 전부 main에 머지됨)

- **앱 전체**: 프론트(모바일+PC 반응형 PWA) / 관리자(`/admin`, ADMIN_TOKEN) / 추천엔진(설문+암묵신호+협업필터링+탐색+설명가능) / 19금 게이트 / 공유(OG) / 등급·룰 / 아웃링크 수집(합법 모델). **테스트 61개 전부 통과** (`node --test test/*.test.js`), CI 워크플로 동작.
- **실데이터 검증 완료**: 라이브 소스 9개 전부 정상(구글뉴스 8종 + 클리앙 c_hot50), `FEED_LIVE=1`로 피드 10/10 실기사·시드 누출 0 확인. provenance 버그(발췌 200자 캡 우회) 발견·수정됨.
- **웹푸시 완전 배선**: VAPID 환경변수 → `GET /api/push/vapid-key` → 클라이언트 실구독 → `sendDigestPushes` 다이제스트 발송(`PUSH_DIGEST_MS` 주기 / `POST /api/admin/push-digest` 수동). 19금 제목은 알림에 노출 안 됨. 키 생성: `npm run push:keys`.
- **배포 준비**: `render.yaml` 블루프린트(무료 티어, main 기준) + `Dockerfile` + `docs/deploy.md`.

## 다음 작업 (순서대로)

1. **Render 배포** — 사용자가 대시보드를 열다 중단한 상태. 로컬 세션은 브라우저 자동화(MCP)로 대신 진행 가능:
   - 키 생성: `npm run push:keys` — **반드시 새로 생성** (이전에 만든 키는 대화에 노출되어 폐기 대상. 키를 리포·문서에 절대 커밋 금지)
   - Render 대시보드 → New → Blueprint → `comeva2kr/ai-command-bus` → 브랜치 main → VAPID 3개 변수만 입력 → Apply
   - 무료 티어: 15분 유휴 후 콜드스타트, 디스크 없음(유저 데이터 휘발). 유료 전환 시 `render.yaml`의 disk+`FEED_DB` 주석 해제.
   - 대안: Fly.io는 flyctl CLI만으로 배포 가능 (`Dockerfile` 있음).
2. **배포 검증**: `/api/health` → 피드에 실기사(`via:"rss"`) → "알림 받기"로 실구독 생성 → `POST /api/admin/push-digest`로 실제 푸시 수신 확인(웹푸시의 최종 미검증 구간은 "실 push 서비스로의 전송"뿐. 암호화·JWT는 오프라인 테스트 완료) → `/admin` 접속(토큰: Render Environment 탭).
3. **수익모델 설계** (로드맵 마지막): 합법 아웃링크 모델과 충돌하지 않는 선에서. 후보 검토부터: 프리미엄 구독(고급 개인화·무광고), 제휴 아웃링크, 자체 광고 슬롯(19금 제외), 커뮤니티 부스트. `docs/legal.md`의 제약 먼저 재확인할 것.
4. 이후: 실사용자 온보딩 → 지표(리텐션/DAU) 계측 추가.

## 코드 지도 (src/feed/)

engine.js(피드 조립·digest·auto-refresh) · recommender.js(점수·학습·협업·설명) · collab.js · store.js(유저·글·댓글·닉네임·관리) · server.js(API+정적+관리자+푸시 배선) · registry.js+communities.json(소스 DB 44개, seed는 FEED_DEV 게이트) · fetchers.js(RSS/HN/Reddit+8s 타임아웃) · ingest.js(OG파싱·유저제출·화제성) · translate.js · rules.js(등급·금지어·레이트리밋) · nickname.js · push.js(VAPID·암호화·sendDigestPushes) · push-keys.js(키 생성 CLI) · public/(index.html 앱, admin.html 관리자, sw.js+manifest PWA)

## 환경변수 요약

`PORT` · `FEED_DB`(영속 파일) · `FEED_LIVE=1`(실수집) · `FEED_DEV=1`(개발 시드) · `FEED_REFRESH_MS` · `VAPID_PUBLIC_KEY`/`VAPID_PRIVATE_KEY`/`VAPID_SUBJECT` · `PUSH_DIGEST_MS` · `ADMIN_TOKEN`. 상세는 `docs/deploy.md`.

## 세션 이력 참고

- 이전 클라우드 세션들은 네트워크 정책(403) 때문에 실데이터 검증을 사용자 로컬 터미널에 명령 블록을 전달하는 방식으로 수행했음. 로컬 세션은 이 제약이 없다.
- 세션 간 직접 통신(trigger persistent_session_id)은 조직 정책상 비활성. 보고·인수인계는 이 문서와 PR 코멘트로.
