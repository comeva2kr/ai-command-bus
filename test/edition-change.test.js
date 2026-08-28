import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  EDITION_CHANGE_CONTRACT,
  applyEditionChanges,
  editionSegmentKey
} from "../src/feed/edition-change.js";
import { FeedStore } from "../src/feed/store.js";

function issue(id, {
  title = `사건 ${id} 핵심 변화`,
  subject = `사건 ${id}`,
  category = "news",
  source = "매체A",
  sourceCount = 1,
  coverage = 1,
  score = 10,
  comments = 2,
  evidenceMode = "single_feed_observed"
} = {}) {
  return {
    subject,
    headline: `“${subject}” 현재 관측`,
    paragraph: `${title}에 관해 지금핫이 관측 근거를 바탕으로 정리한 문장이다.`,
    categoryIds: [category],
    metrics: { sourceCount, coverage, score, comments, evidenceMode },
    evidence: {
      mode: evidenceMode,
      observedFeedCount: sourceCount,
      coverage,
      sources: [{ source: source.toLowerCase(), label: source }]
    },
    refs: [{ id, title, sourceLabel: source }]
  };
}

function edition(id, issues, generatedAt = "2026-08-10T03:00:00.000Z") {
  return {
    editionId: id,
    generatedAt,
    selectedCategories: ["news"],
    selection: { maxIssues: 3, minIssuesPerCategory: 1 },
    issues,
    limits: []
  };
}

test("판본 변화: 첫 저장 판은 기준선이며 안정 필드를 채운다", () => {
  assert.equal(EDITION_CHANGE_CONTRACT.version, 9);
  assert.equal(EDITION_CHANGE_CONTRACT.semanticMatch.minimumSharedConcepts, 3);
  assert.deepEqual(EDITION_CHANGE_CONTRACT.semanticMatch.excludedEvidenceRoles, ["related_observation"]);
  const current = edition("2026-08-10-morning-news", [issue("a"), issue("b"), issue("c")]);
  const out = applyEditionChanges(current, null);
  assert.equal(out.editionChange.stableId, EDITION_CHANGE_CONTRACT.stableId);
  assert.equal(out.editionChange.state, "baseline_saved");
  assert.equal(out.editionChange.counts.baseline, 3);
  assert.equal(out.issues.length, 3);
  for (const row of out.issues) {
    assert.equal(row.changeState, "baseline");
    assert.equal(row.repeatEligible, true);
    assert.match(row.clusterId, /^NHC-/);
    assert.deepEqual(row.editionIds, [current.editionId]);
    assert.equal(row.whatHappened, row.paragraph);
    assert.ok(row.changedSincePrevious);
  }
});

test("판본 변화: 분야별 상위 목록은 같은 사건만 한 번 남기고 순위 층별로 섞는다", () => {
  const shared = {
    ...issue("shared", { category: "business" }),
    categoryIds: ["business", "science"]
  };
  const business = Array.from({ length: 14 }, (_, index) =>
    issue(`business-${index}`, { category: "business" }));
  const science = Array.from({ length: 14 }, (_, index) =>
    issue(`science-${index}`, { category: "science" }));
  const rows = [shared, ...business, ...science];
  const current = {
    ...edition("additive-union", rows),
    selectedCategories: ["business", "science"],
    selection: {
      maxIssues: 28,
      minIssuesPerCategory: 3,
      additiveCategoryUnion: true,
      categoryIssueLimit: 14
    }
  };

  const out = applyEditionChanges(current, null);
  const ids = out.issues.map((row) => row.refs[0].id);
  const expected = ["shared"];
  for (let index = 0; index < 13; index += 1) {
    expected.push(`business-${index}`, `science-${index}`);
  }
  assert.equal(out.issues.length, 27);
  assert.deepEqual(ids, expected);
  assert.ok(!ids.includes("business-13"));
  assert.ok(!ids.includes("science-13"));
});

test("판본 변화: 한 분야에서 본 사건도 새로 선택한 다른 분야의 몫까지 지우지 않는다", () => {
  const currentIssue = {
    ...issue("shared", { category: "tech" }),
    selectedByCategories: ["tech", "business"],
    categoryIds: ["tech", "business"]
  };
  const previousTechOnly = {
    ...issue("shared", { category: "tech" }),
    selectedByCategories: ["tech"],
    categoryIds: ["tech"]
  };
  const current = {
    ...edition("lunch", [currentIssue]),
    selectedCategories: ["tech", "business"],
    selection: { maxIssues: 28, additiveCategoryUnion: true, categoryIssueLimit: 14 }
  };

  const firstBusinessExposure = applyEditionChanges(current, edition("morning", [previousTechOnly]));
  assert.equal(firstBusinessExposure.issues.length, 1);
  assert.equal(firstBusinessExposure.issues[0].changeState, "new");

  const previousBoth = { ...previousTechOnly, selectedByCategories: ["tech", "business"], categoryIds: ["tech", "business"] };
  const alreadySeenInBoth = applyEditionChanges(current, edition("morning", [previousBoth]));
  assert.equal(alreadySeenInBoth.issues.length, 0);
  assert.equal(alreadySeenInBoth.editionChange.heldRepeatCount, 1);
});

