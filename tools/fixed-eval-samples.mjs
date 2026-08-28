// P4 LLM 편집 canary — 고정 평가 표본(블루프린트 v4, 2026-08-13 동결) 픽스처.
//
// docs/01_NOWHOT_SYSTEM_BLUEPRINT.md "고정 평가 표본" 9종 중 여러 기사를 묶어
// LLM이 사건 요약(무슨 일·왜 중요·달라진 점)을 쓰기에 맞는 표본만 골랐다:
// 1~5(사건 클러스터, 구성원 2~3건)와 9(근거 라벨 정직성 — coverage 이진 신호를
// "복수 확인"으로 부풀리면 안 되는 단일 기사 표본, 미지원 주장률 측정에 직결).
// 6~8은 분류/헤드라인 단일 판정 표본이라 이 도구의 "여러 기사 종합" 목적과
// 맞지 않아 제외했다(오버 방지 — 정확히 필요한 범위만).
//
// 제목·출처는 test/event-cluster-samples.test.js·test/shadow-selection.test.js에
// 동결된 실측 기반 픽스처 값을 그대로 옮겼다. **발췌(excerpt)는 프런트 픽스처에
// 존재하지 않는다** — 지어내지 않고 정직하게 null로 둔다(측정 도구는 발췌가
// 있으면 쓰고 없으면 제목만으로 저하 동작한다는 사실 자체가 측정 대상이다).
//
// ruleBasedBaseline은 src/feed/digest.js를 **실행하지 않고 읽기만** 해서 확인한
// 관측 패턴(예: "관련 보도 묶음 포착" 접미, 제목 그대로 재인용)을 예시로 적은
// 것이다 — 실측 출력이 아니라 비교용 참고문이며, 그렇게 명시한다.

