// P3-A shadow 선별 계층 검수 — 축 산식·팩별 자격 게이트·동적 분량·동결 표본.
//
// 계약: 블루프린트 01 "2026-08-13 정책 팩별 판 자격(eligibility) 계약".
// shadow는 현행 서빙 경로와 분리된 병렬 계산이다 — 이 테스트는 shadow 모듈만
// 대상으로 하고 digest/engine/server는 건드리지 않는다.
import test from "node:test";
import assert from "node:assert/strict";

import {
  heatAxis, importanceAxis, changeAxis, freshnessStairValue, trustMaterials, engagementOf
} from "../src/feed/selection-axes.js";
import {
  SHADOW_PACK_PARAMS, SHADOW_SELECTION_CONTRACT,
  shadowSelectEdition, shadowSelectBriefing, packIdForArticle, resolveSourceRole, overrideShadowParams
} from "../src/feed/shadow-selection.js";
import { buildEventClusters } from "../src/feed/event-cluster.js";

const NOW = Date.parse("2026-08-13T12:00:00+09:00");
const AXIS = SHADOW_PACK_PARAMS.axis;
const roleOf = (article) => resolveSourceRole(article);

const article = (over) => ({
  id: over.id,
  title: over.title,
  url: over.url || `https://example.com/${over.id}`,
  publishedAt: over.publishedAt || "2026-08-13T10:00:00+09:00",
  kind: over.kind || "news",
  category: over.category || "news",
  source: over.source || "gnews-news",
  sourceLabel: over.sourceLabel || over.source || "매체",
  ...over
});

// ---------------------------------------------------------------------------
// 축 산식 단위
// ---------------------------------------------------------------------------

test("heat: log10 포화 — 단조 증가·포화점에서 1.0 상한", () => {
  const at = (eng) => heatAxis({ memberArticles: [{ score: eng }] },
    { saturationEng: AXIS.heatSaturationEng });
  assert.equal(at(0).value, 0);
  assert.ok(at(100).value > at(10).value, "반응이 많으면 heat가 커야 한다");
  assert.ok(at(10000).value < 1);
  assert.equal(at(AXIS.heatSaturationEng).value, 1, "포화점에서 정확히 1");
  assert.equal(at(AXIS.heatSaturationEng * 100).value, 1, "포화점 초과는 1로 눌린다");
  // 감사 근거: 입력 신호 값이 함께 나온다.
  assert.equal(at(100).evidence.eng, 100);
  assert.equal(at(100).evidence.saturationEng, AXIS.heatSaturationEng);
});

test("heat: 커뮤니티 반응은 heat에 계수되고, importance 독립 그룹에는 계수되지 않는다 (정정 3)", () => {
  const reaction = { score: 500, commentCount: 100, kind: "community" };
  const member = { score: 0, category: "business" };
  const withReaction = heatAxis({ memberArticles: [member], reactionArticles: [reaction] },
    { saturationEng: AXIS.heatSaturationEng });
  const withoutReaction = heatAxis({ memberArticles: [member], reactionArticles: [] },
    { saturationEng: AXIS.heatSaturationEng });
  assert.ok(withReaction.value > withoutReaction.value, "커뮤 반응은 heat를 올린다");
  assert.equal(withReaction.evidence.reactionEng, engagementOf(reaction));
  // importance는 event.counts.independentReportingGroups만 본다 — 반응은 무관.
  const event = { counts: { independentReportingGroups: 1 } };
  const imp = importanceAxis({ event, memberArticles: [member] }, {
    groupSaturation: AXIS.importanceGroupSaturation,
    weightyCategories: AXIS.weightyCategories,
    componentWeights: AXIS.importanceComponents,
    roleOf
  });
  assert.equal(imp.evidence.independentReportingGroups, 1);
});

test("importance: 독립 그룹 포화(5)·weighty·primary 구성 요소와 근거", () => {
  const opt = {
    groupSaturation: AXIS.importanceGroupSaturation,
    weightyCategories: AXIS.weightyCategories,
    componentWeights: AXIS.importanceComponents,
    roleOf
  };
  const at = (groups, category, sourceRole) => importanceAxis({
    event: { counts: { independentReportingGroups: groups } },
    memberArticles: [{ category, kind: "news",
      editorialCandidate: sourceRole ? { sourceRole } : undefined }]
  }, opt);
  assert.ok(at(3, "life").value > at(1, "life").value, "그룹 수가 많으면 중요도 상승");
  assert.equal(at(5, "life").evidence.groupsRatio, 1, "그룹 5에서 포화");
  assert.equal(at(9, "life").evidence.groupsRatio, 1, "포화 초과 가산 없음(이진 부풀림 금지 — 표본 9 교훈)");
  assert.ok(at(1, "business").value > at(1, "life").value, "weighty 분야 가산");
  assert.ok(at(1, "life", "primary").value > at(1, "life").value, "primary 근거 가산");
  assert.equal(at(1, "business").evidence.weighty, true);
});

test("change: 신선도 계단 — 창 4등분·창 밖 0", () => {
  const stair = AXIS.freshnessStair;
  assert.equal(freshnessStairValue(1, 12, stair), 1);
  assert.equal(freshnessStairValue(4, 12, stair), 0.75);
  assert.equal(freshnessStairValue(7, 12, stair), 0.5);
  assert.equal(freshnessStairValue(11, 12, stair), 0.25);
  assert.equal(freshnessStairValue(13, 12, stair), 0, "창 밖은 0");
});

test("change: factsFingerprint 재등장 게이트 — 지문 동일이면 0, 변화면 계단값 유지", () => {
  const event = {
    firstSeenAt: "2026-08-13T10:00:00+09:00",
    lastMaterialChangeAt: "2026-08-13T10:00:00+09:00",
    factsFingerprint: "EVF-aaaa"
  };
  const opt = { now: NOW, windowHours: 12, stair: AXIS.freshnessStair };
  const fresh = changeAxis({ event }, opt);
  assert.equal(fresh.value, 1, "2시간 경과 = 계단 첫 칸");
  const unchanged = changeAxis({ event }, { ...opt, previousFingerprint: "EVF-aaaa" });
  assert.equal(unchanged.value, 0, "직전 판과 지문이 같으면 재탕 — 0");
  assert.equal(unchanged.evidence.reappearedUnchanged, true);
  const changed = changeAxis({ event }, { ...opt, previousFingerprint: "EVF-bbbb" });
  assert.equal(changed.value, 1, "실질 변화가 있으면 계단값 그대로(발명 보너스 없음)");
  assert.equal(changed.evidence.materialChange, true);
});

// ---------------------------------------------------------------------------
// 팩 소속·팩별 자격 게이트
// ---------------------------------------------------------------------------

test("팩 배속: 미결 2 추천안 — tech·auto→newsy, gaming→culture, life·kind=community→community", () => {
  assert.equal(packIdForArticle(article({ id: "p1", title: "t", category: "tech" })), "newsy");
  assert.equal(packIdForArticle(article({ id: "p2", title: "t", category: "auto" })), "newsy");
  assert.equal(packIdForArticle(article({ id: "p3", title: "t", category: "gaming" })), "culture");
  assert.equal(packIdForArticle(article({ id: "p4", title: "t", category: "life" })), "community");
  assert.equal(packIdForArticle(article({ id: "p5", title: "t", category: "science", kind: "community" })),
    "community", "커뮤글은 카테고리와 무관하게 커뮤 팩 잣대");
});

test("게이트: reported_secondary 1건 단독은 어느 뉴스 팩에서도 차단된다 (공통 원칙 1)", () => {
  const solo = [article({ id: "g1", title: "누리검사 단독 보도 내용", category: "business",
    source: "some-news", publishedAt: "2026-08-13T11:00:00+09:00" })];
  const out = shadowSelectEdition(solo, { packId: "newsy", now: NOW });
  assert.equal(out.selected.length, 0);
  assert.equal(out.excluded.gate.length, 1);
  assert.ok(out.excluded.gate[0].gate.failures.includes("trust_reported_secondary_alone"));
  assert.equal(out.partialEdition, true, "무관한 글로 채우지 않는다 — 부분판");
});

