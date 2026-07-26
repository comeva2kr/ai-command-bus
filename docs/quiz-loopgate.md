# 루프게이트 플로우차트 팩 — 주간 유형테스트 파이프라인

목표: **매번 바이럴 조건을 전부 갖추고, AI로 만든 티가 나지 않는 테스트만
발행되도록** 조건을 게이트로 성문화하고, 통과할 때까지 반려 사유를 피드백으로
재생성하는 루프를 돌린다.

> **정본은 선언식 팩 매니페스트다: [`src/quiz/pack.manifest.json`](../src/quiz/pack.manifest.json).**
> 게이트 등급·재시도 예산·제외 토픽·임계값·산출물 규약·no_go는 전부
> 매니페스트에서 로드되고(코드 상수 금지), 게이트 로직 자체는
> `src/quiz/gates.js`가 매니페스트를 해석해 실행한다. **이 문서는 파생 뷰 —
> 조건 값을 여기서 손편집하지 말 것.** 값 변경은 매니페스트에서 하고 이
> 문서에 반영한다.

> WRC 통합 상태 (2026-07-24 갱신): 검증된 세션 어댑터(`list_sessions` →
> `send_message`)로 WRC Workflow Gate 세션에 문의 3건을 전달했고 **정식
> ACK + 회신을 수신했다** (claude_workflow_gate, 2026-07-23). 회신에 따라
> 반영한 것: ① 선언식 매니페스트를 단일 진실원으로 추가 ② 게이트 ID를 팩
> 접두 `QG`로 리네임 ③ 게이트별 등급(HARD/HOLD/GUIDE) + risk_policy 선언
> ④ `runGates` 결과 봉투 고정(`{decision, reasons, gateResults}`) ⑤ 재시도
> 예산 매니페스트 이관 + 소진 시 fail-loud ⑥ 회차 결박 + 원자적 쓰기
> ⑦ `no_go: external_publish` 명문화. **정합 검토 결과 (2026-07-24):
> PASS_WITH_3_CORRECTIONS** — 의도적 편차 3건(QG3 HOLD·slug-키 스토어·json)
> 전부 수용, identity 패턴 교정 3건 반영 완료. **운전석 전용 메뉴 등록 완료**
> (wrc-workflow-gate `workflows/weekly_viral_quiz.yaml`, 라이브 확인
> `pack:weekly-viral-quiz`, activation `display_and_link_only` — 실행·산출물은
> 이 레포가 정본).

**게이트 ID 마이그레이션**: `G0→QG0, G1→QG1, G2→QG2, G3→QG3, G4→QG4,
G5→QG5, G6→QG6` (WRC 컨벤션: 팩 접두 — 전 팩 공유 표면에서의 충돌 방지.
매니페스트 `gate_id_migration`이 기계 정본).

> **생성 알고리즘 = 5단계 전문가 작업 절차** (0.소재 해부 → 1.컨셉 →
> 2.문항 초고 → 3.결과 초고 → 4.셀프 검수 → 5.제출, `buildPrompt()`가 단일
> 원본). 2차 적대 검수(전문가 5그룹+이용자 20명, 2026-07-25) 결론: "형식
> 게이트는 작동하지만 의미 층위가 샌다 + 생성이 한 방 출력이라 전문가가
> 만든 티가 안 난다" — 룰 나열식 프롬프트를 실제 제작자의 작업 절차로
> 재편해서, 소재-행동 짜깁기·오프닝 템플릿화·극 조언 수렴·상표 오남용 같은
> (코드 게이트가 형식적으로는 못 잡는) **의미 정합은 4단계 셀프 검수 +
> QG5 사람 판단이 담당**하고, 글자수·비율·유사도 같은 **형식 조건만 코드
> 게이트(QG0~QG4)가 담당**한다. 하드코딩 금지 원칙에 따라 이번 신규 검사도
> 값은 전부 매니페스트 `pack_contract.checks` 선언이다(코드 상수 없음).