export const FIXED_EVAL_SAMPLES = Object.freeze([
  {
    sampleNo: 1,
    label: "DeepSeek 한/영 이중 게재 — 한/영 동일 사건 결합",
    subject: "DeepSeek V4 Pro 출시",
    categoryIds: ["tech", "business"],
    evidenceHash: "EVF-fixed-sample-1",
    members: Object.freeze([
      { evidenceId: "s1-hn", title: "DeepSeek V4 Pro 0813", sourceLabel: "해커뉴스",
        sourceRole: "community_reaction", excerpt: null },
      { evidenceId: "s1-yna", title: "딥시크 V4 프로 정식 출시", sourceLabel: "연합뉴스TV",
        sourceRole: "primary", excerpt: null }
    ]),
    ruleBasedBaseline: {
      headline: "딥시크 V4 프로 정식 출시",
      whatHappened: "딥시크 V4 프로 정식 출시 소식이 확인됐다.",
      note: "digest.js 관측 패턴 기반 예시(비실행) — 제목을 사실상 그대로 재인용"
    }
  },
  {
    sampleNo: 2,
    label: "8·13 부동산대책 — 파편 병합 + 근거 보존",
    subject: "8·13 부동산대책",
    categoryIds: ["realestate", "business"],
    evidenceHash: "EVF-fixed-sample-2",
    members: Object.freeze([
      { evidenceId: "s2-hani", title: "8·13 부동산대책 발표…대출 규제 대폭 강화",
        sourceLabel: "한겨레", sourceRole: "primary", excerpt: null },
      { evidenceId: "s2-chosun", title: "정부 8·13 대책, 다주택자 대출 정조준",
        sourceLabel: "조선비즈", sourceRole: "primary", excerpt: null },
      { evidenceId: "s2-mk", title: "8·13 부동산대책에 시장 술렁…대출 문턱 높아진다",
        sourceLabel: "매일경제", sourceRole: "primary", excerpt: null }
    ]),
    ruleBasedBaseline: {
      headline: "8·13 부동산대책 발표…대출 규제 대폭 강화",
      whatHappened: "8·13 부동산대책 관련 보도가 3건 확인됐다.",
      note: "digest.js 관측 패턴 기반 예시(비실행) — 최선두 기사 제목을 헤드라인으로 재사용"
    }
  },
  {
    sampleNo: 3,
    label: "대통령 동일 발언 — 매체 2회 게재",
    subject: "대통령 부동산 투기 차단 발언",
    categoryIds: ["politics", "business"],
    evidenceHash: "EVF-fixed-sample-3",
    members: Object.freeze([
      { evidenceId: "s3-khan", title: "이 대통령 \"부동산 투기 반드시 차단\"…추가 대책 시사",
        sourceLabel: "경향신문", sourceRole: "primary", excerpt: null },
      { evidenceId: "s3-chosun", title: "이 대통령 \"부동산 투기 반드시 차단\" 발언…시장 파장",
        sourceLabel: "조선비즈", sourceRole: "primary", excerpt: null }
    ]),
    ruleBasedBaseline: {
      headline: "이 대통령 \"부동산 투기 반드시 차단\"…추가 대책 시사",
      whatHappened: "대통령 발언 관련 보도가 2건 확인됐다.",
      note: "digest.js 관측 패턴 기반 예시(비실행)"
    }
  },
  {
    sampleNo: 4,
    label: "니케×페르소나 콜라보 — 카테고리 간 동일 사건",
    subject: "니케×페르소나 콜라보레이션",
    categoryIds: ["gaming", "tech"],
    evidenceHash: "EVF-fixed-sample-4",
    members: Object.freeze([
      { evidenceId: "s4-gaming", title: "니케×페르소나 콜라보 확정…아틀라스 캐릭터 참전",
        sourceLabel: "게임메카", sourceRole: "primary", excerpt: null },
      { evidenceId: "s4-tech", title: "승리의 여신 니케, 페르소나 콜라보 일정 공개",
        sourceLabel: "전자신문", sourceRole: "primary", excerpt: null }
    ]),
    ruleBasedBaseline: {
      headline: "니케×페르소나 콜라보 확정…아틀라스 캐릭터 참전",
      whatHappened: "니케×페르소나 콜라보 관련 보도가 2건 확인됐다.",
      note: "digest.js 관측 패턴 기반 예시(비실행)"
    }
  },
  {
    sampleNo: 5,
    label: "geeknews→해커뉴스 재유통 — 중계·독립 구분",
    subject: "SQLite 벡터 검색 확장 공개",
    categoryIds: ["tech"],
    evidenceHash: "EVF-fixed-sample-5",
    members: Object.freeze([
      { evidenceId: "s5-hn", title: "Show HN: An SQLite extension for vector search",
        sourceLabel: "해커뉴스", sourceRole: "community_reaction", excerpt: null },
      { evidenceId: "s5-gk", title: "SQLite 벡터 검색 확장 공개", sourceLabel: "긱뉴스",
        sourceRole: "community_reaction", excerpt: null }
    ]),
    ruleBasedBaseline: {
      headline: "SQLite 벡터 검색 확장 공개",
      whatHappened: "SQLite 벡터 검색 확장 소식이 확인됐다.",
      note: "digest.js 관측 패턴 기반 예시(비실행) — 중계 재유통이 독립 출처처럼 두 번 세지면 안 된다는 게 이 표본의 검수 핵심"
    }
  },
  {
    sampleNo: 9,
    label: "coverage 이진 포화 — 근거 라벨 정직성(단일 기사, 관련 보도 없음)",
    subject: "관련 보도 묶음 포착 표본 단일 기사",
    categoryIds: ["news"],
    evidenceHash: "EVF-fixed-sample-9",
    members: Object.freeze([
      { evidenceId: "s9-solo", title: "관련 보도 묶음 포착 표본 단일 기사",
        sourceLabel: "매체A", sourceRole: "reported_secondary", excerpt: null }
    ]),
    ruleBasedBaseline: {
      headline: "“관련 보도 묶음 포착 표본 단일 기사” · 관련 보도 묶음 포착",
      whatHappened: "관련 보도 묶음 신호가 수집 풀에서 확인됐다.",
      note: "digest.js 관측 패턴 기반 예시(비실행) — coverage 이진 신호를 '관련 보도 묶음'으로 표현하되 실제 독립 출처 확인 건수(1건)를 부풀리지 않는 것이 정직성 기준. LLM 편집이 이 표본에서 '여러 매체가 보도했다'처럼 근거 없는 다중 출처 주장을 만들면 미지원 주장으로 잡아야 한다."
    }
  }
]);

export const FIXED_EVAL_SAMPLE_NOTE =
  "표본 6~7~8(커뮤글 정치 오탐·번역 제목 fashion 오탐·과학 기계번역 헤드라인)은 " +
  "단일 기사 분류/헤드라인 판정 표본이라 이 도구의 '여러 기사 종합 편집' 목적과 " +
  "다르다 — canary 측정 범위에서 의도적으로 제외했다(오버 방지).";
