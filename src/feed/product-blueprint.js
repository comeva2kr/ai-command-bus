// Machine-readable projection of the approved-candidate product charter and
// system blueprint. The human-readable sources stay under docs/; this object
// gives the local admin a stable, testable read model without parsing Markdown.

import { MARKET_POLICY_SOURCE_SAMPLE } from "./market-policy-source-sample.js";
import { EDITION_CANDIDATE_CONTRACT } from "./edition-candidates.js";
import {
  BLIND_REVIEW_PACKET_ID,
  EDITORIAL_QUALITY_CONTRACT,
  HUMAN_REVIEW_QUEUE_CONTRACT
} from "./editorial-quality.js";
import { EDITION_CHANGE_CONTRACT } from "./edition-change.js";
import {
  EDITORIAL_INVENTORY_CONTRACT,
  editorialSnapshotCompatibilityStatus
} from "./editorial-inventory.js";
import { ELAPSED_EDITION_EVIDENCE_CONTRACT } from "./editorial-elapsed-evidence.js";
import { EDITORIAL_LINEAGE_CONTRACT } from "./editorial-lineage.js";
import { EDITORIAL_LLM_CANARY_CONTRACT, EDITORIAL_LLM_CONTRACT } from "./editorial-llm.js";
import { EDITORIAL_FULFILLMENT_CONTRACT } from "./editorial-fulfillment.js";
import { EDITORIAL_SOURCE_IDENTITY_CONTRACT } from "./editorial-source-identity.js";
import {
  EDITORIAL_QUALITY_HISTORY_CONTRACT,
  EDITORIAL_RELIABILITY_HISTORY_CONTRACT
} from "./editorial-reliability.js";
import {
  EDITORIAL_PERSONALIZATION_CONTRACT,
  EDITORIAL_PERSONALIZATION_UTILITY_CONTRACT
} from "./editorial-personalization.js";
import {
  EDITORIAL_EVENT_FRAME_CONTRACT,
  EDITORIAL_READER_COPY_CONTRACT
} from "./editorial-reader-copy.js";
import {
  EDITORIAL_REVIEW_DESK_CONTRACT,
  EDITORIAL_REVIEW_FIELD_SCHEMA
} from "./editorial-review-desk.js";
import { EDITORIAL_SERVING_CONTRACT } from "./editorial-serving.js";
import { FEEDBACK_OVERLAY_CONTRACT } from "./recommender.js";

const deepFreeze = (value) => {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
};

const MARKET_POLICY_VERIFICATION_ANCHORS = deepFreeze([
  { id: "KR-MACRO-BOK", priority: "P0", desk: "거시경제", source: "한국은행 ECOS", access: "API", credential: "키 후보", verification: "엔드포인트 재확인", officialUrl: "https://ecos.bok.or.kr/api/", registryIds: ["bok-ecos"] },
  { id: "KR-MACRO-KOSIS", priority: "P0", desk: "거시경제", source: "KOSIS 공유서비스", access: "API", credential: "키 필요", verification: "공식 문서 확인", officialUrl: "https://kosis.kr/openapi/index/index.jsp", registryIds: ["kosis"] },
  { id: "KR-COMPANY-DART", priority: "P0", desk: "기업·산업", source: "금융감독원 OpenDART", access: "API", credential: "키 필요", verification: "공식 문서 확인", officialUrl: "https://opendart.fss.or.kr/intro/main.do", registryIds: ["opendart"] },
  { id: "KR-POLICY-RELEASES", priority: "P0", desk: "정책·정치", source: "기획재정부·금융위원회 보도자료", access: "공식 페이지", credential: "없음", verification: "수집 방식 확인 필요", officialUrl: "https://www.moef.go.kr/", registryIds: ["moef", "fsc"] },
  { id: "KR-MARKET-KRX", priority: "P0", desk: "시장", source: "한국거래소 정보데이터시스템", access: "데이터 페이지", credential: "확인 필요", verification: "이용 방식 재확인", officialUrl: "https://data.krx.co.kr/", registryIds: ["krx-data"] },
  { id: "US-POLICY-FED", priority: "P0", desk: "정책·정치", source: "Federal Reserve RSS", access: "RSS", credential: "없음", verification: "공식 문서 확인", officialUrl: "https://www.federalreserve.gov/feeds/feeds.htm", registryIds: ["fed-rss"] },
  { id: "US-MACRO-DATA", priority: "P1", desk: "거시경제", source: "BLS Public API·BEA API", access: "API", credential: "혼합", verification: "공식 문서 확인", officialUrl: "https://www.bls.gov/bls/api_features.htm", registryIds: ["bls-api", "bea-api"] },
  { id: "US-COMPANY-SEC", priority: "P1", desk: "기업·산업", source: "SEC EDGAR Data API", access: "API", credential: "없음", verification: "공식 문서 확인", officialUrl: "https://data.sec.gov/", registryIds: ["sec-edgar"] }
]);