test("게이트: 기관 primary 1곳은 단독으로 통과한다 (과학 팩 — NASA 경로)", () => {
  const registry = [{ id: "agency-x", kind: "news", category: "science", sourceRole: "primary" }];
  const rows = [article({ id: "g2", title: "가온망원경 심우주 관측 발표 자료", category: "science",
    source: "agency-x", publishedAt: "2026-08-13T09:00:00+09:00" })];
  const out = shadowSelectEdition(rows, { packId: "science", now: NOW, registry });
  assert.equal(out.selected.length, 1);
  assert.equal(out.selected[0].gate.passedBy, "primary_or_first_party");
});

test("게이트: 독립 운영그룹 2곳이면 통과한다 (뉴스 기본 계약)", () => {
  const rows = [
    article({ id: "g3a", title: "도담반도체 수출 통계 결과 공개", category: "business",
      source: "news-a", ownershipGroup: "group-a", ownershipBasis: "registry_explicit",
      publishedAt: "2026-08-13T11:00:00+09:00" }),
    article({ id: "g3b", title: "도담반도체 수출 통계 결과 공개", category: "business",
      source: "news-b", ownershipGroup: "group-b", ownershipBasis: "registry_explicit",
      url: "https://other.example.com/g3b", publishedAt: "2026-08-13T11:20:00+09:00" })
  ];
  const out = shadowSelectEdition(rows, { packId: "newsy", now: NOW });
  assert.equal(out.selected.length, 1);
  assert.equal(out.selected[0].gate.passedBy, "independent_groups>=2");
});

test("게이트: 같은 운영그룹 2건은 독립 계수 1 — 통과하지 못한다 (공통 원칙 3·C4)", () => {
  const rows = [
    article({ id: "g4a", title: "라온항만 물동량 집계 발표 자료", category: "business",
      source: "news-a1", ownershipGroup: "same-group", ownershipBasis: "registry_explicit",
      publishedAt: "2026-08-13T11:00:00+09:00" }),
    article({ id: "g4b", title: "라온항만 물동량 집계 발표 자료", category: "business",
      source: "news-a2", ownershipGroup: "same-group", ownershipBasis: "registry_explicit",
      url: "https://other.example.com/g4b", publishedAt: "2026-08-13T11:10:00+09:00" })
  ];
  const out = shadowSelectEdition(rows, { packId: "newsy", now: NOW });
  assert.equal(out.selected.length, 0);
  assert.ok(out.excluded.gate[0].gate.failures.includes("trust_reported_secondary_alone"));
});

test("게이트: 커뮤 팩 절대 반응선 eng≥30 — 29는 탈락, 30은 통과, 언론 신뢰 라벨 없음", () => {
  const post = (id, score) => article({ id, title: `${id} 커뮤글`, kind: "community",
    category: "humor", source: "theqoo", score, commentCount: 0,
    url: `https://theqoo.example.com/${id}`, publishedAt: "2026-08-13T11:00:00+09:00" });
  const fail = shadowSelectEdition([post("c29", 29)], { packId: "community", now: NOW });
  assert.equal(fail.selected.length, 0);
  assert.ok(fail.excluded.gate[0].gate.failures[0].startsWith("community_eng_below_absolute_line"));
  const pass = shadowSelectEdition([post("c30", 30)], { packId: "community", now: NOW });
  assert.equal(pass.selected.length, 1);
  assert.equal(pass.selected[0].gate.passedBy, "community_eng>=30");
  assert.equal(SHADOW_PACK_PARAMS.packs.community.pressTrustLabel, false,
    "커뮤 팩은 언론 신뢰 라벨을 부착하지 않는다");
});

test("게이트: 신선도 창 — 커뮤 6h 밖 글은 탈락한다", () => {
  const old = article({ id: "c-old", title: "옛날 커뮤글", kind: "community", category: "humor",
    source: "theqoo", score: 500, publishedAt: "2026-08-13T04:00:00+09:00" }); // 8시간 전
  const out = shadowSelectEdition([old], { packId: "community", now: NOW });
  assert.equal(out.selected.length, 0);
  assert.ok(out.excluded.gate[0].gate.failures.includes("freshness_window_6h"));
});

test("게이트: 미래 publishedAt — 1시간 넘는 미래는 무효, 1시간 이내는 0으로 클램프 (검수 P2-2)", () => {
  // 불량 피드·시계 오차로 발행시각이 미래인 기사가 "영원히 창 안"에 머물던 구멍.
  const future = article({ id: "f-far", title: "미래 발행 불량 기사", kind: "community",
    category: "humor", source: "theqoo", score: 500,
    publishedAt: "2026-08-14T11:00:00+09:00" }); // now+23h
  const far = shadowSelectEdition([future], { packId: "community", now: NOW });
  assert.equal(far.selected.length, 0);
  assert.ok(far.excluded.gate[0].gate.failures.includes("freshness_invalid_future_published_at"));

  const skew = article({ id: "f-skew", title: "시계 오차 30분 미래 커뮤글", kind: "community",
    category: "humor", source: "theqoo", score: 500,
    publishedAt: "2026-08-13T12:30:00+09:00" }); // now+30m — 오차 허용
  const near = shadowSelectEdition([skew], { packId: "community", now: NOW });
  assert.equal(near.selected.length, 1);
});

test("게이트: 재등장 — 직전 판과 factsFingerprint가 같으면 제외된다 (공통 원칙 5)", () => {
  const rows = [
    article({ id: "r1a", title: "마루조선 수주 계약 체결 확인", category: "business",
      source: "news-a", ownershipGroup: "group-a", ownershipBasis: "registry_explicit",
      publishedAt: "2026-08-13T11:00:00+09:00" }),
    article({ id: "r1b", title: "마루조선 수주 계약 체결 확인", category: "business",
      source: "news-b", ownershipGroup: "group-b", ownershipBasis: "registry_explicit",
      url: "https://other.example.com/r1b", publishedAt: "2026-08-13T11:05:00+09:00" })
  ];
  const [event] = buildEventClusters(rows);
  const out = shadowSelectEdition(rows, {
    packId: "newsy", now: NOW,
    previousEditionFingerprints: new Map([[event.eventId, event.factsFingerprint]])
  });
  assert.equal(out.selected.length, 0);
  assert.ok(out.excluded.gate[0].gate.failures.includes("reappear_no_material_change"));
});

test("게이트: 스포츠 단독 결과 예외는 초기값 false — 파라미터로 켜야만 열린다 (미결 1)", () => {
  const solo = [article({ id: "sp1", title: "누리구단 결승 진출 확정 소식", category: "sports",
    source: "some-sport-news", publishedAt: "2026-08-13T11:00:00+09:00" })];
  const [event] = buildEventClusters(solo);
  const off = shadowSelectEdition(solo, { packId: "sports", now: NOW,
    officialResultEventIds: new Set([event.eventId]) });
  assert.equal(off.selected.length, 0, "초기값(예외 없음)에서는 단독 결과도 차단");
  const params = overrideShadowParams({ packs: { sports: { soloOfficialResultException: true } } });
  const on = shadowSelectEdition(solo, { packId: "sports", now: NOW, params,
    officialResultEventIds: new Set([event.eventId]) });
  assert.equal(on.selected.length, 1);
  assert.equal(on.selected[0].gate.passedBy, "solo_official_result_exception");
});

// ---------------------------------------------------------------------------
// 동적 분량 — 8~12, 95% 동급 확장, 캡 비완화
// ---------------------------------------------------------------------------

// 서로 병합되지 않는 사건 n개(각각 독립 그룹 2로 게이트 통과) 생성.
const BASES = ["누리", "가온", "도담", "라온", "마루", "바람", "사랑", "아현",
  "자몽", "차오", "타래", "파랑", "하늘", "소담", "온새", "미르"];
const twinEvent = (index, { score = 0, category = "business" } = {}) => {
  const base = BASES[index];
  const title = `${base}검사 ${base}공장 ${base}단지 가동`;
  return [
    article({ id: `t${index}a`, title, category, score,
      source: `src-${index}a`, ownershipGroup: `grp-${index}a`, ownershipBasis: "registry_explicit",
      url: `https://a.example.com/${index}`, publishedAt: "2026-08-13T11:00:00+09:00" }),
    article({ id: `t${index}b`, title, category,
      source: `src-${index}b`, ownershipGroup: `grp-${index}b`, ownershipBasis: "registry_explicit",
      url: `https://b.example.com/${index}`, publishedAt: "2026-08-13T11:10:00+09:00" })
  ];
};

