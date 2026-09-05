# NOWHOT NH122 Fable 오늘판 광고 시각 교정 검수 (2026-09-05)

- 작업자: Claude Fable 5.1 (Orca 워커 `task_10cb16390c25` / dispatch `ctx_abdb6031486a`). 읽기 전용 검수. 제품·테스트 파일 수정, 커밋, 배포 없음.
- 대상: Root의 NH122 diff(기준 `b1c1797`, branch `codex/adfit-content-rescue-20260810`): `src/feed/public/today.html` 22줄, `test/browser-navigation.test.js` 11줄. 검수 중 동일 내용이 `0c1616f`(Use article layout for Today affiliate content)로 커밋됐고, 검수한 작업 트리와 커밋 내용은 바이트 단위로 같다(`git diff b1c1797 HEAD` 동일 stat·핵심 줄 확인).
- David 입력 분류: 확정 지시("오늘판 광고를 오늘판 기사 서식과 똑같이") + NH121 결과 반려(사진 1장: 광고 제목·이미지 없음, 별도 CTA·고지 구역이 34번 기사와 다름).

## 결론

GO. 목록의 광고 행은 34번 기사 행과 같은 구조·치수로 맞춰졌다. 상세 창에서만 부작용 2건(선택 수정)이 있고, 요청 밖 새 라벨 문구 1건에 이의를 남긴다.

## 1. 사진(NH121 배포판)에서 제목·이미지가 빠진 원인

- 데이터 문제가 아니다. 공개 `/api/config`(build `uoDUNxtY`)는 품목 18/18, 문구 세트 270/270 모두 hook이 있다. 사진의 세트는 kitchen/news 3번(hook "뉴스 피하고 싶어서 요리나 할까 한다", line "도구 하나 있으면 그나마 위안이 된다", cta "주방관 가기")이며 line과 cta는 찍혔고 hook만 보이지 않았다.
- 사진의 빈 칸 높이는 킥커 아래 여백 9px + 본문 상자 위 여백 19px 정도다. 제목+썸네일 행(`.go-row`)이 0 높이로 접힌 모양, 즉 요소가 화면에서 숨겨진 상태다.
- EasyList 일반 숨김 규칙에 `##.ad-title`(6889행), `##.ad-native`(6569행), `##.ad-slot`(6767행)이 있고 네트워크 차단 `||ads-partners.coupang.com^`(66203행)이 있다. 사진에서 `.ad-slot` 자체는 보였으므로 David 기기에는 일부 규칙만 적용된 차단기 또는 변환 목록이 작동했을 가능성이 가장 크다. 실기기 확인 전까지는 추정이다(WARN).
- Root 패치는 제목을 `h2 > a.issue-title-button`로 바꿔 제목에서 `ad-*` 클래스를 없앴고 배너 이미지도 제거했다. 같은 규칙에 더 이상 걸리지 않는다. 앞으로도 제목과 앵커에는 `ad-*` 클래스를 붙이지 않는다. `p.ad-disclosure`, `.ad-mark`는 EasyList 일반 규칙에 없고 사진에서도 보였으므로 유지해도 된다.

## 2. Root 패치 검수 결과 (목록)

- 구조: `aside.ad-slot.ad-coupang` 안에 `.ad-mark`(AD) + [`.issue-kicker`(광고 | 브랜드), `h2 > a.issue-title-button`(전폭 제목, 광고당 링크 1개), `.editorial-grid > .editorial-point`(라벨 + line), `.change-row`(라벨 + `p.ad-disclosure`)]. 기사 행의 네이티브 클래스를 그대로 쓰고 외부 훅은 `.ad-coupang`뿐이다. `.issue` 수와 번호는 불변.
- 실측(공개 오늘판 56이슈 + 공개 config, Chromium headless shell 1223, 393/1100px): 광고 5개, 빈 제목 0, 가로 넘침 0, 페이지 오류 0. 광고 행과 직전 기사 행의 grid/gap/padding/하단선 동일(393: `32px` / 10px / 23·25px, 1100: `48px` / 18px / 28·30px). h2 21px/24px·880·잉크색 동일, 라벨 11px·sub색 동일, change-row 본문 12px·잉크색 동일. 링크는 `rel="nofollow sponsored noopener"` `target="_blank"`, `link.coupang.com`만.
- 테스트: `test/browser-navigation.test.js` Today 9/9 PASS(스크린샷 `/tmp/nh122-today-ad-{320,393,1100}.png`). today.html을 읽는 노드 테스트 6파일 82건 중 79 PASS. 실패 3건(검수5+3 다양성 하한, 검수7 온보딩, 오늘·실시간 순서)은 HEAD 순정 export에서도 동일하게 실패한다. 이번 패치와 무관.
- 잔여 셀렉터 0(`ad-title`/`go-row`/`go-thumb`/`ad-native`/`ad-go`/`go-line`), `git diff --check` 통과, preflight·briefing-quality가 잠근 `todayAdHtml(issue,index,"today-feed",seenAds,` 호출부 유지.

## 3. 수정 권고 (상세 창, 선택)