export const PRODUCT_BLUEPRINT = deepFreeze({
  schemaVersion: 66,
  stableId: "NOWHOT-SYSTEM-BLUEPRINT-003",
  charterId: "NOWHOT-PRODUCT-CHARTER-001",
  categoryArchitectureId: "NOWHOT-CATEGORY-ARCHITECTURE-001",
  selectionEditorialId: "NOWHOT-SELECTION-EDITORIAL-001",
  adversarialReviewId: "NOWHOT-ADVERSARIAL-REVIEW-001",
  purposeAlignmentReviewId: "NOWHOT-PURPOSE-ALIGNMENT-ADVERSARIAL-REVIEW-001",
  independentAdversarialAuditId: "NOWHOT-INDEPENDENT-CODEX-ADVERSARIAL-AUDIT-001",
  counterexampleRepairId: "NOWHOT-B6-COUNTEREXAMPLE-REPAIR-001",
  independentReauditId: "NOWHOT-B6-INDEPENDENT-REAUDIT-001",
  serveableEditionRepairId: "NOWHOT-B6-SERVEABLE-EDITION-GATE-001",
  readerLineageGroundingRepairId: "NOWHOT-B6-READER-LINEAGE-GROUNDING-REPAIR-001",
  eventContinuityFrameRepairId: "NOWHOT-B6-EVENT-CONTINUITY-FRAME-REPAIR-001",
  categoryUniqueFulfillmentRepairId: "NOWHOT-B6-CATEGORY-UNIQUE-FULFILLMENT-REPAIR-001",
  feedbackRollbackRepairId: "NOWHOT-B6-FEEDBACK-ROLLBACK-REPAIR-001",
  personalizationUtilityEvidenceId: "NOWHOT-B6-PERSONALIZATION-UTILITY-EVIDENCE-001",
  humanBlindEditorialPilotReadyId: "NOWHOT-B6-HUMAN-BLIND-EDITORIAL-PILOT-READY-001",
  categoryCombinationServeabilityId: "NOWHOT-B5-CATEGORY-COMBINATION-SERVEABILITY-001",
  additiveCategoryUnionId: "NOWHOT-B5-ADDITIVE-CATEGORY-UNION-001",
  marketPolicyBeachheadId: "NOWHOT-MARKET-POLICY-BEACHHEAD-001",
  marketPolicySourceAuditId: "NOWHOT-MARKET-POLICY-SOURCE-AUDIT-001",
  marketPolicySourceSampleId: "NOWHOT-MARKET-POLICY-SOURCE-SAMPLE-001",
  editionCandidateContractId: "NOWHOT-EDITION-CANDIDATE-CONTRACT-001",
  editorialQualityContractId: EDITORIAL_QUALITY_CONTRACT.stableId,
  editionChangeContractId: EDITION_CHANGE_CONTRACT.stableId,
  editorialInventoryContractId: EDITORIAL_INVENTORY_CONTRACT.stableId,
  elapsedEditionEvidenceContractId: ELAPSED_EDITION_EVIDENCE_CONTRACT.stableId,
  editorialSchedulerStatusId: "NOWHOT-EDITORIAL-SCHEDULER-STATUS-001",
  editorialLineageContractId: EDITORIAL_LINEAGE_CONTRACT.stableId,
  editorialLlmContractId: EDITORIAL_LLM_CONTRACT.stableId,
  editorialLlmCanaryContractId: EDITORIAL_LLM_CANARY_CONTRACT.stableId,
  editorialFulfillmentContractId: EDITORIAL_FULFILLMENT_CONTRACT.stableId,
  editorialSourceIdentityContractId: EDITORIAL_SOURCE_IDENTITY_CONTRACT.stableId,
  editorialReliabilityHistoryContractId: EDITORIAL_RELIABILITY_HISTORY_CONTRACT.stableId,
  editorialQualityHistoryContractId: EDITORIAL_QUALITY_HISTORY_CONTRACT.stableId,
  editorialPersonalizationContractId: EDITORIAL_PERSONALIZATION_CONTRACT.stableId,
  editorialPersonalizationUtilityContractId: EDITORIAL_PERSONALIZATION_UTILITY_CONTRACT.stableId,
  editorialReaderCopyContractId: EDITORIAL_READER_COPY_CONTRACT.stableId,
  editorialEventFrameContractId: EDITORIAL_EVENT_FRAME_CONTRACT.stableId,
  editorialReviewDeskContractId: EDITORIAL_REVIEW_DESK_CONTRACT.stableId,
  editorialServingContractId: EDITORIAL_SERVING_CONTRACT.stableId,
  feedbackOverlayContractId: FEEDBACK_OVERLAY_CONTRACT.stableId,
  blindReviewPacketId: BLIND_REVIEW_PACKET_ID,
  humanReviewQueueContractId: HUMAN_REVIEW_QUEUE_CONTRACT.stableId,
  localEditorialEditionId: "NOWHOT-LOCAL-EDITORIAL-EDITION-001",
  developmentId: "NOWHOT-DEVELOPMENT-STATUS-001",
  changeId: "DEVCHG-NOWHOT-20260813-070",
  updatedAt: "2026-08-13",
  environment: "local_only",
  status: {
    code: "local_user_test_entry_pass",
    label: "LOCAL USER TEST ENTRY PASS",
    purposeAlignment: "pass_with_limits",
    purposeAlignmentLabel: "PASS WITH LIMITS",
    detail: "NH70~NH75의 영속 패킷, 독립 AI 편집 검수, 분야 공급, 정상 서빙·재시작·모바일·관심 분야별 상위 이슈 합집합 검증을 닫아 로컬 실사용 테스트에 진입할 수 있다. 다일 자동발행과 실제 이용자 만족도, 운영 배포는 아직 증명하지 않았다.",
    localExperimentAllowed: true,
    implementationAllowed: false,
    deploymentAllowed: false
  },
  tagline: "찾아다니지 마. 여기 있어.",
  operatingPromise: "내 관심사에서 지금 알아야 할 것만, 하루 세 번.",
  mission: "지금핫은 사용자가 선택한 관심 카테고리의 국내외 뉴스·정보·유머·지식을 신뢰할 수 있는 공개 근거와 실제 확산 신호로 선별하고, 아침·낮·저녁 하루 세 번 완결된 개인 브리핑으로 제공해 여러 곳을 찾아다니지 않고도 중요한 변화를 놓치지 않게 하는 서비스다.",
  audience: "주식·부동산·테크·유머·유행·지식 등 자신이 선택한 국내외 분야의 중요한 흐름을 여러 서비스를 돌지 않고 따라가려는 한국어 사용자",
  primaryUse: "아침·낮·저녁 최신 판을 열어 선택한 분야의 필수 사건, 급상승, 이전 판 이후 변화를 한 연속 페이지에서 확인",
  productGoal: {
    value: "하루 3판",
    label: "선택 관심사",
    detail: "국내외 필요한 것만 충분히"
  },
  currentGate: { id: "B5-LOCAL-USER-TEST-ENTRY-CLOSED", title: "로컬 실사용 진입 4단계 완료" },
  nextPhase: { id: "B5-MULTIDAY-CLOSED-USER-PILOT", title: "다일 자동발행과 소규모 비공개 실사용", gate: "07·12·19시 자동발행과 재시작·수집 장애를 여러 날 검증하고, 실제 이용자가 하루 세 번이면 충분한지 확인" },
  userTestEntryGates: [
    {
      order: 1,
      id: "NH70-REVIEW-PACKET-PERSISTENCE",
      title: "동일 42행 영구 고정",
      acceptance: "재시작 전후 packetId·editionId·42행 지문 일치",
      state: "local_runtime_pass",
      label: "실데이터 42행·재시작 동일·독립 검수 PASS",
      receipt: {
        packetId: "BRP-07rqta4",
        editionId: "2026-08-12-lunch-art.auto.business.culture.fashion.gaming.humor.life.news.politics.realestate.science.sports.tech-review-1il50eq",
        issueCount: 42,
        packetState: "human_annotation_ready",
        persisted: true,
        frozenAt: "2026-08-12T04:24:34.173Z",
        rowFingerprintSha256: "c36eafd025502366ef6f287298f3d7c8e334e0e59a1f9827800204d6c970f6bd",
        restartEnvelopeFingerprintSha256: "d4ccdf4726e990a1bd211a380a74a440d1ebc3d5cd56271c6e04046c22ad80cb",
        canonicalEditionMutated: false,
        externalLlmCalls: 0,
        targetedRegression: "30/30 PASS",
        independentAdversarialReview: "PASS"
      }
    },
    {
      order: 2,
      id: "NH71-INDEPENDENT-EDITORIAL-REVIEW",
      title: "A·B 독립 AI 편집 검수",
      acceptance: "A 42/42·B 42/42·완료 전 답 비공개·불일치 조정·확인 결함의 미래 판 수리",
      state: "local_review_complete_with_holds",
      label: "AI A·B 84/84·16필드 조정·과거 패킷 4 PASS/38 HOLD·미래 판 수리",
      receipt: {
        packetId: "BRP-07rqta4",
        reviewerType: "independent_ai",
        humanIdentityVerified: false,
        reviewerAJudgments: 42,
        reviewerBJudgments: 42,
        totalJudgments: 84,
        disagreementRows: 11,
        disagreementFields: 16,
        adjudicatedFields: 16,
        historicalPacketVerdict: "human_quality_hold",
        historicalPassingRows: 4,
        historicalHeldRows: 38,
        futureGenerationRepairsApplied: true,
        productRuntimeLlmCalls: 0,
        targetedRegression: "117/117 PASS",
        independentAdversarialReview: "PASS"
      }
    },
    {
      order: 3,
      id: "NH72-DEFAULT-SUPPLY-RECOVERY",
      title: "기본 조합과 전 분야 공급 복구",
      acceptance: "유머 포함 기본 선택 분야와 14개 전체 분야 최소 깊이 충족·품질 미달 채우기 0",
      state: "local_runtime_pass",
      label: "기본 4/4·28건, 전체 14/14·42건·v21·독립 검수 PASS",
      receipt: {
        inventoryVersion: 21,
        defaultCategoriesMet: 4,
        defaultCategoryCount: 4,
        defaultIssueCount: 28,
        allCategoriesMet: 14,
        allCategoryCount: 14,
        allCategoryIssueCount: 42,
        allCategoryPacketId: "BRP-10rp30i",
        missingCategories: [],
        newSourcesAdded: 0,
        productRuntimeLlmCalls: 0,
        focusedRegression: "43/43 PASS",
        independentAdversarialReview: "PASS"
      }
    },
    {
      order: 4,
      id: "NH73-DEFAULT-TODAY-SERVEABLE",
      title: "기본 오늘판 정상 서빙",
      acceptance: "재시작 뒤 기본 /api/today HTTP 200·검증 지문 일치·LAN과 390px 모바일 정상",
      state: "local_runtime_pass",
      label: "HTTP 200·28건·재시작 동일·LAN/390px 정상·독립 검수 PASS",
      receipt: {
        editionId: "2026-08-12-lunch-business.humor.news.tech",
        packetId: "BRP-1657l0y",
        httpStatus: 200,
        issueCount: 28,
        serveability: "current_machine_verified",
        responseSha256: "696bbff505899752fa4599032c903ee48e5a1fd3848069e6eca005545850c362",
        issueSha256: "30f5aec67a553dcaeb6ffef198292b016404fd7ea6d9aea22739d8814fbf4190",
        restartIdentityMatched: true,
        lanHomeHttpStatus: 200,
        lanTodayHttpStatus: 200,
        mobileViewportWidth: 390,
        mobileDocumentOverflow: false,
        productRuntimeLlmCalls: 0,
        fullRegression: "1138/1138 PASS",
        independentAdversarialReview: "PASS"
      }
    },
    {
      order: 5,
      id: "NH74-CATEGORY-COMBINATION-SERVEABILITY",
      title: "관심 분야 조합 정상 서빙",
      acceptance: "관심 분야 선택 수와 조합이 달라도 공급이 충족된 현재판은 반복 문장 오탐 없이 HTTP 200으로 제공",
      state: "local_runtime_pass",
      label: "단일 14/14·두 분야 91/91·3~14개 층화 34/34 HTTP 200",
      receipt: {
        rootCause: "event_agnostic_reader_copy_triggered_packet_diversity_hold",
        readerCopyContractVersion: 11,
        singleCategoryMatrix: "14/14 HTTP 200",
        twoCategoryMatrix: "91/91 HTTP 200",
        stratifiedMultiCategoryMatrix: "34/34 HTTP 200",
        liveRuntimeSampleCount: 139,
        liveRuntimeFailures: 0,
        targetedRegression: "37/37 PASS",
        fullRegression: "1139/1139 PASS",
        productRuntimeLlmCalls: 0,
        externalDeployment: false
      }
    },
    {
      order: 6,
      id: "NH75-ADDITIVE-CATEGORY-UNION",
      title: "관심 분야별 상위 이슈 합집합",
      acceptance: "선택 분야마다 중요도 상위 이슈를 최대 14건까지 합치고 동일 사건은 한 번만 제공하며, 분야별 중요도 순위 층과 같은 층의 전체 중요도를 반영해 섞어 제공",
      state: "local_runtime_pass",
      label: "경제+과학 28건·14/14·고유 사건 28/28·390px 정상",
      receipt: {
        rootCause: "global_issue_budget_and_minimum_quota_capped_multi_category_union",
        previousObserved: {
          businessOnly: 14,
          scienceOnly: 14,
          businessAndScience: 16
        },
        currentObserved: {
          businessOnly: 14,
          scienceOnly: 14,
          businessAndScience: 28,
          businessInPair: 14,
          scienceInPair: 14,
          uniqueClusterIdsInPair: 28,
          categorySwitchesInPair: 27
        },
        rules: {
          perSelectedCategoryLimit: 14,
          sameEventOnce: true,
          crossUrlTitleVariantDeduplication: "high_confidence_identity_only",
          distinctKeyNumbersPreserved: true,
          mergeOrder: "category_importance_rank_layer_then_global_importance",
          qualityPadding: false
        },
        contracts: {
          fulfillmentVersion: 8,
          editionChangeVersion: 9,
          inventorySnapshotVersion: "v30"
        },
        mobile: {
          viewport: "390x844",
          articleCount: 28,
          documentOverflowX: false,
          browserErrors: 0
        },
        targetedRegression: "69/69 PASS",
        fullRegression: "1145/1145 PASS",
        independentAdversarialReview: {
          reviewer: "independent_ai_reviewer",
          verdict: "PASS",
          findings: { p0: 0, p1: 0, p2: 0 },
          humanReview: false
        },
        productRuntimeLlmCalls: 0,
        externalDeployment: false
      }
    }
  ],
  editionCandidateContract: EDITION_CANDIDATE_CONTRACT,
  editorialQualityContract: EDITORIAL_QUALITY_CONTRACT,
  humanReviewQueueContract: HUMAN_REVIEW_QUEUE_CONTRACT,
  editionChangeContract: EDITION_CHANGE_CONTRACT,
  editorialFulfillmentContract: EDITORIAL_FULFILLMENT_CONTRACT,
  editorialSourceIdentityContract: EDITORIAL_SOURCE_IDENTITY_CONTRACT,
  editorialQualityHistoryContract: EDITORIAL_QUALITY_HISTORY_CONTRACT,
  editorialPersonalizationContract: EDITORIAL_PERSONALIZATION_CONTRACT,
  editorialPersonalizationUtilityContract: EDITORIAL_PERSONALIZATION_UTILITY_CONTRACT,
  editorialReaderCopyContract: EDITORIAL_READER_COPY_CONTRACT,
  editorialEventFrameContract: EDITORIAL_EVENT_FRAME_CONTRACT,
  editorialReviewDeskContract: EDITORIAL_REVIEW_DESK_CONTRACT,
  editorialServingContract: EDITORIAL_SERVING_CONTRACT,
  feedbackOverlayContract: FEEDBACK_OVERLAY_CONTRACT,
  editorialReviewFieldSchema: EDITORIAL_REVIEW_FIELD_SCHEMA,
  localEditorialEdition: {
    stableId: "NOWHOT-LOCAL-EDITORIAL-EDITION-001",
    state: "local_qa_pass_with_limits",
    scope: "existing_nowhot_editorial_enhancement",
    purpose: "이미 운영 중인 수집·개인화·브리핑을 고도화해 자체 편집 콘텐츠가 충분한 첫화면으로 제공",
    reuses: ["FeedEngine.briefing", "buildDigest", "eventKey", "기존 사용자 설문", "기존 실시간 피드"],
    adds: ["동적 후보 영수증", "후보→기계 유효→최종 분야별 퍼널", "고정밀 사건 결합", "일반어 제거 사건 개념 연속성", "주 사건·관련기사 근거 역할 분리", "다중 분야 이슈의 고유 분야 단일 배정", "완결 사건명·분야 우선 판단가치", "선택 분야별 최대 14건 합집합·중복 제거·중요도 순위 층 혼합 개인판", "선택 분야별 공급·발행 충족도", "사건명 결합 독자 문장과 관심 분야 조합 서빙", "사용자 중립 공유 판본", "응답 전용 제한 취향 재정렬", "동일 판본 오프라인 효용·출처/분야 다양성 가드", "기본 취향·명시 평가 오버레이 분리와 정확 해제", "최근 세 판 사건 연속성", "독자 품질 결함의 미래 판 되먹임", "미제공 보도형 재고의 24시간 제한 이월", "비저장 슬롯 후보 품질 퍼널", "독자용 보도 문체 투영", "독자 화면 reader payload 불변 동결·행/판 이중 게이트", "paragraph·독자 7필드 현재 근거 SHA-256 결박", "구조화 변화 근거·정확 문장 결박", "정확 응답 기반 fail-closed 서빙·검증 이전판·409 상태", "독자 화면의 왜 내게 숨김", "오늘·실시간 고정 상단 전환", "독자 화면 기준 전용 편집 데스크", "분야별 반복 대체 후보", "경품·판촉 대표 이슈 제외", "게임 국내외 일반 뉴스 공급", "과학 복수 보도 공급·근거 우선", "패션 섹션 피드 순도", "상한 해제 시 출처 균형 폴백", "분류 무결성 복구", "운영그룹 기준 교차관측", "보도 묶음 신호와 직접 확인 원문 범위 분리", "왜 중요한가·지금 나온 이유·지난 브리핑과 비교", "주장·출처 계보", "근거 해시", "선택형 배치 LLM 편집·독립 검증", "검증 캐시·결정론적 폴백", "판본 변화", "반복 자격", "슬롯 as-of", "선택 조합 공유 재고", "누락 판 제한 백필", "최초 실행 영수증", "자동 슬롯 감시 상태", "공유 조합별 세 슬롯 증거", "날짜·슬롯별 판본 품질·근거·사람 검수 이력", "무인 슬롯 검수 패킷 동결", "불변 활성 검수 패킷·명시 전환", "2인 답 비공개·불일치 조정 원장", "오늘·실시간 왕복", "로컬 전용 첫화면"],
    featureFlag: "NOWHOT_LOCAL_EDITORIAL=1",
    llmFeatureFlag: "NOWHOT_LOCAL_EDITORIAL_LLM=1",
    routes: ["/", "/api/today", "/api/today/categories", "/admin/editorial-desk", "/api/admin/editorial-desk"],
    llmCalls: 0,
    llmCallsPerNewEvidenceEditionWhenEnabledMax: 2,
    editorialLineageContract: EDITORIAL_LINEAGE_CONTRACT,
    editorialLlmContract: EDITORIAL_LLM_CONTRACT,
    editorialFulfillmentContract: EDITORIAL_FULFILLMENT_CONTRACT,
    editorialPersonalizationContract: EDITORIAL_PERSONALIZATION_CONTRACT,
    editorialPersonalizationUtilityContract: EDITORIAL_PERSONALIZATION_UTILITY_CONTRACT,
    editorialReaderCopyContract: EDITORIAL_READER_COPY_CONTRACT,
    editorialReviewDeskContract: EDITORIAL_REVIEW_DESK_CONTRACT,
    editorialServingContract: EDITORIAL_SERVING_CONTRACT,
    qaReceipt: {
      stableId: "NOWHOT-LOCAL-QA-20260810-001",
      observedAt: "2026-08-10",
      scope: "local_four_category_real_data_snapshot",
      selectedCategories: ["news", "business", "tech", "humor"],
      runtime: {
        collectedPoolAtStartup: 6126,
        registeredSources: 76,
        eligibleEditionItems: 982,
        candidateCount: 128,
        candidateCap: 128,
        candidateUniqueSources: 26,
        issueCount: 16,
        issueDistribution: { news: 10, business: 2, tech: 2, humor: 2 }
      },
      tests: { total: 997, passed: 997, failed: 0 },
      visual: {
        desktop: "1440x900_pass",
        mobile: "390x844_pass",
        horizontalOverflow: false,
        todayLiveRoundTrip: true
      },
      limits: [
        "로컬에는 쿠팡 파트너 자격증명이 없어 광고 슬롯 사전점검 1건은 관측 불가",
        "사람 블라인드 포함·제외·클러스터·주장 근거 검수는 아직 HOLD",
        "운영 배포·광고·계정·GitHub push는 수행하지 않음"
      ]
    },
    editorialQualityReceipt: {
      stableId: "NOWHOT-EDITORIAL-QA-20260810-001",
      observedAt: "2026-08-10",
      scope: "local_four_category_real_data_editorial_snapshot",
      selectedCategories: ["news", "business", "tech", "humor"],
      runtime: {
        collectedPoolAtStartup: 6996,
        registeredSources: 76,
        eligibleEditionItems: 792,
        candidateCount: 128,
        candidateUniqueSources: 26,
        evaluatedClusters: 124,
        machinePass: 124,
        machineHold: 0,
        issueCount: 16,
        issueDistribution: { news: 9, business: 2, tech: 3, humor: 2 },
        evidenceModes: { related_coverage_signal: 10, single_feed_observed: 5, multiple_feed_observed: 1 },
        falseCrossSourceClaims: 0,
        duplicateHeadlines: 0
      },
      blindReview: {
        sampleMode: "dynamic_current_edition",
        allCategoryDevelopmentIssueCount: 24,
        machinePass: 24,
        humanCompleted: 0,
        e1State: "not_frozen"
      },
      tests: { total: 1001, passed: 1001, failed: 0 },
      visual: {
        desktop: "1440x900_pass",
        mobile: "390x844_pass",
        admin: "1440x900_pass",
        horizontalOverflow: false,
        pageErrors: 0
      },
      limits: [
        "현재 판 기계 게이트 통과는 사람 블라인드 품질 PASS가 아니다",
        "E1 층화 평가 코퍼스의 규모와 manifest는 아직 동결하지 않았다",
        "로컬에는 쿠팡 파트너 자격증명이 없어 광고 슬롯 점검 1건은 관측 불가",
        "운영 배포·광고·계정·GitHub push는 수행하지 않음"
      ]
    },
    editionChangeReceipt: {
      stableId: "NOWHOT-EDITION-CHANGE-RECEIPT-20260810-001",
      contractId: EDITION_CHANGE_CONTRACT.stableId,
      observedAt: "2026-08-10",
      state: "implemented_local_candidate",
      persistence: "date + slot + selected category segment, 400 days",
      matching: EDITION_CHANGE_CONTRACT.matchOrder,
      repeatEligible: EDITION_CHANGE_CONTRACT.repeatRule.eligible,
      repeatHeld: EDITION_CHANGE_CONTRACT.repeatRule.held,
      tests: { total: 1006, passed: 1006, failed: 0 },
      runtime: {
        collectedPoolAtStartup: 7401,
        allCategoryEligibleItems: 3203,
        candidateCount: 192,
        candidateUniqueSources: 27,
        issueCount: 24,
        baselineIssues: 24,
        humanCompleted: 0
      },
      replay: {
        stableId: "NOWHOT-THREE-SLOT-REPLAY-001",
        state: "same_pool_replay_complete",
        actualElapsedTime: false,
        proves: "세 슬롯 순서·직전 판 연결·반복 보류 코드 경로",
        slots: {
          morning: { selected: 24, heldRepeat: 0 },
          lunch: { selected: 19, heldRepeat: 5 },
          evening: { selected: 20, heldRepeat: 4 }
        }
      },
      humanReview: {
        reviewers: ["reviewer-a", "reviewer-b"],
        storage: "immutable active packet + edition + reviewer separated local ledger",
        completedRows: 0,
        qualityPass: false,
        identityProof: false,
        adjudication: "두 원장 완료 뒤 불일치 필드의 최종 판정·근거를 별도 원장에 저장"
      },
      limits: [
        "실제 아침·낮·저녁 세 슬롯 연속 리플레이 영수증은 아직 미완료",
        "사람 검수 표기는 아직 입력되지 않았고 완료돼도 자동 품질 PASS가 아니다",
        "운영 배포·광고·계정·GitHub push는 수행하지 않음"
      ]
    },
    editorialInventoryReceipt: {
      stableId: EDITORIAL_INVENTORY_CONTRACT.receiptId,
      contractId: EDITORIAL_INVENTORY_CONTRACT.stableId,
      state: "implemented_local_candidate",
      snapshotVersion: EDITORIAL_INVENTORY_CONTRACT.snapshotVersion,
      compatibility: editorialSnapshotCompatibilityStatus(),
      cadence: EDITORIAL_INVENTORY_CONTRACT.cadence,
      sharingUnit: EDITORIAL_INVENTORY_CONTRACT.sharingUnit,
      keyContract: `${EDITORIAL_INVENTORY_CONTRACT.snapshotVersion}:<sorted category ids>`,
      timeContract: "각 슬롯의 KST 07:00·12:00·19:00을 generatedAt과 후보 시간창의 as-of로 사용",
      uiContract: "미도래 슬롯은 당일 판에서만 잠그며 07시 전 표시되는 전날 모닝·런치·이브닝 판은 다시 열 수 있음",
      queueContract: "현재까지 발행됐어야 하는 누락 슬롯을 오래된 순서부터 회당 최대 12개 조합 판본으로 백필하고 07시 전에는 전날 세 슬롯을 복구 점검",
      privacy: EDITORIAL_INVENTORY_CONTRACT.privacy,
      cost: EDITORIAL_INVENTORY_CONTRACT.costRule,
      llmCalls: EDITORIAL_INVENTORY_CONTRACT.llmCallsPerSegment,
      llmCallsPerNewEvidenceSegmentWhenEnabledMax: EDITORIAL_INVENTORY_CONTRACT.llmCallsPerNewEvidenceSegmentWhenEnabledMax,
      tests: {
        fullRegression: { total: 1052, passed: 1052, failed: 0 },
        asOfFutureExclusion: "pass",
        sharedCombinationOnce: "pass",
        boundedBackfill: "pass",
        versionedRestartPersistence: "pass"
      },
      limits: [
        "백필은 보존된 발행·최초 관측 시각을 사용하며 서버가 꺼진 동안 실제로 놓친 수집물을 복원하지는 못한다",
        "실제 07·12·19시 시간차 수집 충분성과 사람 품질 PASS는 아직 별도 증거가 필요하다",
        "운영 배포·광고·계정·GitHub push는 수행하지 않음"
      ]
    },
    elapsedEvidenceReceipt: {
      stableId: ELAPSED_EDITION_EVIDENCE_CONTRACT.receiptId,
      contractId: ELAPSED_EDITION_EVIDENCE_CONTRACT.stableId,
      state: "elapsed_evidence_collecting",
      captureWindowMs: ELAPSED_EDITION_EVIDENCE_CONTRACT.captureWindowMs,
      clockRule: ELAPSED_EDITION_EVIDENCE_CONTRACT.clockRule,
      appendOnly: ELAPSED_EDITION_EVIDENCE_CONTRACT.appendOnly,
      proofRule: ELAPSED_EDITION_EVIDENCE_CONTRACT.proofRule,
      segmentProofRule: "같은 공유 카테고리 조합의 정시·저장·발행·선택 분야 충족·서로 다른 콘텐츠 지문을 세 슬롯에 걸쳐 따로 판정",
      actualMorningObservation: {
        date: "2026-08-11",
        slotId: "morning",
        asOf: "2026-08-10T22:00:00.000Z",
        observedAt: "2026-08-10T22:03:30.626Z",
        captureMode: "scheduled_window",
        clockSource: "system",
        delayMs: 210626,
        expectedSegments: 4,
        storedSegments: 4,
        publishableSegments: 4,
        capturedCount: 1,
        actualElapsedTimeProof: false
      },
      tests: {
        fullRegression: { total: 1052, passed: 1052, failed: 0 },
        injectedClockCannotProve: "pass",
        lateBackfillCannotProve: "pass",
        firstObservationPersists: "pass",
        threeDistinctOnTimeEditionsRequired: "pass",
        segmentFulfillmentSeparated: "pass"
      },
      limits: [
        "실제 07시는 정시 창에서 1/3로 보존됐지만 12·19시까지 완료되기 전에는 실제 시간차 세 판 증거가 아니다",
        "현재 로컬 서버를 12·19시 슬롯 동안 계속 실행해 시스템 시계 영수증을 누적해야 한다",
        "사람 검수 원장 좌석은 분리되지만 실제 사람의 신원까지 증명하지 않는다",
        "운영 배포·광고·계정·GitHub push는 수행하지 않음"
      ]
    },
    editorialLineageReceipt: {
      stableId: "NOWHOT-EDITORIAL-LINEAGE-LLM-QA-20260811-001",
      lineageContractId: EDITORIAL_LINEAGE_CONTRACT.stableId,
      llmContractId: EDITORIAL_LLM_CONTRACT.stableId,
      state: "local_path_verified_model_unobserved",
      tests: {
        fullRegression: { total: 1052, passed: 1052, failed: 0 },
        deterministicEvidenceHash: "pass",
        lineageTamperDetection: "pass",
        batchEditorAndIndependentVerifier: "pass",
        verifierRejectionFallback: "pass",
        restartPersistentCache: "pass",
        disabledFlagZeroCalls: "pass",
        boundedCanaryHarness: "pass"
      },
      observedLlmCalls: 0,
      canary: {
        contractId: EDITORIAL_LLM_CANARY_CONTRACT.stableId,
        state: "dry_run_pass_actual_call_pending",
        localOnly: EDITORIAL_LLM_CANARY_CONTRACT.localOnly,
        sourceEditionId: "2026-08-10-evening-business.news.realestate",
        sourceIssueCount: 16,
        eligibleIssueCount: 16,
        requestedIssueCount: 3,
        selectedCategories: ["business", "news", "realestate"],
        maxIssues: EDITORIAL_LLM_CANARY_CONTRACT.maxIssues,
        maxCalls: EDITORIAL_LLM_CANARY_CONTRACT.maxCalls,
        approvalRequired: true,
        keyAvailable: false,
        externalCalls: 0,
        runtimeReceiptProjection: true,
        outputReceipt: null
      },
      limits: [
        "실제 모델 출력 품질·검증 거부율·실비용은 아직 관측하지 않음",
        "실제 사람 A/B 검수와 실제 12·19시를 포함한 완결 세 판 증거는 별도 HOLD",
        "운영 배포·광고·계정·GitHub push는 수행하지 않음"
      ]
    },
    clusterQaReceipt: {
      stableId: "NOWHOT-CLUSTER-QA-20260811-001",
      state: "local_machine_observation",
      snapshotVersion: "v12",
      observedAt: "2026-08-11",
      fixture: {
        candidateCount: 240,
        clusterCount: 239,
        multiMemberClusterCount: 1,
        exactTitleClusterCount: 1,
        selectedIssueCount: 42,
        selectedMultiUrlIssueCount: 0,
        removedFalseMergeCount: 2,
        removedExamples: ["lost we", "Ultra With"],
        evidenceModes: { related_coverage_signal: 27, single_feed_observed: 15, multiple_feed_observed: 0 },
        fulfillment: { state: "fulfillment_partial", metCount: 13, selectedCount: 14, underfilledCategoryIds: ["gaming"] }
      },
      tests: { fullRegression: { total: 1052, passed: 1052, failed: 0 } },
      boundary: "240개 후보의 로컬 기계 재생 영수증이며 실제 사람의 사건 동일성 판정이나 운영 품질 PASS가 아니다."
    },
    categorySupplyQaReceipt: {
      stableId: "NOWHOT-CATEGORY-SUPPLY-QA-20260811-001",
      state: "local_machine_observation",
      snapshotVersion: "v13",
      observedAt: "2026-08-10T21:06:27.117Z",
      sourceHealth: [
        { id: "gamemeca", label: "게임메카", country: "KR", kind: "news", liveCount: 20, state: "live" },
        { id: "pcgamer", label: "PC 게이머", country: "US", kind: "news", liveCount: 20, state: "live" }
      ],
      gamingOnlyReplay: {
        candidateCount: 25,
        issueCount: 14,
        machinePass: 25,
        machineHold: 0,
        publishable: true,
        fulfillmentState: "fulfillment_complete",
        sourceIssueCounts: { gamemeca: 7, pcgamer: 6, ruliweb: 1 },
        generalNewsSourceSpread: 1
      },
      allCategoryReplay: {
        candidateCount: 240,
        evaluatedClusters: 235,
        machinePass: 234,
        machineHold: 1,
        issueCount: 42,
        selectedCategoryCount: 14,
        fulfilledCategoryCount: 14,
        underfilledCategoryIds: [],
        gamingCandidateCount: 6,
        gamingIssueCount: 2,
        fulfillmentState: "fulfillment_complete"
      },
      tests: { fullRegression: { total: 1052, passed: 1052, failed: 0 } },
      boundary: "현재 로컬 풀을 현재 시각 as-of로 재생한 공급·편성 기계 QA다. 실제 07시 정시 판, 번역 품질, 개별 이슈 사실성, 사람 품질 PASS를 증명하지 않는다."
    },
    evidenceWordingQaReceipt: {
      stableId: "NOWHOT-EVIDENCE-WORDING-QA-20260811-001",
      state: "local_machine_observation",
      observedAt: "2026-08-11",
      rules: {
        relatedCoverageIsNotDirectCorroboration: true,
        directSourceCountDisclosed: true,
        subjectFirstHeadline: true,
        particleSafeSentence: true,
        immutablePublishedEdition: true
      },
      example: {
        relatedCoverageSignal: true,
        directlyObservedOriginals: 1,
        allowed: "관련 보도 묶음 신호에서 포착 · 직접 확인한 원문은 한 건",
        forbidden: "관련 기사들이 함께 묶여 노출"
      },
      tests: {
        focusedRegression: { total: 67, passed: 67, failed: 0 },
        fullRegression: { total: 1053, passed: 1053, failed: 0 }
      },
      boundary: "문구가 기계 관측 범위를 정확히 밝힌다는 코드 계약이다. 기사 사실의 진실성이나 사람 품질 PASS를 증명하지 않는다."
    },
    candidateFunnelQaReceipt: {
      stableId: "NOWHOT-CANDIDATE-FUNNEL-QA-20260811-001",
      state: "local_machine_observation",
      observedAt: "2026-08-11",
      rules: {
        fixedRuntimeCandidateCount: false,
        machineGateBeforeNearDuplicateDedupe: true,
        perCategoryFunnel: ["inputItemCount", "clusterCount", "machinePassClusterCount", "qualifiedClusterCount", "draftSelectedCount", "issueCount"],
        noQualifiedSupplySeparated: true,
        oneReplacementPerCategoryWhenChangeReserveExists: true,
        representativePromotionHold: true
      },
      diagnosedActualMorning: {
        immutableReceiptPreserved: true,
        totalIssues: 42,
        fulfilledCategories: 12,
        selectedCategories: 14,
        techRawCandidates: 46,
        techFinalIssues: 1,
        scienceFinalIssues: 0,
        examplesHeldInFutureEditions: [
          "댓글 참여형 경품 이벤트",
          "특별 프로모션 진행 판촉 기사",
          "판매처 이름만으로 패션에 들어온 생리대 핫딜"
        ]
      },
      tests: {
        focusedRegression: { total: 160, passed: 160, failed: 0 },
        fullRegression: { total: 1054, passed: 1054, failed: 0 }
      },
      visual: {
        adminDesktop: "1440x900_pass",
        adminMobile: "390x844_pass",
        documentHorizontalOverflow: false,
        consoleErrors: 0,
        immutableLegacyRowsShowUnknownStages: true
      },
      boundary: "원문 수와 쓸 수 있는 이슈의 손실 지점을 드러내는 기계 계약이다. 의미 품질·분야 적합성·사실성·사람 품질 PASS를 증명하지 않으며 저장된 07시 판을 소급 수정하지 않는다."
    },
    sourceRepairQaReceipt: {
      stableId: "NOWHOT-SOURCE-REPAIR-QA-20260811-001",
      state: "local_machine_observation",
      observedAt: "2026-08-11",
      changeId: "DEVCHG-NOWHOT-20260811-031",
      purpose: "새 제품이나 고정 수집량이 아니라 기존 개인판의 과학 공급 공백과 패션 분야 오염을 복구",
      rules: {
        fixedCandidateTarget: false,
        sourceInputsAreOwnContent: false,
        existingRssAdapterOnly: true,
        scienceVerifiedSourcePriority: true,
        scienceCommunitySignalsRemainEligible: true,
        retiredBroadFeedCannotShadowSectionFeed: true
      },
      sources: [
        {
          id: "sciencedaily",
          categoryId: "science",
          role: "reported_secondary",
          rawParsed: 60,
          engineRows: 20,
          evidence: "공식 RSS 안내·실제 200 응답·날짜와 요약 파싱 확인",
          useBoundary: "전체 본문을 싣지 않고 출처·원문 링크를 보존"
        },
        {
          id: "physorg",
          categoryId: "science",
          role: "reported_secondary",
          rawParsed: 30,
          engineRows: 20,
          evidence: "공식 RSS 안내·실제 200 응답·날짜와 요약 파싱 확인",
          useBoundary: "헤드라인·링크·출처를 보존하고 전체 본문은 수집하지 않음"
        },
        {
          id: "hypebeast-fashion",
          categoryId: "fashion",
          role: "reported_secondary",
          rawParsed: 20,
          engineRows: 20,
          evidence: "공식 Fashion 섹션과 실제 RSS 200 응답 확인",
          useBoundary: "RSS 참조 입력만 사용하며 별도 법률·약관 승인을 주장하지 않음"
        }
      ],
      replay: {
        mode: "copied_local_pool_non_saving",
        actualElapsedTime: false,
        selectedCategories: ["science", "fashion"],
        issueCount: 16,
        science: {
          inputItemCount: 20,
          machinePassClusterCount: 20,
          qualifiedClusterCount: 20,
          finalIssueCount: 7,
          target: 3,
          state: "met",
          verifiedSourceLeadCount: 6,
          communitySignalFirstRank: 7
        },
        fashion: {
          inputItemCount: 42,
          machinePassClusterCount: 42,
          qualifiedClusterCount: 38,
          finalIssueCount: 9,
          target: 3,
          state: "met"
        },
        retiredBroadHypebeastIssueCount: 0
      },
      tests: {
        focusedRegression: { total: 101, passed: 101, failed: 0 },
        fullRegression: { total: 1058, passed: 1058, failed: 0 }
      },
      boundary: "RSS·외부 보도는 자체 콘텐츠가 아니라 편집 원료다. 이 영수증은 공급과 기계 편성 복구만 증명하며 NowHot 문장 품질·사실성·사람 품질 PASS·실제 12·19시 판·운영 배포는 증명하지 않는다."
    },
    semanticQualityQaReceipt: {
      stableId: "NOWHOT-SEMANTIC-QUALITY-QA-20260811-001",
      state: "local_code_qa_pass_actual_slot_pending",
      observedAt: "2026-08-11",
      changeId: "DEVCHG-NOWHOT-20260811-034",
      source: "immutable_2026_08_11_morning_review_packet",
      rules: {
        fixedRuntimeCandidateCount: false,
        exactDuplicateTitleKeepsCoherentLead: true,
        danglingSubjectRejectedOrExtended: true,
        trailingEllipsisRemoved: true,
        longEnglishSubjectPreservedWithinLimit: true,
        selectedCategoryOwnsEditorialValueLens: true,
        representativePromotionHold: true,
        immutableHistoricalEdition: true
      },
      diagnosedExamples: [
        { before: "뉴욕증시 급등에", correction: "같은 원제목이면 공통어 재조합 대신 완결 앞 구절 보존" },
        { before: "전월세난·임차인 불안 우려에", correction: "연결 조사로 끝나면 다음 구절까지 이어 사건명 완결" },
        { before: "스포츠 폭염 → 생활·안전", correction: "선택 분야를 먼저 적용해 경기·선수 판단가치 유지" }
      ],
      tests: {
        focusedRegression: { total: 101, passed: 101, failed: 0 },
        fullRegression: { total: 1062, passed: 1062, failed: 0 }
      },
      boundary: "저장된 07시 판과 활성 검수 패킷은 수정하지 않았다. 교정 코드는 다음 신규 판부터 적용되며 실제 12·19시 판과 사람 A/B 판정 전에는 의미 품질 PASS가 아니다."
    },
    eventDiversityQaReceipt: {
      stableId: "NOWHOT-EVENT-DIVERSITY-QA-20260811-001",
      state: "local_code_qa_pass_actual_slot_pending",
      observedAt: "2026-08-11",
      changeId: "DEVCHG-NOWHOT-20260811-035",
      source: "saved_2026_08_11_editorial_editions_non_mutating_audit",
      rules: {
        fixedRuntimeCandidateCount: false,
        sameCategoryRequired: true,
        selectionOnlyNearDuplicateSuppression: true,
        paragraphClusterRuleUnchanged: true,
        koreanParticleAndEndingNormalization: true,
        englishStopWordsExcluded: true,
        categoryAndCollectionMetadataExcluded: true,
        distinctEventsPreserveEditionDepth: true,
        sportsSubtopicLens: true,
        immutableHistoricalEdition: true
      },
      audit: {
        uniqueLeadTitleCount: 91,
        nearDuplicatePairCount: 4,
        classification: "four_observed_same_event_pairs",
        humanBlindReviewCompleted: false,
        pairs: [
          { sharedConcepts: 5, event: "우크라이나 방공망 지원 요청" },
          { sharedConcepts: 5, event: "젤렌스키·북한군 추가 배치" },
          { sharedConcepts: 3, event: "축구 심판 성접대 의혹 조사" },
          { sharedConcepts: 3, event: "트럼프·이란 배상 요구" }
        ]
      },
      tests: {
        focusedRegression: { total: 101, passed: 101, failed: 0 },
        fullRegression: { total: 1062, passed: 1062, failed: 0 }
      },
      boundary: "91개 제목과 4개 중복쌍은 저장 판본의 비저장 감사 스냅샷이지 제품 목표·고정 표본·품질 PASS 기준이 아니다. 저장된 07시 판과 활성 검수 패킷은 수정하지 않았으며 실제 다음 슬롯과 사람 A/B 검수는 대기한다."
    },
    categoryFitQaReceipt: {
      stableId: "NOWHOT-CATEGORY-FIT-QA-20260811-001",
      state: "local_code_qa_pass_actual_slot_pending",
      observedAt: "2026-08-11",
      changeId: "DEVCHG-NOWHOT-20260811-036",
      source: "copied_staging_pool_injected_lunch_non_saving",
      rules: {
        fixedRuntimeCandidateCount: false,
        categoryGuardSharedByClassifierAndMachineGate: true,
        wrongLabelCannotBecomeRepresentative: true,
        informativeEventTailPreferredForObservedHooks: true,
        incompleteTruncationHeld: true,
        immutableHistoricalEdition: true
      },
      simulation: {
        slotId: "lunch",
        clockSource: "injected",
        actualElapsedProof: false,
        expectedSegments: 4,
        storedSegments: 4,
        publishableSegments: 4,
        selectedCategoryCount: 14,
        fulfilledCategoryCount: 14,
        issueCount: 42,
        evaluatedClusters: 236,
        machinePass: 227,
        machineHold: 9,
        guardedBadSelectedCount: 0,
        improvedHeadlineCount: 7,
        llmCalls: 0,
        humanReviewCompleted: false
      },
      guardedExamples: [
        "여행가챠→게임", "ETF→과학", "증시·유가→기술", "사내행사→경제",
        "영화 명장면→패션", "포켓몬·포트나이트→기술", "이완용→문화", "대학살→유머"
      ],
      improvedExamples: [
        "폐버스 풍자 밈 확산", "평택 물류센터 화재 현장", "양식장 치어 긴급방류",
        "선관위 국조 언쟁", "치매 없이 13년", "부동산 세제의 새로운 방향", "신개념 인공위성"
      ],
      tests: {
        focusedRegression: { total: 97, passed: 97, failed: 0 },
        fullRegression: { total: 1064, passed: 1064, failed: 0 }
      },
      boundary: "주입 시계와 복사 데이터의 비저장 미래 슬롯 모사다. 분야 게이트·제목 교정·재고 코드 경로만 증명하며 실제 12시 시스템 시계 판, 시간 경과 수집, 사람 품질 PASS, LLM 품질, 운영 배포를 증명하지 않는다."
    },
    slotCaptureIntegrityQaReceipt: {
      stableId: "NOWHOT-SLOT-CAPTURE-INTEGRITY-QA-20260811-001",
      state: "local_code_qa_pass_actual_slot_pending",
      observedAt: "2026-08-11",
      changeId: "DEVCHG-NOWHOT-20260811-037",
      source: "inventory_priority_and_completion_timing_contract_tests",
      rules: {
        fixedRuntimeCandidateCount: false,
        defaultSegmentFirst: true,
        higherAudienceSegmentFirst: true,
        chronologicalPrerequisitesWithinSegment: true,
        evidenceUsesInventoryCompletionTime: true,
        legacyObservationUsesPersistedAtForProof: true,
        immutableHistoricalObservation: true
      },
      tests: {
        focusedRegression: { total: 21, passed: 21, failed: 0 },
        fullRegression: { total: 1065, passed: 1065, failed: 0 }
      },
      boundary: "핵심 공유조합의 현재 판이 저이용 과거 누락에 밀리지 않고 직전 판 계보를 유지하는 코드와, 저장 완료시각 기준 정시 판정을 증명한다. 실제 12·19시 완료 관측과 사람 품질·운영 반영은 대기한다."
    },
    reliabilityHistoryQaReceipt: {
      stableId: "NOWHOT-EDITORIAL-RELIABILITY-HISTORY-QA-20260811-001",
      contractId: EDITORIAL_RELIABILITY_HISTORY_CONTRACT.stableId,
      state: "local_code_qa_pass_actual_history_pending",
      observedAt: "2026-08-11",
      changeId: "DEVCHG-NOWHOT-20260811-038",
      source: "focused_synthetic_history_and_runtime_projection",
      rules: {
        fixedRuntimeCandidateCount: false,
        systemClockObservationsOnly: true,
        preMonitoringBackfillsExcluded: true,
        postMonitoringLateCapturesCounted: true,
        dueSlotsOnlyForToday: true,
        wholeMissingDaysVisible: true,
        onTimeReadyDistinctCategoryHolds: true,
        readOnlyDerivedFromAppendOnly: true,
        reportingWindowIsNotCollectionTarget: true
      },
      tests: {
        focusedRegression: { total: 25, passed: 25, failed: 0 },
        fullRegression: { total: 1069, passed: 1069, failed: 0 }
      },
      boundary: "현재 실제 원장은 하루·한 슬롯뿐이다. 날짜별 정시·누락·완결·내용 변화·분야 보류를 읽기 전용으로 계산하지만 다일 안정성, 사람 편집 품질, 원문 사실성, 운영 반영은 증명하지 않는다."
    },
    editorialQualityHistoryQaReceipt: {
      stableId: "NOWHOT-EDITORIAL-QUALITY-HISTORY-QA-20260811-001",
      contractId: EDITORIAL_QUALITY_HISTORY_CONTRACT.stableId,
      state: "local_code_qa_pass_actual_history_pending",
      observedAt: "2026-08-11",
      changeId: "DEVCHG-NOWHOT-20260811-045",
      source: "immutable_saved_editions_and_frozen_human_review_ledgers",
      rules: {
        fixedRuntimeCandidateCount: false,
        immutableSavedEditions: true,
        finalMachineGateAndLineageVisible: true,
        legacyLineageUnavailableSeparatedFromHashFailure: true,
        evidenceModesAndSourceRowsVisible: true,
        categoryFulfillmentVisible: true,
        humanReviewProgressSeparate: true,
        widestSharedSegmentFrozenPerDueSlot: true,
        automaticFreezeDoesNotActivatePacket: true,
        readOnlyDerivedHistory: true,
        reportingWindowIsNotCollectionTarget: true
      },
      tests: {
        focusedRegression: { total: 19, passed: 19, failed: 0 },
        fullRegression: { total: 1077, passed: 1077, failed: 0 }
      },
      boundary: "저장 판을 재생성하지 않고 날짜·슬롯별 기계 품질·계보·근거·분야 충족과 사람 검수 진행을 분리 집계한다. 자동 패킷 동결은 검수 입력 대상 보존만 증명하며 실제 19시판, 다일 안정성, 사람 품질 PASS, 원문 사실성, 운영 반영은 증명하지 않는다."
    },
    replayFulfillmentPreflightQaReceipt: {
      stableId: "NOWHOT-REPLAY-FULFILLMENT-PREFLIGHT-QA-20260811-001",
      state: "local_code_qa_pass_actual_slot_pending",
      observedAt: "2026-08-11",
      changeId: "DEVCHG-NOWHOT-20260811-039",
      source: "current_pool_non_saving_lunch_simulation_and_contract_tests",
      rules: {
        fixedRuntimeCandidateCount: false,
        projectedOnly: true,
        noEditionPersistence: true,
        perCategoryFulfillmentBeforeTotalCount: true,
        heldCategoryReasonsVisible: true,
        actualElapsedEvidenceUnaffected: true
      },
      simulation: {
        asOf: "2026-08-11T03:00:00.000Z",
        actualElapsedTimeProof: false,
        candidateIssueCount: 50,
        selectedIssueCount: 42,
        selectedCategoryCount: 14,
        metCategoryCount: 14,
        scienceIssueCount: 3,
        techIssueCount: 3,
        unpromotableRepresentativeCount: 0
      },
      tests: {
        focusedRegression: { total: 31, passed: 31, failed: 0 },
        fullRegression: { total: 1069, passed: 1069, failed: 0 }
      },
      boundary: "현재 풀을 미래 슬롯 규칙에 비저장 적용한 사전점검이다. 14/14 분야 충족 코드와 보류 가시성을 증명하지만 실제 12시 정시 저장, 시간차 수집, 사람 품질, 운영 반영은 증명하지 않는다."
    },
    categorySemanticLeakQaReceipt: {
      stableId: "NOWHOT-CATEGORY-SEMANTIC-LEAK-QA-20260811-001",
      state: "local_code_qa_pass_actual_slot_pending",
      observedAt: "2026-08-11",
      changeId: "DEVCHG-NOWHOT-20260811-040",
      source: "copied_staging_pool_injected_lunch_non_saving_adversarial_replay",
      rules: {
        fixedRuntimeCandidateCount: false,
        incidentContextOverridesObjectKeyword: true,
        cultureEventCannotPassTechWithoutTechSubject: true,
        corporateEventSponsorshipNotRepresentative: true,
        informativeTailReplacesVagueQuoteHook: true,
        categorySpecificImpactLens: true,
        immutableHistoricalEdition: true
      },
      simulation: {
        slotId: "lunch",
        clockSource: "injected",
        actualElapsedTimeProof: false,
        candidateIssueCount: 50,
        selectedIssueCount: 42,
        selectedCategoryCount: 14,
        metCategoryCount: 14,
        observedLeakCountBefore: 3,
        selectedLeakCountAfter: 0,
        correctedHeadlineCount: 1,
        correctedImpactLensCount: 2,
        llmCalls: 0,
        humanReviewCompleted: false
      },
      removedExamples: [
        "제주항공 참사 수사→부동산", "아티스트 전시→기술", "대회 음료 지원→스포츠 대표"
      ],
      correctedExamples: [
        "추신수·메이저리그 연금", "레켐비 치료→건강·근거", "미군기지·북중 공격→국제정세"
      ],
      tests: {
        focusedRegression: { total: 142, passed: 142, failed: 0 },
        fullRegression: { total: 1069, passed: 1069, failed: 0 }
      },
      boundary: "현재 풀과 주입 시계의 비저장 12시 재검수다. 관측된 의미 누수 제거와 14/14 분야 깊이 보존을 증명하지만 실제 12시 정시 저장, 사람 의미·사실성 판정, LLM 품질, 운영 반영은 증명하지 않는다."
    },
    actualLunchSemanticQaReceipt: {
      stableId: "NOWHOT-ACTUAL-LUNCH-SEMANTIC-QA-20260811-001",
      state: "actual_slot_observed_quality_hold",
      observedAt: "2026-08-11T03:01:06.034Z",
      changeId: "DEVCHG-NOWHOT-20260811-041",
      source: "append_only_system_clock_lunch_edition_and_future_only_guard_regression",
      rules: {
        fixedRuntimeCandidateCount: false,
        actualElapsedSlot: true,
        fullDayProof: false,
        historicalEditionImmutable: true,
        futureEditionsOnly: true,
        formalFulfillmentIsNotHumanQualityPass: true,
        seriousHarmCannotRepresentHumor: true,
        geopoliticalHostilityCannotRepresentCulture: true,
        vagueOpeningHookRejected: true,
        isolatedHanjaInitialsRejected: true,
        llmCalls: 0,
        humanReviewCompleted: false
      },
      capture: {
        slotId: "lunch",
        clockSource: "system",
        captureMode: "scheduled_window",
        delayMs: 66034,
        durationMs: 9451,
        expectedSegmentCount: 5,
        storedSegmentCount: 5,
        publishableSegmentCount: 5,
        heldSegmentCount: 0,
        missingSegmentCount: 0,
        aggregateIssueCount: 125,
        aggregateFingerprint: "005iy04"
      },
      allCategorySegment: {
        selectedCategoryCount: 14,
        metCategoryCount: 14,
        issueCount: 42,
        fingerprint: "14uq0gp"
      },
      defaultSegment: {
        categories: ["business", "humor", "news", "tech"],
        morningIssueCount: 28,
        lunchIssueCount: 28,
        morningFingerprint: "0yuwijg",
        lunchFingerprint: "0i7gnav",
        contentChanged: true
      },
      audit: {
        targeted040LeaksRemaining: 0,
        observedProblemCount: 6,
        classificationHoldCount: 2,
        headlineHoldCount: 4,
        classificationExamples: [
          "국가 간 적대·저주 글이 문화 대표로 선택",
          "강제 낙태·한센인 피해 글이 유머 대표로 선택"
        ],
        headlineExamples: [
          "55세에 없었더니",
          "긴 휴식 끝 전력대결",
          "새벽 5시부터 대출런",
          "鄭 金, 남탓 전문가·고질병"
        ],
        futureProjectionOnly: true
      },
      tests: {
        focusedRegression: { total: 98, passed: 98, failed: 0 },
        fullRegression: { total: 1070, passed: 1070, failed: 0 }
      },
      boundary: "실제 시스템 시계 12시 판은 5/5 저장·14/14 분야·42건·직전 판과 다른 내용까지 증명한다. 동시에 사람 관점 결함 6건을 발견했으므로 낮 판의 사람 품질은 HOLD다. 저장 원장은 수정하지 않고 새 가드는 미래 판에만 적용하며, 실제 19시·LLM canary·2인 검수·운영 반영은 증명하지 않는다."
    },
    actualLunchFullAuditQaReceipt: {
      stableId: "NOWHOT-ACTUAL-LUNCH-FULL-AUDIT-QA-20260811-001",
      state: "local_code_qa_pass_actual_slot_pending",
      observedAt: "2026-08-11T03:01:06.034Z",
      changeId: "DEVCHG-NOWHOT-20260811-042",
      source: "immutable_actual_lunch_42_issue_full_field_audit_and_future_only_regression",
      rules: {
        fixedRuntimeCandidateCount: false,
        auditedObservedEditionSizeIsNotTarget: true,
        everyStoredIssueAudited: true,
        historicalEditionImmutable: true,
        futureEditionsOnly: true,
        noContextFabrication: true,
        lowContextCandidateHeld: true,
        relatedSamePublisherTopicCrowdingSuppressed: true,
        koreanObjectParticleMatched: true,
        llmCalls: 0,
        humanReviewCompleted: false
      },
      audit: {
        auditedIssueCount: 42,
        priorKnownAffectedIssueCount: 6,
        additionalDefectFieldCount: 18,
        additionalAffectedIssueCount: 17,
        totalAffectedIssueCount: 23,
        categoryLeakCount: 1,
        lowContextHeadlineCount: 3,
        vagueEventHookCount: 1,
        samePublisherTopicCrowdingCount: 1,
        particleErrorCount: 12,
        actualEditionHumanQualityPass: false
      },
      futureRuleProjection: {
        fixedIssueTarget: false,
        currentPreviewSelectedCategoryCount: 14,
        currentPreviewMetCategoryCount: 14,
        currentPreviewIssueCount: 42,
        currentPreviewObservedNotTarget: true,
        actualEveningObserved: false
      },
      tests: {
        focusedRegression: { total: 106, passed: 106, failed: 0 },
        fullRegression: { total: 1070, passed: 1070, failed: 0 }
      },
      boundary: "42건은 실제 낮 판에서 감사한 관측 크기일 뿐 수집·발행 목표가 아니다. 영향 행 23건을 찾았다는 사실은 나머지 19건의 사람 품질 PASS를 뜻하지 않는다. 저장된 낮 판은 수정하지 않고 교정 규칙은 미래 판에만 적용한다. 실제 19시 판·승인 키 LLM canary·2인 독립 검수·운영 반영은 아직 증명하지 않았다."
    },
    projectedEditionPreflightQaReceipt: {
      stableId: "NOWHOT-PROJECTED-EDITION-PREFLIGHT-QA-20260811-001",
      state: "local_projected_qa_pass_actual_slot_pending",
      observedAt: "2026-08-11T04:19:52.442Z",
      changeId: "DEVCHG-NOWHOT-20260811-043",
      source: "same_current_pool_no_elapsed_time_non_persisted_evening_preflight",
      rules: {
        fixedRuntimeCandidateCount: false,
        projectedOnly: true,
        persisted: false,
        actualElapsedProof: false,
        humanInputAllowed: false,
        mixedBoardBeforeOpaqueClassifier: true,
        narrowPromotionAndLowContextHold: true,
        crossCategoryNumberedEventDedupe: true,
        humanReviewCompleted: false,
        llmCalls: 0
      },
      runtime: {
        slotId: "evening",
        issueCount: 42,
        observedIssueCountIsNotTarget: true,
        machinePass: 42,
        machineHold: 0,
        humanCompleted: 0,
        selectedCategoryCount: 14,
        metCategoryCount: 11,
        targetPerCategory: 2,
        state: "fulfillment_partial",
        missingCategoryIds: ["fashion"],
        underfilledCategoryIds: ["science", "art"],
        enumeratedTargetedDefectsRemaining: 0,
        colombiaEarthquakeIssueCount: 1,
        c3sPoolCategory: "science"
      },
      corrections: [
        "정신차려라 안의 신차 부분문자열 자동차 오분류 제거",
        "피프티피프티 문샤넬 이름 충돌 패션 오분류 제거",
        "가격형 특가 광고 대표 승격 제외",
        "친일파 논쟁의 유머 대표 승격 보류",
        "저문맥·한자 약칭 제목 보류",
        "강진/지진·17만5천/17만5000 사건 변주 중복 억제"
      ],
      tests: {
        focusedRegression: { total: 174, passed: 174, failed: 0 },
        fullRegression: { total: 1070, passed: 1070, failed: 0 }
      },
      boundary: "현재 수집 풀을 시간 경과 없이 이브닝 규칙에 통과시킨 비저장 투영이다. 42행은 관측 크기일 뿐 목표가 아니며 기계 42/42도 사람 품질 PASS가 아니다. 열거한 표적 결함은 0건으로 줄었지만 11/14 분야만 충족했고 패션은 공급 없음, 과학·예술은 부족으로 남겼다. 실제 19시 수집·정시 저장·새 사건·LLM canary·2인 검수·운영 반영은 증명하지 않는다."
    },
    projectedQualityReauditQaReceipt: {
      stableId: "NOWHOT-PROJECTED-QUALITY-REAUDIT-QA-20260811-001",
      state: "local_projected_quality_hardening_pass_actual_slot_pending",
      observedAt: "2026-08-11T04:51:14.663Z",
      changeId: "DEVCHG-NOWHOT-20260811-044",
      source: "same_current_pool_non_persisted_evening_reaudit_after_replacement",
      rules: {
        fixedRuntimeCandidateCount: false,
        projectedOnly: true,
        persisted: false,
        actualElapsedProof: false,
        replacementRowsRequireReaudit: true,
        sensitiveAllegationRequiresReportedSource: true,
        sectionedNewsNarrowGamingOverride: true,
        distinctiveEntityTopicCrowdingSuppressed: true,
        qualityHoldMayReduceCategoryFulfillment: true,
        humanReviewCompleted: false,
        llmCalls: 0
      },
      runtime: {
        slotId: "evening",
        issueCount: 42,
        observedIssueCountIsNotTarget: true,
        machinePass: 42,
        machineHold: 0,
        humanCompleted: 0,
        selectedCategoryCount: 14,
        metCategoryCount: 10,
        targetPerCategory: 2,
        state: "fulfillment_partial",
        missingCategoryIds: ["fashion"],
        underfilledCategoryIds: ["auto", "science", "art"],
        enumeratedTargetedDefectsRemaining: 0,
        priorMetCategoryCount: 11,
        fulfillmentReducedByQualityHold: true
      },
      corrections: [
        "커뮤니티 단독 친일 후손·매국 주장 대표 승격 보류",
        "짧은 튜닝·은어 이미지·먹통 제목의 저문맥 보류",
        "과학·기술 섹션의 명백한 인디게임 기사를 게임으로 복구",
        "모호한 인용 훅 대신 수출·발사 실패·입주전망 하락 사건 구절 선택",
        "배우 부고의 경제 대표 승격과 기관 교육과정의 자동차 오분류 차단",
        "같은 긴 고유명사와 같은 흐름어가 겹친 관련 보도의 한 판 밀집 억제"
      ],
      tests: {
        focusedRegression: { total: 100, passed: 100, failed: 0 },
        fullRegression: { total: 1072, passed: 1072, failed: 0 }
      },
      boundary: "같은 풀에서 최종 행 수는 다시 42였지만 이는 목표 달성이 아니라 다음 유효 후보가 빈자리를 채운 결과다. 대체행까지 다시 감사해 열거 표적 결함은 0건으로 줄였고, 품질 보류 때문에 분야 충족은 11/14에서 10/14로 낮아졌다. 패션은 공급 없음, 자동차·과학·예술은 부족으로 남겼다. 기계 42/42는 사람 품질 PASS가 아니며 실제 19시 수집·정시 저장·LLM canary·2인 검수·운영 반영은 증명하지 않는다."
    },
    personalizationIntegrityReceipt: {
      stableId: "NOWHOT-PERSONALIZATION-INTEGRITY-QA-20260811-001",
      contractId: EDITORIAL_FULFILLMENT_CONTRACT.stableId,
      observedAt: "2026-08-11",
      state: "local_real_data_and_visual_qa_pass_with_limits",
      scope: "selected_category_fulfillment_and_category_integrity",
      rules: {
        fixedProductItemCount: false,
        perCategoryFulfillment: true,
        registeredDealCategoryLocked: true,
        staleClassificationRestored: true,
        englishAcronymTokenBoundary: true,
        importantCategoryVerifiedSourcePriority: true
      },
      tests: {
        focusedRegression: { total: 88, passed: 88, failed: 0 },
        fullRegression: { total: 1052, passed: 1052, failed: 0 }
      },
      runtime: {
        liveReplayObserved: true,
        editionId: "2026-08-10-evening-business.news.politics.realestate",
        selectedCategories: ["business", "news", "politics", "realestate"],
        issueCount: 16,
        issueDistribution: { business: 9, news: 4, politics: 0, realestate: 3 },
        sourceCount: 12,
        issuesWithSourceEvidence: 16,
        communityOnlyIssues: 0,
        contaminationCount: 0,
        nonSelectedCategoryCount: 0,
        fulfillmentState: "fulfillment_partial",
        metCount: 3,
        selectedCount: 4,
        missingCategoryIds: ["politics"]
      },
      visual: {
        todayDesktop: "1280px_pass",
        todayMobile: "390x844_pass",
        adminDesktop: "820px_pass",
        adminMobile: "390x844_pass",
        horizontalOverflow: false,
        pageErrors: 0,
        pageWarnings: 0
      },
      limits: [
        "선택 분야 공급 없음은 다른 분야 이슈 수로 덮지 않고 부분 충족으로 표시",
        "로컬 번역 기능은 꺼져 있어 해외 원문 제목의 한국어 편집 품질은 이 영수증이 증명하지 않음",
        "실제 모델 품질·사람 A/B 검수·12·19시를 포함한 완결 세 판 증거는 별도 HOLD",
        "운영 배포·광고·계정·GitHub push는 수행하지 않음"
      ]
    },
    personalizationProjectionQaReceipt: {
      stableId: "NOWHOT-EDITORIAL-PERSONALIZATION-QA-20260811-001",
      contractId: EDITORIAL_PERSONALIZATION_CONTRACT.stableId,
      state: "local_code_qa_pass_with_limits",
      observedAt: "2026-08-11",
      changeId: "DEVCHG-NOWHOT-20260811-046",
      source: "shared_canonical_and_response_only_projection_regression",
      rules: {
        sharedCanonicalIsUserNeutral: true,
        requestUserTopicCannotEnterSharedEdition: true,
        selectedCategoriesOnly: true,
        responseOrderOnly: true,
        issueCountUnchanged: true,
        contentEvidenceAndLineageUnchanged: true,
        boundedWithinEditorialPriorityBand: true,
        noPerUserEditionPersistence: true,
        llmCalls: 0,
        fixedProductItemCount: false
      },
      tests: {
        focusedRegression: { total: 20, passed: 20, failed: 0 },
        fullRegression: { total: 1081, passed: 1081, failed: 0 }
      },
      boundary: "같은 카테고리 조합의 저장 판본은 사용자별 정치·종교 토픽과 취향에서 분리하고, 응답에서만 기존 카테고리 선호로 가까운 중요도 묶음의 순서를 조정한다. 이슈·문장·근거·계보·판본 ID와 수량은 바꾸지 않으며 사용자별 LLM 호출도 없다. 이는 만족도·사람 품질 PASS·운영 반영을 증명하지 않는다."
    },
    continuityReaderShellQaReceipt: {
      stableId: "NOWHOT-CONTINUITY-READER-SHELL-QA-20260811-001",
      state: "local_code_qa_pass_with_limits",
      observedAt: "2026-08-11",
      changeId: "DEVCHG-NOWHOT-20260811-047",
      contractIds: {
        editionChange: EDITION_CHANGE_CONTRACT.stableId,
        readerCopy: EDITORIAL_READER_COPY_CONTRACT.stableId
      },
      rules: {
        adjacentEditionSemanticContinuity: true,
        minimumSharedMeaningfulTerms: 3,
        particleVariantAware: true,
        singleNamedEntityInsufficient: true,
        responseOnlyContinuityProjection: true,
        canonicalSnapshotMutated: false,
        newsroomReaderProjection: true,
        whyForYouHiddenFromReader: true,
        canonicalContentAndLineagePreserved: true,
        llmCalls: 0,
        unifiedTodayLiveSwitch: true,
        indicatorMotionMs: 210,
        reducedMotionImmediate: true
      },
      actualStoredRegression: {
        previousSlot: "morning",
        currentSlot: "lunch",
        previousSubject: "미-이란 호르무즈 협상 난항",
        currentSubject: "호르무즈 협상 난항에 국제유가 급등",
        previousSource: "VOA 한국어",
        currentSource: "남도일보",
        previousClusterId: "NHC-1rqv58y",
        observedCurrentClusterId: "NHC-1dc1dfr",
        matchMethod: "shared_event_terms",
        matchedTerms: ["호르무즈", "협상", "난항", "국제유가"],
        previousIncorrectState: "new",
        projectedState: "material_update"
      },
      tests: {
        focusedRegression: { total: 19, passed: 19, failed: 0 },
        fullRegression: { total: 1087, passed: 1087, failed: 0 }
      },
      visual: {
        state: "local_browser_qa_pass",
        todayDesktop: "1280x720_pass",
        liveDesktop: "1280x720_pass",
        todayMobile: "390x844_pass",
        liveMobile: "390x844_pass",
        brandIdentityVisible: true,
        stableHeaderCoordinates: true,
        desktopTabX: { today: 364.5, live: 424.8359375 },
        mobileTabX: { today: 144, live: 196.3359375 },
        headerOverlap: false,
        horizontalOverflow: false,
        pageErrors: 0,
        pageWarnings: 0
      },
      boundary: "다른 기사라도 인접 판의 핵심 사건어가 충분히 같으면 같은 사건의 후속 보도로 잇되 고유명사 한 단어만 같으면 합치지 않는다. 저장 판과 계보는 불변이며 응답에서만 연속성·독자 문장을 투영한다. 왜 내게는 내부 선택 근거로 보존하되 독자 화면에서는 숨긴다. 실제 19시 판·사람 문장 품질·운영 반영은 증명하지 않는다."
    },
    editorialReviewDeskQaReceipt: {
      stableId: "NOWHOT-EDITORIAL-REVIEW-DESK-QA-20260811-001",
      contractId: EDITORIAL_REVIEW_DESK_CONTRACT.stableId,
      state: "local_qa_pass_with_limits",
      observedAt: "2026-08-11T16:20:13+09:00",
      changeId: "DEVCHG-NOWHOT-20260811-048",
      route: EDITORIAL_REVIEW_DESK_CONTRACT.route,
      api: EDITORIAL_REVIEW_DESK_CONTRACT.api,
      rules: {
        singleIssueWorkspace: true,
        readerSurfaceIsPrimary: true,
        canonicalComparisonAvailable: true,
        sourceLinksAvailable: true,
        autoSaveToExistingLedger: true,
        incompleteAndHeldFilters: true,
        currentReviewerOnly: true,
        otherReviewerAnswersHiddenUntilComplete: true,
        machineGateHidden: true,
        whyForYouHidden: true,
        packetRowsMutated: false,
        llmCalls: 0
      },
      actualLocalPacket: {
        packetId: "BRP-0z4fus5",
        editionId: "2026-08-11-morning-art.auto.business.culture.fashion.gaming.humor.life.news.politics.realestate.science.sports.tech",
        issueCount: 42,
        reviewerACompleted: 0,
        reviewerBCompleted: 0,
        identityProof: false
      },
      tests: {
        focusedRegression: { total: 24, passed: 24, failed: 0 },
        fullRegression: { total: 1090, passed: 1090, failed: 0 }
      },
      visual: {
        state: "local_browser_qa_pass",
        desktop: "1280x720_three_pane_pass",
        mobile: "390x844_stacked_pass",
        issueRows: 42,
        reviewFields: 5,
        mobileHorizontalIssueQueue: true,
        mobileRubricBelowStory: true,
        horizontalOverflow: false,
        pageErrors: 0,
        pageWarnings: 0
      },
      boundary: "전용 데스크는 실제 독자 화면 문장과 근거를 한 건씩 검수하고 현재 좌석의 답만 기존 불변 원장에 자동 저장한다. 화면과 API는 기계 판정·상대 답·왜 내게를 숨기지만 실제 서로 다른 두 사람의 배정·전 행 판정·불일치 조정·운영 반영을 증명하지 않는다."
    },
    readerQualityFeedbackQaReceipt: {
      stableId: "NOWHOT-READER-QUALITY-FEEDBACK-QA-20260811-001",
      state: "local_code_qa_pass_with_limits",
      observedAt: "2026-08-11T07:45:41.350Z",
      changeId: "DEVCHG-NOWHOT-20260811-049",
      scope: "same_pool_non_persisted_three_slot_replay",
      rules: {
        recentEditionHistoryDepth: 3,
        skippedSlotRepeatDetection: true,
        currentEditionNearDuplicateFeedback: true,
        lowContextAndMetaHeadlineHold: true,
        informativeTailPreference: true,
        categorySemanticLeakHold: true,
        immutableSavedEditions: true,
        immutableHumanReviewPacket: true,
        llmCalls: 0
      },
      projectedEvening: {
        evaluatedClusters: 237,
        machinePassClusters: 213,
        machineHoldClusters: 24,
        qualifiedClusters: 177,
        nearDuplicateHolds: 36,
        selectedIssues: 42,
        heldRepeats: 4,
        comparedEditionCount: 2,
        selectedReviewPacketMachinePass: 42,
        targetDefectsRemaining: 0,
        fulfillmentState: "fulfillment_partial",
        underfilledCategoryIds: ["science"]
      },
      correctedClasses: [
        "한 슬롯을 건너 재등장한 같은 사건",
        "판 안의 같은 발표·같은 커뮤니티 논쟁",
        "감사글·메타 헤드라인·도움 요청",
        "64자에서 잘린 영문 사건명",
        "클릭 유도 앞구절 대신 사실이 담긴 뒷구절",
        "게임의 기술 오분류",
        "기후·재난의 부동산·과학 오분류",
        "정치 비유의 문화 오분류",
        "차량 맥락 없는 교통사고의 자동차 오분류"
      ],
      tests: {
        focusedRegression: { total: 110, passed: 110, failed: 0 },
        fullRegression: { total: 1093, passed: 1093, failed: 0 }
      },
      boundary: "같은 현재 수집 풀을 세 슬롯 순서로 재생한 비저장 사전검수다. 실제 19시 수집·저장·사람 품질 PASS·운영 반영을 증명하지 않으며, 과학은 목표 2건 중 1건만 유효해 부분 충족으로 남긴다."
    },
    unservedQualityCarryoverQaReceipt: {
      stableId: "NOWHOT-UNSERVED-QUALITY-CARRYOVER-QA-20260811-001",
      contractId: "NOWHOT-UNSERVED-QUALITY-CARRYOVER-001",
      state: "local_code_qa_pass_with_limits",
      observedAt: "2026-08-11T17:21:58+09:00",
      changeId: "DEVCHG-NOWHOT-20260811-050",
      scope: "history_aware_shared_editorial_candidate",
      rules: {
        requiresPriorEdition: true,
        maxAgeHours: EDITION_CANDIDATE_CONTRACT.carryoverMaxHours,
        candidateFloor: EDITION_CANDIDATE_CONTRACT.carryoverCandidateFloor,
        allowedSourceRoles: EDITION_CANDIDATE_CONTRACT.carryoverSourceRoles,
        servedCanonicalUrlsExcluded: true,
        communitySignalsExcluded: true,
        currentSlotIssuesRankFirst: true,
        machineQualityAndNearDuplicateGatesPreserved: true,
        recentEditionContinuityPreserved: true,
        fixedCandidateTarget: false,
        llmCalls: 0
      },
      deterministicFixture: {
        currentSlotCandidates: 1,
        eligibleCarryoverCandidates: 4,
        excludedServedCanonicalUrls: 1,
        excludedCommunitySignals: 1,
        excludedOverAgeItems: 1,
        currentSlotIssueFirst: true
      },
      projectedRuntimeReplay: {
        mode: "same_current_pool_no_elapsed_time",
        projectedOnly: true,
        evening: {
          servedCanonicalUrlCount: 86,
          carryoverCandidateCount: 3,
          carryoverCategoryCounts: { science: 3 },
          draftCarryoverIssueCount: 2,
          finalCarryoverIssueCount: 1,
          finalScienceIssues: 2,
          finalScienceCurrentSlotIssues: 1,
          finalScienceCarryoverIssues: 1,
          targetScienceIssues: 2,
          heldRepeats: 3,
          finalIssueCount: 42,
          fulfillmentState: "fulfillment_complete",
          fulfilledCategories: 14,
          selectedCategories: 14,
          machineReviewPass: 42,
          machineReviewHold: 0
        },
        candidateQuality: {
          evaluatedClusters: 237,
          machinePassClusters: 214,
          machineHoldClusters: 23,
          qualifiedClusters: 179
        }
      },
      tests: {
        focusedRegression: { total: 90, passed: 90, failed: 0 },
        fullRegression: { total: 1094, passed: 1094, failed: 0 }
      },
      visual: {
        state: "local_browser_qa_pass",
        desktop: {
          viewport: "1280x720",
          identity: "지금핫 NowHot 맞춰가는 중",
          overlap: false,
          horizontalOverflow: false
        },
        mobile: {
          viewport: "390x844",
          identity: "지금핫 맞춰가는 중",
          englishHidden: true,
          overlap: false,
          horizontalOverflow: false
        },
        todayLiveRoundTrip: true,
        liveIndicatorMoved: true,
        consoleErrors: 0,
        consoleWarnings: 0
      },
      boundary: "이월은 현재 슬롯의 새 사건을 대체하지 않고 부족한 선택 분야만 보충한다. 실제 19시 저장 판·사람 품질 PASS·운영 반영은 별도 증거다. 상단의 지금핫·NowHot·맞춰가는 중 정체성 문구는 오늘과 실시간 양쪽에서 유지한다."
    },
    readerPayloadFreezeQaReceipt: {
      stableId: "NOWHOT-READER-PAYLOAD-FREEZE-QA-001",
      state: "reader_copy_hold",
      label: "독자 payload 동결 완료 · 품질 HOLD",
      observedAt: "2026-08-11T18:18:22+09:00",
      changeId: "DEVCHG-NOWHOT-20260811-052",
      scope: "actual_active_reader_payload_and_packet_level_copy_gate",
      contracts: {
        packetVersion: 2,
        readerContractId: EDITORIAL_READER_COPY_CONTRACT.stableId,
        readerContractVersion: 3,
        visibleFields: EDITORIAL_READER_COPY_CONTRACT.visibleFields
      },
      before: {
        readerFrozen: "0/42",
        projectedMachinePass: "42/42",
        defect: "독자가 읽는 문장을 동결하지 않아 실제 문장 품질을 검사하지 않고도 기계 PASS가 가능했다."
      },
      actualRuntime: {
        packetId: "BRP-1826p5m",
        issueCount: 42,
        readerFrozen: "42/42",
        canonicalMachinePass: "42/42",
        readerIssuePass: "41/42",
        readerIssueHold: "1/42",
        readerPacketPass: false,
        overallMachinePass: "0/42",
        machineState: "reader_copy_hold",
        humanState: "human_annotation_ready",
        overallState: "reader_copy_hold",
        humanDoubleReviewedRows: "0/84",
        actualElapsedSlots: "2/3",
        schedulerState: "slot_scheduler_armed"
      },
      copyChecks: {
        internalLanguageRows: 0,
        koreanAudienceReadableHoldRows: 1,
        blankWatchNextRows: 28,
        blankWatchNextPolicy: "구체적 후속 관측점이 없으면 상용구를 만들지 않고 화면 행을 숨긴다."
      },
      packetDiversity: {
        threshold: "동일 문장 최대 ceil(판 행 수의 15%)",
        allowedExactRepeat: 7,
        whyImportant: { distinct: 17, maxExactRepeat: 10, pass: false },
        whyNow: { distinct: 32, maxExactRepeat: 3, pass: true },
        watchNext: { distinct: 5, maxExactRepeat: 8, pass: false }
      },
      tests: {
        focusedRegression: { total: 36, passed: 36, failed: 0 },
        blueprintProjectionRegression: { total: 47, passed: 47, failed: 0 },
        fullRegression: { total: 1097, passed: 1097, failed: 0 }
      },
      proves: [
        "독자가 읽는 일곱 필드를 검수 패킷에 불변 동결하고 같은 문장을 행 단위로 검사한다.",
        "행 검사가 통과해도 판 전체 상용구 반복이 임계치를 넘으면 전체 기계 판정을 HOLD한다.",
        "사람 입력 준비 상태와 기계·최종 품질 상태를 별도 필드로 보존한다.",
        "구형 활성 패킷은 사람 진행이 0일 때만 append-only 신규 패킷으로 승격한다."
      ],
      doesNotProve: [
        "독자 문장이 기자 수준이라는 사람 품질 PASS",
        "미번역 영어 제목 1건과 반복 상용구 해소",
        "실제 19시 판·다일 신뢰도·두 검수자 84행 완료",
        "운영 배포·광고·계정·수익 결과"
      ],
      nextAllowed: [
        "HOLD 행의 한국어 사건 제목과 반복 문장을 근거 범위 안에서 사건별로 편집",
        "실제 아침·낮 패킷을 검수자 A/B가 독립 표기하고 불일치를 조정",
        "기존 스케줄러로 실제 19시 저장 판을 관측하되 성공을 미리 주장하지 않음"
      ],
      boundary: "이 영수증은 거짓 42/42 PASS 경로를 닫았다는 로컬 구조 증거다. 현재 실제 패킷 판정 자체는 reader_copy_hold다."
    },
    readerEventFrameQaReceipt: {
      stableId: "NOWHOT-READER-EVENT-FRAME-QA-001",
      state: "hold",
      label: "사건별 문안 다양성 PASS · 목적 적합성 HOLD",
      observedAt: "2026-08-11T18:45:06+09:00",
      changeId: "DEVCHG-NOWHOT-20260811-053",
      scope: "actual_active_reader_event_frames_packet_identity_and_purpose_alignment",
      contracts: {
        packetVersion: 3,
        qualityContractVersion: 7,
        readerContractId: EDITORIAL_READER_COPY_CONTRACT.stableId,
        readerContractVersion: 5
      },
      editingRule: {
        order: ["verified_llm_edit", "deterministic_event_frame", "existing_editorial_fallback"],
        eventFrames: 21,
        headlinePrefixTrickUsed: false,
        canonicalContentMutated: false,
        llmCalls: 0
      },
      actualRuntime: {
        packetId: "BRP-0volhia",
        supersededPacketId: "BRP-0lsefw1",
        editionId: "2026-08-11-morning-art.auto.business.culture.fashion.gaming.humor.life.news.politics.realestate.science.sports.tech",
        issueCount: 42,
        canonicalMachinePass: "42/42",
        readerIssuePass: "41/42",
        readerIssueHold: "1/42",
        readerPacketPass: true,
        machinePass: "41/42",
        machineState: "reader_copy_hold",
        holdReason: "한국어 독자용 제목이 없는 영문 기사 1건",
        humanDoubleReviewedRows: "0/84"
      },
      packetDiversity: {
        allowedExactRepeat: 7,
        whyImportant: { beforeDistinct: 17, distinct: 29, beforeMaxExactRepeat: 10, maxExactRepeat: 2, pass: true },
        whyNow: { distinct: 32, maxExactRepeat: 3, pass: true },
        watchNext: { beforeDistinct: 5, distinct: 25, beforeMaxExactRepeat: 8, maxExactRepeat: 3, pass: true }
      },
      immutableUpgrade: {
        sameStoredEditionOnly: true,
        humanProgressMustBeZero: true,
        oldPacketPreserved: true,
        packetIdentityIncludes: ["qualityContractVersion", "readerContractVersion", "readerPayload", "readerGate"],
        regressionState: "pass"
      },
      elapsedRuntime: {
        observedAt: "2026-08-11T19:00:44.799+09:00",
        clockSource: "system",
        capturedSlots: "3/3",
        onTimeSlots: "3/3",
        readySlots: "3/3",
        distinctContentFingerprints: "3/3",
        eveningDelayMs: 44799,
        actualElapsedTimeProof: false,
        completeSegmentProofs: "1/5",
        completeSegmentKey: "v13:gaming",
        allCategoryHold: "realestate underfilled",
        defaultSegmentHold: "humor underfilled",
        triggerBoundary: "관리자 읽기와 자동 감시가 같은 재고 생성 경로를 사용하므로 스케줄러 단독 무인 실행 인과는 별도 증거가 필요하다."
      },
      adversarialReview: {
        state: "hold",
        actualNamedCompanyParticipation: false,
        simulatedIndependentRoleLenses: true,
        reviewersSawOtherVerdicts: false,
        reviewers: [
          { id: "R1", lens: "Techmeme 사건 데스크", score: 66, verdict: "HOLD", finding: "세 판의 내용 지문은 달랐지만 이브닝 분야 부족과 동일 사건 우선순위의 사람 판정이 남았다." },
          { id: "R2", lens: "Ground News 근거 감사", score: 60, verdict: "HOLD", finding: "정본 계보는 유지됐지만 일반 중요성 해설이 주장 단위 근거로 지지되는지는 사람 검증되지 않았다." },
          { id: "R3", lens: "Particle 개인 브리핑 제품", score: 61, verdict: "HOLD", finding: "42건을 읽을 수 있게 나눴지만 첫 화면의 우선순위와 실제 재방문 효용은 사용자 증거가 없다." },
          { id: "R4", lens: "뉴닉 한국어 편집", score: 58, verdict: "HOLD", finding: "상용구는 크게 줄었지만 영문 제목 1건과 확인 대상 중심 문체가 사람 편집 기준을 통과하지 않았다." },
          { id: "R5", lens: "네이버 뉴스·추천 제품", score: 55, verdict: "HOLD", finding: "선택 분야 공급은 관측됐지만 클릭·저장·숨김 학습이 실제 핵심 선별을 개선한다는 증거가 없다." }
        ],
        meanScore: 60,
        verdict: "목적 방향은 맞고 문장 다양성 결함은 폐쇄됐지만, 사람 품질·세 판 효용·근거 지지·개인화 효과가 미증명이라 다음 단계 진입은 HOLD"
      },
      tests: {
        focusedRegression: { total: 19, passed: 19, failed: 0 },
        fullRegression: { total: 1103, passed: 1103, failed: 0 }
      },
      proves: [
        "서로 다른 사건을 사회·지정학 상용구 하나로 뭉치던 판 전체 반복 결함을 실제 42행에서 줄였다.",
        "문안·계약·판정 변경이 같은 검수 패킷 ID를 재사용하지 않도록 했다.",
        "기존 저장 판과 패킷을 지우지 않고 사람 메모·부분 체크·조정도 없는 같은 판만 새 패킷으로 승계했다."
      ],
      doesNotProve: [
        "독립 회사 직원이 실제 검수했다는 사실",
        "두 사람의 독립 전수 검수와 기자 수준 품질 PASS",
        "하루 세 판의 장기 재방문 가치와 개인화 선별 효과",
        "운영 배포·광고·계정·수익 결과"
      ],
      nextAllowed: [
        "한국어 근거가 확인된 영문 HOLD 1건만 번역·편집하고 같은 행 게이트로 재검증",
        "검수자 A/B가 같은 활성 42행을 독립 표기한 뒤 불일치만 조정",
        "실제 세 슬롯과 다일 관측으로 반복·우선순위·재방문 효용을 검증"
      ],
      boundary: "기계 다양성 PASS는 사람 편집 품질이나 영구 제품 목적 달성을 대신하지 않는다."
    },
    independentAdversarialAuditReceipt: {
      stableId: "NOWHOT-INDEPENDENT-CODEX-ADVERSARIAL-AUDIT-001",
      state: "block",
      label: "운영 승격 BLOCK · 로컬 반례 수리만 허용",
      observedAt: "2026-08-11T19:24:14+09:00",
      changeId: "DEVCHG-NOWHOT-20260811-054",
      scope: "current_local_editorial_trust_reader_personalization_and_serving_paths",
      independence: {
        separateAgentContexts: true,
        forkContextShared: false,
        reviewersSawOtherVerdicts: false,
        actualHumanParticipation: false,
        actualNamedCompanyParticipation: false,
        codeMutationAllowed: false
      },
      reviewers: [
        {
          id: "IA-R1",
          lens: "사건 데스크·한국어 브리핑 편집",
          score: 54,
          verdict: "HOLD",
          finding: "변화 정보가 없어도 행이 통과하고 관련 기사 키워드가 주 사건 프레임을 바꿀 수 있으며 완전일치 반복만 검사한다."
        },
        {
          id: "IA-R2",
          lens: "주장 계보·근거·LLM 검증",
          score: 32,
          verdict: "BLOCK",
          finding: "주장 텍스트 변조 뒤에도 lineage_pass이고 verifier가 없는 캐시도 verified_edit로 적용되는 거짓 신뢰 PASS를 재현했다."
        },
        {
          id: "IA-R3",
          lens: "개인화 브리핑 제품·UX·운영",
          score: 52,
          verdict: "HOLD",
          finding: "독자 품질 HOLD가 서빙을 막지 않고 다중 분야 가산과 평가 해제의 양수 학습이 공급·개인화 상태를 과대평가한다."
        }
      ],
      score: {
        scale: 100,
        mean: 46,
        verdicts: { block: 1, hold: 2, go: 0 },
        kind: "diagnostic_not_product_kpi"
      },
      directReproductions: [
        {
          id: "ADR-P0-01",
          result: "confirmed",
          path: "src/feed/editorial-lineage.js:121-169",
          before: "lineage_pass",
          mutation: "whyImportant와 watchNext를 근거 없는 단정으로 변경",
          after: "lineage_pass",
          cause: "저장한 claimLineage.contentHash를 verifyEditorialLineage에서 재계산하지 않는다."
        },
        {
          id: "ADR-P0-02",
          result: "confirmed",
          path: "src/feed/editorial-llm.js:280-299",
          input: "draft는 있으나 verifier가 없는 캐시",
          calls: 0,
          output: "cache_only · verified_edit",
          cause: "누락 verifier를 세 필드 true로 대체한다."
        }
      ],
      confirmedFindings: [
        { id: "ADR-P0-01", severity: "P0", title: "주장 텍스트 변조를 계보 검증이 감지하지 못함", state: "confirmed" },
        { id: "ADR-P0-02", severity: "P0", title: "verifier 없는 캐시가 검증 완료 편집으로 적용됨", state: "confirmed" },
        { id: "ADR-P1-03", severity: "P1", title: "결정론적 사건 프레임이 근거 지지 없이 중요성·관전을 만들고 같은 프레임으로 자기 통과함", state: "code_confirmed" },
        { id: "ADR-P1-04", severity: "P1", title: "변화 정보가 없어도 대기 문구로 채워 독자 행이 통과할 수 있음", state: "code_confirmed" },
        { id: "ADR-P1-05", severity: "P1", title: "평가 해제 signal 0을 양수 평가로 저장해 개인화 학습을 원복하지 못함", state: "code_confirmed" },
        { id: "ADR-P1-06", severity: "P1", title: "다중 categoryIds 이슈를 각 분야에 중복 가산해 충족 깊이를 과대평가할 수 있음", state: "code_confirmed" }
      ],
      regressionBoundary: {
        fullSuite: "1103/1103 PASS",
        newlyFoundCounterexamplesCovered: "0/4",
        conclusion: "기존 회귀 통과는 위 신뢰·제품 반례를 잡지 못했다."
      },
      nextAllowed: [
        "네 핵심 반례를 먼저 실패 회귀로 고정",
        "claim text·reader 7필드·근거 ID·정책 버전을 해시하고 검증 시 재계산",
        "verifier 전체 기록과 계약·모델·프롬프트 버전이 없는 캐시는 miss 처리",
        "변화 없음·분야 고유 사건 부족·독자 문안 HOLD를 serveableEdition 게이트로 연결",
        "좋아요·싫어요 해제 시 저장 평가와 취향 가중치를 실제 삭제·원복"
      ],
      stopUntilClosed: [
        "운영 배포와 실제 이용자 전환",
        "LLM 편집 범위 확대",
        "현재 lineage_pass·verified_edit·fulfillment_complete를 신뢰 품질 PASS로 홍보"
      ],
      boundary: "세 검수자는 실제 Techmeme·Ground News·Particle·뉴닉·네이버 임직원이나 사람이 아니라 서로 분리된 Codex 검수자다. BLOCK은 확인된 거짓 신뢰 PASS 때문에 운영 승격에만 적용하며 로컬 최소 수리는 허용한다."
    },
    counterexampleRepairReceipt: {
      stableId: "NOWHOT-B6-COUNTEREXAMPLE-REPAIR-001",
      state: "local_repair_pass_reaudit_pending",
      label: "핵심 반례 4/4 수리 · 독립 재검수 대기",
      observedAt: "2026-08-11T19:41:35+09:00",
      changeId: "DEVCHG-NOWHOT-20260811-055",
      scope: "four_confirmed_trust_change_and_rating_counterexamples_only",
      red: {
        focusedRun: "189/194 PASS · 5 FAIL",
        counterexamplesCovered: "0/4",
        note: "네 반례 실패와 계보 지문 버전 상승 기대 실패를 함께 확인했다."
      },
      repairs: [
        { id: "ADR-P0-01", state: "regression_pass", repair: "현재 주장 텍스트·필드별 근거·계약 지문을 contentHash로 재계산하고 불일치 시 HOLD" },
        { id: "ADR-P0-02", state: "regression_pass", repair: "verifier 전체 기록과 계약·프롬프트·편집/검증 모델 버전이 일치하는 캐시만 재사용" },
        { id: "ADR-P1-04", state: "regression_pass", repair: "changedSincePrevious 원자료가 없으면 독자 문장 길이와 무관하게 reader_copy_hold" },
        { id: "ADR-P1-05", state: "regression_pass", repair: "signal 0은 저장 평가를 삭제하고 직전 명시 평가의 특징 기여를 역연산" }
      ],
      contracts: {
        lineageVersion: 2,
        lineageFingerprintVersion: 3,
        llmVersion: 2,
        llmPromptVersion: 2,
        readerCopyVersion: 6
      },
      green: {
        focusedRegression: "194/194 PASS",
        fullRegression: "1107/1107 PASS",
        counterexamplesCovered: "4/4"
      },
      remainingHold: [
        "결정론적 사건 프레임의 주장 단위 근거 지지",
        "다중 분야 이슈의 분야별 고유 사건 충족 계산",
        "독자 문안 HOLD와 분야 부족을 마지막 검증판 서빙 게이트에 연결",
        "실제 사람 2인 검수와 같은 독립 렌즈 재검수"
      ],
      nextAllowed: ["같은 독립 검수 렌즈의 재실행과 새 영수증 기록"],
      doesNotProve: ["사람 편집 품질 PASS", "운영 승격 가능", "장기 개인화 효용", "실제 모델 품질"],
      boundary: "이 영수증은 확인된 네 반례의 로컬 코드 수리만 증명한다. 과거 독립 BLOCK 영수증은 보존하며 재검수 전에는 운영 상태를 올리지 않는다."
    },
    independentReauditReceipt: {
      stableId: "NOWHOT-B6-INDEPENDENT-REAUDIT-001",
      state: "block",
      label: "2 BLOCK · 1 HOLD · 실제 이용자 서빙과 운영 승격 BLOCK",
      observedAt: "2026-08-11T20:03:06+09:00",
      changeId: "DEVCHG-NOWHOT-20260811-056",
      scope: "post_repair_reader_trust_personalization_fulfillment_and_serving_paths",
      independence: {
        separateAgentContexts: true,
        completedFinalReviewers: 3,
        replacedErroredAttempt: 1,
        actualHumanParticipation: false,
        actualNamedCompanyParticipation: false,
        strictBlind: false,
        limitation: "세 최종 판정은 분리 문맥에서 직접 반례를 재현했다. 다만 정본 코드에 과거 감사 영수증이 포함돼 한 검수자가 이를 보았으므로 완전 블라인드라고 주장하지 않는다."
      },
      reviewers: [
        {
          id: "RA-R1",
          lens: "사건 연속성·한국어 편집·실제 독자 응답",
          score: 36,
          verdict: "BLOCK",
          finding: "reader HOLD가 서빙을 막지 않고 실제 응답과 활성 검수 패킷이 다르며 사건 연속성 오탐·미탐과 관련기사 프레임 오염이 PASS한다."
        },
        {
          id: "RA-R2",
          lens: "주장 계보·근거·검수 원장",
          score: 58,
          verdict: "BLOCK",
          finding: "paragraph 단독 변조와 근거 없는 중요성 문장이 신뢰 게이트를 우회하고 reader HOLD도 HTTP 200 응답에 남는다."
        },
        {
          id: "RA-R3",
          lens: "개인화·분야 충족·제품 효용",
          score: 44,
          verdict: "HOLD",
          finding: "중간 신호 뒤 평가 삭제가 정확히 원복되지 않고 한 다중분야 이슈가 여러 분야를 채우며 개인화 효용은 아직 측정되지 않았다."
        }
      ],
      score: {
        scale: 100,
        mean: 46,
        verdicts: { block: 2, hold: 1, go: 0 },
        kind: "diagnostic_not_product_kpi"
      },
      actualRuntime: {
        storedSlots: {
          morning: { issueCount: 42, readerPass: "41/42", servedStatus: 200 },
          lunch: { issueCount: 42, readerPass: "37/42", servedStatus: 200 },
          evening: { issueCount: 42, readerPass: "37/42", servedStatus: 200 }
        },
        allCategoryEvening: {
          statusCode: 200,
          issueCount: 42,
          publishable: true,
          fulfillment: "13/14",
          underfilledCategoryIds: ["realestate"],
          readerHoldRows: 5,
          servedDespiteReaderHold: true
        },
        activeReviewPacket: {
          rows: 42,
          readerPass: "41/42",
          machineState: "reader_copy_hold",
          humanCompleted: 0,
          llmCalls: 0
        },
        responsePacketDrift: {
          slot: "morning",
          comparedRows: 42,
          changedReaderField: "change",
          mismatchedRows: "42/42"
        }
      },
      directReproductions: [
        { id: "RA-P0-01", severity: "P0", result: "confirmed", title: "reader HOLD·분야 부족 판이 HTTP 200으로 제공됨", detail: "이브닝 42건 중 reader HOLD 5건, 분야 충족 13/14인데 publishable true와 HTTP 200이었다." },
        { id: "RA-P0-02", severity: "P0", result: "confirmed", title: "검수 패킷과 실제 독자 응답의 reader 값 불일치", detail: "모닝 42행의 change 값이 활성 검수 패킷과 실제 응답에서 42/42 달랐다." },
        { id: "RA-P1-03", severity: "P1", result: "confirmed", title: "paragraph 단독 변조가 계보 해시를 우회", detail: "whatHappened가 함께 있으면 paragraph만 바꿔도 lineage_pass가 유지됐다." },
        { id: "RA-P1-04", severity: "P1", result: "confirmed", title: "근거 없는 중요성·변화 문장이 reader gate 통과", detail: "구조화 근거 없이 임의 whyImportant·changedSincePrevious를 넣어도 reader_copy_pass가 가능했다." },
        { id: "RA-P1-05", severity: "P1", result: "confirmed", title: "사건 연속성 오탐·미탐과 관련기사 프레임 오염", detail: "서로 다른 갤럭시 사건은 unchanged, 같은 호르무즈 사건 변주는 new였고 관련기사 키워드가 주 사건 중요성을 바꿨다." },
        { id: "RA-P1-06", severity: "P1", result: "confirmed", title: "다중분야 이슈 한 건이 두 분야 충족", detail: "business·realestate를 함께 가진 이슈 1건이 두 분야 최소 깊이를 모두 충족시켰다." },
        { id: "RA-P1-07", severity: "P1", result: "confirmed", title: "중간 신호 뒤 평가 삭제가 정확히 원복되지 않음", detail: "like 뒤 implicit 신호를 쌓고 삭제하면 대조 사용자와 특징 벡터가 달랐고 feedbackCount 1이 남았다." }
      ],
      previousRepairClosure: {
        covered: "4/4",
        remainsValid: true,
        note: "계보 주장 변조, verifier 없는 캐시, 변화 원자료 누락, 즉시 평가 삭제 회귀는 계속 GREEN이다. 이번 재검수는 다른 입력과 실제 서빙 경로에서 새 공백을 확인했다."
      },
      regressionBoundary: {
        suiteAtReviewStart: "1107/1107 PASS",
        productVerdict: "BLOCK",
        conclusion: "전체 테스트 PASS는 실제 응답의 품질 권한, 주장 근거, 분야 고유성, 개인화 효용을 증명하지 않는다."
      },
      recordingQa: {
        blueprintAndAdminFocused: "21/21 PASS",
        fullRegression: "1107/1107 PASS",
        diffCheck: "PASS"
      },
      nextRequired: {
        id: "B6-SERVEABLE-EDITION-REPAIR",
        title: "정확한 응답 packet 기반 fail-closed 서빙 게이트",
        acceptance: [
          "editionForRequest 직후 그 응답 그대로 검수 패킷을 만들고 reader PASS와 선택 분야 충족을 확인",
          "현재판 실패 시 같은 선택 조합과 reader 지문의 마지막 검증판만 폴백",
          "검증판이 없으면 HOLD 판을 HTTP 200 본문으로 보내지 않고 409로 종료",
          "HOLD·분야 부족·응답/패킷 불일치 세 반례를 라우트 회귀로 고정"
        ]
      },
      remainingAfterServingGate: [
        "paragraph·reader 7필드의 계보 해시 결박과 중요성 주장 단위 근거",
        "사건 연속성 오탐·미탐과 관련기사 프레임 오염",
        "다중 분야 이슈의 분야별 고유 사건 충족",
        "중간 신호 뒤 평가 삭제의 정확 원복과 실제 개인화 효용",
        "사람 편집 검수·다일 안정성·비용·복구 증거"
      ],
      stopUntilClosed: ["실제 이용자 서빙 전환", "운영 main 배포", "LLM 편집 범위 확대", "현재 publishable을 품질 PASS로 홍보"],
      doesNotProve: ["실제 사람 또는 회사 임직원 검수", "기사 사실성 전수 확인", "사람 편집 품질 PASS", "장기 개인화 효용", "운영 배포 가능"],
      boundary: "세 검수자는 실제 Techmeme·Ground News·Particle·뉴닉·네이버 임직원이나 사람이 아닌 분리 Codex 검수자다. 진단은 로컬 수리를 막지 않으며 품질 미달 판의 실제 이용자 서빙과 운영 승격만 BLOCK한다."
    },
    serveableEditionRepairReceipt: {
      stableId: "NOWHOT-B6-SERVEABLE-EDITION-GATE-001",
      state: "local_repair_pass_with_limits",
      label: "정확 응답 서빙 P0 4/4 폐쇄 · 후속 P1 HOLD",
      observedAt: "2026-08-11T20:33:00+09:00",
      changeId: "DEVCHG-NOWHOT-20260811-057",
      scope: "exact_response_machine_reader_fulfillment_serving_gate_only",
      contract: {
        stableId: EDITORIAL_SERVING_CONTRACT.stableId,
        version: EDITORIAL_SERVING_CONTRACT.version,
        maxFallbackAgeMs: EDITORIAL_SERVING_CONTRACT.maxFallbackAgeMs,
        humanReviewRequired: EDITORIAL_SERVING_CONTRACT.humanReviewRequired
      },
      red: {
        sampledResponses: 42,
        http200: 42,
        humanAnnotationReady: 3,
        readerCopyHold: 38,
        machineGateHold: 1,
        note: "14개 단일 분야와 아침·낮·저녁 조합을 직접 호출했을 때 품질 상태와 무관하게 모두 HTTP 200이었다."
      },
      repairs: [
        { id: "SERVE-P0-01", state: "regression_pass", repair: "반환할 정확한 응답에서 기계·독자 행·판 다양성·선택 분야 충족을 다시 계산한 뒤에만 HTTP 200 허용" },
        { id: "SERVE-P0-02", state: "regression_pass", repair: "통과한 응답 packetId·editionId·분야 조합·계약 버전의 불변 검증 영수증 저장" },
        { id: "SERVE-P0-03", state: "regression_pass", repair: "같은 분야 조합의 24시간 이내 판만 현재 계약으로 재검수하고 저장 지문이 같을 때 폴백" },
        { id: "SERVE-P0-04", state: "regression_pass", repair: "현재판과 검증 이전판이 모두 실패하면 품질 미달 본문 대신 HTTP 409와 명시적 대기 화면 제공" }
      ],
      green: {
        focusedRegression: "17/17 PASS",
        fullRegression: "1114/1114 PASS",
        routeCounterexamples: "4/4 PASS",
        exactPacketMatch: true,
        holdResponseStatus: 409,
        tamperedReceiptRejected: true
      },
      nextRequired: {
        id: "B6-READER-LINEAGE-GROUNDING-REPAIR",
        title: "독자 문장·paragraph 계보와 중요성 주장 근거 결박",
        acceptance: "paragraph·reader 7필드 변조와 근거 없는 whyImportant·change가 현재 계약에서 모두 HOLD"
      },
      remainingHold: [
        "paragraph·reader 7필드의 계보 해시 결박과 중요성 주장 단위 근거",
        "사건 연속성 오탐·미탐과 관련기사 프레임 오염",
        "다중 분야 이슈의 분야별 고유 사건 충족",
        "중간 신호 뒤 평가 삭제의 정확 원복과 실제 개인화 효용",
        "사람 편집 검수·다일 안정성·비용·복구 증거"
      ],
      doesNotProve: ["기사 사실성", "사람 편집 품질 PASS", "장기 개인화 효용", "운영 배포 가능"],
      boundary: "이 영수증은 정확 응답 fail-closed 서빙 P0의 로컬 코드와 회귀만 증명한다. 사람 표본 검수는 자동 하루 세 판 제공 게이트와 별개이며 후속 P1과 운영 승격은 계속 BLOCK한다."
    },
    readerLineageGroundingRepairReceipt: {
      stableId: "NOWHOT-B6-READER-LINEAGE-GROUNDING-REPAIR-001",
      state: "local_repair_pass_with_limits",
      label: "paragraph·독자 7필드·중요성·변화 반례 폐쇄 · 후속 P1 HOLD",
      observedAt: "2026-08-11T21:06:12+09:00",
      changeId: "DEVCHG-NOWHOT-20260811-058",
      scope: "paragraph_and_current_reader_payload_lineage_grounding_only",
      contracts: {
        lineageVersion: 3,
        lineageFingerprintVersion: 4,
        readerVersion: 7,
        readerFingerprintVersion: 1,
        qualityVersion: 8,
        packetVersion: 4,
        visibleFields: EDITORIAL_READER_COPY_CONTRACT.visibleFields
      },
      red: {
        focusedRegression: "11/14 PASS · 3 FAIL",
        confirmed: [
          "whatHappened가 있으면 paragraph 단독 변조가 lineage_pass 유지",
          "구조화 계보·변화 근거 없는 whyImportant·changedSincePrevious가 reader_copy_pass",
          "독자 7필드의 현재 근거 SHA-256 지문과 필드별 결속 판정 부재"
        ]
      },
      repairs: [
        { id: "RLG-P1-01", state: "regression_pass", repair: "paragraph를 whatHappened와 독립된 일곱 번째 claim으로 해시하고 검증 시 현재 문장을 재계산" },
        { id: "RLG-P1-02", state: "regression_pass", repair: "독자 7필드·정본 evidenceHash/contentHash·필드별 근거·변화 근거를 SHA-256 reader 지문에 함께 결박" },
        { id: "RLG-P1-03", state: "regression_pass", repair: "검증 편집·사건 프레임·계보화 편집 정책만 중요성 근거로 인정하고 변화 상태·reasons·deltas에서 재현한 정확 문장만 허용" },
        { id: "RLG-P1-04", state: "regression_pass", repair: "검수 packet v4 식별자에 reader lineage와 필드별 게이트를 포함해 구형 판정을 자동 재사용하지 않음" }
      ],
      green: {
        coreRegression: "14/14 PASS",
        integrationRegression: "47/47 PASS",
        fullRegression: "1117/1117 PASS",
        paragraphTamperHeld: true,
        readerFieldTamperHeld: "7/7",
        unsupportedImportanceAndChangeHeld: true,
        externalLlmCalls: 0
      },
      nextRequired: {
        id: "B6-EVENT-CONTINUITY-FRAME-REPAIR",
        title: "사건 연속성 오탐·미탐과 관련기사 프레임 오염 수리",
        acceptance: "서로 다른 사건 결합·같은 사건 분리·관련기사 키워드의 주 사건 프레임 오염 반례가 모두 HOLD 또는 올바른 사건 판정으로 고정"
      },
      remainingHold: [
        "사건 연속성 오탐·미탐과 관련기사 프레임 오염",
        "다중 분야 이슈의 분야별 고유 사건 충족",
        "중간 신호 뒤 평가 삭제의 정확 원복과 실제 개인화 효용",
        "사람 편집 검수·다일 안정성·비용·복구 증거"
      ],
      doesNotProve: ["기사 사실성", "사람 편집 품질 PASS", "사건 매칭 정확도", "장기 개인화 효용", "운영 배포 가능"],
      boundary: "이번 단계는 현재 독자 문장과 근거의 무결성·출처를 결박한다. 근거 자체가 사실인지, 같은 사건을 올바르게 연결했는지, 문장이 사람에게 충분히 좋은지는 별도 게이트다."
    },
    eventContinuityFrameRepairReceipt: {
      stableId: "NOWHOT-B6-EVENT-CONTINUITY-FRAME-REPAIR-001",
      state: "local_repair_pass_with_limits",
      label: "사건 연속성·관련기사 프레임 반례 폐쇄 · 후속 P1 HOLD",
      observedAt: "2026-08-11T21:26:04+09:00",
      changeId: "DEVCHG-NOWHOT-20260811-059",
      scope: "recent_edition_event_identity_and_primary_event_frame_grounding_only",
      contracts: {
        editionChangeVersion: 4,
        lineageVersion: 4,
        lineageFingerprintVersion: 5,
        readerVersion: 8,
        readerFingerprintVersion: 2,
        eventFrameId: EDITORIAL_EVENT_FRAME_CONTRACT.stableId,
        eventFrameVersion: 1,
        qualityVersion: 9,
        packetVersion: 5
      },
      red: {
        focusedRegression: "22/25 PASS · 3 FAIL",
        confirmed: [
          "삼성·갤럭시·공개 일반어만 같은 폴드8과 워치8 발표를 같은 사건으로 합쳐 현재 이슈가 지면에서 사라짐",
          "related_observation 근거가 주 사건의 제목·리드·중요성·관전 claim에 함께 결박됨",
          "관련기사의 임상시험 키워드가 무관한 문화행사의 중요성·다음 확인 프레임을 바꿔도 reader_copy_pass"
        ]
      },
      repairs: [
        { id: "ECF-P1-01", state: "regression_pass", repair: "공개·발표 같은 일반어를 제거한 dedupe.titleConcepts 3개·최소 비율 0.5로 의미 연속성을 판정" },
        { id: "ECF-P1-02", state: "regression_pass", repair: "shared ref ID·정규 제목·의미 개념 모든 사건 매칭 경로에서 related_observation 제목·itemId를 제외" },
        { id: "ECF-P1-03", state: "regression_pass", repair: "주 사건 다섯 claim은 lead·corroborating 근거만 결박하고 related_observation은 whyHot 확산 관측에만 보존" },
        { id: "ECF-P1-04", state: "regression_pass", repair: "사건 프레임 입력을 subject·headline·whatHappened·paragraph로 제한하고 프레임 계약·주 사건 근거·입력 해시를 reader lineage와 packet v5에 결박" }
      ],
      green: {
        coreRegression: "26/26 PASS",
        integrationRegression: "70/70 PASS",
        fullRegression: "1121/1121 PASS",
        sameHormuzEventContinues: true,
        distinctGalaxyEventsSeparated: true,
        relatedObservationExcludedFromIdentityAndFrame: true,
        primaryClaimEvidenceIsolated: true,
        externalLlmCalls: 0
      },
      nextRequired: {
        id: "B6-CATEGORY-UNIQUE-FULFILLMENT-REPAIR",
        title: "선택 분야별 고유 사건 충족 계산 수리",
        acceptance: "다중 categoryIds 이슈 한 건이 여러 선택 분야를 동시에 채우지 않고 각 분야의 고유 사건 최소 깊이를 별도로 증명"
      },
      remainingHold: [
        "다중 분야 이슈의 분야별 고유 사건 충족",
        "중간 신호 뒤 평가 삭제의 정확 원복과 실제 개인화 효용",
        "사람 편집 검수·다일 안정성·비용·복구 증거"
      ],
      doesNotProve: ["기사 사실성", "모든 사건의 의미 매칭 정확도", "사람 편집 품질 PASS", "장기 개인화 효용", "운영 배포 가능"],
      boundary: "이번 단계는 확인된 사건 연속성·관련기사 오염 반례와 주 사건 근거 역할만 폐쇄한다. 일반어 제거 기반 매칭은 형태소·개체·시간 의미의 전수 정답이 아니므로 사람 표본과 다일 관측 전에는 운영 승격을 허용하지 않는다."
    },
    categoryUniqueFulfillmentRepairReceipt: {
      stableId: "NOWHOT-B6-CATEGORY-UNIQUE-FULFILLMENT-REPAIR-001",
      state: "local_repair_pass_with_limits",
      label: "다중 분야 이슈 중복 충족 반례 폐쇄 · 후속 P1 HOLD",
      observedAt: "2026-08-11T21:50:52+09:00",
      changeId: "DEVCHG-NOWHOT-20260811-060",
      scope: "final_edition_selected_category_unique_issue_credit_only",
      contracts: {
        fulfillmentId: EDITORIAL_FULFILLMENT_CONTRACT.stableId,
        fulfillmentVersion: 4,
        maxSelectedCategoryCreditsPerIssue: 1,
        servingId: EDITORIAL_SERVING_CONTRACT.stableId,
        servingVersion: EDITORIAL_SERVING_CONTRACT.version
      },
      red: {
        focusedRegression: "5/8 PASS · 3 FAIL",
        confirmed: [
          "business·realestate 공유 이슈 한 건이 두 분야 목표 1건을 동시에 충족",
          "공유 이슈 두 건이 두 분야 목표 2건을 각각 충족한 것으로 중복 가산",
          "고유 단일 배정 수·다중 분야 이슈 수 영수증이 없어 과대평가를 직접 감사할 수 없음"
        ]
      },
      repairs: [
        { id: "CUF-P1-01", state: "regression_pass", repair: "최종 이슈 한 건의 선택 분야 크레딧을 최대 한 곳으로 제한" },
        { id: "CUF-P1-02", state: "regression_pass", repair: "공급이 적은 분야부터 깊이 1→목표까지 순환하는 결정적 최대 매칭으로 전용·공유 이슈를 재배정" },
        { id: "CUF-P1-03", state: "regression_pass", repair: "분야 적합 최종 건수와 실제 단일 배정 건수·다른 분야 배정 수를 분리 기록" },
        { id: "CUF-P1-04", state: "regression_pass", repair: "고유 사건 최소 깊이 미충족 판은 기존 정확 응답 서빙 계약에서 category_fulfillment_hold로 fail-closed" }
      ],
      green: {
        coreRegression: "8/8 PASS",
        servingRegression: "16/16 PASS",
        editionIntegrationRegression: "22/22 PASS",
        fullRegression: "1125/1125 PASS",
        singleIssueMaximumCredits: 1,
        rawEligibilityAndUniqueCreditSeparated: true,
        underfilledResponseHeld: true,
        existingEditionPathsPreserved: true,
        externalLlmCalls: 0
      },
      nextRequired: {
        id: "B6-FEEDBACK-ROLLBACK-REPAIR",
        title: "중간 신호 뒤 평가 삭제의 정확 원복",
        acceptance: "명시 평가 뒤 묵시 신호를 쌓고 평가를 해제한 사용자도 저장 평가·특징 벡터·feedbackCount가 대조 사용자와 같으며 재시작 뒤에도 같은 상태를 유지"
      },
      remainingHold: [
        "중간 신호 뒤 평가 삭제의 정확 원복과 실제 개인화 효용",
        "사람 편집 검수·다일 안정성·비용·복구 증거"
      ],
      doesNotProve: ["기사 사실성", "분야 태그 자체의 의미 정답", "사람 편집 품질 PASS", "장기 개인화 효용", "운영 배포 가능"],
      boundary: "이번 단계는 최종 판본 이슈의 선택 분야 최소치 중복 가산만 폐쇄한다. 카테고리 태그가 사실상 맞는지와 실제 독자 가치, 사람 품질, 운영 안정성은 별도 게이트다."
    },
    feedbackRollbackRepairReceipt: {
      stableId: "NOWHOT-B6-FEEDBACK-ROLLBACK-REPAIR-001",
      state: "local_repair_pass_with_limits",
      label: "중간 신호 뒤 평가 삭제 원복 반례 폐쇄 · 효용 증거 HOLD",
      observedAt: "2026-08-11T22:14:05+09:00",
      changeId: "DEVCHG-NOWHOT-20260811-061",
      scope: "explicit_rating_rollback_state_integrity_only",
      contract: {
        stableId: FEEDBACK_OVERLAY_CONTRACT.stableId,
        version: FEEDBACK_OVERLAY_CONTRACT.version,
        baseField: FEEDBACK_OVERLAY_CONTRACT.baseField,
        projectionField: FEEDBACK_OVERLAY_CONTRACT.projectionField,
        eventJournalEntriesPerUser: 0
      },
      red: {
        focusedRegression: "0/1 PASS · 1 FAIL",
        confirmed: [
          "좋아요 뒤 완독 신호를 쌓고 평가를 해제하면 완독만 남긴 대조 사용자와 특징 벡터가 달라짐",
          "평가가 삭제돼도 feedbackCount가 1로 남아 개인화 확신을 과대계상",
          "같은 잘못된 특징 벡터와 feedbackCount가 JSON 저장·재시작 뒤에도 유지"
        ]
      },
      repairs: [
        { id: "FBR-P1-01", state: "regression_pass", repair: "설문·이력·묵시 신호의 preferenceBase와 현재 명시 평가의 preferences 투영을 분리" },
        { id: "FBR-P1-02", state: "regression_pass", repair: "현재 ratings의 최소 아이템 특징만 저장하고 시간·itemId 순으로 결정적 오버레이 재투영" },
        { id: "FBR-P1-03", state: "regression_pass", repair: "비평가 확신 feedbackBaseCount와 활성 평가 수를 분리해 추가·교체·해제 때 feedbackCount 재계산" },
        { id: "FBR-P1-04", state: "regression_pass", repair: "활성 레거시 평가가 없는 사용자는 현재 특징 벡터를 손실 없는 base로 이행하고 재시작 뒤 동일 투영" }
      ],
      green: {
        focusedRegression: "4/4 PASS",
        feedRegression: "179/179 PASS",
        fullRegression: "1126/1126 PASS",
        immediateRollbackMatchesControl: true,
        interleavedImplicitRollbackMatchesControl: true,
        restartStateMatchesControl: true,
        stagingUsersObserved: 365,
        stagingUsersMigratableWithoutInference: 365,
        stagingUsersWithLegacyActiveRatings: 0,
        unboundedEventJournalAdded: false,
        externalLlmCalls: 0,
        productionChanges: 0
      },
      nextRequired: {
        id: "B6-PERSONALIZATION-UTILITY-EVIDENCE",
        title: "개인화가 실제 선택 품질을 높이는지 증명",
        acceptance: "동일 후보군의 무신호 기준 대비 학습 사용자가 선택 분야 적중과 상위 순위를 개선하면서 비선택 분야 침범·출처 다양성 손실·과도한 한 분야 쏠림을 만들지 않음을 짝지은 오프라인 평가로 증명"
      },
      remainingHold: [
        "실제 개인화 효용과 장기 드리프트·다양성 증거",
        "사람 편집 검수·다일 안정성·비용·복구 증거"
      ],
      doesNotProve: ["실제 사용자 만족도", "운영 데이터 이행 완료", "장기 추천 효용", "사람 편집 품질 PASS", "운영 배포 가능"],
      boundary: "이번 단계는 평가 상태·특징 벡터·확신 수의 정확 원복만 폐쇄한다. 현재 로컬 데이터 복제본은 활성 평가 0건이라 365/365명을 추정 없이 이행할 수 있었지만, 운영 승격 전에는 당시 운영 파일의 활성 레거시 평가 수를 다시 감사해야 한다."
    },
    personalizationUtilityEvidenceReceipt: {
      stableId: "NOWHOT-B6-PERSONALIZATION-UTILITY-EVIDENCE-001",
      state: "local_offline_proxy_pass_with_limits",
      label: "동일 판본 상단 대리 효용 개선·다양성 가드 PASS · 실제 만족도 HOLD",
      observedAt: "2026-08-11T22:40:15+09:00",
      changeId: "DEVCHG-NOWHOT-20260811-062",
      scope: "response_only_category_affinity_offline_proxy_and_diversity_guard",
      contract: {
        stableId: EDITORIAL_PERSONALIZATION_UTILITY_CONTRACT.stableId,
        version: EDITORIAL_PERSONALIZATION_UTILITY_CONTRACT.version,
        pairedSameCanonicalEdition: true,
        topWindowMax: 10,
        sourceEvidenceCoverageMinimum: 0.8,
        fallbackOnHold: "canonical_shared_order",
        externalCalls: 0
      },
      methodology: {
        productionUserDataUsed: false,
        syntheticLearnedProfile: true,
        sourceEdition: "local_staging_saved_edition",
        baseline: "same_edition_canonical_shared_order",
        treatment: "same_edition_bounded_category_affinity_reorder",
        contentIssueCountEvidenceAndLineageMutated: false,
        metricIsOfflineProxyNotOutcome: true
      },
      red: {
        focusedRegression: "0/1 PASS · 1 FAIL",
        confirmed: [
          "개인화 순서 변경 여부만 기록하고 상단 선호 효용의 기준 대비 변화는 계산하지 않음",
          "선호 분야가 한 출처에 몰린 후보 순서가 상단 출처 다양성을 낮춰도 공유 순서로 되돌리는 계약이 없음"
        ]
      },
      guardrails: [
        "기준과 후보의 이슈 수·식별 멀티셋이 완전히 같음",
        "할인 누적 분야 친화도가 기준 순서보다 실제로 증가",
        "상위 창의 선택 분야 정밀도와 선호 분야 점유를 악화시키지 않음",
        "확인 가능한 출처 수 감소와 최대 출처 점유율 증가 금지",
        "상위 창에 최대 3개 선택 분야를 보존하고 한 분야 점유·연속 노출 증가 제한",
        "선택 밖 분야가 한 건이라도 섞이거나 출처 근거가 80% 미만이면 개인화 후보 HOLD",
        "HOLD 후보는 저장·문장 변경 없이 공유 중요도 순서로 폴백"
      ],
      replay: {
        editionId: "2026-08-11-evening-business.humor.news.tech",
        issueCount: 28,
        selectedCategories: ["business", "humor", "news", "tech"],
        profile: { business: 1, tech: 0.8, news: 0.2, humor: -1 },
        topK: 10,
        mode: "bounded_category_affinity_reorder",
        maxRankShift: 3,
        state: "utility_guard_pass",
        affinity: {
          baselineDiscounted: 3.265,
          projectedDiscounted: 3.2949,
          discountedGain: 0.0298,
          baselinePreferredShare: 0.8,
          projectedPreferredShare: 0.8
        },
        categorySelection: {
          baselinePrecision: 1,
          projectedPrecision: 1,
          unselectedIssueCount: 0
        },
        sourceDiversity: {
          baselineDistinctCount: 10,
          projectedDistinctCount: 10,
          baselineMaxShare: 0.1,
          projectedMaxShare: 0.1,
          evidenceCoverage: 1,
          pass: true
        },
        categoryConcentration: {
          baselineDistinctCount: 4,
          projectedDistinctCount: 4,
          baselineMaxShare: 0.3,
          projectedMaxShare: 0.3,
          baselineLongestRun: 3,
          projectedLongestRun: 3,
          pass: true
        }
      },
      counterexample: {
        issueCount: 12,
        topK: 10,
        preferredCategoryLeadSourceCount: 1,
        sourceDistinctBefore: 6,
        sourceDistinctCandidate: 5,
        sourceMaxShareBefore: 0.5,
        sourceMaxShareCandidate: 0.6,
        failure: "source_diversity_loss",
        servedCanonicalFallback: true
      },
      green: {
        focusedRegression: "5/5 PASS",
        fullRegression: "1127/1127 PASS",
        sameEditionPairedEvaluation: true,
        actualSavedEditionProxyGainObserved: true,
        diversityLossCounterexampleHeld: true,
        unselectedCategoryIntrusion: 0,
        contentMutations: 0,
        externalLlmCalls: 0,
        productionChanges: 0
      },
      nextRequired: {
        id: "B6-HUMAN-BLIND-EDITORIAL-PILOT",
        title: "실제 독자가 읽을 문장 품질을 사람 기준으로 닫기",
        acceptance: "동결된 동일 검수 패킷을 2인이 서로의 답을 보지 않고 판정하고 불일치 조정까지 완료해 사실성·중요성·문체·다양성 기준과 실제 서빙 가능한 판을 확보"
      },
      remainingHold: [
        "실제 사용자 만족도·클릭/완독 인과와 장기 취향 드리프트",
        "사람 편집 검수·다일 안정성·비용·장애 복구·조합 확장성"
      ],
      doesNotProve: ["실제 사용자 만족도", "개인화 클릭 인과", "장기 추천 효용", "사람 편집 품질 PASS", "운영 배포 가능"],
      boundary: "이번 PASS는 저장된 동일 판본과 합성 학습 프로필을 짝지은 오프라인 대리 효용이다. 실제 사용자 만족도나 클릭·완독 인과를 증명하지 않으며, 다양성 손실이 생기면 개인화하지 않고 공유 중요도 순서를 제공한다."
    },
    humanBlindEditorialPilotReadyReceipt: {
      stableId: "NOWHOT-B6-HUMAN-BLIND-EDITORIAL-PILOT-READY-001",
      state: "historical_receipt_not_runtime_restored",
      label: "과거 이브닝 42/42 영수증 보존 · 현재 런타임 패킷 아님",
      observedAt: "2026-08-11T23:17:11+09:00",
      changeId: "DEVCHG-NOWHOT-20260811-063",
      scope: "append_only_current_contract_edition_and_two_reviewer_packet_readiness",
      runtimeRestored: false,
      currentRuntimePacket: null,
      inventoryRenewal: {
        currentSnapshotVersion: "v21",
        compatibility: editorialSnapshotCompatibilityStatus(),
        appendOnly: true,
        preservedVersions: ["v13", "v14", "v15", "v16"],
        crossVersionContinuity: true,
        currentEveningPreviousEditionId: "2026-08-11-lunch-art.auto.business.culture.fashion.gaming.humor.life.news.politics.realestate.science.sports.tech",
        externalLlmCalls: 0
      },
      machinePacket: {
        status: "historical_receipt_only",
        packetId: "BRP-1etcf4c",
        editionId: "2026-08-11-evening-art.auto.business.culture.fashion.gaming.humor.life.news.politics.realestate.science.sports.tech",
        segmentKey: "v17:art.auto.business.culture.fashion.gaming.humor.life.news.politics.realestate.science.sports.tech",
        packetVersion: 5,
        readerContractVersion: 9,
        issueCount: 42,
        canonicalMachinePass: 42,
        readerIssuePass: 42,
        readerPacketPass: true,
        machineHold: 0,
        canonicalLineageValid: 42,
        koreanAudienceReadable: 42,
        groundedImportanceAndChange: 42,
        englishOnlyLeadCount: 0,
        whyImportantDistinct: 40,
        whyNowDistinct: 36,
        watchNextDistinct: 11
      },
      humanReview: {
        activePacket: true,
        reviewers: ["reviewer-a", "reviewer-b"],
        sameFrozenRows: 42,
        completedRows: 0,
        totalRequiredJudgments: 84,
        answersHiddenUntilBothComplete: true,
        comparisonReady: false,
        adjudicationComplete: false,
        humanQualityPass: false
      },
      supplyBoundary: {
        allCategoryFulfillment: "9/14",
        noQualifiedCategoryIds: ["art", "science"],
        underfilledCategoryIds: ["culture", "fashion", "realestate"],
        defaultCombinationFulfillment: "3/4",
        defaultUnderfilledCategoryIds: ["humor"],
        defaultTodayHttpStatus: 409,
        defaultServingFailure: "category_fulfillment_hold"
      },
      verification: {
        focusedRegression: "55/55 PASS",
        restoredPublicBriefingRegression: "PASS",
        fullRegression: "1131/1131 PASS",
        productionChanges: 0
      },
      nextRequired: {
        id: "B6-HUMAN-BLIND-EDITORIAL-PILOT",
        title: "두 검수자의 독립 42행 판정과 불일치 조정",
        acceptance: "reviewer-a와 reviewer-b가 같은 불변 42행을 서로의 답 없이 모두 판정하고 불일치 조정까지 완료한다. 분야 공급과 기본 조합 409는 별도 게이트로 유지한다."
      },
      doesNotProve: ["사람 편집 품질 PASS", "전 분야 공급 충족", "기본 오늘판 서빙 가능", "실제 사용자 만족도", "운영 배포 가능"],
      boundary: "문장·계보 기계 검사를 통과한 사람 검수 입력물을 준비한 단계다. 사람 판정과 분야 공급이 끝나기 전에는 제품 품질 PASS나 운영 승격으로 올리지 않는다."
    },
    purposeAlignmentAdversarialReviewReceipt: {
      stableId: "NOWHOT-PURPOSE-ALIGNMENT-ADVERSARIAL-REVIEW-001",
      state: "hold",
      label: "목적 적합성 HOLD",
      observedAt: "2026-08-11T17:44:27+09:00",
      changeId: "DEVCHG-NOWHOT-20260811-051",
      scope: "current_local_product_against_permanent_product_purpose",
      independence: {
        separateAgentContexts: true,
        reviewersSawOtherVerdicts: false,
        actualNamedCompanyParticipation: false,
        simulatedRoleLenses: true,
        codeMutationAllowed: false
      },
      reviewers: [
        { id: "PAR-R1", label: "Techmeme·Particle 편집 렌즈", score: 46, verdict: "HOLD", focus: "사건 클러스터·중요도·후속 변화·자체 편집" },
        { id: "PAR-R2", label: "Ground News 근거 렌즈", score: 44, verdict: "HOLD", focus: "출처 역할·소유·주장 단위 근거·이월 신뢰" },
        { id: "PAR-R3", label: "뉴닉·네이버 기획 렌즈", score: 57, verdict: "HOLD", focus: "하루 세 번 습관 가치·첫 화면·제품 약속" },
        { id: "PAR-R4", label: "네이버 개발·SRE 렌즈", score: 46, verdict: "HOLD", focus: "스케줄러·조합 폭증·비용·보존·복구" },
        { id: "PAR-R5", label: "네이버 디자인 렌즈", score: 44, verdict: "HOLD", focus: "실제 독자 문장·모바일 밀도·행동 일관성" }
      ],
      score: {
        scale: 100,
        mean: 47.4,
        median: 46,
        kind: "diagnostic_not_product_kpi"
      },
      verifiedFacts: {
        actualElapsedSlots: "2/3",
        humanDoubleReviewedRows: "0/84",
        projectedEveningMachinePass: "42/42",
        projectedEveningReaderRowsFrozen: "0/42",
        activeMorningReviewRows: 42,
        activeMorningDistinctWhyImportant: 14,
        activeMorningDistinctWhyNow: 3,
        activeMorningDistinctWatchNext: 3,
        activeMorningMostRepeatedWatchNext: 33,
        registrySources: 111,
        explicitSourceRoleRows: 3,
        explicitOwnershipGroupRows: 6,
        explicitSyndicationGroupRows: 0,
        codeRegression: "1094/1094"
      },
      commonFindings: [
        { id: "PAR-P1-01", agreement: "5/5", title: "독자 문장 품질이 기계 PASS 범위 밖", detail: "비저장 세 판 검수 패킷은 reader를 동결하지 않은 채 42/42 PASS가 가능하다. 코드 안정성과 기자식 문장 품질을 분리해야 한다." },
        { id: "PAR-P1-02", agreement: "5/5", title: "자체 편집이 사건별 설명보다 상용구 반복에 가까움", detail: "실제 활성 42행에서 왜 중요한가는 14종, 왜 지금은 3종, 다음 확인은 3종뿐이며 한 다음 확인 문장이 33행에 반복됐다." },
        { id: "PAR-P1-03", agreement: "5/5", title: "사람 품질 정답표 부재", detail: "실제 저장 패킷 84행 중 두 사람 독립 완료는 0행이다. 14/14 분야와 42건은 공급량 증거이지 포함 가치·자연스러움·사실성 증거가 아니다." },
        { id: "PAR-P1-04", agreement: "3/5", title: "사건 중요도·후속 변화·주장 근거가 사실 상태 중심이 아님", detail: "관련 보도량과 출처 수 변화가 실제 새 사실·수치·결정과 분리되지 않고, 주장 계보는 문장이 원문으로 지지되는지까지 검증하지 않는다." },
        { id: "PAR-P1-05", agreement: "2/5", title: "신뢰 메타데이터와 이월 정정 상태 공백", detail: "111개 소스 중 명시 역할·소유 그룹은 소수이며 fallback이 많다. 이월 자격에는 정정·철회·후속 반전 상태 확인이 없다." },
        { id: "PAR-P1-06", agreement: "2/5", title: "장기 운영 내구성·비용·조합 상한 미정", detail: "관측 GET의 상태 생성, 단일 프로세스 스케줄러, 무제한 카테고리 조합, 임시 경로 단일 JSON, 일·월 LLM 비용 상한 부재는 현재 5개 조합보다 큰 운영을 증명하지 못한다." }
      ],
      strengths: [
        "실제 07·12시 2/3와 사람 0/84를 PASS로 과장하지 않음",
        "저장 판본·근거 해시·검수 원장을 분리하고 최초 관측을 덮어쓰지 않음",
        "공유 판본·응답 전용 개인화·LLM 0 기본값으로 현재 비용을 통제",
        "현재 슬롯 우선·기제공 URL과 커뮤니티 제외 이월 경계 유지"
      ],
      nextAllowed: [
        "실제 독자 reader payload를 검수 패킷에 그대로 동결하고 화면 동일성을 검증",
        "reader null·미번역 영어·내부 용어·반복 상용구·커뮤니티 보도 표현을 발행 HOLD 조건으로 정의",
        "아침·낮 84행의 실제 2인 독립 검수와 불일치 조정 완료",
        "실제 19시 슬롯은 기존 자동 원장으로 관측하되 성공을 미리 주장하지 않음",
        "독자 품질 기준선 뒤 사건 상태 모델·출처 메타데이터·내구 스케줄러·비용 상한을 순차 폐쇄"
      ],
      stopUntilClosed: [
        "새 소스·카테고리·발행량·LLM 범위 확대",
        "회귀 테스트 수·42/42·14/14를 제품 품질 PASS로 승격",
        "운영 배포·광고·계정·GitHub push"
      ],
      decision: "제품 방향은 유지한다. 다만 현재 단계에서 신규 기능 확장을 멈추고 독자에게 실제로 보이는 편집 품질과 사람 정답표를 먼저 닫는다.",
      boundary: "다섯 검수자는 실제 Techmeme·Ground News·Particle·뉴닉·네이버 임직원이 아니라 서로 분리된 모의 직무 렌즈다. 이 영수증은 로컬 목적 적합성 HOLD이며 운영·광고·계정·배포 승인이나 실제 사람 품질 PASS가 아니다."
    },
    boundaries: [
      "운영 홈·광고·계정·배포에는 반영하지 않음",
      "사람 블라인드 정답표와 운영 승인 전에는 production ready로 부르지 않음",
      "시장·정책은 첫 검증 팩이며 오늘판은 범용 카테고리 구조를 유지"
    ]
  },
  categoryArchitecture: {
    stableId: "NOWHOT-CATEGORY-ARCHITECTURE-001",
    type: "extensible_category_platform",
    label: "범용 개인 브리핑 플랫폼",
    doctrine: "지금핫의 제품 범위는 경제가 아니라 사용자가 선택할 수 있는 모든 관심사다. 공통 엔진은 카테고리에 중립적이고, 분야별 차이는 교체 가능한 정책 팩으로 둔다.",
    layers: [
      { id: "core", label: "범용 코어", detail: "수집·반응 측정·중복 제거·사건 클러스터·다축 선별·LLM 편집·검증·판본" },
      { id: "policyPack", label: "카테고리 정책 팩", detail: "분야별 양질 출처·핫 신호·중요도 기준·검증 조건·편집 형식" },
      { id: "personalEdition", label: "개인 브리핑", detail: "사용자가 고른 카테고리 팩의 검증 재고를 분량 제한 없이 조립" }
    ],
    packContract: [
      "sourcePolicy", "heatSignals", "importanceRules", "verificationTriggers",
      "editorialTemplate", "exclusionRules", "qualityFixtures"
    ],
    examplePacks: [
      { id: "market-policy", label: "경제·정치·주식", state: "first_evidence_pack" },
      { id: "real-estate", label: "부동산", state: "planned_policy_pack" },
      { id: "tech-ai", label: "테크·AI", state: "planned_policy_pack" },
      { id: "society-world", label: "사회·세계", state: "planned_policy_pack" },
      { id: "culture-entertainment", label: "문화·연예", state: "planned_policy_pack" },
      { id: "sports", label: "스포츠", state: "planned_policy_pack" },
      { id: "humor-trends", label: "유머·밈·유행", state: "planned_policy_pack" },
      { id: "knowledge-science", label: "지식·과학", state: "planned_policy_pack" },
      { id: "life-health", label: "생활·건강", state: "planned_policy_pack" },
      { id: "games-hobbies", label: "게임·취미", state: "planned_policy_pack" }
    ],
    boundaries: [
      "시장·정책 파일럿은 제품 전체 정체성·홈 기본값·최종 카테고리 목록이 아니다.",
      "시장 영향 경로 같은 분야 전용 필드는 범용 콘텐츠 계약의 필수값이 될 수 없다.",
      "한 파일럿의 성능으로 다른 카테고리의 품질을 통과했다고 주장하지 않는다."
    ]
  },
  designScore: {
    current: 51,
    target: 85,
    scale: 100,
    kind: "benchmark_assessment",
    state: "invalidated_by_review",
    note: "검수 방법론이 없어 승인 지표에서 제외한 과거 벤치마크 진단"
  },
  northStar: {
    name: "주간 브리핑 충족 이용자",
    definition: "최근 7일 중 3일 이상 방문하고, 방문 시점의 최신 판에서 선택 카테고리의 핵심·변화 영역을 실제로 소비한 사용자",
    state: "measurement_contract_pending",
    label: "측정 계약 대기"
  },
  promises: [
    { id: "NH-G01", title: "명시적 취향", text: "사용자가 고른 카테고리가 일반 브리핑 지면의 주인이 된다." },
    { id: "NH-G02", title: "충분한 분량", text: "선택이 많으면 유효 내용과 페이지 길이가 늘고, 하나면 그 분야를 깊게 제공한다." },
    { id: "NH-G03", title: "하루 세 판", text: "아침·낮·저녁 새 사건과 이전 판 이후의 변화를 제공한다." },
    { id: "NH-G04", title: "자체 맥락", text: "무슨 일·왜 중요·왜 뜨나·왜 내게·달라진 점·관전을 제공한다." },
    { id: "NH-G05", title: "검증 가능", text: "핵심 설명을 공개 출처와 지금핫 측정 근거로 되짚을 수 있다." },
    { id: "NH-G06", title: "국내외 통합", text: "국가보다 중요도·화제성·신뢰·개인 적합도를 기준으로 고른다." },
    { id: "NH-G07", title: "행동은 보조", text: "행동 학습이 명시적 선택을 덮거나 안 고른 분야를 조용히 추가하지 않는다." },
    { id: "NH-G08", title: "장애 내성", text: "수집·LLM·검증이 실패해도 마지막 검증 판본은 계속 읽힌다." }
  ],
  principles: [
    { id: "NH-P01", title: "홈은 제품이다", test: "첫 화면만으로 오늘의 브리핑 가치가 완결되는가" },
    { id: "NH-P02", title: "하나의 서비스다", test: "오늘·실시간·상세·아카이브가 같은 셸을 쓰는가" },
    { id: "NH-P03", title: "사건을 클러스터로 관리한다", test: "같은 사건을 페이지별로 중복 생성하지 않는가" },
    { id: "NH-P04", title: "근거가 해설보다 먼저다", test: "핵심 문장에 출처 또는 측정 근거가 있는가" },
    { id: "NH-P05", title: "사실과 해석을 분리한다", test: "측정·사실·해석·관전이 구분되는가" },
    { id: "NH-P06", title: "오래 가는 수익을 택한다", test: "단기 광고가 신뢰와 재방문을 해치지 않는가" },
    { id: "NH-P07", title: "장애 시에도 읽힌다", test: "새 수집 실패 시 마지막 검증본을 제공하는가" },
    { id: "NH-P08", title: "명시적 취향이 지면을 소유한다", test: "선택 카테고리가 자동 탐색·인기 편향보다 우선하는가" },
    { id: "NH-P09", title: "하루 세 판은 변화 중심이다", test: "같은 설명 대신 이전 판 이후 달라진 점을 제공하는가" },
    { id: "NH-P10", title: "LLM은 근거 안에서 편집한다", test: "모델이 수치·출처 신뢰·사실을 추측하지 않고 주장별 근거를 남기는가" }
  ],
  loop: [
    { id: "collect", label: "수집", detail: "국내외 공개 소스" },
    { id: "snapshot", label: "스냅샷", detail: "반응·속도·출처 변화" },
    { id: "cluster", label: "클러스터", detail: "동일 사건·전재 통합" },
    { id: "score", label: "다축 선별", detail: "화제·중요·신뢰·취향·변화" },
    { id: "edit", label: "LLM 편집", detail: "의미 판정·구조화 문장" },
    { id: "verify", label: "검수", detail: "주장·수치·출처 대조" },
    { id: "edition", label: "판본 재고", detail: "아침·낮·저녁" },
    { id: "compose", label: "개인 조립", detail: "선택 분야·동적 분량" },
    { id: "learn", label: "개선", detail: "열람·저장·평가 신호" },
    { id: "earn", label: "수익", detail: "문맥형 광고·제휴" }
  ],
  routes: [
    { path: "/", role: "최신 개인 브리핑 판본", index: "index", acceptance: "선택 분야의 국내외 필수·화제·유용 정보를 고정 개수 없이 한 페이지에 완결", state: "local_candidate" },
    { path: "/live", role: "같은 셸의 실시간 모드", index: "noindex", acceptance: "홈 복귀·개인화·필터·읽던 위치 보존", state: "local_candidate" },
    { path: "/story/:clusterId", role: "사건 단위 상세", index: "conditional", acceptance: "타임라인·측정 근거·출처·해설·관전", state: "planned" },
    { path: "/briefing", role: "판본 아카이브", index: "index", acceptance: "날짜와 아침·낮·저녁 판본을 탐색하되 오늘 본문을 복제하지 않음", state: "role_change" },
    { path: "/briefing/YYYY-MM-DD", role: "하루 판본 색인", index: "index", acceptance: "해당 날짜의 세 판과 수정 이력을 제공", state: "existing_to_upgrade" },
    { path: "/briefing/YYYY-MM-DD/:edition", role: "검증된 개별 판본", index: "index", acceptance: "발행 당시 근거·구성·이전 판과의 차이를 고정", state: "planned" },
    { path: "/report", role: "방법론·데이터 리포트", index: "index", acceptance: "측정 정의와 한계를 구체적으로 공개", state: "existing_to_upgrade" }
  ],
  contentContract: [
    { field: "clusterId", role: "사건 안정 ID", required: true },
    { field: "categoryIds", role: "복수 선택 분야와 세부 주제", required: true },
    { field: "editionIds", role: "포함된 아침·낮·저녁 판본 ID", required: true },
    { field: "headline", role: "사실과 의미를 담은 지금핫 제목", required: true },
    { field: "whatHappened", role: "교차 확인된 사실 한 문장", required: true },
    { field: "whyImportant", role: "놓치면 잃는 판단·맥락·활용 가치", required: true },
    { field: "whyHot", role: "반응이 지금 커진 측정 근거", required: true },
    { field: "whyForYou", role: "내부 선택·계보 감사용 연결 근거, 독자 화면에서는 숨김", required: false },
    { field: "reader", role: "응답 전용 기자식 제목·리드·중요성·변화·다음 확인 문장", required: false },
    { field: "changedSincePrevious", role: "이전 판 이후 달라진 사실·수치·상태", required: true },
    { field: "scorecard", role: "화제·중요·신뢰·개인 적합·변화 축과 근거", required: true },
    { field: "metrics", role: "독립 출처·플랫폼·반응·속도·가속도·시각", required: true },
    { field: "sourceEvidence", role: "원문·매체·발행 시각·원출처·근거 역할", required: true },
    { field: "sources", role: "기존 호환용 출처 요약, sourceEvidence로 이전", required: false },
    { field: "watchNext", role: "아직 확정되지 않은 다음 확인점", required: false },
    { field: "confidence", role: "근거 충족 상태와 미확인 사유", required: true },
    { field: "publishedAt", role: "처음 공개한 시각", required: true },
    { field: "updatedAt", role: "근거 또는 해설이 마지막으로 바뀐 시각", required: true },
    { field: "corrections", role: "수정 전후·사유·시각", required: false }
  ],
  editionPolicy: {
    countPerDay: 3,
    fixedTimesInBlueprint: false,
    editions: [
      { id: "morning", label: "아침판", role: "밤사이 핵심 변화와 오늘의 관전" },
      { id: "midday", label: "낮판", role: "오전 이후 새 사건과 중요 변화" },
      { id: "evening", label: "저녁판", role: "오늘의 결론·놓친 핵심·다음 관전" }
    ],
    repeatRule: "같은 사건은 실질적인 변화가 있을 때만 다시 등장",
    archiveRule: "판본별 근거 스냅샷·이전 판 차이·검증 상태 보존"
  },
  personalizationPolicy: {
    selectedCategoriesOwnNormalFeed: true,
    automaticUnselectedMixShare: 0,
    globalMustKnowSeparate: true,
    dynamicLengthBySelectionAndSupply: true,
    fixedItemLimit: false,
    qualityFillerAllowed: false,
    behaviorCanSilentlyAddCategory: false,
    oneCategoryRule: "한 분야의 품질 통과 사건을 충분히 제공",
    manyCategoryRule: "선택 수와 유효 후보량에 비례해 길이를 늘리고 중요도·공급량으로 배분",
    pageRule: "한 연속 페이지에서 판본을 완결하고 필수 정보를 더보기 뒤에 숨기지 않음"
  },
  selectionEngine: {
    stableId: "NOWHOT-SELECTION-EDITORIAL-001",
    state: "draft_complete",
    label: "설계 초안 완료",
    doctrine: "코드가 반응을 측정하고, LLM이 근거 안에서 의미를 편집하며, 검증 게이트가 문장과 출처를 대조하고, 일반 코드가 사용자별 판을 조립한다.",
    clusterContract: {
      version: 2,
      mergeRule: "한 문단 결합은 정규화 제목 완전일치 또는 추적값을 제거한 canonical 원문 URL 동일일 때만 허용",
      forbiddenMergeSignals: ["출처 기본 태그", "태그 개수 겹침", "부분 제목 유사도", "같은 카테고리", "같은 발행사"],
      nearDuplicateRule: "변주 제목은 문단을 합치지 않고 발행 이슈 선택 단계에서만 중복 노출을 억제",
      expansionGate: "엔티티·시간·행동을 묶는 사건 후보 확장은 E1 사람 판정으로 오병합률을 증명한 뒤 별도 버전에서 허용",
      safetyPriority: "미결합보다 오병합을 더 큰 오류로 취급"
    },
    stages: [
      { id: "SE01", title: "수집", detail: "국내외 공개 메타데이터·허용된 발췌·원문 URL" },
      { id: "SE02", title: "신호 스냅샷", detail: "언급·댓글·클릭·공유·속도·가속도 시계열" },
      { id: "SE03", title: "정규화", detail: "출처별 기준선·복제·봇·위치 편향 보정" },
      { id: "SE04", title: "사건 클러스터", detail: "완전일치 제목·canonical 원문 URL만 문단 결합, 변주 제목은 노출 중복만 억제" },
      { id: "SE05", title: "다축 선별", detail: "화제·중요·신뢰·개인 적합·변화" },
      { id: "SE06", title: "LLM 편집", detail: "의미 판정·한국어 구조화 초안" },
      { id: "SE07", title: "검증", detail: "주장·수치·출처 지원·충돌 대조" },
      { id: "SE08", title: "판본·개인 조립", detail: "공용 재고를 선택 분야와 동적 분량으로 구성" }
    ],
    scoreAxes: [
      { id: "heat", label: "화제성", question: "지금 얼마나 빠르게 퍼지는가", evidence: "속도·가속도·플랫폼 폭·정규화 반응" },
      { id: "importance", label: "중요도", question: "놓치면 어떤 판단이나 맥락을 잃는가", evidence: "영향 범위·지속성·의사결정 가치" },
      { id: "trust", label: "신뢰 근거", question: "현재 설명을 어느 정도 확신할 수 있는가", evidence: "원출처·독립 교차 확인·정정 근거" },
      { id: "personalFit", label: "개인 적합", question: "명시한 관심사에 얼마나 맞는가", evidence: "선택 카테고리·세부 주제·제외 설정" },
      { id: "change", label: "변화", question: "이전 판 이후 무엇이 달라졌는가", evidence: "새 사실·수치·상태·근거 변화" }
    ],
    lanes: [
      { id: "mustKnow", label: "반드시 알아야 함", rule: "중요도·신뢰도가 높음" },
      { id: "hotNow", label: "지금 뜨는 중", rule: "속도·가속도·독립 출처 폭이 높음" },
      { id: "usefulForYou", label: "내게 유용함", rule: "개인 적합·활용 가치가 높음" },
      { id: "cultureAndFun", label: "유머·유행", rule: "공유·댓글·플랫폼 확산이 강함" },
      { id: "globalMustKnow", label: "전체 필수", rule: "선택 밖이지만 영향·신뢰 문턱이 매우 높고 별도 표시" }
    ],
    sourceTrustFields: [
      "sourceId", "ownershipGroup", "syndicationGroup", "sourceRole",
      "authorityByCategory", "originalityEvidence", "correctionEvidence",
      "availableSignals", "engagementReliability", "observedAt"
    ],
    llmRoles: [
      { id: "classifier", role: "카테고리·주제·클러스터 후보", modelClass: "저비용 분류" },
      { id: "judge", role: "중요 이유·영향 대상·불확실성 제안", modelClass: "근거 제한 판단" },
      { id: "editor", role: "한국어 브리핑 구조화 초안", modelClass: "고품질 편집" },
      { id: "verifier", role: "주장별 지원·충돌·미지원 판정", modelClass: "독립 검증" }
    ],
    llmProhibitions: [
      "댓글·클릭·공유·출처 수 추측",
      "모델 인상만으로 출처 신뢰도 결정",
      "근거 없는 인과·의도·미래 결과 단정",
      "사용자마다 전체 브리핑 재생성",
      "모델 응답만으로 발행 완료 선언"
    ],
    categoryPolicies: [
      { category: "경제·정치·주식", priority: "양질 보도·시장 영향·속도·중요 사실 선택 검증", caution: "루머·이해상충·정파적 소음" },
      { category: "부동산", priority: "정부·지자체·정책 원문·지역 영향", caution: "광고성 매물·지역 과대표집" },
      { category: "테크·AI", priority: "전문 매체·원문·공식 발표·개발자 반응", caution: "보도자료 복제·미래 과장" },
      { category: "사회·세계", priority: "독립 출처·직접 인용·영향 범위", caution: "속보 오보·동일 출처 중복" },
      { category: "문화·연예", priority: "공식 발표·현장 취재·대중 반응", caution: "사생활 침해·팬덤 중복" },
      { category: "스포츠", priority: "공식 기록·경기 맥락·팬 반응", caution: "낚시 이적설·결과 중복" },
      { category: "유머·밈·유행", priority: "속도·플랫폼 폭·공유·댓글", caution: "재업로드·조작·맥락 손실" },
      { category: "지식·과학", priority: "논문·전문가·원출처·인용", caution: "단일 연구 과장·인과 오독" },
      { category: "생활·건강", priority: "실용성·전문 근거·최신성", caution: "위험 조언·광고성 정보" },
      { category: "게임·취미", priority: "공식 업데이트·커뮤니티 확산·실사용 맥락", caution: "내부자 루머·과도한 세부 편향" }
    ],
    qualityGates: [
      { id: "criticalMissRate", label: "중대 사건 누락률" },
      { id: "selectedCoverageRate", label: "선택 분야 유효 후보 포함률" },
      { id: "independentSourceRate", label: "독립 출처 교차 확인률" },
      { id: "duplicateClusterRate", label: "중복 클러스터율" },
      { id: "unsupportedClaimRate", label: "근거 없는 LLM 주장률" },
      { id: "materialRepeatRate", label: "무변화 판본 반복률" },
      { id: "detectionLatency", label: "중요 사건 탐지 지연" },
      { id: "correctionRate", label: "수정·철회율" }
    ],
    costControls: [
      "수치 관문과 유사도로 LLM 전 후보 축소",
      "저비용 분류와 고품질 편집 역할 분리",
      "clusterId + evidenceHash 캐시",
      "변화가 생긴 클러스터만 증분 처리",
      "사용자별 조립은 LLM 없이 수행",
      "비용 초과·실패 시 마지막 검증 재고로 폴백"
    ]
  },
  adversarialReview: {
    stableId: "NOWHOT-ADVERSARIAL-REVIEW-001",
    state: "hold",
    label: "HOLD",
    decision: "독립 검수 당시 B2 운영 후보는 HOLD였다. 이후 David가 로컬 복제본의 가역적 고도화를 승인해 기존 제품의 자체 편집 후보만 구현하며, 사람 검수와 운영 전환 HOLD는 유지한다.",
    execution: {
      independentSeats: 6,
      preservedLenses: 7,
      reusedFollowUpLenses: 1,
      newSeatsAfterCostInstruction: 0,
      allIndependentVerdicts: "hold"
    },
    score: { mean: 26.8, median: 26, scale: 50, kind: "diagnostic_not_kpi" },
    reviewers: [
      { id: "R1", label: "Techmeme", score: 26, verdict: "HOLD", independent: true, focus: "클러스터 관계·병합·분할 정답 계약" },
      { id: "R2", label: "Ground News", score: 26, verdict: "HOLD", independent: true, focus: "독립 출처·소유·보도 차이 설명" },
      { id: "R3", label: "Particle", score: 26, verdict: "HOLD", independent: true, focus: "주장 단위 원문 근거·검증 이관" },
      { id: "R4", label: "뉴닉", score: 28, verdict: "HOLD", independent: true, focus: "세 판 목적·읽기 예산·한국어 편집" },
      { id: "R5", label: "네이버 개발", score: 25, verdict: "HOLD", independent: true, focus: "계보·원자 발행·SLO·비용 상한" },
      { id: "R6", label: "네이버 기획", score: 30, verdict: "HOLD", independent: true, focus: "초기 사용자·첫 주 가치·중단 기준" },
      { id: "R7", label: "네이버 디자인", score: null, verdict: "HOLD 지지", independent: false, focus: "390px 정보 예산·상태·접근성 보충" }
    ],
    commonFindings: [
      { id: "AR-P0-01", title: "주장·출처 계보 계약 부재", agreement: "독립 3", detail: "claimId에서 원문 구절과 검증 버전까지 재현할 계약이 없다." },
      { id: "AR-P0-02", title: "클러스터 정답·되돌리기 계약 부재", agreement: "독립 4", detail: "사건 관계, 병합·분할, 대표 보도 선택과 수정 기준이 없다." },
      { id: "AR-P0-03", title: "초기 사용자·세 판·읽기 예산 미검증", agreement: "독립 3 + 보충 1", detail: "모든 분야와 동적 장문, 세 완결판을 동시에 약속했다." },
      { id: "AR-P0-04", title: "원자 발행·SLO·비용·인간 이관 부재", agreement: "독립 3", detail: "실패를 격리하고 마지막 검증판을 지킬 운영 계약이 없다." }
    ],
    keep: [
      "명시적으로 선택한 관심사가 일반 지면을 소유",
      "국내외 사건 클러스터와 사실·해석·불확실성 분리",
      "마지막 검증 판본 폴백과 변경·정정 이력"
    ],
    beachhead: {
      stableId: "NOWHOT-MARKET-POLICY-BEACHHEAD-001",
      role: "first_category_evidence_pack",
      scopeNotice: "시장·정책은 범용 지금핫 엔진을 검증하는 첫 카테고리 팩이며 제품 전체 정체성이나 홈 기본값이 아니다.",
      coreBoundary: "시장 영향 경로와 투자자 출력은 이 팩 안에서만 필수이며 범용 콘텐츠 계약에는 강제하지 않는다.",
      audience: "국내외 주식 투자자",
      category: "시장·정책",
      promise: "금리·환율·정책·기업·수급의 변화가 어떤 자산과 업종에 어떤 경로로 연결되는지 사실과 불확실성을 나눠 제공한다.",
      desks: [
        { id: "macro", label: "거시경제", includes: "금리·물가·고용·GDP·환율·유동성" },
        { id: "policy", label: "정책·정치", includes: "예산·세금·규제·무역·선거 결과·지정학" },
        { id: "company", label: "기업·산업", includes: "공시·실적·가이던스·M&A·투자·보조금·공급망" },
        { id: "market", label: "시장", includes: "주식·채권·외환·원자재·변동성·자금 흐름" }
      ],
      impactChannels: [
        "금리·채권", "환율", "유동성·재정", "세금·규제",
        "무역·공급망", "실적·밸류에이션", "리스크 프리미엄"
      ],
      eligibility: {
        rule: "확인 사건, 한 개 이상의 시장 영향 경로, 영향 자산·국가·업종·기업군이 모두 있어야 통과",
        sourceRule: "양질의 독립 보도를 기본으로 묶고, 중요 수치·공시·정책·출처 충돌만 공식 자료로 선택 확인",
        politicalRule: "정치 일반은 제외하고 정책·선거·지정학 결과가 시장 영향 경로를 통과할 때만 포함"
      },
      exclude: [
        "시장 연결이 없는 정당 공방·인물 동정·지지율 순위",
        "가격 움직임만 반복하는 시황 기사",
        "출처 없는 루머·목표가 받아쓰기·매수매도 추천",
        "같은 보도자료 전재를 독립 확인으로 계산한 내용"
      ],
      outputs: [
        "확인된 사건", "이전 판 이후 변화", "시장 영향 경로", "영향 자산·업종",
        "관측된 가격·수급 반응", "반대 근거·불확실성", "다음 확인 일정", "원문 근거"
      ],
      sourceSample: MARKET_POLICY_SOURCE_SAMPLE
    },
    simplify: [
      "범용 엔진의 첫 증거 실험만 국내외 주식 투자자용 시장·정책 팩으로 제한하고 제품 범위는 제한하지 않음",
      "LLM은 생성자·독립 검증자 두 단계부터 시작",
      "51→85 설계 점수와 단일 신뢰 점수를 승인 지표에서 제외"
    ],
    experiments: [
      { id: "E1", title: "첫 카테고리 팩 클러스터·근거 골든팩", detail: "시장·정책 파일럿 문서를 분야·근거 유형·출처 역할·변화 상태로 층화하고, 파일럿 불일치율과 목표 정밀도·검수 예산으로 동결 규모를 정한다. 두 사람이 같은 manifest를 블라인드 표기해 포함·제외, 사건 관계, 독립 출처, 주장 근거와 영향 경로를 함께 평가한다. 이 결과는 범용 코어의 일부 능력만 증명하며 다른 카테고리의 품질을 대신하지 않는다.", proves: "범용 클러스터 기초·파일럿 정책" },
      { id: "E2", title: "390px 투자자 세 판 정적 A/B", detail: "주식 투자자 12명이 세 완결판과 아침 완결판+변화판을 비교해 재방문·반복·읽기 예산을 검증한다.", proves: "JTBD·판본·모바일 밀도" },
      { id: "E3", title: "7일 그림자 재생·장애 주입", detail: "E1에서 동결한 같은 manifest에 20% 실패를 주입해 출력 해시, 폴백, p95 지연, 누락과 비용을 기록한다.", proves: "SLO·비용·장애 내성" }
    ],
    candidateGates: [
      "pair-F1 ≥ 0.92 · 중대 오병합 ≤ 0.5%",
      "주장 인용 100% · 검증기 오통과 ≤ 1%",
      "중요 사건 탐지 p95 ≤ 15분 · 누락 ≤ 5%",
      "중복 ≤ 2% · 무변화 반복 ≤ 5%"
    ],
    hardFacts: [
      "독립 검수 6개가 모두 HOLD를 판정",
      "동적 후보·정규화 URL·운영 소스 그룹은 로컬 런타임에 연결됐지만 사람 정답표와 완전한 소유·전재·데스크 메타데이터는 아직 없다",
      "E1 평가 코퍼스는 사전 고정 건수가 아니라 층화·정밀도·검수 예산으로 규모를 정하며 제품 후보 수나 품질 PASS 기준이 아니다",
      "R7은 기존 좌석 재사용 보충 검수이므로 독립 평균에서 제외",
      "시장·정책은 첫 검증 팩일 뿐 지금핫의 제품 범위나 전문 분야가 아님"
    ]
  },
  benchmarks: [
    { rank: 1, name: "Techmeme", score: 89, adopt: "고밀도 사건·출처 클러스터" },
    { rank: 2, name: "Ground News", score: 85, adopt: "다중 출처 상세와 투명성" },
    { rank: 3, name: "Particle", score: 83, adopt: "출처 수·최신성·한 문장 의미" },
    { rank: 3, name: "뉴닉", score: 83, adopt: "읽기 쉬운 자체 브리핑" },
    { rank: 5, name: "Google Trends", score: 81, adopt: "상승률·시작 시각·활성 상태" },
    { rank: 6, name: "네이버 뉴스 랭킹", score: 76, adopt: "익숙한 탭·순위·시간" }
  ],
  phases: [
    { id: "B0", title: "영구 제품헌장", gate: "사명·약속·비목표 확인", state: "current", label: "정본 유지" },
    { id: "B1", title: "시스템 블루프린트", gate: "정보 구조·클러스터 계약·장애 원칙 확인", state: "current", label: "정본 유지" },
    { id: "B1.5", title: "선별·편집 엔진", gate: "동적 런타임 후보와 E1 층화 평가 코퍼스를 분리", state: "local_machine_observation", label: "기계 관측" },
    { id: "B2", title: "실데이터 와이어프레임", gate: "기존 브리핑을 충분한 개인판으로 확장", state: "legacy_local_implementation_complete", label: "기존 구현 완료·현재 실행 검증 별도" },
    { id: "B3", title: "공통 셸·통합 홈", gate: "오늘·실시간 왕복과 모바일 밀도", state: "complete_local", label: "로컬 구현 완료" },
    { id: "B4", title: "클러스터 파이프라인", gate: "고정밀 문단 결합과 별도 근접 중복 억제의 독립 편집 판정", state: "local_review_complete_with_holds", label: "독립 AI 84/84·과거 패킷 HOLD·미래 판 수리" },
    { id: "B5", title: "로컬 릴리스 후보", gate: "독자 문장·분야 공급·정상 서빙", state: "local_user_test_ready_with_limits", label: "로컬 실사용 가능·다일/실이용자 검증 대기" },
    { id: "B6", title: "운영 전환", gate: "David 배포 승인·롤백 영수증", state: "blocked", label: "금지" }
  ],
  requirements: [
    { id: "NH00-CHARTER", title: "영구 사명·사용자 약속·비목표", state: "draft_complete", label: "초안 완료" },
    { id: "NH01-BENCHMARK", title: "국내외 본보기 점수화", state: "complete", label: "완료" },
    { id: "NH02-BLUEPRINT", title: "정보 구조·데이터·수익·장애 설계", state: "draft_complete", label: "초안 완료" },
    { id: "NH03-ADMIN-SURFACE", title: "관리자 개발관리 투영 화면", state: "complete", label: "로컬 검증 완료" },
    { id: "NH04-BLUEPRINT-API", title: "관리자 전용 구조화 API", state: "complete", label: "로컬 검증 완료" },
    { id: "NH09-SELECTION-EDITORIAL", title: "다축 선별·출처 신뢰·LLM 편집·검증·하루 세 판 설계", state: "draft_complete", label: "초안 완료" },
    { id: "NH10-ADVERSARIAL-CLOSURE", title: "독립 적대적 검수 P0 폐쇄와 저비용 증거 실험", state: "hold", label: "HOLD" },
    { id: "NH11-MARKET-POLICY-BEACHHEAD", title: "투자자용 시장·정책 범위와 영향 자격 게이트", state: "draft_complete", label: "설계 반영" },
    { id: "NH12-MARKET-POLICY-SOURCE-AUDIT", title: "시장·정책 파일럿의 보도·검증 앵커 공급 공백과 연결 순서", state: "hold", label: "입력 HOLD" },
    { id: "NH13-CATEGORY-PLATFORM-BOUNDARY", title: "범용 코어·카테고리 정책 팩·첫 파일럿 경계", state: "complete", label: "로컬 검증 완료" },
    { id: "NH14-MARKET-POLICY-SOURCE-SAMPLE", title: "네 데스크 보도 20건·선택적 공식 확인 5건 재현 표본", state: "complete_with_limits", label: "표본 완료·한계 기록" },
    { id: "NH15-EDITION-CANDIDATE-CONTRACT", title: "기존 수집물의 동적 중복·출처·카테고리 편집 재료 계약", state: "complete_with_limits", label: "기계 관측·사람 검수 대기" },
    { id: "NH16-LOCAL-EDITORIAL-EDITION", title: "기존 브리핑 자체 콘텐츠 확장과 개인 오늘판", state: "local_qa_pass_with_limits", label: "기계 QA 통과·한계" },
    { id: "NH17-EDITORIAL-QUALITY-GATE", title: "헤드라인·출처·교차확인 표현·편집 맥락 기계 게이트", state: "local_qa_pass_with_limits", label: "실데이터 기계 QA 통과·한계" },
    { id: "NH18-BLIND-REVIEW-PACKET", title: "현재 판 동적 블라인드 검수 패킷과 별도 E1 평가 경계", state: "human_annotation_ready", label: "사람 표기 준비·미완료" },
    { id: "NH19-EDITION-CHANGE-CONTRACT", title: "직전 저장 판 대비 새 사건·근거 변화·반응 변화·무변화 판정과 반복 억제", state: "implemented_local_candidate", label: "로컬 구현·세 슬롯 리플레이 대기" },
    { id: "NH20-HUMAN-REVIEW-LEDGER", title: "패킷·판본·검수자별 독립 사람 검수 입력과 로컬 보존", state: "human_annotation_ready", label: "입력 경로 준비·실제 표기 0" },
    { id: "NH21-SLOT-AS-OF", title: "모닝·런치·이브닝 판을 각 KST 발행 시각 기준으로 생성하고 이후 항목을 제외", state: "implemented_local_candidate", label: "고정 시계 테스트 통과" },
    { id: "NH22-EDITORIAL-INVENTORY", title: "선택 카테고리 조합별 공유 판본 재고와 제한 누락 백필", state: "implemented_local_candidate", label: "로컬 구현·실시간 누적 관측 대기" },
    { id: "NH23-ELAPSED-SLOT-LEDGER", title: "날짜·슬롯별 최초 실행 시각·지연·재고·내용 지문 영구 원장", state: "implemented_local_candidate", label: "수집 경로 구현·실제 세 슬롯 대기" },
    { id: "NH24-HUMAN-REVIEW-ADJUDICATION", title: "2인 독립 검수의 필드 일치·불일치·별도 조정·최종 품질 판정", state: "human_annotation_ready", label: "조정 원장·UI 구현·실제 표기 0" },
    { id: "NH25-EDITORIAL-LINEAGE", title: "문장별 원문·측정·명시 선택·편집 판단 계보와 안정 근거 해시", state: "implemented_local_candidate", label: "기계 계보·변조 검출 테스트 통과" },
    { id: "NH26-EDITORIAL-LLM-RUNTIME", title: "판본 배치 편집·독립 검증·근거 해시 캐시·결정론적 폴백", state: "complete_with_limits", label: "단발 canary dry-run 통과·실호출 대기" },
    { id: "NH27-PERSONALIZATION-INTEGRITY", title: "선택 분야별 공급·발행 충족도와 등록 카테고리 분류 무결성", state: "local_qa_pass_with_limits", label: "실데이터 오염 0·공급 공백 정직 표시" },
    { id: "NH28-DYNAMIC-EDITION-DENSITY", title: "선택 분야 수에 비례한 14~42건 판본과 공급 분야 최소 깊이", state: "local_machine_observation", label: "v13 42건·14/14 충족 관측·사람 품질 HOLD" },
    { id: "NH29-LATE-BACKFILL-ASOF", title: "과거 슬롯을 48시간 누적 풀에서 as-of 우선으로 복원", state: "local_machine_observation", label: "상한 밖 과거 후보 복원 관측·정시 증거 대기" },
    { id: "NH30-HISTORICAL-CATEGORY-PARITY", title: "현재판·과거판 동일 항목 분류와 명시 정치 선택 투영", state: "local_machine_observation", label: "현재·과거 분류 대조·정치 0→충족 관측" },
    { id: "NH31-SEGMENT-ELAPSED-EVIDENCE", title: "공유 카테고리 조합별 정시·발행·분야 충족·내용 지문 세 슬롯 증거", state: "implemented_local_candidate", label: "조합별 원장 구현·실제 세 슬롯 대기" },
    { id: "NH32-INDEPENDENT-CORROBORATION", title: "원시 피드와 운영그룹을 분리한 교차관측·가산점·문구 계약", state: "local_machine_observation", label: "v11 교차관측 1건 오병합 확인·v12 0건" },
    { id: "NH33-CATEGORY-SUPPLY-DIVERSITY", title: "부족 분야의 국내외 일반 뉴스 공급과 상한 해제 시 출처 균형", state: "local_machine_observation", label: "게임 25후보·14이슈·일반 뉴스 7/6 균형 관측" },
    { id: "NH34-EVIDENCE-WORDING-BOUNDARY", title: "관련 보도 묶음 신호와 직접 확인 원문 수를 사용자 문장에서 분리", state: "local_machine_observation", label: "단일 직접 원문을 복수 확인처럼 쓰지 않음" },
    { id: "NH35-CANDIDATE-QUALITY-FUNNEL", title: "선택 분야별 수집 후보·기계 유효 클러스터·초안·최종 이슈 손실 구간", state: "local_machine_observation", label: "원문 수와 발행 가능 이슈 수 분리·사람 품질 HOLD" },
    { id: "NH36-QUALIFIED-SOURCE-REPAIR", title: "과학 복수 보도 공급·근거 우선과 패션 섹션 피드 순도 복구", state: "local_machine_observation", label: "과학 0→7 이슈·패션 종합 피드 차단·사람 품질 HOLD" },
    { id: "NH37-SLOT-SCHEDULER-OBSERVABILITY", title: "자동 슬롯 감시 활성·다음 정시창·도래 후 누락 가시화", state: "local_code_qa_pass_with_limits", label: "실제 07·12·19시 관측·다음 07시 대기·스케줄러 단독 인과 별도" },
    { id: "NH38-IMMUTABLE-HUMAN-REVIEW", title: "슬롯이 바뀌어도 같은 검수 행을 유지하는 불변 패킷·진행 중 교체 차단·답 비공개", state: "implemented_local_candidate", label: "저장·재시작·API·관리자 경로 구현" },
    { id: "NH39-EDITORIAL-SEMANTIC-QUALITY", title: "완결 사건명·원제목 보존·분야 우선 판단가치·실제 판촉 사례 차단", state: "local_code_qa_pass_with_limits", label: "집중 101/101·전체 1,062/1,062·실제 다음 슬롯 대기" },
    { id: "NH40-EDITORIAL-EVENT-DIVERSITY", title: "실제 사건 제목 변주 1건화·일반어 오병합 방지·스포츠 하위 판단가치", state: "local_code_qa_pass_with_limits", label: "저장판 91제목·중복 4쌍 감사·전체 1,062/1,062·실제 다음 슬롯 대기" },
    { id: "NH41-EDITORIAL-CATEGORY-FIT", title: "잘못 라벨된 후보의 대표 승격 차단·사건 중심 제목·불완전 절단 보류", state: "local_code_qa_pass_with_limits", label: "주입 12시 모사 14/14·42건·감사 오분류 선택 0·실제 슬롯 대기" },
    { id: "NH42-SLOT-CAPTURE-INTEGRITY", title: "핵심 공유조합 우선·슬롯 변화 계보·재고 완료시각 기준 정시 증거", state: "hold", label: "실제 3/3 정시·서로 다른 내용·전체 조합 분야 충족 실패로 overall HOLD" },
    { id: "NH43-EDITORIAL-RELIABILITY-HISTORY", title: "최근 날짜별 정시·누락·완결·내용 변화·분야 보류 신뢰도 원장", state: "local_code_qa_pass_with_limits", label: "집중 25/25·실제 다일 이력 축적 대기" },
    { id: "NH44-REPLAY-FULFILLMENT-PREFLIGHT", title: "비저장 세 슬롯 재생의 선택 분야 충족·보류 사전점검", state: "local_code_qa_pass_with_limits", label: "12시 현재 풀 14/14 모사 뒤 실제 12시 동적 충족 관측" },
    { id: "NH45-CATEGORY-SEMANTIC-LEAK-GUARD", title: "실제 후보의 사건·문화행사·협찬 보도 분야 의미 누수 차단", state: "local_code_qa_pass_with_limits", label: "실제 12시 표적 누수 0·14/14·42건·사람 품질 별도 HOLD" },
    { id: "NH46-ACTUAL-LUNCH-SEMANTIC-AUDIT", title: "실제 12시 시스템 판의 정시·동적 충족과 사람 관점 결함 분리 감사", state: "local_code_qa_pass_with_limits", label: "실제 2/3·12시 14/14·42건·사람 품질 HOLD·미래 판 가드 준비" },
    { id: "NH47-ACTUAL-LUNCH-FULL-AUDIT", title: "실제 낮 판 42건 전체 필드 감사와 미래 판 문맥·중복·조사 가드", state: "local_code_qa_pass_with_limits", label: "관측 42건 전수 감사·영향 행 23건·사람 품질 HOLD·실제 19시 대기" },
    { id: "NH48-PROJECTED-EDITION-PREFLIGHT", title: "다음 슬롯 비저장 후보 행 감사와 표적 결함 교정", state: "local_code_qa_pass_with_limits", label: "이브닝 투영 42행·열거 표적 결함 0·11/14 충족·패션 없음·과학/예술 부족·실제 19시 대기" },
    { id: "NH49-DYNAMIC-REPLACEMENT-REAUDIT", title: "품질 보류 뒤 대체 후보까지 다시 감사하는 동적 판본 재검수", state: "local_code_qa_pass_with_limits", label: "관측 42행은 목표 아님·표적 0·10/14·패션 없음·자동차/과학/예술 부족·실제 19시 대기" },
    { id: "NH50-EDITORIAL-QUALITY-HISTORY", title: "불변 저장 판의 슬롯별 기계 품질·계보·근거 유형·사람 검수 이력", state: "local_code_qa_pass_with_limits", label: "고정 건수 없음·실제 3슬롯 누적·다일·2인 검수 대기" },
    { id: "NH51-RESPONSE-ONLY-PERSONALIZATION", title: "사용자 중립 공유 판본과 선택 분야 내부 응답 전용 취향 재정렬", state: "local_code_qa_pass_with_limits", label: "집중 20/20·전체 1,081/1,081·사용자 설정 혼입 차단·수량/내용 불변·사용자별 LLM 0" },
    { id: "NH52-EDITORIAL-CONTINUITY-READER-COPY", title: "인접 판 동일 사건 연속성·독자용 보도 문체·왜 내게 화면 숨김", state: "local_code_qa_pass_with_limits", label: "호르무즈 모닝→런치 연속성 회귀·원본/계보 불변·LLM 0·사람 품질 HOLD" },
    { id: "NH53-UNIFIED-VIEW-SWITCH", title: "오늘·실시간 고정 상단 메뉴와 활성 표시선 전환 모션", state: "local_code_qa_pass_with_limits", label: "같은 순서·같은 위치·210ms 표시선 이동·모션 축소 즉시 전환" },
    { id: "NH54-EDITORIAL-REVIEW-DESK", title: "독자 화면 문장·원문 근거를 한 건씩 판정하는 독립 편집 데스크", state: "local_code_qa_pass_with_limits", label: "현재 검수자만·자동 저장·미완료/보류 필터·기계 판정 비노출" },
    { id: "NH55-READER-QUALITY-FEEDBACK", title: "최근 세 판 사건 연속성·독자 품질 결함의 미래 판 자동 되먹임", state: "local_code_qa_pass_with_limits", label: "비저장 저녁 후보 237→품질 보류 24·근접중복 36·42건 편성·과학 1/2 정직 표시" },
    { id: "NH56-UNSERVED-QUALITY-CARRYOVER", title: "미제공 보도형 재고의 24시간 제한 이월", state: "local_code_qa_pass_with_limits", label: "실제 19시 저장·전체 조합 부동산/기본 조합 유머 부족·사람 품질 HOLD" },
    { id: "NH57-PURPOSE-ALIGNMENT-ADVERSARIAL-REVIEW", title: "현재 로컬판의 영구 제품 목적 적합성 독립 재검수", state: "hold", label: "독립 5/5 HOLD·평균 47.4/100·독자 품질 폐쇄 우선" },
    { id: "NH58-READER-PAYLOAD-FREEZE-GATE", title: "독자 화면 문장 불변 동결·행 품질·판 전체 반복 이중 게이트", state: "hold", label: "reader 42/42 동결·행 41/42·판 반복 HOLD·사람 0/84" },
    { id: "NH59-READER-EVENT-FRAME-COPY", title: "사건별 중요성·다음 확인 편집과 계약·판정 포함 불변 패킷 식별", state: "hold", label: "행 41/42·판 반복 PASS·세 슬롯 정시 3/3·분야 충족 HOLD·모의 독립 렌즈 5/5 HOLD·사람 0/84" },
    { id: "NH60-INDEPENDENT-ADVERSARIAL-AUDIT", title: "분리 Codex 검수자의 신뢰·편집·개인화·서빙 적대검수", state: "blocked", label: "1 BLOCK·2 HOLD·평균 46/100·거짓 신뢰 PASS P0 2건 직접 재현" },
    { id: "NH61-COUNTEREXAMPLE-REPAIR", title: "계보 변조·검증 없는 캐시·변화 누락·평가 해제 핵심 반례 수리", state: "local_code_qa_pass_with_limits", label: "4/4 RED→GREEN·전체 1,107/1,107·독립 재검수 대기" },
    { id: "NH62-INDEPENDENT-REAUDIT", title: "핵심 반례 수리 뒤 신뢰·편집·개인화·실제 서빙 독립 재검수", state: "blocked", label: "2 BLOCK·1 HOLD·평균 46/100·HOLD 판 HTTP 200 서빙 P0 확인" },
    { id: "NH63-SERVEABLE-EDITION-GATE", title: "정확 응답 검수·동일 분야 검증판·409 fail-closed 서빙", state: "local_code_qa_pass_with_limits", label: "정확 응답·24시간 동일 분야 검증판·없으면 409·지문 변조 차단" },
    { id: "NH64-READER-LINEAGE-GROUNDING", title: "paragraph·독자 7필드 현재 근거 지문과 중요성·변화 주장 결박", state: "local_code_qa_pass_with_limits", label: "paragraph 변조·7/7 필드 변조·근거 없는 중요성/변화 HOLD·전체 1,117/1,117" },
    { id: "NH65-EVENT-CONTINUITY-FRAME-GROUNDING", title: "최근 판 사건 개념 연속성·관련기사 정체성/프레임 오염 차단", state: "local_code_qa_pass_with_limits", label: "호르무즈 연속·갤럭시 분리·관련기사 주 사건 claim/프레임 제외·전체 1,121/1,121" },
    { id: "NH66-CATEGORY-UNIQUE-FULFILLMENT", title: "다중 분야 최종 이슈의 단일 분야 배정과 고유 사건 최소 깊이", state: "local_code_qa_pass_with_limits", label: "중복 충족 3개 반례 폐쇄·서빙 fail-closed·전체 1,125/1,125" },
    { id: "NH67-FEEDBACK-ROLLBACK-INTEGRITY", title: "묵시 신호가 끼어도 명시 평가 해제 시 특징·확신·저장 상태 정확 원복", state: "local_code_qa_pass_with_limits", label: "대조 사용자·재시작 일치·로컬 365/365 무추정 이행 가능·전체 1,126/1,126" },
    { id: "NH68-PERSONALIZATION-UTILITY-EVIDENCE", title: "동일 공유 판본의 상단 개인화 대리 효용과 출처·분야 다양성 가드", state: "local_offline_proxy_pass_with_limits", label: "실제 28건 판 상위10 할인 선호 +0.0298·출처10/10·분야4/4·손실 반례 공유순서 폴백·전체 1,127/1,127" },
    { id: "NH69-HUMAN-BLIND-EDITORIAL-PILOT-READY", title: "당시 계약 불변 판본과 2인 독립 검수 패킷 준비", state: "historical_receipt_not_runtime_restored", label: "v17 이브닝 42/42 영수증 보존·현재 런타임 미복원" },
    { id: "NH70-REVIEW-PACKET-PERSISTENCE", title: "같은 42행의 영구 고정과 재시작 복원", state: "local_runtime_pass", label: "BRP-07rqta4·42행·재시작 동일 지문·독립 검수 PASS" },
    { id: "NH71-INDEPENDENT-EDITORIAL-REVIEW", title: "A·B 독립 84개 판정과 불일치 조정", state: "local_review_complete_with_holds", label: "독립 AI 84/84·16필드 조정·과거 패킷 4 PASS/38 HOLD·미래 판 수리" },
    { id: "NH72-DEFAULT-SUPPLY-RECOVERY", title: "유머 포함 기본 조합과 부족 분야 공급 복구", state: "local_runtime_pass", label: "기본 4/4·28건, 전체 14/14·42건·v21·독립 검수 PASS" },
    { id: "NH73-DEFAULT-TODAY-SERVEABLE", title: "재시작 뒤 기본 오늘판 HTTP 200", state: "local_runtime_pass", label: "HTTP 200·28건·재시작 동일·LAN/390px 정상·독립 검수 PASS" },
    { id: "NH74-CATEGORY-COMBINATION-SERVEABILITY", title: "관심 분야 선택 수·조합별 정상 서빙", state: "local_runtime_pass", label: "단일 14/14·두 분야 91/91·3~14개 층화 34/34 HTTP 200" },
    { id: "NH75-ADDITIVE-CATEGORY-UNION", title: "선택 분야별 상위 이슈 합집합과 중요도 혼합", state: "local_runtime_pass", label: "경제+과학 28건·14/14·고유 사건 28/28·390px 정상" },
    { id: "NH05-WIREFRAME", title: "실데이터 홈 와이어프레임", state: "local_qa_pass_with_limits", label: "실데이터·시각 QA 통과" },
    { id: "NH06-UNIFIED-SHELL", title: "오늘·실시간 공통 셸", state: "local_qa_pass_with_limits", label: "왕복 동선 QA 통과" },
    { id: "NH07-CLUSTER", title: "사건 클러스터 계약·파이프라인", state: "local_machine_observation", label: "v12 오병합 2건 제거·240→239 사건·사람 검수 대기" },
    { id: "NH08-RELEASE", title: "로컬 후보와 운영 전환", state: "blocked", label: "금지" }
  ],
  notNow: [
    "운영 main 배포와 GitHub push",
    "LLM의 인상만으로 만든 편향·출처 신뢰 점수",
    "사용자별 전체 브리핑 실시간 재생성",
    "대화형 AI 질문 기능",
    "새 결제·구독 시스템",
    "관리자에서 블루프린트를 직접 수정하는 쓰기 기능"
  ],
  sourceFiles: [
    { kind: "영구 제품헌장", path: "docs/00_NOWHOT_PRODUCT_CHARTER.md" },
    { kind: "시스템 블루프린트", path: "docs/01_NOWHOT_SYSTEM_BLUEPRINT.md" },
    { kind: "선별·편집 엔진", path: "docs/02_NOWHOT_SELECTION_EDITORIAL_ENGINE.md" },
    { kind: "적대적 검수 프로토콜", path: "docs/03_NOWHOT_ADVERSARIAL_REVIEW_PROTOCOL.md" },
    { kind: "적대적 검수 결과", path: "docs/04_NOWHOT_ADVERSARIAL_REVIEW_RESULT.md" },
    { kind: "시장·정책 비치헤드", path: "docs/05_NOWHOT_MARKET_POLICY_BEACHHEAD.md" },
    { kind: "시장·정책 파일럿 소스 감사", path: "docs/06_NOWHOT_MARKET_POLICY_SOURCE_AUDIT.md" },
    { kind: "범용 카테고리 구조", path: "docs/07_NOWHOT_CATEGORY_ARCHITECTURE.md" },
    { kind: "시장·정책 20+5 소스 표본", path: "docs/08_NOWHOT_MARKET_POLICY_SOURCE_SAMPLE.md" },
    { kind: "로컬 자체 편집 오늘판", path: "docs/09_NOWHOT_LOCAL_EDITORIAL_EDITION.md" },
    { kind: "편집 품질 게이트", path: "docs/10_NOWHOT_EDITORIAL_QUALITY_GATE.md" },
    { kind: "세 판 변화·검수 원장", path: "docs/11_NOWHOT_EDITION_CHANGE_AND_REVIEW.md" },
    { kind: "슬롯 개인판 재고·백필", path: "docs/12_NOWHOT_EDITORIAL_INVENTORY.md" },
    { kind: "실제 슬롯 증거·2인 판정", path: "docs/13_NOWHOT_ELAPSED_EVIDENCE_AND_HUMAN_REVIEW.md" },
    { kind: "주장 계보·선택형 LLM 런타임", path: "docs/14_NOWHOT_EDITORIAL_LINEAGE_AND_LLM_RUNTIME.md" },
    { kind: "개인화 충족도·분류 무결성", path: "docs/15_NOWHOT_PERSONALIZATION_INTEGRITY.md" },
    { kind: "독자 화면 편집 검수 데스크", path: "docs/16_NOWHOT_EDITORIAL_REVIEW_DESK.md" },
    { kind: "독자 품질 결함 미래 판 되먹임", path: "docs/17_NOWHOT_READER_QUALITY_FEEDBACK.md" },
    { kind: "미제공 보도형 재고 제한 이월", path: "docs/18_NOWHOT_UNSERVED_QUALITY_CARRYOVER.md" },
    { kind: "목적 적합성 독립 적대검수", path: "docs/19_NOWHOT_PURPOSE_ALIGNMENT_ADVERSARIAL_REVIEW.md" },
    { kind: "독자 payload 동결·품질 게이트", path: "docs/20_NOWHOT_READER_PAYLOAD_FREEZE_AND_GATE.md" },
    { kind: "사건별 독자 문안 다양성", path: "docs/21_NOWHOT_READER_EVENT_FRAME_COPY.md" },
    { kind: "독립 Codex 적대검수", path: "docs/22_NOWHOT_INDEPENDENT_ADVERSARIAL_AUDIT.md" },
    { kind: "핵심 반례 최소 수리", path: "docs/23_NOWHOT_COUNTEREXAMPLE_REPAIR.md" },
    { kind: "핵심 반례 수리 후 독립 재검수", path: "docs/24_NOWHOT_INDEPENDENT_REAUDIT.md" },
    { kind: "정확 응답 fail-closed 서빙 게이트", path: "docs/25_NOWHOT_SERVEABLE_EDITION_GATE.md" },
    { kind: "독자 문장·paragraph 계보 근거 결박", path: "docs/26_NOWHOT_READER_LINEAGE_GROUNDING_GATE.md" },
    { kind: "사건 연속성·관련기사 프레임 근거 수리", path: "docs/27_NOWHOT_EVENT_CONTINUITY_FRAME_GATE.md" },
    { kind: "선택 분야별 고유 사건 충족 수리", path: "docs/28_NOWHOT_CATEGORY_UNIQUE_FULFILLMENT_GATE.md" },
    { kind: "중간 신호 뒤 평가 삭제 정확 원복", path: "docs/29_NOWHOT_FEEDBACK_ROLLBACK_GATE.md" },
    { kind: "동일 판본 개인화 효용·다양성 가드", path: "docs/30_NOWHOT_PERSONALIZATION_UTILITY_EVIDENCE.md" },
    { kind: "2인 블라인드 편집 파일럿 준비", path: "docs/31_NOWHOT_HUMAN_BLIND_EDITORIAL_PILOT_READY.md" },
    { kind: "응답 전용 개인화 투영", path: "src/feed/editorial-personalization.js" },
    { kind: "독자용 보도 문체 투영", path: "src/feed/editorial-reader-copy.js" },
    { kind: "오늘·실시간 공통 상단 전환", path: "src/feed/public/today.html, src/feed/public/index.html" },
    { kind: "개발현황", path: "docs/NOWHOT_DEVELOPMENT_STATUS.md" },
    { kind: "벤치마크 입력", path: "docs/NOWHOT_PRODUCT_BLUEPRINT_002.md" }
  ],
  changeLog: [
    { id: "DEVCHG-NOWHOT-20260810-001", date: "2026-08-10", title: "AdFit 심사 대응 로컬 후보", external: false },
    { id: "DEVCHG-NOWHOT-20260810-002", date: "2026-08-10", title: "7개 서비스 벤치마크와 방향 후보", external: false },
    { id: "DEVCHG-NOWHOT-20260810-003", date: "2026-08-10", title: "영구 제품헌장·시스템 블루프린트·관리자 가시화 (로컬 검증 완료)", external: false },
    { id: "DEVCHG-NOWHOT-20260810-004", date: "2026-08-10", title: "개인화 하루 세 판·동적 분량·선별·LLM 편집 엔진 정본과 관리자 투영 (로컬 검증 완료)", external: false },
    { id: "DEVCHG-NOWHOT-20260810-005", date: "2026-08-10", title: "독립 적대적 검수 HOLD와 세 저비용 증거 실험 관리자 투영 (로컬 검증 완료)", external: false },
    { id: "DEVCHG-NOWHOT-20260810-006", date: "2026-08-10", title: "첫 실험을 투자자용 시장·정책 비치헤드로 변경 (로컬 검증 완료)", external: false },
    { id: "DEVCHG-NOWHOT-20260810-007", date: "2026-08-10", title: "E1-0 시장·정책 소스 감사와 1차 자료 연결 순서 (로컬 검증 완료)", external: false },
    { id: "DEVCHG-NOWHOT-20260810-008", date: "2026-08-10", title: "범용 카테고리 플랫폼 경계와 시장·정책 첫 검증 팩 분리 (로컬 검증 완료)", external: false },
    { id: "DEVCHG-NOWHOT-20260810-009", date: "2026-08-10", title: "E1-0B 보도 20건·공식 확인 5건 재현 표본과 한계 보존", external: false },
    { id: "DEVCHG-NOWHOT-20260810-010", date: "2026-08-10", title: "[폐기된 초기안] 기존 브리핑 자체 편집 콘텐츠 확장·100건 기계 fixture·개인 오늘판 로컬 후보", external: false },
    { id: "DEVCHG-NOWHOT-20260810-011", date: "2026-08-10", title: "100건 절대화 철회·E1 평가표본과 동적 런타임 후보 계약 분리", external: false },
    { id: "DEVCHG-NOWHOT-20260810-012", date: "2026-08-10", title: "관련 보도 신호·직접 복수 피드 관측 분리와 동적 편집 품질 검수 패킷", external: false },
    { id: "DEVCHG-NOWHOT-20260810-013", date: "2026-08-10", title: "직전 판 변화 계산·반복 자격과 2인 로컬 검수 원장", external: false },
    { id: "DEVCHG-NOWHOT-20260810-014", date: "2026-08-10", title: "슬롯 as-of 개인판 재고·선택 조합 공유·제한 누락 백필", external: false },
    { id: "DEVCHG-NOWHOT-20260811-015", date: "2026-08-11", title: "실제 슬롯 최초 실행 영수증과 2인 검수 불일치·품질 판정", external: false },
    { id: "DEVCHG-NOWHOT-20260811-016", date: "2026-08-11", title: "주장·출처 계보와 선택형 판본 배치 LLM 편집·독립 검증·캐시·폴백", external: false },
    { id: "DEVCHG-NOWHOT-20260811-017", date: "2026-08-11", title: "선택 분야 충족도·등록 분류 복구·중요 분야 출처 우선순위", external: false },
    { id: "DEVCHG-NOWHOT-20260811-018", date: "2026-08-11", title: "로컬 전용 3개 이슈·최대 2회·명시 승인형 LLM canary 실행기", external: false },
    { id: "DEVCHG-NOWHOT-20260811-019", date: "2026-08-11", title: "E1 고정 100건 폐기·층화와 목표 정밀도 기반 동결 계약", external: false },
    { id: "DEVCHG-NOWHOT-20260811-020", date: "2026-08-11", title: "선택 수 비례 14~42건 판본·공급 분야 최소 2~3건·v5 재고", external: false },
    { id: "DEVCHG-NOWHOT-20260811-021", date: "2026-08-11", title: "late-backfill as-of 우선 복원·미래 교차보도 차단·v6 재고", external: false },
    { id: "DEVCHG-NOWHOT-20260811-022", date: "2026-08-11", title: "현재·과거 분류 parity·루리웹 유머판 정정·정치 선택 투영·분야 최소 생성 계약·v9 재고", external: false },
    { id: "DEVCHG-NOWHOT-20260811-023", date: "2026-08-11", title: "공유 카테고리 조합별 정시·발행·분야 충족·내용 지문 세 슬롯 영수증", external: false },
    { id: "DEVCHG-NOWHOT-20260811-024", date: "2026-08-11", title: "동일 발행사 중계·직접 RSS 중복 가산 차단과 운영그룹 교차관측·v10 재고", external: false },
    { id: "DEVCHG-NOWHOT-20260811-025", date: "2026-08-11", title: "발행사 표기·섹션 피드 운영그룹 수렴과 stale 방지 v11 재고", external: false },
    { id: "DEVCHG-NOWHOT-20260811-026", date: "2026-08-11", title: "태그 오병합 차단·완전일치 제목 또는 canonical URL 고정밀 사건 결합·v12 재고", external: false },
    { id: "DEVCHG-NOWHOT-20260811-027", date: "2026-08-11", title: "게임 국내외 일반 뉴스 공급·상한 해제 출처 균형·전 분야 14/14 충족·v13 재고", external: false },
    { id: "DEVCHG-NOWHOT-20260811-028", date: "2026-08-11", title: "보도 묶음 신호·직접 확인 원문 범위 분리와 사건명 우선 헤드라인", external: false },
    { id: "DEVCHG-NOWHOT-20260811-029", date: "2026-08-11", title: "100건 절대 규칙 없음 관리자 명시·폐기 이력 표시·제목 조사 안전 문장", external: false },
    { id: "DEVCHG-NOWHOT-20260811-030", date: "2026-08-11", title: "분야별 후보→기계 유효→최종 퍼널·반복 대체 후보·경품/판촉 대표 제외", external: false },
    { id: "DEVCHG-NOWHOT-20260811-031", date: "2026-08-11", title: "과학 복수 보도 공급·근거 우선과 패션 섹션 피드 순도 복구", external: false },
    { id: "DEVCHG-NOWHOT-20260811-032", date: "2026-08-11", title: "자동 슬롯 감시 활성·다음 정시창·도래 후 누락 관리자 가시화", external: false },
    { id: "DEVCHG-NOWHOT-20260811-033", date: "2026-08-11", title: "불변 활성 검수 패킷·진행 중 교체 차단·답 비공개·불일치 조정 원장", external: false },
    { id: "DEVCHG-NOWHOT-20260811-034", date: "2026-08-11", title: "완결 사건명·동일 원제목 보존·분야 우선 판단가치·실제 판촉 사례 고정", external: false },
    { id: "DEVCHG-NOWHOT-20260811-035", date: "2026-08-11", title: "저장판 의미 중복 4쌍 억제·영문/메타어 오병합 방지·스포츠 하위 판단가치", external: false },
    { id: "DEVCHG-NOWHOT-20260811-036", date: "2026-08-11", title: "분야 적합성 공통 게이트·사건 중심 제목·불완전 절단 보류·주입 12시 모사", external: false },
    { id: "DEVCHG-NOWHOT-20260811-037", date: "2026-08-11", title: "핵심 공유조합 우선 재고·슬롯 변화 계보 보존·저장 완료시각 정시 판정", external: false },
    { id: "DEVCHG-NOWHOT-20260811-038", date: "2026-08-11", title: "고정 수집 건수 없는 날짜별 판본 신뢰도 원장·정시·누락·분야 보류 추세", external: false },
    { id: "DEVCHG-NOWHOT-20260811-039", date: "2026-08-11", title: "비저장 세 슬롯 재생의 동적 분야 충족·보류 사전점검", external: false },
    { id: "DEVCHG-NOWHOT-20260811-040", date: "2026-08-11", title: "실제 후보의 분야 의미 누수·기업 협찬 대표·모호한 제목 교정", external: false },
    { id: "DEVCHG-NOWHOT-20260811-041", date: "2026-08-11", title: "실제 12시 정시 판 보존·사람 관점 의미 HOLD·미래 판 분류와 제목 가드", external: false },
    { id: "DEVCHG-NOWHOT-20260811-042", date: "2026-08-11", title: "실제 낮 판 42건 전수 필드 감사·고정 건수 부정·미래 판 문맥·중복·한국어 조사 가드", external: false },
    { id: "DEVCHG-NOWHOT-20260811-043", date: "2026-08-11", title: "다음 판 비저장 행 감사·혼합 게시판 분류·저문맥·가격형 판촉·사건 변주 교정", external: false },
    { id: "DEVCHG-NOWHOT-20260811-044", date: "2026-08-11", title: "고정 건수 없는 대체행 재감사·민감 주장 근거·분야·사건 중심·희귀 인물 밀집 교정", external: false },
    { id: "DEVCHG-NOWHOT-20260811-045", date: "2026-08-11", title: "불변 저장 판 품질 누적 원장·도래 슬롯 검수 패킷 자동 동결·활성 검수 보호", external: false },
    { id: "DEVCHG-NOWHOT-20260811-046", date: "2026-08-11", title: "사용자 중립 공유 판본·응답 전용 제한 취향 재정렬·토픽 설정 혼입 차단", external: false },
    { id: "DEVCHG-NOWHOT-20260811-047", date: "2026-08-11", title: "인접 판 동일 사건 연속성·독자용 보도 문체·왜 내게 숨김·오늘/실시간 고정 전환", external: false },
    { id: "DEVCHG-NOWHOT-20260811-048", date: "2026-08-11", title: "독자 화면 기준 단건 편집 데스크·현재 검수자 전용 API·자동 저장·미완료/보류 탐색", external: false },
    { id: "DEVCHG-NOWHOT-20260811-049", date: "2026-08-11", title: "최근 세 판 반복 대조·독자 결함 미래 판 되먹임·비저장 후보 품질 퍼널", external: false },
    { id: "DEVCHG-NOWHOT-20260811-050", date: "2026-08-11", title: "미제공 보도형 재고의 24시간 제한 이월·현재 슬롯 우선·상단 정체성 문구 고정", external: false },
    { id: "DEVCHG-NOWHOT-20260811-051", date: "2026-08-11", title: "영구 제품 목적 적합성 독립 5인 적대검수·5/5 HOLD·독자 품질 폐쇄 우선", external: false },
    { id: "DEVCHG-NOWHOT-20260811-052", date: "2026-08-11", title: "독자 화면 reader payload 42/42 불변 동결·행/판 이중 품질 게이트·거짓 기계 PASS 차단", external: false },
    { id: "DEVCHG-NOWHOT-20260811-053", date: "2026-08-11", title: "사건별 독자 문안·판 반복 PASS·계약/판정 포함 패킷 식별·목적 적합성 재검수", external: false },
    { id: "DEVCHG-NOWHOT-20260811-054", date: "2026-08-11", title: "분리 Codex 3인 적대검수·거짓 신뢰 PASS P0 2건 직접 재현·운영 승격 BLOCK", external: false },
    { id: "DEVCHG-NOWHOT-20260811-055", date: "2026-08-11", title: "핵심 반례 4/4 RED→GREEN·계보 재해시·캐시 fail-closed·변화 HOLD·평가 삭제 원복", external: false },
    { id: "DEVCHG-NOWHOT-20260811-056", date: "2026-08-11", title: "수리 후 독립 재검수·2 BLOCK/1 HOLD·실제 응답 HOLD 서빙 확인·serveableEdition 우선순위 고정", external: false },
    { id: "DEVCHG-NOWHOT-20260811-057", date: "2026-08-11", title: "정확 응답 검수·불변 서빙 영수증·동일 분야 24시간 폴백·검증판 없으면 409", external: false },
    { id: "DEVCHG-NOWHOT-20260811-058", date: "2026-08-11", title: "paragraph 독립 계보·독자 7필드 SHA-256 지문·중요성 정책 근거·구조화 변화 근거 결박", external: false },
    { id: "DEVCHG-NOWHOT-20260811-059", date: "2026-08-11", title: "일반어 제거 사건 연속성·관련기사 정체성/주장/프레임 오염 차단·packet v5", external: false },
    { id: "DEVCHG-NOWHOT-20260811-060", date: "2026-08-11", title: "다중 분야 이슈 단일 배정·고유 사건 최소 깊이·미충족 응답 fail-closed", external: false },
    { id: "DEVCHG-NOWHOT-20260811-061", date: "2026-08-11", title: "기본 취향·명시 평가 오버레이 분리와 중간 신호 뒤 평가 삭제 정확 원복", external: false },
    { id: "DEVCHG-NOWHOT-20260811-062", date: "2026-08-11", title: "동일 판본 상단 개인화 대리 효용·출처/분야 다양성 측정과 손실 시 공유순서 폴백", external: false },
    { id: "DEVCHG-NOWHOT-20260811-063", date: "2026-08-11", title: "현재 계약 v17 불변 판본·영문 미번역 보류·사건별 중요성 문장·42행 2인 검수 패킷 활성", external: false },
    { id: "DEVCHG-NOWHOT-20260812-064", date: "2026-08-12", title: "실사용 진입 4단계 정합화·기존 42행 런타임 미복원 정정·새 영구 고정부터 재검증", external: false },
    { id: "DEVCHG-NOWHOT-20260812-065", date: "2026-08-12", title: "실데이터 42행 영속 고정·재시작 동일 지문·검수 전용 fail-closed 관리자 경로", external: false },
    { id: "DEVCHG-NOWHOT-20260812-066", date: "2026-08-12", title: "독립 AI A·B 84/84 판정·16필드 조정·과거 패킷 HOLD 보존·미래 판 문안 수리", external: false },
    { id: "DEVCHG-NOWHOT-20260812-067", date: "2026-08-12", title: "현재 HOLD 재고 미저장·v21 분리·한국어 가독 후보 우선으로 기본 4/4와 전체 14/14 공급 복구", external: false },
    { id: "DEVCHG-NOWHOT-20260812-068", date: "2026-08-12", title: "기본 오늘판 HTTP 200·28건·재시작 동일 지문·LAN·390px 모바일·독립 검수 PASS", external: false },
    { id: "DEVCHG-NOWHOT-20260812-069", date: "2026-08-12", title: "사건명 없는 반복 독자 문장으로 인한 관심 분야 조합 409 오탐 수리·실데이터 139조합 HTTP 200", external: false },
    { id: "DEVCHG-NOWHOT-20260813-070", date: "2026-08-13", title: "선택 분야별 최대 14건 합집합·동일 사건 1회·분야 중요도 순위 층 혼합·v26 재고", external: false }
  ]
});

