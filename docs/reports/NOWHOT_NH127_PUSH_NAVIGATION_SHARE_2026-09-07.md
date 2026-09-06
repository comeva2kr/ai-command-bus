# NH127 갤럭시 삼성 인터넷 알림·공유 경로 수리

- 안정 ID: `NOWHOT-PUSH-NAVIGATION-SHARE-001`
- 변경 레코드: `DEVCHG-NOWHOT-20260907-214`
- 입력 분류: 확정 수리 지시. 갤럭시 기본 브라우저인 삼성 인터넷 기준으로 오늘판 3회, 실시간 주요 소식/반응 상승 알림, 기본 뒤로가기, 공유 차단/미리보기를 확인한다.
- 현재 상태: Root 통합 구현·독립 검토 PASS, Fable/Grok 조사 회수·완료 워커 release·ACK. 1차 알림·공유 수리는 운영 반영했다. 후속 검증에서 발견한 오늘판 전분야 최소수량 교착을 수리했고 2차 배포를 준비한다.

## 확인한 원인과 변경

1. 기존 운영은 `PUSH_DIGEST_MS=3600000`으로 일반 관심글 알림만 확인했다. 하루 3회는 일반 다이제스트의 상한이었으며 오늘판 슬롯 발행 알림은 없었다. 이제 기존 정본 reader로 현재 날짜/슬롯의 실제 검증된 발행본을 확인한 후 모닝·런치·이브닝마다 한 번 발송한다. 늦게 준비된 판은 다음 점검에서 재시도하고, fallback/미발행 판은 보내지 않는다. 같은 슬롯 교정판이나 재시작으로 중복 발송하지 않는다.
2. 오늘판 수신 기록과 Live 수신 기록을 분리했다. 운영 점검은 60초마다 하되 실시간 알림은 하루 최대6회·최소30분 간격, 3시간 이내 소식으로 한정한다. 뉴스는 다중 보도 또는 상위 편집 신호, 커뮤니티는 기존 인기 관문과 수집된 반응 값의 실제 증가를 함께 요구한다. `heatHist`는 추천+댓글×2이므로 시간당 추천수나 실제 추천수 증가로 과장하지 않는다. 읽음·중복 ID·사용자 숨김·출처 차단·종류 양 끝 설정을 적용한다.
3. 스크린샷의 제한 문구는 지금핫의 `TOPIC_FILTERED`이다. 기본 정치/종교 숨김이 공유 글 상세까지 막고 있었다. `/api/item`에서 직접 선택한 글만 일회성으로 읽히게 하고, 저장 설정·목록·관련 글·알림 필터·관리자 출처 차단은 보존한다. 성인 분류 기능을 새로 만들거나 성인 출처를 켜지 않았다.
4. 공유 중계 `/p?id=`를 `robots.txt`가 전체 차단했다. 미리보기 메타 수집은 허용하고 중계 페이지 검색 색인은 HTML의 `noindex,follow`로 제외한다. 원래 기사 사진을 1순위로 보존하며 자체 PNG를 두 번째 OG 이미지로 추가했다. 크기를 알 수 없는 외부 사진에 1200×630이라고 쓰지 않고 자체 PNG에만 해당 속성을 연결한다. `/p`와 robots는 재검증하도록 한다. 이미지 다운로드·프록시·재호스팅은 없다.
5. 기존 허용 상태라도 서버의 구독 연결을 복구하지 않았고, 알림 버튼은 권한 허용 후 사라졌다. Today/Live가 공용 `NowHotPush.restore`로 기존 허용/구독만 재연결하고, 양쪽 메뉴의 버튼으로 명시적으로 신규 연결할 수 있게 했다. 자동 권한 요청은 없다. SW는 화면을 보고 있어도 전달된 알림마다 OS 알림을 표시하고 PNG와 슬롯/글별 tag를 사용한다. 하나의 `feed-digest`로 모든 알림을 덮지 않는다.
6. SW 캐시를147로 갱신하고 공용 푸시·뒤로가기 스크립트에 버전 주소를 사용한다. 새 HTML이 먼저 도착해도 옛 SW의 버전 없는 캐시에 남은 이전 뒤로가기 코드를 받지 않는다. 기존 실제 navigation-history 구현은 보존한다.