1. 상세 창의 광고 제목이 기사 제목과 같은 크기(1100px 28px, 393px 23px)이면서 더 굵다(880 vs 700). 원인은 `.detail-content h2`(134행, 모바일 161행)가 같은 특이도의 `.ad-coupang h2`보다 뒤에 있어 이기기 때문이다. NH121에서는 24px였다. 최소 수정은 두 곳의 `.detail-content h2`를 `.detail-content>h2`로 바꾸는 것이다. 상세 창의 직계 h2는 `#detailTitle` 하나뿐이라 영향이 제목에 한정되고, 광고 제목은 목록과 같은 24/21px로 돌아간다.
2. 상세 창에서 광고 마지막 `.change-row` 하단선 + 24px + 다음 섹션 상단선의 이중선이 생긴다(실측 24px). NH121이 없앴던 모양이다. 최소 수정은 기존 `#detailContent .ad-coupang` 줄 옆에 `#detailContent .ad-coupang .change-row{border-bottom:0}` 한 규칙 추가다.
- 둘 다 하지 않아도 목록 반려 사유는 해소된다. Root 판단.

## 4. 문구 이의 (요청 밖 새 카피)

- `상품 안내`, `광고 안내`는 David 지시에 없는 새 라벨이다. 배포 중이던 라벨은 `쿠팡 파트너스`였다. line은 감정 훅("집 안 정리하다 보면 마음이 좀 가라앉는다")이라 `상품 안내`는 내용과 어긋난다.
- 최소 변경안: 본문 라벨은 기존 `쿠팡 파트너스` 유지(새 카피 0, 고지문 밖에서도 파트너 명 노출). 고지 행은 change-row 라벨 칸이 있어 새 라벨 1개가 필요하므로 `광고 안내` 또는 더 정확한 `제휴 고지` 중 하나. 테스트 정규식 `/쿠팡 파트너스[\s\S]*수수료/`는 고지문만으로 통과하므로 어느 쪽이든 무관.

## 5. 관찰 (조치 불필요)

- CTA 행 제거로 클릭 대상은 제목 링크 1개다. 기사 행은 행 전체 클릭인데 광고는 제목만 클릭된다. 기사 서식 일치 요구에는 맞다. 클릭률이 떨어지면 나중에 aside 행 클릭을 같은 href로 연결하는 덜 제한적 대안이 있다(지금 요청 아님).
- 테스트 변경은 목표 계약과 일치한다(h2 .issue-title-button 2, img/.ad-go 0, .change-row .ad-disclosure 2, 상세 h2 표시, 스크린샷 nh122). 상세 창 제목 크기 검사는 없다.

## 증거

- 스크린샷: 세션 scratchpad `nh122-real-393-list.png`, `nh122-real-1100-list.png`, `nh122-real-393-detail.png`, `nh122-real-1100-detail.png`; 테스트 산출 `/tmp/nh122-today-ad-{320,393,1100}.png`.
- 로그·원본: scratchpad `today-browser-test.log`, `node-tests.log`, `node-tests-head.log`, `config.json`, `today.json`, `easylist.txt`, `render-real.cjs`.

## WRC 보고

- 작업 시작 전 확인한 MD:
  - 자동 주입: 사용자 `~/.claude/CLAUDE.md`, `~/.claude/rules/wrc-rule-gate.md`, 프로젝트 메모리 `MEMORY.md`.
  - 직접 읽음: `START_HERE.md`, `00_WRC_OPERATING_SYSTEM_CANONICAL.md`(전문), `04_WRC_AI_CONTEXT_WIKI_RULES.md`(전문), `05_RULE_ENFORCEMENT_PROTOCOL.md`(전문), `PMO_LIVE_BOARD.md`(상단 80줄 + NowHot 검색), `REPORT_READ_INDEX.md`(상단 60줄 + NowHot 검색 0건).
  - 미읽음/불가: PMO 보드·색인 하단 과거 이력(무관). David 실기기.
  - 이번 작업 전용 파일: `today.html`(CSS·todayAdHtml·renderIssues·상세 렌더), Root diff, `test/browser-navigation.test.js`, `src/feed/ad-copy.js`, `src/feed/products.json`, NH121 보고서 2건, 반려 사진 1장, 공개 `/api/config`·`/api/today`, EasyList.
- 적용한 규칙: 입력 분류(확정 지시 + 반려), 13 First Principles, Canonical §11.1 최소 충분 변경(권고도 셀렉터 단위), 이익 우선(광고 노출·링크·고지 유지), 읽기 전용(제품·테스트·커밋·배포 0), 개인 브라우저·타 프로젝트 Run 미접촉. Corridor analyzePlan은 코드 생성이 없어 호출하지 않음(도구 계약상 코드 리뷰 제외).
- First Principles 게이트: PASS.
- 개발현황 반영: 해당 없음 — 읽기 전용 검수. Root가 통합 시 NH122 변경 레코드에 기록.
- 금지선 준수: 파일 생성은 이 보고서 1개. 광고 클릭·계정·차단기·배포·Telegram 0.
- David 행동 필요 여부: 없음(배포 후 실기기 확인 1회는 Root 안내).
- Telegram 알림 필요 여부: 없음.
- 이익 우선·과잉방어 점검: GO — 광고 노출·링크·고지 보존, 서식만 통일. 차단기 원인은 추정이라 WARN 표기, 기능 축소 권고 없음.
- 하지 않은 일: 제품·테스트 수정, 커밋, 배포, 실기기 확인, 기존 실패 3건 원인 분석, 메모리 쓰기.
