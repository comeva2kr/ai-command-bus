# NH124 사건·출처·발췌 정합성 수리

- 안정 ID: `NOWHOT-EVENT-SOURCE-EXCERPT-INTEGRITY-001`
- 변경 레코드: `DEVCHG-NOWHOT-20260905-211`
- 입력 분류: 승인. David의 “진행해”에 따라 NH123에서 발견한 현재 화면 결함을 수리한다.
- 상태: 코드·후보 검증 완료, 운영 배포/활성화 결과는 아래에 추가한다.

## 원인과 수정

1. 사건 병합은 `open`을 `OpenAI`의 접두어로 인정하고 Hugging Face를 두 독립 토큰으로 셌다. 보도 상투어까지 합쳐 인수·METR 조사·독일 사이트 사건이 모두 직접 쌍 병합됐다. 단순 전이 병합 문제가 아니었다. 영문 토큰은 완전 일치하고 회사명은 한 토큰으로 계산하며, 원문 제목을 표시 중복 제거에도 전달한다. 한국어 조사·검증된 한영 결합은 보존했다.
2. 실제 전체 후보에서는 여섯 번째 캘리포니아 조사 기사가 BBC 제목의 배경절과 다시 묶이는 반례가 나왔다. 명시적 `before …, report claims` 형식만 사건 토큰에서 제외한다. 원문·URL·강한 제목 키·독자 표시는 그대로다. 범용 before/after 삭제와 전역 임계 상향은 하지 않았다. 실제 6행은 캘리포니아 / BBC+p25 / METR / Nvidia+긱뉴스의 4사건이다.
3. 같은 발행사에서는 가장 오래된 링크를 남기면서 제목은 전체 구성원 중 최신을 고르던 불일치가 있었다. 대표 제목과 링크를 동일한 대표 목록에서 고른다. canLead·직접 URL·한국어판 우선순위를 유지하고 같은 발행사 안에서 최신을 선택한다. 출처 수를 늘리지 않는다.
4. 기존 `cleanArticleTextChrome`와 문단 추출 폴백을 고쳤다. figure/header/script 등 비본문 문단을 먼저 제외하고 실측 사진 표기·기자 메일·Engadget 위젯·TechCrunch 플레이어·게시자 제휴 안내를 정리한다. 번역된 캐시 문구도 같은 경계에서 정리한다. `[제작비 논란]`, `[촬영본 유출]`, `문의는 press@example.com`은 보존한다.
5. 실시간 기존 풀·RSS·저장 상세는 새 enricher만으로 바뀌지 않아 기존 `_cleanItemSummary`에 같은 함수를 연결했다. 자체 ourdeal/ad/affiliate는 제외한다. 이토랜드의 두 문장 소개+참여 유도도 기존 소개문 판정에 포함하되 후속 보도는 보존한다.
6. Techmeme 독자 제목에서 저자/매체 꼬리를 정리하고 원제의 `Sources:`를 문장 처음·중간 모두 ‘소식통:’으로 표시한다. 새 RELEASES 항목 `2026-09-05-content-fix`가 업데이트 기록과 한 번만 뜨는 공지를 공유한다.

## 검증

- 신규 실패 재현 후 수정: `/tmp/nh124-before-tests.log`. 최초 5행에 그치지 않고 실제 후보의 p30까지 6행으로 보강했다.
- 사건·분류·브리핑·독자 문장 190/190: `/tmp/nh124-core-tests-4.log`.
- 정본·정시 준비·상세 재사용·기사 요약 150/150: `/tmp/nh124-pipeline-tests-final.log`.
- 최종 발췌·실시간·저장 상세·공지/요청·독자 문장 300/300: `/tmp/nh124-content-final-tests.log`. 앞선 독자 문장 20개와 겹치므로 합산하지 않는다. 마지막 정상 보도 보존 검사도 `/tmp/nh124-final-cases.log` 및 직접 대조 PASS.
- 실제 Chrome의 공지 회귀 3/3: `/tmp/nh124-release-browser-tests.log`. 과거 공지 캐시·모바일 시작 위치·Today/Live 간 한 번 표시.
- selection 계약 32/33. 실패 1개는 HEAD부터 존재한 sourceRegistry 잠금 불일치다. `/tmp/nh124-baseline`의 원본도 같은 지문 `7290afd0fadf495c → 52bb45ceca678cb1`로 실패한다. 이번에 승인한 eventCluster 지문만 갱신했으며 무관한 registry 잠금을 덮어쓰지 않았다.
- Fable의 광역 검사에는 기존 12실패·1취소가 있다. 워커가 clean HEAD 및 자신의 두 파일 적용본에서 동일 실패를 대조했다. 브리핑 종료 전의 정적 문자열 검사·기존 광고/통계·SW 시점·registry 잠금 등을 포함하며 전체 스위트 PASS로 주장하지 않는다. 새 발췌 픽스처 실패 1건은 수정 후 통과했다.

## 교정 정본

