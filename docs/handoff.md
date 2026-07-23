# 인수인계 (HANDOFF) — 내 취향 피드

> 새 세션은 이 문서를 먼저 읽고 이어서 작업한다. 브랜치: `claude/personalized-community-feed-txj4f0` (PR #4, draft).

## 제품 목적 (한 줄)

수많은 실제 커뮤니티·뉴스에서 **지금 진짜 화제인 글**만 모아, **개인 취향에 맞게 선별**해서, 모바일 우선 웹(PWA)으로 **매끄럽게** 보여주는 개인 맞춤형 커뮤니티 피드. jagei.co.kr의 발전형. 최우선 목표는 합법 범위 내 수익화 가능한 프로덕트.

## 절대 원칙

1. **샘플·더미·하드코딩 콘텐츠 금지.** 실데이터만. (시드는 개발 전용으로 격리 예정 — 아래 TODO)
2. **법적 안전 모델 유지** (`docs/legal.md`): 아웃링크 필수(프레이밍 금지), 발췌 ≤200자, 본문 복제 금지, 대량 DB 복제 금지. 화제성은 공개 신호(추천/댓글 수)로만.
   **수집 계층 (2026-07-23 David 최종 지시로 개정 — jagei.co.kr 방식 채택)**: ① 공식 RSS/API 우선 → ② 없으면 **베스트보드 리스트 페이지에서 제목+링크+시각+공개지표만 파싱** (본문·이미지 미수집, 폴링 주기 ≥10분, 식별 UA, 사이트당 리스트 1~2페이지만). ③ **제외 확정 (David 최종 지시 2026-07-23): 에펨코리아·아카라이브·디시인사이드·일베는 소스로 넣지 않는다** — 차단 여부와 무관하게 시도 자체 금지. 이 개정은 robots 엄격 준수보다 제목 수준 어그리게이션 관행(자게이 등 다수 서비스)을 따르는 WARN 수용 결정이며, 출시 전 변호사 검토 목록에 포함.
3. 403 = 조직 네트워크 정책 거부 → 우회 금지, 보고만.
4. **콘텐츠 선별 원칙 (David 반복 지시 — 위반 시 재작업)**: 커뮤니티는 그 커뮤니티의 **대표 베스트/인기 게시판**만 가져온다 (클리앙 c_hot50이 기준 모델; 펨코=포텐, 오유=베오베 식). 뉴스도 **많이 본/랭킹/핫 큐레이션** 피드만 — 전체 나열형 피드로 아무 글이나 쏟아붓지 말 것. 소스별 볼륨 균형 유지(뉴스가 커뮤니티를 도배하면 안 됨).

## 현재 상태 (2026-07-23, 2차 갱신)

- 앱 완성도: 프론트(모바일+PC 반응형) / 관리자(`/admin`, ADMIN_TOKEN) / 추천엔진(설문+암묵신호+협업필터링+탐색) / 19금 게이트 / PWA / 공유(OG) / 웹푸시 모듈 / 등급·룰 — 전부 구현·테스트됨. **테스트 58개 전부 통과** (`node --test test/*.test.js`).
- 적대적 실사용자 검수 2회 반영 완료 (설문 벽 제거→미리보기 우선, 닉네임 댓글, 화제성 뱃지, 아웃링크 상세, 엄지 조작성, 스킵 오학습 완화).
- **소스 헬스체크 완료 (2026-07-23)**: 샌드박스는 여전히 403이라 사용자 로컬(macOS) 터미널에서 실행. 결과: 라이브 소스 9개 전부 OK — clien(40건)·gnews(34)·gnews-auto(104)·gnews-tech(100)·gnews-biz(108)·gnews-sports(102)·gnews-ent(100)·gnews-science(102)·gnews-game(102). 죽은 피드 없음, 클리앙 feedburner `c_hot50` 검증 완료(communities.json note 갱신).
- **시드 격리 완료**: `FEED_DEV=1`일 때만 seed 어댑터 활성. `buildSources`에 `seed` 옵션 추가(기본 true — 테스트 호환), `server.js`가 `FEED_DEV`로 게이트. `FEED_DEV`·`FEED_LIVE` 둘 다 꺼진 기본 실행은 유저 글만 노출 + 기동 경고. 격리 테스트 추가(58번째).
- 참고: 세션 간 직접 통신(create_trigger persistent_session_id)은 조직 정책상 비활성 — 보고는 이 문서·PR #4 코멘트로.

## 다음 작업 (순서대로)

1. ~~네트워크 확인~~ ✅ 로컬 200 (샌드박스는 403 → 수집 검증은 로컬 위임)
2. ~~소스 헬스체크~~ ✅ 9/9 OK (위 결과)
3. ~~죽은 피드 교체~~ ✅ 해당 없음 (전부 정상)
4. ~~실데이터 검증~~ ✅ (2026-07-23 로컬, `FEED_LIVE=1`): 피드 10건 전부 live(rss) · seed 누출 0 · 실제 구글뉴스 기사 제목 확인. 이 과정에서 실버그 발견·수정: 라이브 항목에 `via` 미표기 → "seed"로 둔갑, 발췌 200자 캡 우회. registry가 어댑터 타입별 provenance(rss/api)를 찍고, 캡은 me/seed 외 전부 적용으로 반전(`e5aec79`).
5. ~~시드 격리~~ ✅ (`FEED_DEV` 게이트)
6. ~~테스트·커밋·푸시~~ ✅ 이 커밋
7. ~~로드맵~~ ✅ (2026-07-23, 3차 갱신):
   - **배포** ✅ Render Blueprint(main, `render.yaml`)로 https://taste-feed.onrender.com 라이브. free tier — 15분 유휴 스핀다운, `FEED_DB` 미설정(인메모리). VAPID 3종 env 설정 완료, `ADMIN_TOKEN`은 Render 자동 생성(대시보드 → Environment). public repo URL 연결이라 push 자동배포 없음 → 갱신은 대시보드 Manual Deploy.
   - **웹푸시 실동작** ✅ 검증 완료: 로컬 테스트 61/61 통과, 프로덕션 `/api/push/vapid-key` 200+키 반환, `/`·`sw.js`·`manifest` 200, `PUSH_DIGEST_MS` 배선 확인(server.js, VAPID 있을 때만 interval 가동). 실제 브라우저 구독→수신 E2E만 미실시(수동 확인 권장).
   - **수익모델 설계** ✅ `docs/monetization.md` 작성 — P0 제휴 커머스 카드(쿠팡파트너스, 표시광고법 고지·19금 제외) + AdFit, P1 프리미엄 구독(번역 무제한, FEED_DB 영속화 선행), P2 트렌드 리포트. 착수 전 blocking: 쿠팡파트너스 약관상 게재 방식 확인(David).

## 다음 착수 후보 (순서 제안)

1. 실기기 웹푸시 E2E 수동 확인 (iPhone/Android 브라우저에서 알림 받기 → `/api/admin/push-digest` 수동 발사).
2. `docs/monetization.md` Phase A: 제휴 카드 슬롯 구현 (약관 확인 후).
3. 실사용 전환 시 Render 유료 플랜 + 디스크 + `FEED_DB` 활성.

## 코드 지도 (src/feed/)

engine.js(피드 조립·digest·auto-refresh) · recommender.js(점수·학습·협업·설명) · collab.js · store.js(유저·글·댓글·닉네임·관리) · server.js(API+정적+관리자) · registry.js+communities.json(소스 DB 44개) · fetchers.js(RSS/HN/Reddit+타임아웃) · ingest.js(OG파싱·유저제출·화제성) · translate.js · rules.js(등급·금지어·레이트리밋) · nickname.js · push.js(VAPID) · public/(index.html 앱, admin.html 관리자, sw.js+manifest PWA)

## 주의

- `seed-data.js`·`SeedSource`는 개발 전용 (5번에서 격리할 것).
- 커밋 메시지에 모델 ID 넣지 말 것. 이전 세션 데모 아티팩트의 콘텐츠는 하드코딩 샘플이었음 — 실데이터 검증 후 갱신 대상.
