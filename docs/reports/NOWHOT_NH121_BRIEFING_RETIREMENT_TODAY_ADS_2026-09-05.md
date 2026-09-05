# NH121 기존 브리핑 종료·오늘판 광고 서식 통일

- 안정 ID: `NOWHOT-LEGACY-BRIEFING-RETIREMENT-001`
- 변경 레코드: `DEVCHG-NOWHOT-20260905-208`
- David 입력: 확정 지시·기존 배포 승인 유지. 기존 오늘의 브리핑과 연결 송출 RSS 종료, Today 광고를 Today 기사 행과 같은 서식으로 구현, Orca 3자 진행.
- 상태: **운영 배포·공개 화면 검증 완료**. 로컬 통합456/456·Chrome28/28 PASS. 운영 코드 `8533eaacc230bf9f875bddefc5f380b359f0e0f0`, 공개 build `uoDUNxtY`.

## 결과와 범위

- `/briefing`·날짜/카테고리 하위 주소: HTTP410 종료 안내, 오늘판 링크, noindex/no-store. 요청한 과거 날짜를 현재판인 것처럼 리다이렉트하지 않는다.
- `/api/briefing`·`/rss.xml`: HTTP410 `LEGACY_BRIEFING_RETIRED`. RSS를 오늘판으로 이관하지 않았다.
- 기존 메뉴/Live 스트립·SSR·요청, sitemap/robots/RSS alternate/IndexNow 발송 목록, 옛 브리핑 LLM writer·5분 발행 스케줄 제거.
- 공용 `FeedEngine.briefing()`·Today 정본 발행/조회/개인 분야·수집 RSS·랭킹은 유지. 수집 갱신은 일별 랭킹만 새로 저장하고 기존 briefing 값은 보존한다. 저장 기록 삭제 없음. 오늘판 플래그가 꺼지면 옛 홈 대신 307 `/live`.
- Today 광고: 이슈 행과 grid/gap/padding/구분선·제목 서식을 공유. 왼쪽 AD·광고/쿠팡 표기·제휴 고지 유지. 기사 `.issue`/번호·광고 간격·정치 등 이웃 제외·상품 회전·파트너 링크·상세 배치는 보존.
- 기존 버전 기록을 유지하고 새 공지 `2026-09-05-today-format` 2항목을 추가. 소개의 이력과 최초 1회 팝업은 같은 데이터를 사용한다.

## 실제 검증

- 최종 통합17파일: **456/456 PASS, skip0** (`/tmp/nh121-integration.log`). Today 현재/지난 판·공용 편집/품질·랭킹/스토리지·Live·발견 경로·광고·메뉴/요청 회귀를 포함한다.
- 실제 격리 Google Chrome: **28/28 PASS, skip0** (`/tmp/nh121-browser.log`). 320/393/1100px에서 광고와 직전 기사 grid/간격/padding/하단선·제목 크기/굵기/행간 일치. 가로 넘침0, 기사18건/01–18 번호와 광고2건 유지, 상세·복원·이웃 제외·파트너 URL 검증.
- GET/HEAD 종료6경로 모두410/no-store/noindex, 수집 호출0. Today 홈200, Live/사이트맵 옛 연결0. `_refresh`가 briefing 호출 없이 랭킹을 저장하고 기존 briefing 객체를 유지하는 실행 검증 포함.
- server/Today/Live 구문 및 `git diff --check` PASS. 폐기한 동작을 요구하던 테스트는 새 종료 계약으로 수정했다. 초기 빨간 테스트에는 Live 스크립트 템플릿을 실제 광고 태그로 오인한 검사가 있었고, 실제 마크업/SDK 검사로 바로잡았다.
- 화면 직접 확인: `/tmp/nh121-today-ad-393.png`, `/tmp/nh121-new-popup-mobile.png`.

## Orca 책임과 회수

- Root Codex: 종료 경로·공용 함수 분리·통합/테스트·릴리스/배포 책임.
- Claude Fable5.1 max: `task_3f297a3dd75d` / `ctx_f9f5efdf98d7`, Today 단일 파일 광고 변경. worker_done 수신·release 완료. [광고 검증](NOWHOT_NH121_FABLE_TODAY_AD_STYLE_2026-09-05.md).
- Cursor Grok4.6 xhigh: `task_fe544bda4fcb` / `ctx_e9104ca2a7b5`, 종료 의존성 및 최종 diff 독립 검수 GO, worker_done 수신·release 완료. [종료 검증](NOWHOT_NH121_GROK_BRIEFING_RETIREMENT_2026-09-05.md). 광고 서식 판정은 Fable·Root 책임이며 Grok 범위로 표현하지 않는다.
- 원래 Run `run_faab5a03f327`. 말미에 공유 코디네이터 terminal이 동시 PandaRank Run으로 바인딩되어 check가 fenced됨. 타 프로젝트를 재바인딩/중단하지 않고 명시적 기존 Run 메시지·읽기 전용 inbox/보고서로 회수했다.