- 기존 런치 `SCE-c1e006868413a496`를 덮어쓰지 않는다. 동일한 VM 동결 pool/packet/routing으로 새 후보를 생성했다. pool SHA `1040025bffb0ec48d18ea1ddfcd1ca5797f479007247c1291d2aeb7cdead2038`는 packet과 일치한다.
- 최종 후보 `SCE-52a3395bf1acdcb2`, SHA `52a3395bf1acdcb2691e11d60eb506319ac487de273f20bbe004258e7b5d79c7`. 전체193·14분야 각14·선택4분야56. 발췌161·원문불가32, 유료 LLM 호출0. 원문불가를 생성 요약으로 위장하지 않는다.
- 주요 해외 보도: news2/business2/tech7 유지. 날짜/시스템 시각 조작·강제 기사 승격 없음. 인수와 METR은 분리된 원자료 사건이며 모두가 14개 선별 지면에 반드시 나온다는 뜻은 아니다.
- 전체193건 제목에 해당하는 원문 링크 누락0. 공개 예정 독일 사이트 카드는 BBC+p25만 포함하며 p25 링크 존재. 표적 번역 위젯·플레이어·확인된 기자 메일 잔재0. `/tmp/nh124-candidate-proof.json`, `/tmp/nh124-candidate-today.json`, `/tmp/nh124-release-candidate/` 참조.
- 중간 후보 7d306은 p30 오병합 때문에, e0fb13은 문장 중간 Sources 교정 전이어서 활성화하지 않았다.

## 3자 검토와 수명 관리

- Root: 공통 경로 구현·실제 후보 대조·통합 테스트·배포/정본 활성화 책임.
- Fable5.1 max: `task_57f6f6179fe6` / `ctx_b3d5c38e9cbc`, [원문 추출 수리](NOWHOT_NH124_FABLE_EXCERPT_FIX_2026-09-05.md). report 권고의 `_decorate` 중복 필터 대신 기존 `_cleanItemSummary`를 사용했다. §6의 이토랜드 소개문은 Root가 후속 보완했다. worker_done 수락 후 released/closed_agent_terminal.
- Cursor Grok4.6 xhigh: [원인](NOWHOT_NH124_GROK_MERGE_REVIEW_2026-09-05.md), [사건·출처 diff](NOWHOT_NH124_GROK_FINAL_REVIEW_2026-09-05.md), [발췌 반례](NOWHOT_NH124_GROK_EXCERPT_REVIEW_2026-09-05.md), [6행·번역 캐시 검수](NOWHOT_NH124_GROK_CANDIDATE_REVIEW_2026-09-05.md) GO. 과삭제가 ‘비블로커’라는 의견과 달리 Root는 이미 재현된 두 반례도 좁혀 수정했다. 최종 `ctx_77309d851060` released/closed_agent_terminal.
- Run `run_5c67cf8e8e78`, 전용 코디네이터 `term_8e483e56-d8a2-4705-95cd-843d85e56d57`. 완료 메시지 전부 처리·ACK, 최종 미수신0. 초기 Grok 입력 붙여넣기 정체 두 번은 failed 확인·각 터미널 release 후 명시 재시도했다. 세 번째는 pending prompt 확인 후 Enter 전달로 ready를 확인했다. 마지막 재사용 중 직접 후속 메시지를 처리하느라 준비 timeout이 한 번 있었고, 무소유 failed Dispatch 정리 후 동일 터미널 재시도로 ready 확인했다. 실패 시도를 실제 검토 참여로 세지 않는다.

## 운영 결과

배포 후 실제 commit·컨테이너·preflight·새 활성 포인터·공개 API·모바일 결과를 이 절에 기록한다.

## 남은 한계

BBC 바이라인, 일부 다른 매체 인포라인·이벤트 배너, 어색한 기계번역 전체와 분류 품질은 모두 해결됐다고 주장하지 않는다. 실제 iPhone Safari 확인은 David 답변 대기다. 이브닝 정시 발행은 오늘19:05의 기존 1회 heartbeat `automation-3`에서 실제 시각/영수증으로 확인한다. 쿠팡을 유지하며 AdSense/AdFit 재신청·계정 상태 확인은 이번 배포 범위가 아니다.

## WRC 보고

- 작업 시작 전 확인한 MD: 자동 주입 AGENTS.md·메모리 요약·Ponytail Full; 직접 읽음 START_HERE·CANONICAL 13원칙·WIKI_RULES·ENFORCEMENT·PMO_LIVE_BOARD·REPORT_READ_INDEX 관련 범위, README·개발현황·NH122/NH123, Orca CLI/orchestration/WRC start 스킬과 현재1.4.197 가이드; 미읽음/불가 무관한 보드 과거 하단·실제 iPhone·미래 이브닝; 이번 작업 전용은 위 구현/테스트/후보/5개 워커 보고.
- 적용한 규칙: 명확한 승인·13원칙 전부·기존 함수 재사용·코드 작성 전 Corridor·원본과 새 정본 분리·로컬 검사와 운영 증거 분리.
- First Principles 게이트: PASS.
- 개발현황 반영: 위 안정 ID/변경 레코드를 `docs/NOWHOT_DEVELOPMENT_STATUS.md` NH124에 연결하고 공개 결과와 대조한다.
- 금지선 준수: 개인 브라우저·고객 메시지·광고 클릭/계정 제출·유료 API·시각 조작·원본 정본 덮어쓰기0. 사용자 승인한 수정/배포와 교정판 활성화만 수행한다.
- David 행동 필요 여부: 실제 iPhone 결과만 대기. 배포·후속 확인은 에이전트 담당.
- Telegram 알림 필요 여부: 없음, 이 대화에서 보고.
- 이익 우선·과잉방어 점검: GO. 기존 기사·광고·원문 연결을 보존하고 반복 발생 경로를 공통 함수에서 고친다. 새 의존성0.
- 하지 않은 일: 모든 기사 사실 검증·전체 번역 재작성·전체 분류 수리·광고 신청/승인·수익 검증·iPhone 실기기 조작·메모리 쓰기.