export function buildMarketPolicySourceAudit(registry = []) {
  const enabled = registry.filter((source) => source && source.enabled);
  const relevant = enabled.filter((source) => ["business", "news", "politics"].includes(source.category));
  const byCategory = Object.fromEntries(
    ["business", "news", "politics"].map((category) => [category, relevant.filter((source) => source.category === category).length])
  );
  const primary = relevant.filter((source) => source.sourceRole === "primary");
  const registeredIds = new Set(registry.map((source) => source && source.id));
  const enabledIds = new Set(enabled.map((source) => source.id));
  const candidates = MARKET_POLICY_VERIFICATION_ANCHORS.map((candidate) => ({
    ...candidate,
    registered: candidate.registryIds.some((id) => registeredIds.has(id)),
    enabled: candidate.registryIds.some((id) => enabledIds.has(id))
  }));
  const gaps = [];
  if (!relevant.some((source) => source.sourceRole)) gaps.push("양질 보도·공식 자료·커뮤니티를 구분할 sourceRole 메타데이터가 없다.");
  if (!byCategory.politics) gaps.push("정치 분류 소스가 없고 정책 원문과 일반 정치를 분리할 공급 계약도 없다.");
  if (!enabled.some((source) => source.marketPolicyDesk)) gaps.push("네 데스크를 증명할 marketPolicyDesk 메타데이터가 없다.");
  if (!enabled.some((source) => source.ownershipGroup)) gaps.push("전재를 독립 확인에서 제외할 ownershipGroup 메타데이터가 없다.");
  return {
    stableId: "NOWHOT-MARKET-POLICY-SOURCE-AUDIT-001",
    state: gaps.length ? "hold" : "ready",
    label: gaps.length ? "E1 INPUT HOLD" : "READY",
    scope: "enabled registry sources",
    current: {
      relevantSourceCount: relevant.length,
      primarySourceCount: primary.length,
      byCategory,
      sourceLabels: relevant.map((source) => source.label)
    },
    candidates,
    gaps,
    nextQueue: [
      { order: 1, state: "complete", title: "양질 보도 공개 표본 증명", detail: "거시·정책·기업·시장별 보도 5건과 출처 역할·소유 그룹·발행 시각 기록 완료" },
      { order: 2, state: "complete_with_limits", title: "선택적 공식 확인 표본", detail: "공개 공식 자료 5건 대조 완료: 일치 3건·부분 일치 2건, 키와 LLM 사용 0" },
      { order: 3, state: "complete_with_limits", title: "동적 런타임 후보 계약 고정", detail: "정규화 URL·역할·운영 그룹·카테고리 필드를 고정했다. E1은 규모 미정의 별도 층화 사람 평가 코퍼스이며 런타임 목표가 아니다" }
    ],
    decision: gaps.length ? "20+5 표본과 동적 후보 계약은 완료했다. E1 층화·규모·manifest, 레지스트리 역할·데스크 메타데이터 공백과 블라인드 정답표는 계속 HOLD다." : "E1 사람 블라인드 정답표 검수로 이동한다."
  };
}

export function projectProductBlueprint(registry = [], runtime = {}) {
  return {
    ...PRODUCT_BLUEPRINT,
    localEditorialEvidence: runtime.localEditorialEvidence || {
      stableId: "NOWHOT-LOCAL-EDITORIAL-EDITION-001",
      state: "not_observed",
      observedAt: null
    },
    adversarialReview: {
      ...PRODUCT_BLUEPRINT.adversarialReview,
      beachhead: {
        ...PRODUCT_BLUEPRINT.adversarialReview.beachhead,
        sourceAudit: buildMarketPolicySourceAudit(registry)
      }
    }
  };
}