test("동적 분량: 게이트 통과가 8건 미만이면 그대로 부분판이다", () => {
  const rows = [0, 1, 2, 3, 4].flatMap((index) => twinEvent(index));
  const out = shadowSelectEdition(rows, { packId: "newsy", now: NOW });
  assert.equal(out.selected.length, 5);
  assert.equal(out.partialEdition, true);
});

test("동적 분량: 13위가 12위 S의 95% 이상이면 13까지, 미달 14위는 확장하지 않는다", () => {
  // 1~13위: 같은 반응량(heat 동일) → S 동률 = 95% 충족. 14위: 반응 0 → 미달.
  const rows = [
    ...Array.from({ length: 13 }, (_, index) => twinEvent(index, { score: 10000 })).flat(),
    ...twinEvent(13, { score: 0 })
  ];
  const out = shadowSelectEdition(rows, { packId: "newsy", now: NOW });
  assert.equal(out.selected.length, 13, "동급 13위는 포함");
  assert.equal(out.excluded.belowVolume.length, 1, "미달 14위는 확장 없음");
  assert.equal(out.excluded.belowVolume[0].exclusion, "below_dynamic_volume");
  assert.equal(out.partialEdition, false);
});

test("동적 분량: 13위가 95% 미달이면 12건에서 멈춘다", () => {
  const rows = [
    ...Array.from({ length: 12 }, (_, index) => twinEvent(index, { score: 10000 })).flat(),
    ...twinEvent(12, { score: 0 }),
    ...twinEvent(13, { score: 0 })
  ];
  const out = shadowSelectEdition(rows, { packId: "newsy", now: NOW });
  assert.equal(out.selected.length, 12);
  assert.equal(out.excluded.belowVolume.length, 2);
});

test("소스캡: 운영그룹 캡 초과는 제외되고, 부족해도 캡을 자동 완화하지 않는다 (공통 원칙 4)", () => {
  // 사건 3개 — 대표(첫 기사)가 전부 같은 운영그룹. 캡 2 → 3번째는 제외.
  const rows = [0, 1, 2].flatMap((index) => {
    const [a, b] = twinEvent(index, { score: (3 - index) * 100 });
    return [{ ...a, ownershipGroup: "cap-group" }, b];
  });
  const out = shadowSelectEdition(rows, { packId: "newsy", now: NOW });
  assert.equal(out.selected.length, 2);
  assert.equal(out.excluded.sourceCap.length, 1);
  assert.ok(out.excluded.sourceCap[0].exclusion.startsWith("source_cap_operatorGroup:cap-group"));
  assert.equal(out.partialEdition, true, "캡 때문에 8건 미만이어도 완화하지 않는다 — 부분판");
});

// ---------------------------------------------------------------------------
// 동결 표본 1·2·5·9 (선별 관련) — 픽스처는 event-cluster-samples와 동일 제목·시각
// ---------------------------------------------------------------------------

test("표본 1(딥시크 한/영): HN은 커뮤 반응 축 — 언론 1곳뿐이면 뉴스 기본 계약 미충족으로 차단", () => {
  const rows = [
    article({ id: "s1-hn", title: "DeepSeek V4 Pro 0813",
      url: "https://news.ycombinator.com/item?id=41000001",
      publishedAt: "2026-08-13T01:10:00+09:00", kind: "community", category: "tech",
      source: "hackernews", sourceLabel: "해커뉴스", score: 907, commentCount: 357 }),
    article({ id: "s1-yna", title: "딥시크 V4 프로 정식 출시",
      url: "https://www.yonhapnewstv.co.kr/news/MYH20260813001",
      publishedAt: "2026-08-13T09:30:00+09:00", category: "business",
      source: "gnews-business", sourceLabel: "연합뉴스TV" })
  ];
  const out = shadowSelectEdition(rows, { packId: "newsy", now: NOW });
  assert.equal(out.counts.events, 1, "한/영이 한 사건으로 결합");
  assert.equal(out.selected.length, 0, "커뮤 반응은 독립 언론 계수에 합산되지 않는다");
  const gate = out.excluded.gate[0].gate;
  assert.ok(gate.failures.includes("trust_reported_secondary_alone"));
  assert.equal(gate.trust.independentReportingGroups, 1);
  assert.ok(gate.trust.communityEng > 0, "반응은 heat 재료로는 남는다");
});

test("표본 2(부동산대책 파편): 병합 후 독립 그룹 3 — 통과하고 근거가 보존된다", () => {
  const rows = [
    article({ id: "s2-hani", title: "8·13 부동산대책 발표…대출 규제 대폭 강화",
      publishedAt: "2026-08-13T10:00:00+09:00", category: "realestate", source: "hani-rank", sourceLabel: "한겨레" }),
    article({ id: "s2-chosun", title: "정부 8·13 대책, 다주택자 대출 정조준",
      publishedAt: "2026-08-13T10:20:00+09:00", category: "business", source: "chosunbiz", sourceLabel: "조선비즈" }),
    article({ id: "s2-mk", title: "8·13 부동산대책에 시장 술렁…대출 문턱 높아진다",
      publishedAt: "2026-08-13T11:00:00+09:00", category: "realestate", source: "mk-realestate", sourceLabel: "매일경제" })
  ];
  const out = shadowSelectEdition(rows, { packId: "newsy", now: NOW });
  assert.equal(out.counts.events, 1);
  assert.equal(out.selected.length, 1);
  assert.equal(out.selected[0].gate.passedBy, "independent_groups>=2");
  assert.equal(out.selected[0].view.event.sourceEvidence.length, 3, "근거 소실 0");
});

test("표본 5(geeknews 재유통): 커뮤 팩 잣대 — 독립 언론 계수 0, 절대 반응선으로만 판정", () => {
  const rows = [
    article({ id: "s5-hn", title: "Show HN: An SQLite extension for vector search",
      url: "https://example-blog.dev/sqlite-vec", publishedAt: "2026-08-13T07:00:00+09:00",
      kind: "community", category: "tech", source: "hackernews", score: 210, commentCount: 48 }),
    article({ id: "s5-gk", title: "SQLite 벡터 검색 확장 공개",
      url: "https://example-blog.dev/sqlite-vec?utm_source=geeknews",
      publishedAt: "2026-08-13T09:00:00+09:00", kind: "community", category: "tech",
      source: "geeknews", score: 12, commentCount: 3 })
  ];
  const out = shadowSelectEdition(rows, { packId: "community", now: NOW });
  assert.equal(out.counts.events, 1, "중계·재유통은 한 사건");
  assert.equal(out.selected.length, 1);
  assert.equal(out.selected[0].gate.passedBy, "community_eng>=30");
  assert.equal(out.selected[0].gate.trust.independentReportingGroups, 0,
    "중계는 복수 출처 확인으로 계수하지 않는다");
});

test("표본 9(coverage 이진 포화): relatedCoverage=5여도 그룹 1 — 다중 소스 주장 없이 차단", () => {
  const rows = [article({ id: "s9", title: "관련 보도 묶음 포착 표본 단일 기사",
    publishedAt: "2026-08-13T10:30:00+09:00", category: "news", source: "gnews-news",
    coverage: 5, relatedCoverage: 5 })];
  const out = shadowSelectEdition(rows, { packId: "newsy", now: NOW });
  assert.equal(out.selected.length, 0);
  const gate = out.excluded.gate[0].gate;
  assert.equal(gate.trust.independentReportingGroups, 1,
    "이진 coverage 신호로 독립 계수를 부풀리지 않는다(근거 라벨 정직성)");
  assert.ok(gate.failures.includes("trust_reported_secondary_alone"));
});

// ---------------------------------------------------------------------------
// 파라미터 계약 — 초기값 한 곳·즉시 조정 가능
// ---------------------------------------------------------------------------