test("판본 변화: 같은 분야의 중복 행은 14칸을 두 번 소비하지 않는다", () => {
  const duplicateA = {
    ...issue("duplicate-a", { category: "business" }),
    eventSourceSetId: "EV-shared:publisher-a"
  };
  const duplicateB = {
    ...issue("duplicate-b", { category: "business" }),
    eventSourceSetId: "EV-shared:publisher-b"
  };
  const uniqueRows = Array.from({ length: 13 }, (_, index) => ({
    ...issue(`unique-${index}`, { category: "business" }),
    eventSourceSetId: `EV-unique-${index}:publisher-${index}`
  }));
  const current = {
    ...edition("deduplicated-lane-budget", [duplicateA, duplicateB, ...uniqueRows]),
    selectedCategories: ["business"],
    selection: {
      maxIssues: 14,
      minIssuesPerCategory: 14,
      additiveCategoryUnion: true,
      categoryIssueLimit: 14
    }
  };

  const out = applyEditionChanges(current, null);
  assert.equal(out.issues.length, 14);
  assert.equal(out.issues.filter((row) => row.eventSourceSetId?.startsWith("EV-shared:")).length, 1);
  assert.ok(out.issues.some((row) => row.refs[0].id === "unique-12"));
});

test("판본 변화: 과거 사건 ID 하나를 현재의 서로 다른 두 사건이 함께 승계하지 않는다", () => {
  const previous = {
    ...issue("previous", { title: "삼성전자 분기 영업이익 전망 상향", subject: "이전 사건" }),
    clusterId: "NHC-one-previous-event"
  };
  const current = edition("lunch", [
    issue("current-a", { title: "삼성전자 분기 영업이익 전망 상향", subject: "현재 사건 A" }),
    issue("current-b", { title: "삼성전자 분기 영업이익 전망 상향", subject: "현재 사건 B" })
  ]);
  const out = applyEditionChanges(current, edition("morning", [previous]), {
    enforceRepeatRule: false
  });

  assert.equal(out.issues[0].clusterId, "NHC-one-previous-event");
  assert.notEqual(out.issues[1].clusterId, "NHC-one-previous-event");
  assert.equal(new Set(out.issues.map((row) => row.clusterId)).size, 2);
});

test("판본 변화: 같은 원문이라도 관심 분야가 다르면 다른 분야의 과거판이 현재판을 누르지 않는다", () => {
  const previous = issue("shared", { title: "공통 원문 제목", category: "tech" });
  previous.refs[0].canonicalUrl = "https://example.com/shared";
  const current = issue("shared", { title: "공통 원문 제목", category: "business" });
  current.refs[0].canonicalUrl = "https://example.com/shared";

  const out = applyEditionChanges(
    edition("lunch", [current]),
    edition("morning", [previous])
  );
  assert.equal(out.issues[0].changeState, "new");
  assert.equal(out.issues[0].changeEvidence.matchMethod, null);
});

test("판본 변화: 분야 합집합은 핵심 숫자가 다른 별개 사건을 합치지 않는다", () => {
  const current = {
    ...edition("distinct-quarter-events", [
      issue("quarter-3", { title: "삼성전자 3분기 영업이익 전망 발표", subject: "삼성전자 3분기 영업이익", category: "business" }),
      issue("quarter-4", { title: "삼성전자 4분기 영업이익 전망 발표", subject: "삼성전자 4분기 영업이익", category: "science" })
    ]),
    selectedCategories: ["business", "science"],
    selection: {
      maxIssues: 28,
      minIssuesPerCategory: 1,
      additiveCategoryUnion: true,
      categoryIssueLimit: 14
    }
  };
  const out = applyEditionChanges(current, null);
  assert.equal(out.issues.length, 2);
  assert.deepEqual(out.issues.map((row) => row.refs[0].id), ["quarter-3", "quarter-4"]);
});

