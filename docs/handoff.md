# 인수인계 (HANDOFF) — 내 취향 피드

> 새 세션은 이 문서를 먼저 읽고 이어서 작업한다. 브랜치: `claude/personalized-community-feed-txj4f0` (PR #4, draft).

## 제품 목적 (한 줄)

수많은 실제 커뮤니티·뉴스에서 **지금 진짜 화제인 글**만 모아, **개인 취향에 맞게 선별**해서, 모바일 우선 웹(PWA)으로 **매끄럽게** 보여주는 개인 맞춤형 커뮤니티 피드. jagei.co.kr의 발전형. 최우선 목표는 합법 범위 내 수익화 가능한 프로덕트.

## 절대 원칙

1. **샘플·더미·하드코딩 콘텐츠 금지.** 실데이터만. (시드는 개발 전용으로 격리 예정 — 아래 TODO)
2. **법적 안전 모델 유지** (`docs/legal.md`): 아웃링크 필수(프레이밍 금지), 발췌 ≤200자, 본문 복제 금지, 대량 크롤링 금지 — 공식 RSS/API·robots 허용·유저 제출만. 화제성은 공개 신호(추천/댓글 수)로만.
3. 403 = 조직 네트워크 정책 거부 → 우회 금지, 보고만.

## 현재 상태 (2026-07-23)

- 앱 완성도: 프론트(모바일+PC 반응형) / 관리자(`/admin`, ADMIN_TOKEN) / 추천엔진(설문+암묵신호+협업필터링+탐색) / 19금 게이트 / PWA / 공유(OG) / 웹푸시 모듈 / 등급·룰 — 전부 구현·테스트됨. **테스트 57개 전부 통과** (`node --test test/*.test.js`).
- 적대적 실사용자 검수 2회 반영 완료 (설문 벽 제거→미리보기 우선, 닉네임 댓글, 화제성 뱃지, 아웃링크 상세, 엄지 조작성, 스킵 오학습 완화).
- **막힌 것 딱 하나: 실데이터 수집 검증.** 이전 세션 환경은 Trusted 네트워크(콘텐츠 호스트 전부 403)라 실행 불가였음. 환경을 Full로 바꾼 새 세션에서 아래 TODO 수행.

## 다음 작업 (순서대로)

1. **네트워크 확인**: `curl -s -o /dev/null -w "%{http_code}" "https://news.google.com/rss?hl=ko&gl=KR&ceid=KR:ko"` → 403이면 중단·보고. 200이면 계속.
2. **소스 헬스체크**: `ADMIN_TOKEN=chk PORT=4600 node src/feed/server.js` 기동 → `curl -X POST localhost:4600/api/admin/check-sources -H "x-admin-token: chk"`. 소스별 ok/items/error 확인. (관리자 UI `/admin` → 커뮤니티 탭 → 🩺 수집 점검 버튼과 동일)
3. **죽은 피드 교체**: 실패 소스(특히 클리앙 feedburner `c_hot50` — 서드파티, 미검증)는 WebSearch로 대체 조사 → `src/feed/communities.json` 수정. 신규 소스 추가 환영(원칙 2 준수).
4. **실데이터 검증**: `FEED_LIVE=1`로 재기동 → `/api/session`+`/api/survey`로 유저 만들고 `/api/feed`에 `via:"rss"` 항목이 뜨는지 확인 → Playwright(전역 설치, `NODE_PATH=/opt/node22/lib/node_modules`, 브라우저 `/opt/pw-browsers`)로 스크린샷 증명.
5. **시드 격리**: `FEED_DEV=1`일 때만 seed 어댑터 활성 (`registry.js`의 buildSources 또는 `server.js`에서 게이트). 기본 실행에 하드코딩 콘텐츠 노출 금지.
6. 테스트 전부 통과 확인 → **같은 브랜치에 커밋·푸시** (main 금지).
7. 그 다음 로드맵: 배포(Dockerfile·docs/deploy.md 준비됨) → 웹푸시 VAPID 실동작(push.js 구현됨, 서버 배선만) → 수익모델 설계.

## 코드 지도 (src/feed/)

engine.js(피드 조립·digest·auto-refresh) · recommender.js(점수·학습·협업·설명) · collab.js · store.js(유저·글·댓글·닉네임·관리) · server.js(API+정적+관리자) · registry.js+communities.json(소스 DB 44개) · fetchers.js(RSS/HN/Reddit+타임아웃) · ingest.js(OG파싱·유저제출·화제성) · translate.js · rules.js(등급·금지어·레이트리밋) · nickname.js · push.js(VAPID) · public/(index.html 앱, admin.html 관리자, sw.js+manifest PWA)

## 주의

- `seed-data.js`·`SeedSource`는 개발 전용 (5번에서 격리할 것).
- 커밋 메시지에 모델 ID 넣지 말 것. 이전 세션 데모 아티팩트의 콘텐츠는 하드코딩 샘플이었음 — 실데이터 검증 후 갱신 대상.
