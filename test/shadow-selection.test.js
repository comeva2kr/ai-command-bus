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
  shadowSelectEdition, packIdForArticle, resolveSourceRole, overrideShadowParams
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