test("판본 변화: 정본 사건 ID가 같으면 제목과 대표 기사 차이에도 카드 한 장만 남긴다", () => {
  const left = issue("event-news", { title: "이란, 미국 제재 대응 준비", category: "news" });
  const right = issue("event-business", { title: "미국 이란 제재 거래망 강화", category: "business" });
  left.eventSourceSetId = "EV-shared:bbc-world|business-paper";
  right.eventSourceSetId = left.eventSourceSetId;
  const out = applyEditionChanges({
    ...edition("canonical-event-union", [left, right]),
    selectedCategories: ["news", "business"],
    selection: { maxIssues: 28, minIssuesPerCategory: 1, additiveCategoryUnion: true, categoryIssueLimit: 14 }
  }, null);

  assert.equal(out.issues.length, 1);
});

test("판본 변화: 조합별 생성 ID가 달라도 같은 원문이면 카드와 분야 크레딧은 하나로 합친다", () => {
  const left = {
    ...issue("news-copy", { title: "카카오AI 초대 이사회 인선", category: "news" }),
    event: { eventId: "EV-news-generated" },
    refs: [{
      id: "news-copy",
      title: "카카오AI 초대 이사회 인선",
      sourceLabel: "매일경제",
      canonicalUrl: "https://www.mk.co.kr/news/business/123"
    }]
  };
  const right = {
    ...issue("business-copy", { title: "카카오AI 이사회 구성 발표", category: "business" }),
    event: { eventId: "EV-business-generated" },
    refs: [{
      id: "business-copy",
      title: "카카오AI 이사회 구성 발표",
      sourceLabel: "매일경제",
      url: "https://www.mk.co.kr/news/business/123"
    }]
  };
  const out = applyEditionChanges({
    ...edition("canonical-url-union", [left, right]),
    selectedCategories: ["news", "business"],
    selection: { maxIssues: 28, minIssuesPerCategory: 1, additiveCategoryUnion: true, categoryIssueLimit: 14 }
  }, null);

  assert.equal(out.issues.length, 1);
  assert.deepEqual(new Set(out.issues[0].selectedByCategories), new Set(["news", "business"]));
});

test("판본 변화: 새 관측 출처는 실질 변화이고 기존 clusterId를 잇는다", () => {
  const previousIssue = {
    ...issue("same"),
    clusterId: "NHC-previous",
    publishedAt: "2026-08-10T00:00:00.000Z",
    updatedAt: "2026-08-10T00:00:00.000Z"
  };
  const currentIssue = issue("same", {
    source: "매체B",
    sourceCount: 2,
    coverage: 3,
    evidenceMode: "multiple_feed_observed"
  });
  currentIssue.evidence.sources.unshift({ source: "a", label: "매체A" });
  const out = applyEditionChanges(
    edition("lunch", [currentIssue], "2026-08-10T05:00:00.000Z"),
    edition("morning", [previousIssue], "2026-08-10T00:00:00.000Z"),
    { targetLimit: 3 }
  );
  assert.equal(out.issues[0].changeState, "material_update");
  assert.equal(out.issues[0].repeatEligible, true);
  assert.equal(out.issues[0].clusterId, "NHC-previous");
  assert.match(out.issues[0].changedSincePrevious, /지난 브리핑에서 다룬 사안/);
  assert.match(out.issues[0].changedSincePrevious, /매체B 보도가 새로 확인/);
  assert.ok(out.issues[0].changeEvidence.reasons.includes("evidence_mode_changed"));
});

test("판본 변화: 기사와 clusterId가 달라도 호르무즈 협상 핵심 사건어가 같으면 지난 브리핑을 잇는다", () => {
  const previousIssue = {
    ...issue("voa-hormuz", {
      title: "미-이란 호르무즈 협상 난항…국제유가 다시 상승",
      subject: "미-이란 호르무즈 협상 난항",
      category: "business",
      source: "VOA 한국어 홈페이지",
      coverage: 5
    }),
    clusterId: "NHC-hormuz-talks"
  };
  const currentIssue = issue("namdo-hormuz", {
    title: "[미국시황]호르무즈 협상 난항에 국제유가 급등…뉴욕증시 일제히 하락",
    subject: "호르무즈 협상 난항에 국제유가 급등",
    category: "business",
    source: "남도일보",
    coverage: 5
  });
  const out = applyEditionChanges(
    edition("lunch", [currentIssue], "2026-08-11T03:01:00.000Z"),
    edition("morning", [previousIssue], "2026-08-10T22:03:00.000Z"),
    { targetLimit: 3 }
  );
  assert.equal(out.issues[0].clusterId, "NHC-hormuz-talks");
  assert.equal(out.issues[0].changeState, "material_update");
  assert.equal(out.issues[0].changeEvidence.matchMethod, "shared_event_concepts");
  assert.deepEqual(out.issues[0].changeEvidence.matchedTerms.slice(0, 3), ["호르무즈", "협상", "난항"]);
  assert.match(out.issues[0].changedSincePrevious, /지난 브리핑에서 다룬 사안/);
  assert.doesNotMatch(out.issues[0].changedSincePrevious, /새 사건|이전 판/);
});