test("파라미터: 팩 테이블 초기값이 설계안과 일치하고 동결돼 있다", () => {
  const p = SHADOW_PACK_PARAMS.packs;
  assert.deepEqual(p.newsy.weights, { heat: 0.2, importance: 0.5, change: 0.3 });
  assert.deepEqual(p.science.weights, { heat: 0.15, importance: 0.35, change: 0.5 });
  assert.deepEqual(p.community.weights, { heat: 0.6, importance: 0.1, change: 0.3 });
  assert.equal(p.newsy.windowHours, 12);
  assert.equal(p.newsy.morningWindowHours, 24);
  assert.equal(p.science.windowHours, 48);
  assert.equal(p.sports.windowHours, 24);
  assert.equal(p.community.windowHours, 6);
  assert.equal(p.community.engMin, 30);
  assert.equal(p.culture.windowHours, 24);
  assert.ok(Object.isFrozen(p.newsy.weights), "기준선 테이블은 불변");
  assert.equal(SHADOW_SELECTION_CONTRACT.servingPathTouched, false);
});

test("파라미터: overrideShadowParams는 원본을 두고 깊은 병합 사본을 만든다 (David 답 즉시 반영 경로)", () => {
  const tuned = overrideShadowParams({ packs: { community: { engMin: 50 } } });
  assert.equal(tuned.packs.community.engMin, 50);
  assert.equal(tuned.packs.community.windowHours, 6, "나머지 값 유지");
  assert.equal(SHADOW_PACK_PARAMS.packs.community.engMin, 30, "원본 불변");
});

// ---------------------------------------------------------------------------
// R1 반례 a·b·c (David 명시 — 블루프린트 "2026-08-14 P3-A 판정" 결함 2·4)
// 이 세 테스트가 통과해야 3일 관찰 게이트가 열린다.
// ---------------------------------------------------------------------------

test("반례 a: 스포츠 매체+종합뉴스 같은 사건 — 전체 클러스터링 선행으로 스포츠 팩 게이트 통과", () => {
  // 기존 구조(팩으로 자른 뒤 클러스터링)에서는 sports 팩에 스포츠 기사 1건,
  // newsy 팩에 종합뉴스 기사 1건만 남아 **양쪽 다 단일 출처로 탈락**했다
  // (P3-A 결함 2의 확인 반례). R1은 전체 풀에서 먼저 사건을 묶는다.
  const rows = [
    article({ id: "ca-sport", title: "한빛구단 챔피언결정전 우승 확정", category: "sports",
      source: "sport-media", ownershipGroup: "sport-grp", ownershipBasis: "registry_explicit",
      publishedAt: "2026-08-13T11:00:00+09:00" }),
    article({ id: "ca-news", title: "한빛구단 챔피언결정전 우승 확정", category: "news",
      source: "general-news", ownershipGroup: "news-grp", ownershipBasis: "registry_explicit",
      url: "https://other.example.com/ca-news", publishedAt: "2026-08-13T11:10:00+09:00" })
  ];
  const sports = shadowSelectEdition(rows, { packId: "sports", now: NOW });
  assert.equal(sports.counts.events, 1, "전체 클러스터링 후 한 사건");
  assert.equal(sports.selected.length, 1, "스포츠 분야에서 게이트 통과");
  assert.equal(sports.selected[0].gate.passedBy, "independent_groups>=2");
  assert.equal(sports.selected[0].gate.trust.independentReportingGroups, 2, "독립 2");
  // 복수 귀속: 같은 사건이 newsy 팩 후보이기도 하다(구성원 카테고리 분포 기반).
  // 판 간 중복 제거는 R2 합집합 단계에서 한다.
  assert.deepEqual(sports.selected[0].view.packIds, ["newsy", "sports"]);
  assert.deepEqual(sports.selected[0].view.categoryIds, ["news", "sports"]);
  const newsy = shadowSelectEdition(rows, { packId: "newsy", now: NOW });
  assert.equal(newsy.selected.length, 1, "newsy 팩에서도 같은 사건이 보인다(복수 귀속)");
});

// 반례 b 픽스처 — 판 N의 늦은 파편 2건과, 판 N+1에 지연 합류하는 이른 기사.
const cbLate = [
  article({ id: "cb-a", title: "새빛제철 고로 재가동 발표", category: "business",
    source: "news-a", ownershipGroup: "group-a", ownershipBasis: "registry_explicit",
    publishedAt: "2026-08-13T10:00:00+09:00" }),
  article({ id: "cb-b", title: "새빛제철 고로 재가동 발표", category: "business",
    source: "news-b", ownershipGroup: "group-b", ownershipBasis: "registry_explicit",
    url: "https://other.example.com/cb-b", publishedAt: "2026-08-13T10:05:00+09:00" })
];
// 이른 기사(08:00) — 정규화 제목 키가 달라 앵커 교체로 eventId가 바뀐다.
// 사건 토큰은 부분집합("발표"는 일반어로 걷힘) → factsFingerprint 동일.
const cbEarlySame = article({ id: "cb-early", title: "새빛제철 고로 재가동", category: "business",
  source: "news-c", ownershipGroup: "group-c", ownershipBasis: "registry_explicit",
  url: "https://c.example.com/cb-early", publishedAt: "2026-08-13T08:00:00+09:00" });
// 이른 기사 변형 — 새 토큰("중단")이 더해져 지문이 바뀐다(실질 변화).
const cbEarlyChanged = article({ id: "cb-early2", title: "새빛제철 고로 재가동 중단 번복", category: "business",
  source: "news-c", ownershipGroup: "group-c", ownershipBasis: "registry_explicit",
  url: "https://c.example.com/cb-early2", publishedAt: "2026-08-13T08:00:00+09:00" });

test("반례 b: 이른 기사 지연 합류로 eventId가 바뀌어도 계보 승계 — 지문 동일이면 재등장 게이트 차단", () => {
  // 판 N: 선택됨. lineage.records를 판 N+1로 넘긴다.
  const editionN = shadowSelectEdition(cbLate, { packId: "newsy", now: NOW, previousLineage: [] });
  assert.equal(editionN.selected.length, 1);
  const eventIdN = editionN.selected[0].view.event.eventId;
  const lineageIdN = editionN.selected[0].view.lineage.lineageId;

  // 판 N+1: 더 이른 기사가 합류 → 앵커 교체 → eventId 변천.
  const editionN1 = shadowSelectEdition([cbEarlySame, ...cbLate], {
    packId: "newsy", now: NOW, previousLineage: editionN.lineage.records
  });
  assert.equal(editionN1.counts.events, 1);
  const viewN1 = editionN1.excluded.gate[0] && editionN1.excluded.gate[0].view;
  assert.ok(viewN1, "재등장 게이트에 걸려 제외돼야 한다");
  assert.notEqual(viewN1.event.eventId, eventIdN, "eventId가 실제로 바뀌는 반례여야 한다");
  assert.equal(viewN1.lineage.inherited, true, "계보 승계로 같은 사건 판정");
  assert.equal(viewN1.lineage.lineageId, lineageIdN, "lineageId는 판 간 불변");
  assert.equal(editionN1.selected.length, 0, "지문 동일 → 재선택 금지");
  assert.ok(editionN1.excluded.gate[0].gate.failures.includes("reappear_no_material_change"));
});

test("반례 b 대조: 같은 계보라도 실질 변화(지문 변경)가 있으면 재등장 게이트를 통과한다", () => {
  const editionN = shadowSelectEdition(cbLate, { packId: "newsy", now: NOW, previousLineage: [] });
  const lineageIdN = editionN.selected[0].view.lineage.lineageId;
  const editionN1 = shadowSelectEdition([cbEarlyChanged, ...cbLate], {
    packId: "newsy", now: NOW, previousLineage: editionN.lineage.records
  });
  assert.equal(editionN1.selected.length, 1, "새 사실이 더해진 사건은 재선택 허용");
  const view = editionN1.selected[0].view;
  assert.equal(view.lineage.inherited, true, "여전히 같은 계보(같은 사건)");
  assert.equal(view.lineage.lineageId, lineageIdN);
  assert.notEqual(view.event.factsFingerprint, view.lineage.previousFingerprint,
    "지문이 실제로 바뀐 픽스처여야 한다");
});