## 검증과 한계

- 푸시16/16, 직접 링크 HTTP 포함13/13, OG/robots 관련3/3 PASS. 실제 정본 파일을 발행하고 실제 reader를 통과시키는 통합1/1 PASS. Live 선별 반례·기존 digest 집중4/4 및 안전 후보 반례1/1 PASS. `git diff --check` PASS. 전체 테스트 묶음은 실행하지 않았다.
- 첫 단위 검사 뒤 독립 검토에서 실제 reader의 필수 categories 누락을 잡았다. 기존 `DEFAULT_EDITORIAL_PREVIEW`를 전달하고 실제 reader 통합을 추가해 통과했다. 부적절 후보가 limit1을 선점해 정상 알림이 안 나가는 반례도 선발 전에 제외하도록 수정했다. 이 중간 오류는 운영에 배포되지 않았다.
- 보조 Codex `nh127_push_review`가 최종 백엔드 GO를 회수했다. 집중5/5와 HTTP1/1을 별도로 실행했다. [Grok 공유 조사](NOWHOT_NH127_GROK_SHARE_REVIEW_2026-09-07.md)는 운영의 같은 종류 정치 글에서403을 재현했다. 제보 원본 URL 자체는 미도착이므로 해당 링크라고 주장하지 않는다. 모든 기사 사진을 공통 로고로 바꾸자는 제안은 채택하지 않았다.
- [Chromium 공식 설명](https://chromium.googlesource.com/chromium/src/+/HEAD/docs/history_manipulation_intervention.md)에 따르면 사용자 활성화 없이 추가한 기록은 브라우저 UI 뒤로가기에서 건너뛸 수 있고 Android는 탭을 닫을 수 있다. `history.back()`이나 Playwright `goBack()`의 성공은 기기 기본 버튼 성공의 증명이 아니다. 실제 삼성 인터넷 기기는 연결되어 있지 않다.
- [삼성 인터넷 개발 안내](https://developer.samsung.com/internet/android/web-developer-guide.html)는 Web Push 지원을 설명한다. 서버 수락·서비스워커 표시·실제 Galaxy 알림 수신은 서로 다른 증거다. 실제 기기 수신이나 세 번의 정시 운영 수신을 미리 완료로 세지 않는다.
- 제보 링크의 카카오/X 캐시와 외부 이미지 CDN 수집은 미확인이다. OG에 후보 이미지를 추가했다고 모든 플랫폼이 두 번째 이미지를 반드시 선택하는 것은 아니다.
- 최종 백엔드/공용 helper/HTTP/인라인 구문45/45 PASS. 공용 helper의 권한·거부·구독없음·키 변환·HTTP/통신 오류 VM1/1 포함. 실제 브라우저의 기존 상세/발행본/알림 클릭·양쪽 구독 연결·SW 알림 표시6/6 PASS. 추가 무활성 CDP 브라우저 Back 입력1/1 PASS. `/tmp/nh127-final-core.log`, `/tmp/nh127-browser-tests.log`, `/tmp/nh127-back-input-cdp.log`.

### Fable 뒤로가기 결론에 대한 Root 재검증

- [Fable 인수인계](NOWHOT_NH127_FABLE_HARDWARE_BACK_DEEPLINK_2026-09-07.md)의 Chromium 정책 설명은 조사 단서로 사용했다. 그러나 T6/T7의 확정 원인 주장은 채택하지 않았다. 실제 `intervention-experiment5.mjs`에서 history를 만드는 조건은 `mode === "eager"`인데 `/deep` 요청은 `html("deep")`으로 응답하므로, 해당 두 검사는 애초에 목록 기록을 만들지 않았다. 그 결과를 실제 NowHot 코드의 결함이라고 볼 수 없다.
- Root는 실제 index/helper를 불러오는 기존 fixture에 CDP `Page.navigate`를 추가하고, `Runtime.evaluate`에 userGesture를 주지 않은 상태에서 `hasBeenActive:false`와 실제 목록/상세 기록을 확인했다. 그 상태의 브라우저 Back 입력은 목록으로 돌아왔다. 최초 일반 Playwright 진입은 active:true였으므로 그 결과는 무활성 증거로 버렸고 fixture를 고쳤다.
- 첫 탭 이후에 기록을 만드는 Fable 제안은 사용자가 탭 없이 읽고 기본 Back을 누르는 제보를 해결하지 못하므로 적용하지 않았다. 작동하는 히스토리 로직을 바꾸거나 가짜 활성화·무한 뒤로가기 방지를 추가하지 않았다. 버전 없는 오래된 스크립트 캐시를 우회하도록 고친 것은 확인된 배포 경로 수리다. **실제 Galaxy 기본 버튼 증상이 해결됐는지는 여전히 미확인**이며, 이 CDP 검사를 삼성 기기 성공으로 세지 않는다.

## 운영 관측·협업

- 변경 전 운영 `afee38acb876515e3b59ae50694ca872876eb6f1`, 점검1시간·VAPID 키 존재 확인. 저장 사용자1213·endpoint 기록4·활성4를 개인정보 없이 집계했다. 그중 유효 FCM 키를 가진 구독2개와 암호화 키가 비어 있는 잘못된 기록2개다. 후자의 전송 오류는 특정 Galaxy 기기 실패가 아니며 암호화 단계에서 중단된다. 실제 고객을 대상으로 시험 발송하지 않았다.
- Orca run `run_ef73c6e2b015`: Root 백엔드·통합, Fable5.1/max 브라우저, Cursor Grok4.6/xhigh 공유 독립 조사. Grok `ctx_802b5595f168` 성공 보고 후 정확한 소유 터미널 release·`delivery_779403e1bcd9` ACK 완료. 앞선 모델 인자/프롬프트 수락 실패는 성공으로 세지 않았다. 실패 소유 터미널은 release 또는 현재 dispatch로 소유권 이전 후 정리했다.
- Fable 실험이 길어져 Root가 보고 전용으로 범위를 전환했다. 08:07:07 KST 인수 ACK 후 공개 파일은 Root가 통합했다. 완료 `ctx_e780f83bfabf` release·`delivery_a200be780310` ACK 완료. Fable 제품 코드0, 조사 보고1이며 구현 성공으로 세지 않는다. 보조 Codex가 공용 helper와 VM 검사1건을 구현했고 Root가 UI/SW와 통합했다. 최종 공용 푸시 통합도 독립 GO 회수했다.

## 1차 배포와 오늘판 발행 교착 후속 수리

- 운영 `910604bbf487dc87b5aa815dcfb10760239e5081`: 08:16:08 KST 자동 배포, 08:16:27 preflight OK, 기존 타이머60초 반영. 정상 Live 선별 작업에서 유효 FCM 구독2개가 성공 응답을 받아 기록됐다. 잘못된 키 기록2개는 실패이며 실제 Galaxy 실패로 세지 않는다. 고객 대상 시험 알림은 보내지 않았다.
- 새 공지 `2026-09-07-notifications-share` 1회·다시 열기 중복0·소개 이력12개 PASS. 공개 정치 글 상세 접근/페이지 내 목록 복귀 PASS. 이후 Today 점검에서 Sep7 모닝 요청이 Sep6 이브닝 `SCE-67413f3497c519b2`으로 fallback되는 것을 발견했다. 이 시점의 오늘판 발행/알림 완료 주장은 철회하고 원인을 추적했다.
- 서버 로그 `semantic lane coverage short (auto 7/13)`와 같은 SHA로 묶인 실제 풀/packet/routing으로 재현했다. 다른13분야는 각각14건, 자동차는 검증된7건이었다. 한 분야 최소13건 미달 때문에 판 전체가 멈췄다. 기존 carry/reserve가 있는데 새 재수집 루프나 빈 기사 채우기를 추가하지 않았다.
- 기존 발행/검증/투영의 공통 경로를 수정했다. 새 `coveragePolicy:available_verified` 정본은 14개 분야에 실제0~14건을 기록하고 목표14·미달/빈 분야를 사실대로 표시한다. 전분야0건·잘못된 source/summary·중복·hash/identity 변조는 계속 거부한다. marker 없는 과거 정본의 최소13건 계약은 그대로다. 선택한 빈 분야를 다른 분야로 몰래 바꾸지 않는다.
- 실제 모닝 후보 `SCE-86304874178116ce`, SHA `86304874178116ce987edca35dbaf167c087b8f841e3183826bd5abf614f7458`:185개 고유 이슈, 13분야14/자동차7, excerpt_only132/source_unavailable53, 기존 본문9개 재사용, LLM0. `/tmp/nh127-morning-candidate/candidate-2026-09-07-morning-863048741781.json`은 정상 builder로 만들었으며 수동 활성화하지 않았다. 기본4분야56건 충족·자동차7/14 부분충족 투영 PASS.
- 정본34/34, 독립 사전발행/fulfillment20/20, 브라우저7/14 표시와 상세 열기1/1 PASS. 독립 검토에서 기본4분야가0/자동차만 있는 판의 알림 누락 반례를 추가 발견해, generic 발행 존재 확인만 전체 CATEGORIES로 조회한다. 실제 auto-only 정본 reader의 RED를 먼저 확인한 후 수정했다. 사용자별 글 제목을 알림에 노출하지 않는다.
- 이미 배포한 공지 ID를 수정하지 않고 별도 `2026-09-07-edition-recovery` 이력/팝업을 추가했다. 2차 배포 후 정상 스케줄러의 모닝 활성화·발송 영수증을 확인한다.

## WRC 보고

- 작업 시작 전 확인한 MD — 자동 주입: 사용자 AGENTS·메모리 요약·Ponytail Full. 직접 읽음: 공유 START_HERE·CANONICAL 13원칙 전체/§11.1·WIKI_RULES·ENFORCEMENT·PMO_LIVE_BOARD/REPORT_READ_INDEX 관련 머리, README·개발현황·직전 NH126 보고, wrc-start/orca-cli/orchestration SKILL과 현재 가이드, legal 이미지 조항. 미읽음/불가: 무관한 보드 과거 하단·실제 Galaxy·원본 제보 URL. 이번 작업 전용 파일: engine/push/store/server/docker-compose와 해당 집중 검사, navigation/index/today/SW 브라우저 경로, NH127 조사.
- 적용한 규칙: 수리 지시 범위·13원칙 전체·§11.1·Ponytail 공통 경로 재사용·코드 전 Corridor·실제 Orca 협업·독립 검토·개인 브라우저 격리·검사와 운영/기기 증거 구분.
- First Principles 게이트: PASS.
- 개발현황 반영: 위 안정 ID/변경 레코드로 1차 운영과 2차 후보 검증을 기록했다. 2차 운영 영수증을 추가한다.
- 금지선 준수: 원본 판본·개인 브라우저·구독 동의 보존. 실제 고객 시험 푸시·제3자 메시지·광고 신청·신규 유료 호출·메모리 쓰기0.
- David 행동 필요 여부: 수리는 기존 지시로 진행한다. 실제 Galaxy 수신/기본 버튼 결과와 원본 문제 URL 확인은 별도 남는다.
- Telegram 알림 필요 여부: 없음. 이 대화에서 보고.
- 이익 우선·과잉방어 점검: GO. 기존 발행 reader·push·기록 저장을 재사용하며 신규 큐/서비스/이미지 프록시를 만들지 않았다.
- 하지 않은 일: 자체 기사 수집/작성 운영 가동·광고 심사 신청·미확인 실기기 완료 주장·전체 풀 재수집·과거 정본 덮어쓰기.