> **사전설명·친절문장 원칙 (David 실사용 피드백 2026-07-25)**: 생성된 퀴즈가
> 커뮤니티 내부자 전보체로 나와서 모르는 사람은 못 알아듣는다는 지적 —
> ① 시작 전 사전설명(weeklyBrief)이 있어야 하고 ② 문장이 완결형으로
> 친절해야 하며(전보체 금지) ③ 소재는 대중성 신호(여러 커뮤니티 동시 화제)를
> 우대해야 한다. 전부 매니페스트 선언값으로 강제한다 — weeklyBrief 15~90자
> +친숙도 등급(familiarity_tiers), 축 intro 15~70자("이 테스트가 뭘
> 확인하는지"), topics.js의 cross_source_bonus/max_single_source_topics.

> **주제선정 큐레이션 개편 (David 실사용 피드백 2026-07-26, "주제 자체가
> 별로", 매니페스트 version 5, superseded)**: 기계 선정(hotness 랭킹)을 최종
> 결정권자 지위에서 내려, `candidate_pool_size`(15)개짜리 후보 풀만 추리게
> 했다. 자세한 이전 파이프라인·조정법은
> [quiz-topic-selection.md](quiz-topic-selection.md)(역사적 문서) 참고 —
> **아래 방향 정정으로 이 설계 자체가 대체됐다.**

> **테마 우선 전환 (David 확정 2026-07-26, "테스트 하나 = 성향 하나",
> 매니페스트 version 6)**: 위 큐레이션 개편조차 "소재를 잘 고르면 된다"는
> 전제가 틀렸다는 게 David의 결론이다 — **테마(성향 하나)가 주인이고, 결과
> 형태는 테마 따라 유연하다** (`combo_types`=유형 조합형, `level_bands`=주
> 지표 %+밴드). 핫아이템 수집 파이프라인은 폐기가 아니라 **유행 테스트 신호
> 탐지용으로 전환**된다 — 화제 뉴스가 아니라 "요즘 이런 테스트가 도는지"를
> 본다(`topics.js pickTestTrendSignals`, `pack_contract.trend_signal_*`).
> `weekly.js prompt`는 이제 ① 유행 테스트 신호(참고용) ② 테마 후보 풀
> (`pack_contract.theme.pool`, 최근 `no_repeat_weeks` 재사용 테마 제외)을
> `buildPrompt()`에 넘기고, [0단계]에서 생성자가 테마 1개를 직접 고른다
> (`--theme <id>`로 강제 지정 가능). **토픽 결박 게이트(제목/결과 토픽
> 키워드·토픽 커버리지·문항 토픽 비율·브리핑 토픽 커버리지)는 전부
> 폐기됐고**, QG2에 `theme_coherence` 검사(제목+소개·결과 서술 중 하나에
> 테마 어절 포함, weeklyBrief 1~3개)가 대신 들어갔다. 테마 재사용 검사는
> 게이트가 아니라 `weekly.js submit`이 `theme_history.json` 기반으로
> 별도 수행한다.

## 플로우차트

```mermaid
flowchart TD
    A[핫아이템 수집<br/>유행 테스트 신호 탐지용] --> G0{QG0 세이프티 필터 HARD<br/>정치·종교·성인 제외<br/>+ 트렌드 신호 키워드 매칭}
    G0 --> TREND[유행 테스트 신호 목록<br/>참고용, top N]
    POOL[테마 후보 풀<br/>pack_contract.theme.pool<br/>최근 no_repeat_weeks 재사용 제외] --> GEN
    TREND --> GEN[AI 생성<br/>0.테마 선정+해부(--theme로 강제 가능) → 1.컨셉(형태 결정) → 2.문항 초고<br/>→ 3.결과 초고 → 4.셀프 검수 → 5.제출]

    GEN --> G1{QG1 구조 게이트 HARD<br/>축·문항·유형·80:20·궁합<br/>+ 오프닝 종결 쏠림<br/>+ 형태별(combo/level) 분기}
    G1 -- fail --> FB[반려 사유 수집<br/>게이트ID + 사유]
    G1 -- pass --> G2{QG2 바이럴 게이트 HOLD<br/>테마 정합성(theme_coherence)<br/>+ 제목 훅·I-got 공유문구<br/>결과문 분량·공유문구 다양성}
    G2 -- fail --> FB
    G2 -- pass --> G3{QG3 AI-티 게이트 HOLD<br/>격식체·상담봇 관용구<br/>선택지 복붙·유형명 중복}
    G3 -- fail --> FB
    G3 -- pass --> G4{QG4 채점 무결성 게이트 HARD<br/>축별 가중치 균형 35:65}
    G4 -- fail --> FB
    G4 -- pass --> HIST{테마 이력 검사<br/>weekly.js submit, 게이트 아님<br/>no_repeat_weeks 재사용 반려}
    HIST -- fail --> FB
    HIST -- pass --> DRAFT[초안 저장 drafts/<br/>게이트 이력·run id 동봉<br/>테마 이력 기록·원자적 쓰기]

    FB -- "시도 < retry_budget<br/>사유를 프롬프트에 주입" --> GEN
    FB -- "예산 소진 또는 템플릿<br/>fail-loud: 판정+사유 전체" --> X1[실패 보고<br/>사람이 테마 교체 판단]

    DRAFT --> G5{QG5 사람 승인 게이트 david<br/>decision_queue<br/>approve 전 david_pending 정지}
    G5 -- 반려 --> X2[초안 폐기 / 재생성 지시]
    G5 -- approve --> PUB[발행 published/<br/>/q/슬러그]

    PUB --> RESP[응답 수집<br/>POST /api/quiz/:slug/response]
    RESP -- "희소성 통계 강화<br/>응답자 중 N%" --> PUB
    PUB --> SHARE[결과 공유<br/>유형별 OG 미리보기]
    SHARE -- "신규 유입<br/>나도 테스트 해보기" --> PUB
    RESP -. "쏠림 감지 시<br/>차주 생성 규칙 보정(예정)" .-> GEN
```

## 게이트 조건표 (파생 뷰 — 값의 정본은 매니페스트 `pack_contract.checks`)

| 게이트 | 등급 | 조건 (전부 충족해야 통과) | 실패 시 | 코드 |
|---|---|---|---|---|
| **QG0 세이프티** | HARD | `excluded_topics`(정치·종교·성인) 제외 · `topic_safety`(연예인 사생활·재난공포 키워드 제목 매칭) 제외 — **2026-07-26 이후: 최종 소재 채택이 아니라 유행 테스트 신호 후보(`trend_signal_keywords` 매칭, hotness 상위 `trend_signal_top_n`)에 적용**. `pickWeeklyTopics`(구 채택 파이프라인)는 함수로는 남아있지만 `weekly.js`가 더 이상 호출하지 않는다 | 신호 폐기 (테마 선정 자체는 막지 않음) | `topics.js` |
| **QG1 구조** | HARD | **테마(theme) 필수** — id/name_ko/format(combo_types\|level_bands) · **combo_types**: 축 2~4개(극 코드 유일) · 문항 12~16개 · 유형 = 극 조합 전체 커버. **level_bands**: 축 1~2개(주 지표+선택 스타일) · `bands` 3~5개(0~100 연속 커버·겹침 금지) · 문항 9~12개 · 유형 = 밴드×스타일 조합 전체 커버 · **축마다 intro(이 축이 뭘 확인하는지 처음 온 사람에게 설명, 15~70자) 필수** · 축당 3문항+ · 문항당 1축 · 답변에 양극 혼합(정답 냄새/조작 방지) · 강점 3~5 + 성장 포인트 1~2(80:20) · 조언 1~3 · 궁합 상호 지정(자기 자신 금지) · **궁합 이유(bestMatchReason/worstMatchReason) 비어있지 않음 + 40자 이내** · **weeklyPick("이 성향이 제일 티 나는 순간") 비어있지 않음 + 60자 이내** · **주간 브리핑(weeklyBrief) 존재 + 항목별 topic/intro(15~90자)/tier(친숙도 등급) 필수** · **문항별 답변 개수 통일** · **문항 쌍별 유사도 ≤ `question_similarity_max`** · **축별 1번 답 pole 혼합(역채점 균형)** · **결과 서술 오프닝 종결 최빈 패턴 비율 ≤ `opening_pattern_max_ratio`** | 반려 → 재생성 피드백 | `generate.js` `validateQuiz`, `gates.js` QG1 |
| **QG2 바이럴** | HOLD | **(2026-07-26 개편) 테마 정합성(`theme_coherence`) — 토픽 결박 게이트(제목/결과 토픽 키워드·토픽 커버리지·문항 토픽 비율·브리핑 토픽 커버리지) 전부 폐기, 이걸로 대체**: ① 제목+소개에 `theme.name_ko` 어절(2자+) 포함 ② 결과 서술 또는 그 유형의 weeklyPick 중 어딘가 한 곳에라도 테마 어절 포함(전 결과 강제 아님 — 관대) ③ weeklyBrief 1~3개("이 테스트가 재는 것" 설명) · 제목 8~40자(미리보기 훅) · 소개 20~90자 · 유형 서술 40자 이상 `result_desc_chars_max`(220자) 이하 · 공유 문구에 "나는 ○○"(I-got) + 상대 호명 훅 · 공유 문구 `share_text_chars_max`(60자) 이내 · 답변 40자 이내(한 줄) · **공유 문구 쌍별 유사도 ≤ `share_text_similarity_max`(템플릿 복붙 금지)** · **공유 문구 물음표 종결 비율 ≤ `share_text_question_ending_max_ratio`(반문형 일색 금지 — 감탄·선언·도발형 혼합, level_bands는 수치 자랑 허용)** | 반려 → 재생성 피드백 | `gates.js` QG2 |
| **QG3 AI-티** | HOLD | 격식체·상담봇 관용구 금지("물론입니다", "여러분", "하십시오", "~합니다/습니다/입니다/됩니다/드립니다", "~하세요/해보세요", "습관 들이기"…) · **주간 브리핑(weeklyBrief)·축 intro도 검사 대상(단 친절한 반말 설명톤 "~했어/~된 거야"는 통과)** · 선택지 고유율 80%+(복붙 티 금지) · 유형 이름 중복 금지 | 반려 → 재생성 피드백 | `gates.js` QG3 |
| **QG4 채점 무결성** | HARD | 축별 선택지 가중치 좌:우 = 35:65 이내("다 이거 나오던데" 쏠림 방지) | 반려 → 재생성 피드백 | `gates.js` QG4 |
| **테마 이력** (게이트 아님) | — | 매니페스트 `pack_contract.theme.no_repeat_weeks`(8) 안에 다른 회차로 이미 쓴 테마면 반려(`weekly.js submit`) — 같은 회차 재실행은 충돌로 안 봄(run_binding 멱등성). 통과 시 `theme_history.json`에 원자적 기록 | 반려 → 재생성 피드백(다른 테마 선택 또는 `--theme` 강제 지정) | `weekly.js` `checkThemeHistory`/`recordThemeHistory` |
| **QG5 사람 승인** | kind: david | `publish quiz:` 작업이 `routeTask()`로 `decision_queue` 경유, `approve` 실행해야 발행. 재시도 없음(대기만), 우회 인자 없음 | 초안 유지(공개 경로 없음) | `store.js` `approve`, `router.js` |
| **QG6 발행 후 루프** | GUIDE | 실응답 누적 → 희소성 통계 강화(라플라스 스무딩) · 공유 유입 → 재참여 루프 | — (지속 피드백) | `store.js` stats, `render.js` |

**상표 정책 (게이트 검사 없음, note로만 선언)**: 매니페스트
`topic_safety.trademark_policy_ko` — 토픽 제목에 이미 등장한 상표명은 공개
화제 인용으로 그대로 써도 되고, 토픽에 없는 상표는 일반 명사로 우회한다.
자동 검사가 불가능한 판단이라 4단계 셀프 검수 + QG5 사람 판단에 맡기고,
코드로 강제하지 않는다는 사실을 정직하게 note로만 남긴다.

발행 산출물에는 랜딩 커버 카드(`/q/<slug>/og/cover.png`)가 포함된다 — `approve` 직후부터
발행된 슬러그에 대해 서버가 즉시 렌더링해 서빙하는 파생 자산이며(`ogcard.js`/`ogrender.js`,
`GET /q/<slug>/og/cover.png`), 퀴즈 랜딩(`/q/<slug>`)의 `og:image`가 이 경로를 가리킨다.

등급 의미(매니페스트 `risk_tier_by_grade`): HARD 실패=**BLOCK**, HOLD
실패=**HOLD**, GUIDE 실패=**WARN**(advisory). QG3은 WRC 예상치(GUIDE)와
달리 HOLD로 선언 — "AI 티 제거"가 이 팩의 핵심 약속이라 발행 전 차단을
유지한다 (매니페스트 `gate_grades_note_ko`, 정합 검토 요청 항목).

## 결과 봉투 (하네스 계약)

`runGates(quiz)`는 WRC 하네스 계약의 구조화 봉투를 반환한다:

```js
{
  decision: "PASS" | "HOLD" | "BLOCK",   // 게이트 등급에서 파생
  reasons: ["[QG2-viral] …", …],          // [게이트ID] 접두 사유
  gateResults: [{ id, key, grade, pass, failures }, …],
  pass, failures                            // 기존 호출부 호환 별칭
}
```

진입점: `runGates(quiz)` (`src/quiz/gates.js`), `runWeekly(items, opts)`
(`src/quiz/weekly.js`).

## 루프 정책 (정본: 매니페스트 `retry_policy` · `run_binding`)

- **재시도 예산**: `retry_budget: 3` (매니페스트 선언 — 코드 상수 아님).
  매 실패 시 게이트별 반려 사유가 `[게이트ID] 사유` 형식으로 다음 프롬프트의
  "이전 생성 시도가 게이트에서 반려됐다 — 전부 해결하라" 섹션에 주입된다.
- **템플릿 폴백은 1회**: 결정적이라 재시도가 무의미 — 폴백이 게이트에
  걸리면 그건 코드 버그이고 테스트가 잡는다 (템플릿은 QG1~QG4 전 게이트
  통과가 테스트로 보장됨).
- **예산 소진 시 fail-loud**: 조용한 드롭 금지 — 판정(`decision`)과
  `[게이트ID]` 사유 전체를 에러에 실어 중단하고(`err.decision`,
  `err.reasons`), 사람이 토픽 교체를 판단한다.
- **회차 결박·멱등성**: run id = `<weekLabel>-<slug>`가 초안 메타에
  결박되고, 같은 회차·같은 콘텐츠 재실행은 동일 slug에 원자적
  쓰기(tmp→rename)로 수렴해 중복 산출이 없다.
- **감사 추적**: 초안 메타데이터에 게이트 이력(`gate.decision`,
  `gate.attempts`, 시도별 판정과 사유)이 남아 QG5 승인자가 "몇 번 만에,
  뭘 고쳐서 통과했는지"를 보고 판단할 수 있다.

## 조건의 근거

각 게이트 조건은 딥리서치로 도출된 명세([quiz-design.md](quiz-design.md))의
집행 장치다. 요약하면 — 두 줄 결과문·복붙 선택지·격식체는 "대충/AI 티"의
3대 사인(BuzzFeed 몰락 패턴), I-got 공유 문구와 궁합은 확산 계수의 핵심(국내
히트작 공통), 가중치 균형은 "다 이거 나오던데" 조작 티 방지, 80:20은 바넘
효과의 올바른 운용이다.

2026-07-25 8팀 적대 검수 반영.
2026-07-25 2차 검수(전문가 5그룹+이용자 20명) 반영: 생성 알고리즘을 5단계
전문가 절차로 재설계 + QG0 출처 캡 · QG1 오프닝 종결 쏠림 · QG2 결과 전체
토픽 커버리지/문항 토픽 비율/공유 문구 물음표 비율 · 궁합 이유
(bestMatchReason/worstMatchReason) 신설.
2026-07-25 David 실사용 피드백 반영(매니페스트 버전 4): 사전설명(weeklyBrief
+ QG1 존재·형식 검사 + QG2 토픽 커버리지 검사) · 용어 친숙도 3등급
(familiarity_tiers, weeklyBrief.tier) · 축 intro("이 테스트가 뭘 확인하는지",
QG1 필수) · 소재 대중성 신호(topics.js cross_source_bonus/
max_single_source_topics) · 복붙 공유 블록(share_block_template_ko,
render.js buildShareBlock — 결과 페이지 렌더 문서화는 [quiz-design.md](quiz-design.md)
참고) 신설.
2026-07-26 David 실사용 피드백 반영(매니페스트 버전 5, "주제 자체가 별로"):
**주제선정 개편** — 기계 선정(hotness)을 후보 풀(`candidate_pool_size`=15)로
낮추고 최종 채택(`checks.topics.count`=5)은 생성자가 buildPrompt [0단계]에서
`quiz_fit_criteria_ko` 기준으로 직접 고르게 함. QG2가 `weeklyBrief`를 "채택
소재" 정의로 삼아 개수·풀 소속을 검증(자세한 파이프라인은
[quiz-topic-selection.md](quiz-topic-selection.md), 이후 아래 버전 6으로
대체됨). 히트작 코퍼스 리서치 제안 R1~R7 반영: 4축 16유형 지시값
(`generation.axes_count`) · 유형별 실용 추천물(`weeklyPick`, QG1 필수) · OG
카드 강점+케미 보강(ogcard.js) · 카카오톡 공유 버튼(render.js,
`share_channels`) · 문항 비네트 "공유된 일상 경험" 지시 · CTA 클릭 계측
(`store.js recordCta`, `POST /api/quiz/:slug/cta`,
`metrics.cta_click_benchmark_ratio`) · 공유 인센티브 슬롯 선언
(`share_incentive`, enabled=false — David 별도 결정 대기).

2026-07-26 David 확정 방향(매니페스트 버전 6, "테스트 하나 = 성향 하나"):
**테마 우선 전환** — 위 버전 5의 "소재를 잘 고르면 된다"는 전제 자체를
뒤집었다. 테마(성향 하나)가 이 팩의 주인이고, 매니페스트
`pack_contract.theme.pool`(12개+ 선언, `selection_criteria_ko`)에서 고른다.
핫아이템 수집은 폐기가 아니라 유행 테스트 신호 탐지용으로 전환
(`topics.js pickTestTrendSignals`, `trend_signal_keywords`). 결과 형태는
테마 따라 유연 — `combo_types`(기존 극 조합형) 또는 `level_bands`(주 지표
%+밴드, 신설: `bands` 최상위 필드, `engine.js scoreQuiz` 밴드 판정,
`ogcard.js`/`render.js` % 대형 표시). 토픽 결박 게이트 5종을 전부 폐기하고
`theme_coherence` 검사로 대체. 테마 재사용은 게이트가 아니라
`weekly.js submit`이 `theme_history.json`(no_repeat_weeks=8)으로 검사.
`weekly.js prompt --theme <id>`로 테마 강제 지정 가능.