test("반례 c: 비슷한 구성의 다른 사건이 계보를 가로채 재등장 게이트를 오작동시키지 않는다", () => {
  // 판 N: 사건 X 선택. 판 N+1: 같은 업종·같은 어형의 **다른 사건 Y** —
  // 구성원·제목 키·지문이 전부 달라 승계 근거가 없다. Y가 X의 계보를
  // 가로채면(오승계) X의 지문과 비교돼 부당 차단되거나, X가 실제 재등장할
  // 때 계보를 잃는다. 오병합>미병합 원칙은 계보에도 적용된다.
  const editionN = shadowSelectEdition(cbLate, { packId: "newsy", now: NOW, previousLineage: [] });
  const lineageIdX = editionN.selected[0].view.lineage.lineageId;
  const rowsY = [
    article({ id: "cc-y1", title: "한아름제철 전기로 신설 확정", category: "business",
      source: "news-y1", ownershipGroup: "group-y1", ownershipBasis: "registry_explicit",
      publishedAt: "2026-08-13T11:00:00+09:00" }),
    article({ id: "cc-y2", title: "한아름제철 전기로 신설 확정", category: "business",
      source: "news-y2", ownershipGroup: "group-y2", ownershipBasis: "registry_explicit",
      url: "https://other.example.com/cc-y2", publishedAt: "2026-08-13T11:10:00+09:00" })
  ];
  const editionN1 = shadowSelectEdition(rowsY, {
    packId: "newsy", now: NOW, previousLineage: editionN.lineage.records
  });
  assert.equal(editionN1.selected.length, 1, "무관한 새 사건은 정상 선택된다");
  const view = editionN1.selected[0].view;
  assert.equal(view.lineage.inherited, false, "승계 없음 — 새 계보");
  assert.notEqual(view.lineage.lineageId, lineageIdX, "X의 계보를 가로채지 않는다");
  // X의 계보는 소멸하지 않고 이월된다 — X가 다음 판에 재등장하면 이어진다.
  assert.ok(editionN1.lineage.records.some((row) => row.lineageId === lineageIdX));
});

// ---------------------------------------------------------------------------
// R2 반례 a~d (블루프린트 "2026-08-14 P3-A 판정" 결함 1 — 재발 방지 동결)
// 판 조립의 정본 진입점 shadowSelectBriefing: 선택 분야별 최대 14건 →
// 합집합(lineageId 기준 동일 사건 1회) → 분야별 중요도 층 교차 배치.
// ---------------------------------------------------------------------------

// 분야별로 병합되지 않는 독립 사건(독립 그룹 2로 게이트 통과) 생성기.
// 사건 토큰이 분야·인덱스마다 달라 서로 병합되지 않는다(합성어 토큰이라
// 접두/접미 포함 매칭에도 걸리지 않음).
const CAT_EVENT_WORDS = {
  business: ["전자", "칩", "공정"],
  politics: ["의회", "법안", "표결"],
  tech: ["플랫폼", "모델", "베타"],
  humor: ["웃긴", "짤방", "모음"]
};
const catEvent = (category, index, { score = 0 } = {}) => {
  const base = BASES[index];
  const [w1, w2, w3] = CAT_EVENT_WORDS[category];
  const title = `${base}${w1} ${base}${w2} ${base}${w3} 확대`;
  return [
    article({ id: `${category}-${index}a`, title, category, score,
      source: `${category}-src-${index}a`, ownershipGroup: `${category}-grp-${index}a`,
      ownershipBasis: "registry_explicit",
      url: `https://a.example.com/${category}/${index}`, publishedAt: "2026-08-13T11:00:00+09:00" }),
    article({ id: `${category}-${index}b`, title, category,
      source: `${category}-src-${index}b`, ownershipGroup: `${category}-grp-${index}b`,
      ownershipBasis: "registry_explicit",
      url: `https://b.example.com/${category}/${index}`, publishedAt: "2026-08-13T11:10:00+09:00" })
  ];
};

test("반례 a: business 단독 선택 — politics·tech 전용 사건은 같은 newsy 팩이어도 0건", () => {
  const rows = [
    ...[0, 1, 2].flatMap((index) => catEvent("business", index, { score: 1000 })),
    ...[0, 1].flatMap((index) => catEvent("politics", index, { score: 90000 })), // 반응이 커도 못 들어와야 한다
    ...[0, 1].flatMap((index) => catEvent("tech", index, { score: 90000 }))
  ];
  const out = shadowSelectBriefing(rows, { requestedCategories: ["business"], now: NOW });
  assert.equal(out.counts.perCategorySelected.business, 3);
  assert.equal(out.briefing.length, 3, "business 귀속 사건만");
  for (const entry of out.briefing) {
    assert.ok(entry.view.categoryIds.includes("business"),
      "briefing의 모든 사건은 business 귀속이 있어야 한다");
    assert.deepEqual(entry.selectedByCategories, ["business"]);
  }
  // 후보 단계부터 차단: politics·tech 전용 사건은 business 후보가 아니다.
  assert.equal(out.perCategory.business.counts.candidates, 3);
});

test("반례 b: business+politics — 각 분야가 각자 최대 14건씩 선별된 뒤 합쳐진다 (16건 재발 방지)", () => {
  // 두 분야 모두 공급 15건(동일 S) — 팩 전체 선별이면 newsy 한 판 14건으로
  // 잘리지만, 분야 단위 선별이면 14+14=28건이어야 한다.
  const rows = [
    ...Array.from({ length: 15 }, (_, index) => catEvent("business", index, { score: 10000 })).flat(),
    ...Array.from({ length: 15 }, (_, index) => catEvent("politics", index, { score: 10000 })).flat()
  ];
  const out = shadowSelectBriefing(rows, {
    requestedCategories: ["business", "politics"], now: NOW
  });
  // 분야별 카운트를 **각각** assert — 한쪽 공급이 다른 쪽을 밀어내지 않는다.
  assert.equal(out.counts.perCategorySelected.business, 14, "business 단독 최대 14건");
  assert.equal(out.counts.perCategorySelected.politics, 14, "politics 단독 최대 14건");
  assert.equal(out.briefing.length, 28, "합집합 28건 — 팩 전체 14건 아님");
  const unique = new Set(out.briefing.map((entry) => entry.lineageId));
  assert.equal(unique.size, 28, "동일 사건 중복 0");
});

test("반례 b 비대칭: 한쪽 공급이 많아도 다른 쪽 분야 몫을 밀어내지 않는다", () => {
  const rows = [
    ...Array.from({ length: 15 }, (_, index) => catEvent("business", index, { score: 10000 })).flat(),
    ...Array.from({ length: 4 }, (_, index) => catEvent("politics", index, { score: 10 })).flat()
  ];
  const out = shadowSelectBriefing(rows, {
    requestedCategories: ["business", "politics"], now: NOW
  });
  assert.equal(out.counts.perCategorySelected.business, 14);
  assert.equal(out.counts.perCategorySelected.politics, 4, "공급이 적은 분야는 그만큼만 — 부분");
  assert.equal(out.perCategory.politics.partialEdition, true, "무관 글로 채우지 않는다");
  assert.equal(out.briefing.length, 18);
});

test("반례 c: 두 분야에 다 귀속된 사건은 1회만 — 층·전체 S 규칙대로 배치된다", () => {
  // 교차 귀속 사건 X: business 기사 + politics 기사가 같은 사건(같은 제목).
  const crossTitle = "한빛세제 개편안 국무회의 통과";
  const cross = [
    article({ id: "x-biz", title: crossTitle, category: "business", score: 50000,
      source: "biz-news", ownershipGroup: "grp-x1", ownershipBasis: "registry_explicit",
      publishedAt: "2026-08-13T11:00:00+09:00" }),
    article({ id: "x-pol", title: crossTitle, category: "politics",
      source: "pol-news", ownershipGroup: "grp-x2", ownershipBasis: "registry_explicit",
      url: "https://other.example.com/x-pol", publishedAt: "2026-08-13T11:10:00+09:00" })
  ];
  const rows = [
    ...cross,
    ...catEvent("business", 0, { score: 300 }), // business 2위층
    ...catEvent("politics", 0, { score: 500 })  // politics 2위층
  ];
  const out = shadowSelectBriefing(rows, {
    requestedCategories: ["business", "politics"], now: NOW
  });
  assert.equal(out.counts.perCategorySelected.business, 2);
  assert.equal(out.counts.perCategorySelected.politics, 2);
  assert.equal(out.briefing.length, 3, "교차 귀속 사건은 합집합에서 1회만");
  const crossEntry = out.briefing.find((entry) =>
    entry.view.memberArticles.some((row) => row.id === "x-biz"));
  assert.ok(crossEntry);
  assert.deepEqual(crossEntry.selectedByCategories, ["business", "politics"],
    "어느 분야들에서 뽑혔는지 기록(whyForYou 재료)");
  assert.equal(crossEntry.tier, 1, "양쪽 1위층 → 층 1");
  assert.equal(out.briefing[0], crossEntry, "1위층에서 전체 S 최고 — 맨 앞");
  // 교차 배치: 각 분야의 1위층이 2위층보다 앞선다.
  const tiers = out.briefing.map((entry) => entry.tier);
  assert.deepEqual(tiers, [...tiers].sort((a, b) => a - b), "층 오름차순 배치");
  assert.equal(out.briefing[1].tier, 2);
  assert.ok(out.briefing[1].S >= out.briefing[2].S, "같은 층은 전체 S 내림차순");
});

