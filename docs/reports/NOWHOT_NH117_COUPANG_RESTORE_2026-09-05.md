# NH117 — 기존 쿠팡 광고 복구

- 안정 ID `NOWHOT-LIVE-COUPANG-001`, 변경 레코드 `DEVCHG-NOWHOT-20260905-204`.
- David 입력: “광고 하나도 안보이는데? 쿠팡 전에 세팅한거”. 기존 수익화 복구 지시로 접수. 책임자 Codex가 수리·운영 검증을 맡는다.
- 작업 기준: 로컬 `da7cb32`, 운영 `b3d8912d83d38a031d1b903da20d3c5cb6411acc`.

## 원인 — 설정 소실이 아닌 서버의 일괄 차단

- 공개 `/api/config`: `monetization.enabled=false`, `adfit.reviewMode=true`, `coupang=null`. 실제 전용 Chrome `/live`에서 콘텐츠10·광고0·쿠팡 링크0 확인.
- 운영 컨테이너 읽기 전용 검사: 파트너 ID 설정 있음, Open API 키 없음, 기존 수동 배너18종 있음. 키 값은 출력하지 않았다. Open API 없이 기존 수동 링크로 수익화하는 경로가 이미 있다.
- `git blame`: `f2ca3da0`(2026-08-13)의 심사 모드가 쿠팡 클라이언트 재고를 null로 만들었고, `0b613c11`(2026-09-04 17:07 KST)이 같은 모드를 `engine.monetizationDisabled`에 연결해 서버의 핫·최신·핫딜 광고도 차단했다. NH116 핫 순위 수정에서 생긴 차단은 아니다.
- 이전 무광고 목록을 복원하는 `restoreLiveList`도 현재 쿠팡 재고로 슬롯을 다시 만들지 않았다. 이 때문에 서버만 복구해도 저장 목록을 재사용한 이용자에게는 광고가 계속 빠질 수 있었다.

## 변경

- 심사용 편집 지면과 실시간 쿠팡의 연결 세 곳을 제거했다. `/api/config`는 기존 쿠팡 재고를 전달하고, 피드 엔진은 원래 자격증명·슬롯·인접 콘텐츠 규칙으로 광고를 제공한다.
- 저장 목록 복원 뒤 기존 `maybeInsertAdfit()`를 호출한다. 이름은 과거 구현의 이름이며 현재 본문 사이 쿠팡 카드를 배치하는 함수다. 새 광고 렌더러나 배치 규칙을 만들지 않았다.
- 편집 홈의 AdFit 1단위·동일 지면 쿠팡/AdSense 제외와 `/live`의 AdFit 단위·네트워크 SDK 미전달은 유지한다. 환경변수·광고 계정·링크 18종은 변경하지 않았다.
- 배포 점검도 “심사 중 실시간 광고0” 조건을 제거하고, 실제 수익화 설정에 맞춰 쿠팡 슬롯·재고·링크·이미지·문구를 검사한다. 광고0을 성공으로 판정하던 검사까지 함께 수정했다.

## 검증

- 수정 전 실패 재현: 심사 설정 아래 Live 수익화 `false !== true`; 무광고 저장 목록 복원 뒤 쿠팡 카드 표시 timeout.
- 수정 후 관련 서버461/461 PASS: monetize, briefing-quality, deals, our-deals, inline-js, feed, mix-slider, rank, anchor, foreign-share.
- 추가 제휴 카드·쿠팡 배너·Open API 경로·광고 문구 행렬50/50 PASS. 총 관련 서버511개 통과.
- 실제 설치 Chrome: browser-navigation21/21 PASS, skip0. 기존 무광고 목록을 복원한 뒤 카드 본문·제휴 링크·고지 표시와 기존 목록 길이를 확인했다.
- `node --check` server/preflight 및 `git diff --check` PASS. 공개 운영 영수증은 배포 뒤 아래에 추가한다.
- Orca Run `run_faab5a03f327`: Fable 5.1 max가 정책 문서/변경 이력, Grok 4.6 xhigh가 공통 광고 경로/배포 검사를 독립 검토해 모두 GO. [Fable 검토](NOWHOT_NH117_FABLE_AD_REVIEW_2026-09-05.md), [Grok 검토](NOWHOT_NH117_GROK_AD_REVIEW_2026-09-05.md). 두 완료 메시지를 수신·확인하고 워커를 release했다.
- 검토 반영: 배포 설정 주석·수익화 문서·개발현황을 현재 범위로 맞췄다. NH112의 광고0 PASS는 당시 검사 이력으로 보존하고 이번 NH117에서 바로잡는다. 엔진의 범용 `monetizationDisabled` 검사는 명시적 엔진 설정을 존중하도록 남기되, 심사 모드 연결만 제거했다.

## 운영 영수증

배포 전 상태: 쿠팡 데이터0·실제 광고0. 운영 반영과 공개 화면 확인은 아직 완료로 기록하지 않는다.

## WRC 보고

- 작업 시작 전 확인한 MD — 자동 주입: 사용자 AGENTS.md·메모리 요약. 직접 읽음: 이 세션 공유 시작 게이트6개·13 First Principles; 이번 입력의 systematic-debugging, orca-cli, orchestration, 기존 수익화 문서·AdFit rescue·개발현황·NH116 기록. 미읽음/불가: 광고 계정 심사 내부 화면(이번 수리에 불필요). 이번 작업 전용 파일: server/index·briefing-quality/browser-navigation 테스트·preflight·NH117 보고서.
- 적용한 규칙: 기존 수익화 복구, 원인 재현 뒤 최소 공통 경로 수정, Corridor 사전 분석, 독립 검토·관련 시험·운영 확인.
- First Principles 게이트: PASS.
- 개발현황 반영: 위 안정 ID/변경 레코드에 원인·시험·운영 영수증 연결.
- 금지선 준수: 자격증명 값·고객 데이터 미노출, 환경변수/계정/신청/정산 변경 없음. 파트너스 링크 임의 클릭·구매·수익 발생 주장 없음. 광고 고지와 콘텐츠 인접 규칙 유지.
- David 행동 필요 여부: 복구 배포 뒤 새로고침1회. 파트너 설정 재입력 불필요.
- Telegram 알림 필요 여부: 없음.
- 이익 우선·과잉방어 점검: GO. 기존18종과 렌더러 재사용, 새 의존성·유료 호출·새 광고 지면 없음.
- 하지 않은 일: 애드핏/애드센스 신청·승인 변경, 쿠팡 링크 재발급, 광고 클릭/구매 추적 검증, 실제 iPhone Safari 단말 검증, 오늘판 광고 추가.
