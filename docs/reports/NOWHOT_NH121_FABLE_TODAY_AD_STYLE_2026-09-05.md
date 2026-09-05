# NOWHOT NH121 Fable 오늘판 광고 서식 통일 (2026-09-05)

- 작업자: Claude Fable 5.1 (Orca 워커 `task_3f297a3dd75d` / dispatch `ctx_f9f5efdf98d7`)
- 대상: `src/feed/public/today.html` 단일 파일. 기준 HEAD `a075591` (branch `codex/adfit-content-rescue-20260810`). 커밋·push·배포·테스트 파일 수정 없음.
- David 입력 분류: 확정 지시("오늘판에 광고는 오늘판 서식하고 똑같이 구현해줘"). root 코디네이터가 구현 권한과 파일 범위(today.html 광고 표시만)를 명시.

## 변경 내용

1. CSS: `.issue` 행 그리드(48px/18px, 모바일 32px/10px, 패딩, 하단 구분선)를 `.ad-coupang`과 셀렉터 공유. 포인터 커서와 hover는 `.issue`에만 유지. `.issue-number` 타이포를 `.ad-mark`(AD 셀)와, `.issue h2` 타이포(모바일 21px 포함)를 `.ad-title`과 공유. 기존 독립 광고 블록(19px 제목, `.go-text`/`.go-dest`, 10px AD 마크) 제거. 상세 창에서는 `#detailContent .ad-coupang`이 `.detail-section`처럼 상단 24px 여백과 상단선만 쓴다(이전에는 광고 하단선과 다음 섹션 상단선이 24px 간격으로 겹쳐 보였다).
2. 템플릿(`todayAdHtml`의 반환 HTML만): 좌측 `AD` 셀, 킥커 `광고 | {브랜드}`, 제목(hook)+88px 썸네일, 본문 상자(`editorial-grid`/`editorial-point`: 라벨 `쿠팡 파트너스`, 문구 line), CTA `{cta} →`, 기존 고지문 전문. 광고당 링크 1개, `rel="nofollow sponsored noopener"`, `target="_blank"`, `referrerpolicy`, `subId`, 이미지 실패 시 썸네일만 제거, `aria-label="쿠팡 제휴 광고"`, `ad-slot ad-coupang` 클래스 유지. 재고 필터·회전·중복 회피·제외 이웃·상세 배치·호출부 코드 라인은 무변경.
3. 초기 플레이스홀더 제목 `오늘의 브리핑` → `오늘판`(로드 뒤에는 기존대로 `{슬롯} 오늘판`).

## 검증(직접 실행)

- 인라인 스크립트 2건 `vm.Script` 파싱 OK. `test/inline-js.test.js` 14/15 — 실패 1건(`사이트맵: lastmod`)은 `server.js`만 읽는 테스트이며 root의 미커밋 `server.js` 수정(작업 트리 578줄 삭제) 영향으로 today.html과 무관.
- 기존 `test/browser-navigation.test.js` `Today` 패턴 9/9 PASS(npx 캐시 Playwright 1.62.1 + chromium headless shell 1223): 광고 2개·글 번호 01–18 보존·`#issues .issue` 수 불변·제외 이웃·상세 광고 고지 전문·공식 링크만.
- 격리 headless Chromium + 공개 오늘판 데이터(56이슈, 2026-09-05 런치) + 로컬 `/api/config`(쿠팡 18종·문구 행렬·고지): 320/393/1100px, 393 다크, 393 이미지 차단.
  - 광고 5개, 글 13/23/33/43/53 뒤(글 03 뒤는 다음 이슈가 politics라 기존 로직대로 제외). 이슈 56·번호 01,02,03… 유지, 페이지 오류 0, 가로 넘침 0.
  - 이슈 행/광고 행 grid·gap·padding·하단선 동일(1100: `48px 696px`/18px/28·30px, 모바일: `32px …`/10px/23·25px). AD 셀 x = 이슈 번호 x. 제목 24px/880(모바일 21px), 본문 13px, 킥커 11px, 고지 12px 모두 이슈 행과 동일. 광고당 링크 1개, 고유 href 5.
  - 상세 창 광고: 같은 grid, 상단 24px 여백+상단선, 하단선 0, `subId=today-detail-12`. 이미지 차단 시 썸네일 제거 후 제목이 전체 폭 사용.
  - 스크린샷: 세션 scratchpad `w320-list.png`, `w393-list.png`, `w1100-list.png`, `w393-detail.png`, `w1100-detail.png`, `w393-dark-list.png`, `w393-noimg-list.png`.
- `git diff --check -- src/feed/public/today.html` PASS. preflight·briefing-quality 정규식(`todayAdHtml(issue,index,"today-feed",seenAds,`, `state.coupang=config.coupang`) 유지.

## 남은 것 / 하지 않은 일

- 전체 테스트·통합·배포는 root. 실제 iPhone·David 브라우저 확인 없음. 광고 클릭 없음.
- 320px에서는 88px 썸네일 때문에 제목 폭이 140px(393px에서는 213px). 필요하면 모바일 썸네일 72px 축소는 CSS 1줄이지만 재설계 금지 범위라 적용하지 않았다.
- index.html·server.js·테스트·릴리스 노트 미수정. 커밋·push 없음.

## WRC 보고

- 작업 시작 전 확인한 MD:
  - 자동 주입: 사용자 `~/.claude/CLAUDE.md`, `~/.claude/rules/wrc-rule-gate.md`.
  - 직접 읽음: `START_HERE.md`, `00_WRC_OPERATING_SYSTEM_CANONICAL.md`(13 First Principles·§11.1), `04_WRC_AI_CONTEXT_WIKI_RULES.md`, `05_RULE_ENFORCEMENT_PROTOCOL.md`(First Principles·Minimal Change·Task Start·Direct Command gate 구간), `PMO_LIVE_BOARD.md`(상단 120줄), `REPORT_READ_INDEX.md`(상단 80줄, NowHot 항목 검색 0건).
  - 미읽음/불가: PMO 보드·색인의 하단 과거 이력(이번 작업과 무관).
  - 이번 작업 전용 파일: `today.html` 전체, `index.html` 광고 CSS/렌더러, `server.js` 광고 SSR, `test/browser-navigation·inline-js·briefing-quality·product-blueprint·ad-matrix`, `tools/preflight.mjs`, NH118·NH119 보고서.
- 적용한 규칙: 확정 지시 실행, Canonical §11.1 최소 수정(단일 파일·기존 셀렉터 확장), Corridor analyzePlan 사전 호출(추가 지침 없음), 기존 잠금 테스트로 검증.
- First Principles 게이트: PASS.
- 개발현황 반영: 해당 없음 — root가 통합·배포 시 NowHot 개발현황(DEVCHG)에 기록.
- 금지선 준수: 다른 제품 파일·테스트·릴리스 노트·서버 미수정, 커밋/푸시/배포 없음, 광고 클릭·계정·차단기 설정 변경 없음, 편집 번호·이슈 수·링크·고지 불변.
- David 행동 필요 여부: 없음(배포 후 새로고침 1회 안내는 root).
- Telegram 알림 필요 여부: 없음.
- 이익 우선·과잉방어 점검: GO — 광고 재고·링크·고지 그대로, 표시 서식만 오늘판과 통일.
- 하지 않은 일: 위 "남은 것 / 하지 않은 일" 참조.