test("반례 d: 미선택 분야 사건은 일반 지면(briefing)에 자동 혼합되지 않는다", () => {
  const rows = [
    ...[0, 1].flatMap((index) => catEvent("business", index, { score: 100 })),
    // 미선택 분야: 반응이 아무리 커도 briefing에 못 들어온다.
    ...[0, 1].flatMap((index) => catEvent("tech", index, { score: 99999 })),
    article({ id: "d-humor", title: "웃긴짤 오늘자 레전드 모음", kind: "community",
      category: "humor", source: "theqoo", score: 90000, commentCount: 500,
      publishedAt: "2026-08-13T11:30:00+09:00" })
  ];
  const out = shadowSelectBriefing(rows, {
    requestedCategories: ["business", "politics"], now: NOW
  });
  assert.equal(out.briefing.length, 2, "business 사건만");
  for (const entry of out.briefing) {
    const requested = entry.view.categoryIds.some((category) =>
      ["business", "politics"].includes(category));
    assert.ok(requested, "선택 분야 귀속 없는 사건 혼입 0");
  }
  assert.equal(out.counts.perCategorySelected.politics, 0, "공급 없는 선택 분야는 0건 — 채우지 않는다");
});

test("shadowSelectBriefing: 알 수 없는 카테고리·빈 선택은 즉시 오류 (침묵 혼입 방지)", () => {
  assert.throws(() => shadowSelectBriefing([], { requestedCategories: [], now: NOW }));
  assert.throws(() => shadowSelectBriefing([], { requestedCategories: ["nope"], now: NOW }));
});

test("shadowSelectBriefing: 계보 연속 — briefing에 배치된 사건만 다음 판 재등장 게이트 대상", () => {
  const rows = [0, 1].flatMap((index) => catEvent("business", index, { score: 100 }));
  const n0 = shadowSelectBriefing(rows, {
    requestedCategories: ["business"], now: NOW, previousLineage: []
  });
  assert.equal(n0.briefing.length, 2);
  const n1 = shadowSelectBriefing(rows, {
    requestedCategories: ["business"], now: NOW, previousLineage: n0.lineage.records
  });
  assert.equal(n1.briefing.length, 0, "지문 변화 없는 재등장은 전건 차단");
  assert.ok(n1.perCategory.business.excluded.gate.every((entry) =>
    entry.gate.failures.includes("reappear_no_material_change")));
});

test("재등장 게이트는 직전 판에 서빙(선택)된 사건만 차단한다 (검수 P1 수리)", () => {
  // 판 N: cb 사건은 선택되고, U 사건은 단독 출처라 게이트 탈락(서빙 안 됨).
  const u1 = article({ id: "u-solo", title: "월곡시 도서관 야간 개방 시범 운영", category: "business",
    source: "solo-news", ownershipGroup: "group-d", ownershipBasis: "registry_explicit",
    publishedAt: "2026-08-13T10:00:00+09:00" });
  const editionN = shadowSelectEdition([...cbLate, u1], { packId: "newsy", now: NOW, previousLineage: [] });
  assert.equal(editionN.selected.length, 1, "cb 사건만 선택");
  assert.ok(editionN.excluded.gate.some((entry) =>
    entry.gate.failures.includes("trust_reported_secondary_alone")), "U는 신뢰 게이트 탈락");

  // 판 N+1: U에 독립 2번째 출처가 붙는다. 지문은 그대로(같은 제목·같은 사실).
  // 수리 전에는 판 N의 "관찰 지문"이 U까지 차단해 영원히 못 나가는 구조였다.
  const u2 = article({ id: "u-second", title: "월곡시 도서관 야간 개방 시범 운영", category: "business",
    source: "other-news", ownershipGroup: "group-e", ownershipBasis: "registry_explicit",
    url: "https://e.example.com/u-second", publishedAt: "2026-08-13T11:30:00+09:00" });
  const editionN1 = shadowSelectEdition([...cbLate, u1, u2], {
    packId: "newsy", now: NOW, previousLineage: editionN.lineage.records
  });
  const uSelected = editionN1.selected.find((entry) =>
    entry.view.memberArticles.some((row) => row.id === "u-solo"));
  assert.ok(uSelected, "서빙된 적 없는 U는 재등장 게이트에 걸리지 않고 독립 2로 통과해야 한다");
  assert.ok(!uSelected.gate.failures.includes("reappear_no_material_change"));
  // 반대로 판 N에 서빙된 cb 사건은 지문 그대로라 정확히 차단된다.
  assert.ok(editionN1.excluded.gate.some((entry) =>
    entry.view.memberArticles.some((row) => row.id === "cb-a")
    && entry.gate.failures.includes("reappear_no_material_change")));
});

// ---------------------------------------------------------------------------
// R3 — 품질 게이트 배선 (블루프린트 "2026-08-14 P3-A 판정" 결함 3)
// 판정은 현행 코드 재사용: promotion.js lowValueReason(:100)·unpromotableReason
// (:91), profanity.js hasProfanity, deals.js isDeal(:34). 동결 표본은 실제 수집
// 풀(.nowhot-local/feed-data-pool.json, savedAt 2026-08-13T06:59:54Z)의 실물이다.
// ---------------------------------------------------------------------------
import { shadowQualityReason } from "../src/feed/shadow-selection.js";

// 실물 동결: 뽐뿌 커뮤 풀에 들어온 상품권 딜 글 — 가격 표기라 isDeal이 잡는다.
const frozenDealAd = article({
  id: "ad-cultureland", title: "컬쳐랜드 46310원 (쿠폰소진)", kind: "community",
  category: "humor", source: "ppomppu", score: 40, commentCount: 20,
  publishedAt: "2026-08-13T15:30:00+09:00"
});
// 실물 동결: etoland 공인인증점(HIT 랭킹 혼입) 하루특가 광고 — 커뮤 절대선
// (eng 25+2·30=85 ≥ 30)을 통과하는 광고성 글. David HOLD 결함 3의 표본.
const frozenEtolandAd = article({
  id: "ad-etoland", title: "하루특가) 온작 이영자의 뼈없는 갈비탕, 특사이즈, 24인분, 900g, 8개",
  kind: "community", category: "humor", source: "etoland", score: 25, commentCount: 30,
  publishedAt: "2026-08-13T15:57:00+09:00"
});
const QUALITY_NOW = Date.parse("2026-08-13T16:00:00+09:00");

test("품질 게이트 기본 ON: 가격 표기 딜 광고(실물)는 커뮤 절대선 이전에 excluded.quality로 빠진다", () => {
  const out = shadowSelectBriefing([frozenDealAd, frozenEtolandAd], {
    requestedCategories: ["humor"], now: QUALITY_NOW
  });
  const row = out.excluded.quality.find((entry) => entry.articleId === "ad-cultureland");
  assert.ok(row, "딜 광고는 품질 게이트 탈락 기록에 남는다");
  assert.equal(row.reason, "deal_price_or_mall_format");
  assert.equal(row.source, "ppomppu", "감사 가능: 소스·제목·사유 동반");
  assert.ok(!out.briefing.some((entry) =>
    entry.view.memberArticles.some((article_) => article_.id === "ad-cultureland")),
  "탈락 글은 어떤 경로로도 briefing에 오르지 않는다");
  assert.equal(out.counts.qualityExcluded, 1);
});