## 운영 배포 영수증

- 기존 승인으로 `8533eaa`를 main에 push. VM HEAD `8533eaacc230bf9f875bddefc5f380b359f0e0f0`, 컨테이너 기동 **2026-09-05 13:04:07 KST**, 자동 preflight **13:04:28 OK**. `/root/autodeploy.log`와 docker StartedAt 직접 확인.
- 공개 config build **uoDUNxtY**, 공지 **2026-09-05-today-format**. `/briefing`, 과거 날짜/카테고리, `/api/briefing`, `/rss.xml` 모두410/no-store/noindex. 공개 Live·sitemap·robots 옛 연결0.
- 공개 `/api/today?categories=news,business,tech,humor`: 200, **2026-09-05 런치**, **56이슈**, `slot_canonical_verified`.
- 실제 격리 Chrome에서 공개 Today **56이슈/광고5**, 상세 광고1. 320/393/1100px에서 AD 행과 직전 기사 grid·제목 크기 일치, 가로 넘침0, AD/제휴 전문/공식 링크/sponsored noopener 보존. 첫 광고는13번 글 뒤(앞3번 뒤는 기존 정치 이웃 제외 규칙 적용).
- 공개 Live **기사10+광고1**, 옛 브리핑 링크0. 페이지 JS 오류0. 기존 방문자 상태로 새 팝업 자동 표시→닫기→상세/Live 이동 시 재표시0. 소개 이력8건(기존7+신규1) 확인.
- 공개 증거: `/tmp/nh121-public-proof.json`; `/tmp/nh121-public-today-320.png`, `-393.png`, `-1100.png`; `/tmp/nh121-public-detail-393.png`; `/tmp/nh121-public-popup-393.png`. Root가393px 광고/상세/팝업 이미지를 직접 확인했다. 실제 iPhone 증명으로 올리지 않는다.
- 최초 검증 스크립트는 이미 본 공지를 다시 강제로 열려고 해 타임아웃했다. 제품은 한 번 표시 규칙대로 동작했다. 새 격리 방문자 상태에서 자동 첫 표시·후속 비표시를 검증하도록 수정한 후 전체 공개 검증 PASS.

## WRC 보고

- 작업 시작 전 확인한 MD:
  - 자동 주입: 사용자 AGENTS.md, 메모리 요약, Ponytail Full.
  - 직접 읽음: 공유 START_HERE·운영 정본(13원칙·§11.1)·위키 규칙·집행 프로토콜·PMO_LIVE_BOARD·REPORT_READ_INDEX 관련 범위; README; orca-cli/orchestration 스킬과 현재 CLI 실행 가이드; 개발현황; NH120 기록. 메모리 레지스트리는 현재 구현/운영 구분을 위한 빠른 조회만 사용.
  - 미읽음/불가: 무관한 공용 보드 과거 하단, 실제 iPhone 실기기.
  - 이번 작업 전용 파일: server.js·engine.js·index.html·today.html·release-notes.js·product-blueprint.js·preflight 및 위 테스트/워커 보고서.
- 적용한 규칙: 입력은 확정 지시. 13 First Principles 전부 적용, 실제 호출자 추적·공용 함수 보존·최소 삭제·독립 반례 검수·구현/운영 증거 분리. Corridor analyzePlan 선행; 종료 HTML 입력 보간0, noindex/no-store, 광고 noopener/제휴 고지 유지.
- First Principles 게이트: PASS.
- 개발현황 반영: 안정 ID/변경 레코드 위와 같음; 개발현황 NH121에 연결; 로컬 완료와 운영 검증을 분리 대조.
- 금지선 준수: 기존 사용자 지시 범위의 제품 구현/배포. 수집 RSS·기록 삭제·광고 계정/키·파트너 URL 설정 변경0. 개인 브라우저·타 프로젝트 Run 변경0.
- David 행동 필요 여부: 없음(기존 구현/배포 승인으로 진행).
- Telegram 알림 필요 여부: 불필요; 메시지 전송0.
- 이익 우선·과잉방어 점검: GO. 중복 발행·불필요 LLM 경로를 종료하고 광고/공용 편집 기능을 보존. 새 의존성·RSS 대체 시스템·추가 승인 절차 없음.
- 하지 않은 일: 9월4일 누락된 이브닝 원본 재생성, 실제 iPhone 확인, 광고 클릭·정산/수익 증명, 신규 RSS, 고객 요청/외부 메시지 제출, 메모리 쓰기.
