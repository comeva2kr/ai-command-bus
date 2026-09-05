# NH118 — 오늘판 쿠팡 적용과 실시간 광고 누락 재검증

- 안정 ID `NOWHOT-TODAY-LIVE-ADS-001`, 변경 레코드 `DEVCHG-NOWHOT-20260905-205`.
- 입력 분류: 최종 지시. David가 오늘판에도 기존 쿠팡 적용을 요청하고 실시간 미표시를 재보고했다. Codex 책임 구현·운영 검증, Orca Fable 5.1 max 제품 검토·Grok 4.6 xhigh 회귀 검토.
- 기준: 로컬 `416245b`, 운영 `c2757dd050037380ae63d5ab2644f2a2baf50346`.

## 원인과 수정

- 오늘판은 config를 이미 받으면서 쿠팡 재고를 버리고 있었다. AdFit 자리도 모바일에서는 모든 기사 뒤의 요약 영역에 있어 기존 쿠팡이 표시되는 경로가 없었다.
- 오늘판은 기존18종·문구 행렬·고지를 재사용해 글03 뒤부터10글 간격, 상세 기사 요약 아래에 표시한다. 출처/글 번호/순서/판본 데이터는 그대로다. 같은 목록에서는 가능한 한 도착지를 반복하지 않는다. 공식 `https://link.coupang.com/` 링크만 허용하고 삽입 문자열을 escape한다. 이미지 실패 시 사진 자리만 제거한다.
- 현재 개인 오늘판에만 AdFit/AdSense 지면·SDK 주입을 없앴다. 다른 SSR 편집 페이지의 심사 경로와 광고 계정 설정은 변경하지 않았다. David의 이번 직접 지시가 8월 Today 제외 방침을 대체한다.
- 실시간의 몰입 모드에서 광고 링크는 CSS `display:contents`라 자체 박스가 없다. 기존 `dropIfAdBlocked`가 높이0을 차단으로 오인해 정상 카드를 삭제했다. 공통 검사에서 실제 `.go-text` 박스를 검사하도록 수정했다. 명시적 숨김과 전체 카드 차단은 그대로 존중한다.
- 기존 전용 Chrome에서는 별도 원인이 직접 확인됐다. 카드 삭제 직전 CDP 중단점에서 카드 `display:none`, 링크 `display:block/visibility:visible`, body 클래스 빈 문자열. `CSS.getMatchedStylesForNode` 결과 `.ad-card {display:none!important}` 규칙의 origin은 `user-agent`. 사이트 CSS에는 이 규칙이 없다. 이 Chrome 사례를 몰입 모드 오류로 설명하지 않는다. 광고 클래스 변경·차단기 설정 변경·우회 없음. David 아이폰의 차단 설정은 질문한 상태이며 아직 확인되지 않았다.

## 검증

- 수정 전 실제 설치 Chrome에서 2건 실패 재현: 몰입 모드 800ms 뒤 광고 CTA0, 오늘판 광고 표시 timeout.
- 수정 후 관련 서버235/235 PASS: briefing-quality, inline-js, affiliate-card, monetize, coupang-banner, coupang, ad-matrix.
- 실제 Chrome browser-navigation23/23 PASS, skip0. 새 오늘판 목록/상세/재로드, 글 번호01–18 보존, 글03 뒤 첫 광고·18글에2광고, 도착지 중복 회피, 이미지 실패 후 본문/고지 보존. 몰입 모드 광고 유지와 명시적 숨김 시 광고 제거 둘 다 검사.
- 구문 검사와 `git diff --check` PASS. 운영 배포와 공개 화면 확인은 아래 영수증으로 별도 기록한다.
- Orca Grok 최종 패치 검토 GO, 최초 진단에서 실제 Chrome과 몰입 모드를 혼동한 설명을 바로잡았으며 [Grok 최종 보고](NOWHOT_NH118_GROK_LIVE_AD_REVIEW_2026-09-05.md)에 두 원인을 구분했다. 최종 디스패치 `ctx_0970862f4f86` release 완료. Fable은 오늘판 최소 적용안과 몰입 모드 반례를 먼저 전달했고 최종 문서 작성 중이다.

## 운영 영수증

배포 전. 운영 적용/모바일 화면 완료를 아직 주장하지 않는다.

## WRC 보고

- 작업 시작 전 확인한 MD — 자동 주입: 사용자 AGENTS.md·메모리 요약. 직접 읽음: 이 세션 시작 게이트6개·13 First Principles; 이번 입력 wrc-start·orca-cli·orchestration·systematic-debugging, 수익화·AdFit rescue·개발현황·NH117 기록. 미읽음/불가: David 아이폰 Safari 직접 검사. 이번 작업 전용 파일: Today/Live HTML·server·기존 browser/briefing 검사·preflight·NH118 보고서.
- 적용한 규칙: 사용자 최종 지시, 13 First Principles, Corridor 사전 계획 검사, 원인별 재현, 최소 기존 경로 재사용, Orca 독립 검토·운영 대조.
- First Principles 게이트: PASS.
- 개발현황 반영: 위 안정 ID/변경 레코드에 원인·검증·운영 영수증 연결.
- 금지선 준수: 기존 링크·계정·환경변수·기사/판본 데이터 보존. 제휴 고지·링크 보안 속성 유지. 광고 클릭·구매·광고 차단 설정 변경 없음.
- David 행동 필요 여부: 배포 후 새로고침1회. 아이폰 콘텐츠 차단 사용 여부 확인은 아직 미회신.
- Telegram 알림 필요 여부: 없음.
- 이익 우선·과잉방어 점검: GO. 기존 광고 재고와 서버 문구 재사용, 추가 라이브러리·유료 API·새 계정 없음.
- 하지 않은 일: 광고 차단 우회·설정 변경, 재심사 신청·승인, 수익/구매 추적 성공 주장, 실제 iPhone 단말 결과 주장.