test("정직 동결 — 알려진 구멍: etoland 하루특가류는 현행 게이트 어느 판정에도 안 걸린다", () => {
  // lowValueReason의 "가격형 특가 광고" 패턴은 제목 첫머리 "특가"만 보고,
  // isDeal은 가격 표기를 요구한다. "하루특가) ..."는 둘 다 비켜 간다.
  // 수리는 promotion.js(현행 코드) 사전 보강이라 이 계층의 범위 밖 — David
  // 게이트 보고 대상이다. promotion.js가 보강되면 이 동결을 갱신하라(그때
  // 이 테스트가 깨지는 것이 의도된 신호다).
  assert.equal(shadowQualityReason(frozenEtolandAd), null);
  const out = shadowSelectBriefing([frozenEtolandAd], {
    requestedCategories: ["humor"], now: QUALITY_NOW
  });
  assert.equal(out.excluded.quality.length, 0, "품질 게이트는 이 광고를 못 잡는다(현행 구멍 — 정직 기록)");
  assert.ok(out.briefing.some((entry) =>
    entry.view.memberArticles.some((article_) => article_.id === "ad-etoland")),
  "커뮤 절대선(eng 85≥30)까지 통과해 판에 오른다 — 결함 3에서 David가 본 표본 오염 그대로");
});

test("품질 게이트 OFF 경계: qualityGate:false면 배선 전과 동일하게 딜 광고도 후보가 된다", () => {
  const on = shadowSelectBriefing([frozenDealAd], { requestedCategories: ["humor"], now: QUALITY_NOW });
  const off = shadowSelectBriefing([frozenDealAd], {
    requestedCategories: ["humor"], now: QUALITY_NOW, qualityGate: false
  });
  assert.equal(on.counts.events, 0, "ON: 클러스터링 전에 빠져 사건 자체가 없다");
  assert.equal(off.counts.events, 1, "OFF: 배선 전 행동 보존(관찰·회귀 대조용)");
  assert.equal(off.excluded.quality.length, 0);
});

test("품질 게이트 사유 사전: 현행 판정별 대표 사례가 각자의 사유로 기록된다", () => {
  // 각 판정의 출처: kind/source 구조 규칙(engine.js 대표 지면 풀 필터),
  // profanity.js, promotion.js:91·100, deals.js:34(커뮤글 한정).
  assert.equal(shadowQualityReason(article({ id: "q1", title: "정상", kind: "ad" })), "kind_ad");
  assert.equal(shadowQualityReason(article({ id: "q2", title: "정상", source: "seed" })), "source_seed");
  assert.equal(shadowQualityReason(
    article({ id: "q3", title: "정상 글", source: "inven_hot" }),
    { offMainSources: new Set(["inven_hot"]) }
  ), "off_main_source");
  assert.equal(shadowQualityReason(article({ id: "q4", title: "300추 가능한가요?" })),
    "low_value:추천 구걸");
  assert.equal(shadowQualityReason(article({ id: "q5", title: "실시간 세르카 나메 2관 파티모집창" })),
    "low_value:모집 공고");
  // 뉴스 보도의 금액 표기는 광고가 아니다 — isDeal은 커뮤글에만 적용(과잉방어
  // 금지: 첫 실측에서 "Nvidia $500 billion 투자" 기사가 걸렸던 오탐의 회귀).
  assert.equal(shadowQualityReason(article({
    id: "q6", title: "Nvidia reckons new $500 billion investment", kind: "news", category: "tech"
  })), null);
  assert.equal(shadowQualityReason(article({ id: "q7", title: "정상 제목의 커뮤 글", kind: "community" })), null);
});

test("shadowSelectEdition(팩 단위)도 같은 품질 게이트를 공유한다", () => {
  const out = shadowSelectEdition([frozenDealAd], { packId: "community", now: QUALITY_NOW });
  assert.equal(out.counts.qualityExcluded, 1);
  assert.equal(out.excluded.quality[0].reason, "deal_price_or_mall_format");
  assert.equal(out.selected.length, 0);
});

// ---------------------------------------------------------------------------
// R3 — 실제 todayEdition 비교기 단위 (tools/eval-shadow-vs-today.mjs, 결함 5)
// ---------------------------------------------------------------------------
import {
  servedSegmentKey, loadServedEdition, listServedEditions, articlesFromPool, diffServedVsShadow
} from "../tools/eval-shadow-vs-today.mjs";

test("비교기 로딩: 저장 키는 서버 저장 규칙(editorialInventorySegmentKey) 그대로", () => {
  // server.js:762가 쓰는 키 규칙 — 정렬·중복 제거·스냅샷 버전 접두.
  assert.equal(servedSegmentKey(["news", "business", "tech", "humor"]),
    servedSegmentKey(["humor", "tech", "business", "news"]), "순서 무관 동일 키");
  assert.match(servedSegmentKey(["business"]), /^v\d+:business$/);
});

test("비교기 로딩: 저장된 판은 그대로, 없으면 found:false — 모형 대체 금지(그게 결함 5였다)", () => {
  const key = servedSegmentKey(["business"]);
  const data = {
    editorialEditions: {
      "2026-08-13": { lunch: { [key]: { generatedAt: "2026-08-13T07:00:00Z", issues: [{ headline: "h", refs: [{ id: "a1" }] }] } } }
    }
  };
  const hit = loadServedEdition(data, { date: "2026-08-13", slotId: "lunch", categories: ["business"] });
  assert.equal(hit.found, true);
  assert.equal(hit.edition.issues.length, 1);
  const missSlot = loadServedEdition(data, { date: "2026-08-13", slotId: "evening", categories: ["business"] });
  assert.equal(missSlot.found, false);
  assert.equal(missSlot.edition, null, "없는 판을 지어내지 않는다");
  const missCombo = loadServedEdition(data, { date: "2026-08-13", slotId: "lunch", categories: ["science"] });
  assert.equal(missCombo.found, false);
  // 빈 판(issues 0)도 서빙판으로 치지 않는다 — 비교할 실물이 없다.
  data.editorialEditions["2026-08-13"].lunch[key].issues = [];
  assert.equal(loadServedEdition(data, { date: "2026-08-13", slotId: "lunch", categories: ["business"] }).found, false);
  assert.equal(listServedEditions(data).length, 0);
});

test("비교기 로딩: 풀 스냅샷은 rows[].item(서버 저장 구조)을 그대로 편다", () => {
  const pool = { savedAt: 1, rows: [{ item: { id: "a" } }, { item: null }, null, { id: "bare" }] };
  assert.deepEqual(articlesFromPool(pool).map((row) => row.id), ["a", "bare"]);
  assert.deepEqual(articlesFromPool(null), []);
});

test("비교기 diff: 진입·탈락(사유 포함)·순위 변화를 가른다", () => {
  // 실제 판 2건: i1은 shadow에도 있고, i2는 shadow 품질 게이트 탈락.
  const edition = {
    issues: [
      { headline: "양쪽 다", refs: [{ id: "n1" }] },
      { headline: "실제에만", refs: [{ id: "ad1" }] }
    ]
  };
  const shadow = {
    briefing: [
      { lineageId: "L1", tier: 1, S: 0.9, selectedByCategories: ["business"],
        view: { memberArticles: [{ id: "n2", title: "shadow에만" }], reactionArticles: [] } },
      { lineageId: "L2", tier: 2, S: 0.8, selectedByCategories: ["business"],
        view: { memberArticles: [{ id: "n1", title: "양쪽 다" }], reactionArticles: [] } }
    ],
    excluded: { quality: [{ articleId: "ad1", reason: "deal_price_or_mall_format" }] },
    perCategory: {}
  };
  const diff = diffServedVsShadow(edition, shadow);
  assert.equal(diff.both.length, 1);
  assert.equal(diff.both[0].served.rank, 1);
  assert.equal(diff.both[0].shadow.rank, 2, "순위 변화 추적(실제 1위→shadow 2위)");
  assert.equal(diff.servedOnly.length, 1);
  assert.match(diff.servedOnly[0].reason, /품질 게이트: deal_price_or_mall_format/);
  assert.equal(diff.shadowOnly.length, 1);
  assert.equal(diff.shadowOnly[0].title, "shadow에만");
});

// ---------------------------------------------------------------------------
// R4 반례 ⓐ~ⓓ — 슬롯 연속(아침→점심→저녁) 재등장 게이트 동결
// (블루프린트 "2026-08-14 P3-A 판정" 결함 4의 관찰 계약).
// 판정 코드는 shadow-selection/event-cluster 무수정 — 이 테스트는 도구가 하는
// "이전 판 상태를 다음 판에 넘기는" 연속 실행 계약 자체를 슬롯 시각으로 동결한다.
// ---------------------------------------------------------------------------

