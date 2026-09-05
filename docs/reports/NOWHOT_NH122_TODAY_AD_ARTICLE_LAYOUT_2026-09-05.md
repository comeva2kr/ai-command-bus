# NH122 오늘판 광고의 기사 구조 적용

- 안정 ID: `NOWHOT-TODAY-AD-ARTICLE-LAYOUT-001`
- 변경 레코드: `DEVCHG-NOWHOT-20260905-209`
- David 입력: 확정 지시. “광고서식 넘 달라. 똑같이 하자.” 기존 구현·운영 배포 승인 유지.
- 상태: 로컬 구현·Chrome 28/28·관련 90/90·공개 데이터 미리보기 PASS. 운영 배포 영수증은 아래에 별도 기록한다.

## 원인과 변경

- NH121은 바깥 행과 제목 글꼴만 공유했고 내부는 썸네일/별도 구매 버튼/별도 고지 여백이 남았다. 사용자 사진과 기사 행을 직접 대조하면 같은 서식으로 보기 어렵다. 기존 완료 판정의 시각적 검수 기준이 부족했다.
- 공유 `todayAdHtml()`에서 Today 목록·상세 광고 모두 기사와 같은 `h2 > .issue-title-button`, `editorial-grid > editorial-point`, `change-row`를 사용한다. 광고 전용 썸네일·구매 버튼 행·CSS를 삭제했다.
- 광고 제목은 기존 쿠팡 링크를 연다. AD·광고/쿠팡 브랜드·상품 안내·광고 안내·제휴 고지 전문은 유지한다. 기사 번호/발행 시각/중요도인 것처럼 꾸미지 않는다.
- 광고 선정·회전·노출 간격·민감 분야 이웃 제외·기사 목록/번호·원본 재고·파트너 URL/subId는 그대로다. 모든 동적 문구 이스케이프와 `nofollow sponsored noopener`를 유지한다.
- 기존 이력을 보존하고 새 공지 `2026-09-05-today-layout` 1건을 추가했다. 소개와 최초 1회 팝업은 같은 데이터다.

## 증거와 한계

- 먼저 새 제목 DOM 검사를 추가해 이전 구현에서 광고 제목 h2 0/기대2로 실패한 뒤 수정했다. `/tmp/nh122-red.log`.
- 실제 격리 Google Chrome **28/28, skip0**: 목록/상세/복원/번호·순서·링크/이웃 제외, 320·393·1100px에서 기사와 광고 행 grid/gap/padding/border 및 제목 크기/행간/굵기 일치. 썸네일/독립 CTA 없음, 가로 넘침0. `/tmp/nh122-browser.log`.
- 관련 `briefing-quality`, `inline-js`, `service-feedback` **90/90, skip0**. 정적 테스트의 옛 하드코딩 문구 검사를 실제 동적 고지 이스케이프·광고 aria-label 검사로 바꿨고, 브라우저에서 렌더링된 제휴 고지 전문을 별도 검증했다. `/tmp/nh122-related.log`.
- 공개 API 데이터 + 로컬 Today HTML만 교체한 **미리보기**에서 런치56이슈/광고5, 상세1, 세 화면폭 서식·고지·링크/오버플로 확인. Root가 `/tmp/nh122-preview-today-393.png`의 인접 기사와 광고 및 `-detail-393.png`를 직접 확인했다. `/tmp/nh122-preview-proof.json`. 이 검사를 운영 반영 증거로 쓰지 않는다.
- 사진의 Safari 광고 제목/이미지 공백 원인은 **미확정**. 공개 재고18종·변형270개에서 빈 제목0을 확인했으나 실제 iPhone 재현은 하지 못했다. 기존 이미지 경로를 제거했음을 관측 원인 해결로 확대하지 않는다. 차단 우회 CSS나 사용자 브라우저 설정 변경 없음.

## Orca 3자 검토

- Root GPT6: 구현·통합 검증·운영 배포 책임.
- Fable5.1 max: `task_10cb16390c25` / `ctx_abdb6031486a`, 실제 서식/제품 검토. 최종 회수 결과는 아래에 기록.
- Grok4.6 xhigh: `task_c48df2de4d6f` / `ctx_811adc600f4d`, 제목 공백 후보·공유 경로 회귀 독립 검토. 최종 회수 결과는 아래에 기록.
- NowHot 전용 새 코디네이터 `term_8e483e56-d8a2-4705-95cd-843d85e56d57`, Run `run_fd13e2137b5f`. 이전 코디네이터의 PandaRank 바인딩을 변경하지 않고 전용 연결을 만들었다.

## 운영 배포 영수증

- 검증 후 실제 main/VM/공개 HTML 확인값을 추가한다. `buildId`는 index.html 해시이므로 Today 단독 변경의 증거로 쓰지 않고 Today 바이트/구조와 VM commit을 대조한다.

## WRC 보고

- 작업 시작 전 확인한 MD:
  - 자동 주입: 사용자 AGENTS.md·메모리 요약·Ponytail Full.
  - 직접 읽음: 공유 START_HERE·운영 정본 13원칙·위키 규칙·집행 프로토콜·PMO_LIVE_BOARD·REPORT_READ_INDEX 관련 범위; README·개발현황·NH121; orca-cli/orchestration 및 현재 CLI 가이드; systematic-debugging·test-driven-development·verification-before-completion 관련 범위; 메모리 레지스트리 현재 구현/운영 구분.
  - 미읽음/불가: 무관한 공용 보드 과거 하단, 실제 iPhone/WebKit 런타임.
  - 이번 작업 전용 파일: today.html·release-notes.js·browser-navigation/briefing-quality 테스트·위 미리보기/검증 로그·이 보고서.
- 적용한 규칙: 13원칙 전부, 실제 호출자 추적·공유 함수 최소 수정/삭제, Corridor analyzePlan 선행, 독립 검토, 로컬·운영 증거 분리.
- First Principles 게이트: PASS.
- 개발현황 반영: 위 안정 ID/변경 레코드로 NH122 연결. 직전 NH121 서식 판정을 이번 사용자 사진/실제 구조로 보완한다.
- 금지선 준수: 기존 승인 범위의 제품 구현/배포. 광고 계정/키/파트너 설정·원본 데이터·수집/판본·타 프로젝트·개인 브라우저 변경0.
- David 행동 필요 여부: 없음.
- Telegram 알림 필요 여부: 불필요, 외부 메시지 전송0.
- 이익 우선·과잉방어 점검: GO. 기존 광고/링크 유지, 새 의존성·캐시 계층·별도 광고 템플릿 추가 없음.
- 하지 않은 일: 실제 iPhone 확인, 사진 속 공백의 정확한 원인 확정, 광고 클릭/정산/수익 증명, 타 기능 재수정, 메모리 쓰기.