test("판본 변화: 호르무즈 한 단어만 같은 기뢰 제거와 협상 난항은 별개 사건으로 둔다", () => {
  const previousIssue = issue("hormuz-mines", {
    title: "트럼프 호르무즈 기뢰 모두 제거 주장",
    subject: "호르무즈 기뢰 제거 주장",
    category: "business"
  });
  const currentIssue = issue("hormuz-talks", {
    title: "호르무즈 협상 난항에 국제유가 급등",
    subject: "호르무즈 협상 난항",
    category: "business"
  });
  const out = applyEditionChanges(edition("lunch", [currentIssue]), edition("morning", [previousIssue]));
  assert.equal(out.issues[0].changeState, "new");
  assert.equal(out.issues[0].changeEvidence.matchMethod, null);
  assert.match(out.issues[0].changedSincePrevious, /지난 브리핑에서는 다루지 않은/);
});

test("판본 변화: 브랜드와 공개 일반어만 같은 서로 다른 갤럭시 제품 발표는 합치지 않는다", () => {
  const previousIssue = {
    ...issue("galaxy-fold", {
      title: "삼성 갤럭시 Z 폴드8 공개",
      subject: "삼성 갤럭시 Z 폴드8 공개",
      category: "tech"
    }),
    clusterId: "NHC-galaxy-fold8"
  };
  const currentIssue = issue("galaxy-watch", {
    title: "삼성 갤럭시 워치8 공개",
    subject: "삼성 갤럭시 워치8 공개",
    category: "tech"
  });
  const out = applyEditionChanges(
    edition("lunch", [currentIssue], "2026-08-11T03:01:00.000Z"),
    edition("morning", [previousIssue], "2026-08-10T22:03:00.000Z"),
    { targetLimit: 3 }
  );
  assert.equal(out.issues[0].changeState, "new");
  assert.notEqual(out.issues[0].clusterId, "NHC-galaxy-fold8");
  assert.equal(out.issues[0].changeEvidence.matchMethod, null);
});

test("판본 변화: 자동 생성 본문만 같은 별개 사건을 과거 사건으로 잇지 않는다", () => {
  const generatedCopy = "관련 보도에 관해 지금핫이 관측 근거를 바탕으로 정리한 문장입니다.";
  const previous = {
    ...issue("flood", { title: "서울 도심 집중호우 침수 피해 집계", subject: "서울 도심 집중호우", category: "news" }),
    whatHappened: generatedCopy,
    clusterId: "NHC-seoul-flood"
  };
  const current = {
    ...issue("mars", { title: "화성 탐사선 지하 얼음층 발견", subject: "화성 지하 얼음층", category: "news" }),
    whatHappened: generatedCopy
  };
  const out = applyEditionChanges(
    edition("lunch", [current]),
    edition("morning", [previous])
  );

  assert.equal(out.issues[0].changeState, "new");
  assert.equal(out.issues[0].repeatEligible, true);
  assert.notEqual(out.issues[0].clusterId, previous.clusterId);
  assert.equal(out.issues[0].changeEvidence.matchMethod, null);
});

test("판본 변화: 관련기사 관측 제목은 다음 판 사건 정체성으로 사용하지 않는다", () => {
  const previousIssue = {
    ...issue("culture-event", {
      title: "서울 독립출판 문화행사 개막",
      subject: "서울 독립출판 문화행사 개막",
      category: "news"
    }),
    clusterId: "NHC-culture-event",
    sourceEvidence: [
      { evidenceId: "lead", title: "서울 독립출판 문화행사 개막", evidenceRole: "lead" },
      { evidenceId: "related", title: "신약 임상시험 3상 대상 공개", evidenceRole: "related_observation" }
    ]
  };
  previousIssue.refs.push({ id: "related", title: "신약 임상시험 3상 대상 공개", sourceLabel: "과학뉴스" });
  const currentIssue = issue("clinical-trial", {
    title: "신약 임상시험 3상 대상 공개",
    subject: "신약 임상시험 3상 대상 공개",
    category: "news"
  });
  const out = applyEditionChanges(edition("lunch", [currentIssue]), edition("morning", [previousIssue]));
  assert.equal(out.issues[0].changeState, "new");
  assert.notEqual(out.issues[0].clusterId, "NHC-culture-event");
});