// 슬롯 시각 — digest.js SLOTS publishHour(07·12·19 KST) 계약과 동일 값.
const R4_DATE = "2026-08-13";
const r4At = (hour) => Date.parse(`${R4_DATE}T${String(hour).padStart(2, "0")}:00:00+09:00`);
const R4_MORNING = r4At(7);
const R4_LUNCH = r4At(12);
const R4_EVENING = r4At(19);

// 사건 H(호르무즈형 픽스처): 독립 2그룹 보도. 각 슬롯 판에서 신선하도록 판별
// publishedAt만 바꾸고 제목(사실 토큰 = 지문)은 유지하는 생성기.
const r4EventH = (slotTag, publishedAt) => [
  article({ id: `r4-h-a-${slotTag}`, title: "청라만 해협 봉쇄 위기 고조", category: "business",
    source: "news-a", ownershipGroup: "group-a", ownershipBasis: "registry_explicit",
    url: `https://a.example.com/r4-h-${slotTag}`, publishedAt }),
  article({ id: `r4-h-b-${slotTag}`, title: "청라만 해협 봉쇄 위기 고조", category: "business",
    source: "news-b", ownershipGroup: "group-b", ownershipBasis: "registry_explicit",
    url: `https://b.example.com/r4-h-${slotTag}`, publishedAt })
];
const r4Run = (rows, now, slotId, previousLineage) => shadowSelectBriefing(rows, {
  requestedCategories: ["business"], now, slotId, previousLineage
});

test("R4 반례 ⓐ: 슬롯1 서빙 사건이 변화 없이 슬롯2 후보에 오면 재등장 차단", () => {
  const morning = r4Run(r4EventH("m", "2026-08-13T06:00:00+09:00"), R4_MORNING, "morning", []);
  assert.equal(morning.briefing.length, 1, "아침판 서빙");
  const lineageId = morning.briefing[0].lineageId;
  // 점심: 같은 사실(같은 지문)의 새 게시물 — id·publishedAt만 다르다.
  const lunch = r4Run(r4EventH("l", "2026-08-13T11:30:00+09:00"), R4_LUNCH, "lunch",
    morning.lineage.records);
  assert.equal(lunch.briefing.length, 0, "지문 그대로 → 점심판 재선택 금지");
  const blocked = lunch.perCategory.business.excluded.gate.find((entry) =>
    entry.gate.failures.includes("reappear_no_material_change"));
  assert.ok(blocked, "재등장 사유로 차단돼야 한다");
  assert.equal(blocked.view.lineage.lineageId, lineageId, "계보 승계로 같은 사건 판정");
});

test("R4 반례 ⓑ: 실질 변화(지문 변경)면 슬롯2에서 재통과 — 지문 변천이 관찰된다", () => {
  const morning = r4Run(r4EventH("m", "2026-08-13T06:00:00+09:00"), R4_MORNING, "morning", []);
  const servedFingerprint = morning.briefing[0].view.event.factsFingerprint;
  const lineageId = morning.briefing[0].lineageId;
  // 점심: 원 제목 재게시(계보 승계 근거 — 제목 키 겹침) + 새 사실 토큰
  // ("해제")이 더해진 속보 — 사건 지문이 바뀐다.
  const changed = [
    ...r4EventH("l", "2026-08-13T11:20:00+09:00"),
    article({ id: "r4-h-c", title: "청라만 해협 봉쇄 위기 해제 선언", category: "business",
      source: "news-a", ownershipGroup: "group-a", ownershipBasis: "registry_explicit",
      url: "https://a.example.com/r4-h-c", publishedAt: "2026-08-13T11:30:00+09:00" }),
    article({ id: "r4-h-d", title: "청라만 해협 봉쇄 위기 해제 선언", category: "business",
      source: "news-b", ownershipGroup: "group-b", ownershipBasis: "registry_explicit",
      url: "https://b.example.com/r4-h-d", publishedAt: "2026-08-13T11:35:00+09:00" })
  ];
  const lunch = r4Run(changed, R4_LUNCH, "lunch", morning.lineage.records);
  assert.equal(lunch.briefing.length, 1, "실질 변화는 재통과");
  const entry = lunch.briefing[0];
  assert.equal(entry.lineageId, lineageId, "같은 계보(같은 사건)의 갱신");
  assert.equal(entry.view.lineage.inherited, true);
  assert.equal(entry.view.lineage.previousServedFingerprint, servedFingerprint,
    "직전 서빙 지문이 넘어와 있다");
  assert.notEqual(entry.view.event.factsFingerprint, servedFingerprint, "지문 변천");
});

test("R4 반례 ⓒ: 슬롯1 게이트 탈락(미서빙) 사건은 슬롯2에서 재등장 차단되지 않는다", () => {
  // 아침: 단독 출처라 신뢰 게이트 탈락 — 서빙 안 됨.
  const solo = article({ id: "r4-u-1", title: "달빛시 노면전차 야간 운행 확대", category: "business",
    source: "solo-news", ownershipGroup: "group-u", ownershipBasis: "registry_explicit",
    publishedAt: "2026-08-13T06:00:00+09:00" });
  const morning = r4Run([solo], R4_MORNING, "morning", []);
  assert.equal(morning.briefing.length, 0, "아침판 미서빙");
  // 점심: 독립 2번째 출처가 붙는다. 지문은 그대로(같은 사실).
  const second = article({ id: "r4-u-2", title: "달빛시 노면전차 야간 운행 확대", category: "business",
    source: "other-news", ownershipGroup: "group-v", ownershipBasis: "registry_explicit",
    url: "https://v.example.com/r4-u-2", publishedAt: "2026-08-13T11:30:00+09:00" });
  const lunch = r4Run([solo, second], R4_LUNCH, "lunch", morning.lineage.records);
  assert.equal(lunch.briefing.length, 1, "서빙된 적 없는 사건은 차단 대상이 아니다");
  assert.ok(!lunch.perCategory.business.excluded.gate.some((entry) =>
    entry.gate.failures.includes("reappear_no_material_change")));
});

test("R4 반례 ⓓ: 3연속 체이닝 — 슬롯1 서빙·슬롯2 부재·슬롯3 재등장도 계보 이월로 차단", () => {
  const morning = r4Run(r4EventH("m", "2026-08-13T06:00:00+09:00"), R4_MORNING, "morning", []);
  assert.equal(morning.briefing.length, 1);
  const lineageId = morning.briefing[0].lineageId;
  // 점심: 사건 H는 풀에 없다(쉼) — 무관한 사건만 흐른다.
  const other = [
    article({ id: "r4-o-1", title: "금빛항만 자동화 부두 개장", category: "business",
      source: "news-y1", ownershipGroup: "group-y1", ownershipBasis: "registry_explicit",
      publishedAt: "2026-08-13T11:00:00+09:00" }),
    article({ id: "r4-o-2", title: "금빛항만 자동화 부두 개장", category: "business",
      source: "news-y2", ownershipGroup: "group-y2", ownershipBasis: "registry_explicit",
      url: "https://y2.example.com/r4-o-2", publishedAt: "2026-08-13T11:05:00+09:00" })
  ];
  const lunch = r4Run(other, R4_LUNCH, "lunch", morning.lineage.records);
  assert.ok(!lunch.briefing.some((entry) => entry.lineageId === lineageId), "점심판에 H 없음");
  assert.ok(lunch.lineage.records.some((record) => record.lineageId === lineageId
    && record.lastServedFactsFingerprint), "H 계보는 서빙 지문째 이월된다");
  // 저녁: H가 같은 지문으로 재등장(id·publishedAt만 새것) — 한 판 쉬었어도 차단.
  const evening = r4Run(r4EventH("e", "2026-08-13T18:30:00+09:00"), R4_EVENING, "evening",
    lunch.lineage.records);
  assert.equal(evening.briefing.length, 0, "슬롯3 재등장도 차단");
  const blocked = evening.perCategory.business.excluded.gate.find((entry) =>
    entry.gate.failures.includes("reappear_no_material_change"));
  assert.ok(blocked, "재등장 사유");
  assert.equal(blocked.view.lineage.lineageId, lineageId, "아침판 계보가 저녁까지 이어진다");
});