test("판본 변화: 반응 수치만 달라진 반복은 새 사건 대체 후보가 있을 때 보류한다", () => {
  const previous = edition("morning", [issue("same", { score: 10, comments: 2 })]);
  const current = edition("lunch", [
    issue("same", { score: 30, comments: 9 }),
    issue("new-a"),
    issue("new-b")
  ]);
  const out = applyEditionChanges(current, previous, { targetLimit: 2 });
  assert.deepEqual(out.issues.map((row) => row.refs[0].id), ["new-a", "new-b"]);
  assert.equal(out.editionChange.counts.reaction_update, 1);
  assert.equal(out.editionChange.heldRepeatCount, 1);
  assert.equal(out.editionChange.reactionThreshold, "none");
});

test("판본 변화: 바로 전 판에 없어도 같은 날 앞선 브리핑의 사건을 새 소식으로 되돌리지 않는다", () => {
  const morningIssue = {
    ...issue("morning-fashion", {
      title: "You’ll Only Find This Scrumptious New Balance Dad Shoe in Japan",
      subject: "Youll Only Find This Scrumptious New Balance Dad Shoe in Japan",
      category: "fashion",
      source: "하이스노바이어티"
    }),
    clusterId: "NHC-morning-shoe",
    editionIds: ["morning"]
  };
  const lunch = edition("lunch", [issue("lunch-only")]);
  const eveningRepeat = issue("evening-fashion", {
    title: "You’ll Only Find This Scrumptious New Balance Dad Shoe in Japan",
    subject: "Youll Only Find This Scrumptious New Balance Dad Shoe in Japan",
    category: "fashion",
    source: "하이스노바이어티"
  });
  const current = edition("evening", [eveningRepeat, issue("new-a"), issue("new-b")]);
  const projected = applyEditionChanges(current, lunch, {
    targetLimit: 3,
    enforceRepeatRule: false,
    historyEditions: [edition("morning", [morningIssue])]
  });
  assert.equal(projected.issues[0].changeState, "unchanged");
  assert.equal(projected.issues[0].clusterId, "NHC-morning-shoe");
  assert.equal(projected.issues[0].changeEvidence.matchedEditionId, "morning");
  assert.deepEqual(projected.issues[0].editionIds, ["morning", "evening"]);
  assert.doesNotMatch(projected.issues[0].changedSincePrevious, /다루지 않은/);

  const filtered = applyEditionChanges(current, lunch, {
    targetLimit: 2,
    historyEditions: [edition("morning", [morningIssue])]
  });
  assert.deepEqual(filtered.issues.map((row) => row.refs[0].id), ["new-a", "new-b"]);
  assert.equal(filtered.editionChange.heldRepeatCount, 1);
  assert.deepEqual(filtered.editionChange.comparedEditionIds, ["lunch", "morning"]);
});

test("판본 조합 키는 선택 순서와 무관하다", () => {
  assert.equal(editionSegmentKey(["tech", "news", "tech"]), "news.tech");
});

test("스토어: 로컬 판본·이전 슬롯·독립 검수자 원장을 재시작 뒤에도 보존한다", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "nowhot-edition-change-"));
  const file = path.join(dir, "feed.json");
  try {
    const store = new FeedStore({ file });
    store.saveEditorialEdition("2026-08-10", "morning", "news.tech", { editionId: "morning", issues: [] });
    store.saveEditorialEdition("2026-08-10", "lunch", "news.tech", { editionId: "lunch", issues: [] });
    assert.equal(
      store.previousEditorialEdition("2026-08-10", "evening", "news.tech", ["morning", "lunch", "evening"]).editionId,
      "lunch"
    );
    assert.deepEqual(
      store.priorEditorialEditions("2026-08-10", "evening", "news.tech", ["morning", "lunch", "evening"])
        .map((row) => row.editionId),
      ["lunch", "morning"]
    );
    store.saveEditorialReview("packet", "lunch", "reviewer-a", [{ blindId: "BR-1", include: true }]);

    const reloaded = new FeedStore({ file });
    assert.equal(reloaded.getEditorialEdition("2026-08-10", "morning", "news.tech").editionId, "morning");
    assert.equal(reloaded.getEditorialReview("packet", "lunch", "reviewer-a").annotations[0].include, true);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
