import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { FeedStore } from "../src/feed/store.js";

const packet = (id) => ({
  packetId: `packet-${id}`,
  editionId: `edition-${id}`,
  rows: [{ blindId: `BR-${id}` }]
});

test("검수 패킷 원장: 활성 대상은 다음 패킷 저장과 재시작에도 바뀌지 않는다", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "nowhot-review-queue-"));
  const file = path.join(dir, "feed.json");
  try {
    const store = new FeedStore({ file, clock: () => "2026-08-11T00:00:00.000Z" });
    const first = store.saveEditorialReviewPacket(packet("morning"), { date: "2026-08-11", slotId: "morning" });
    store.saveEditorialReviewPacket(packet("lunch"), { date: "2026-08-11", slotId: "lunch" });
    assert.equal(store.activeEditorialReviewPacket().key, first.key);
    assert.equal(store.listEditorialReviewPackets().length, 2);

    const restarted = new FeedStore({ file, clock: () => "2026-08-11T03:00:00.000Z" });
    assert.equal(restarted.activeEditorialReviewPacket().key, first.key);
    restarted.activateEditorialReviewPacket("packet-lunch", "edition-lunch");
    assert.equal(restarted.activeEditorialReviewPacket().slotId, "lunch");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("검수 패킷 원장: 자동 슬롯 표본은 대기열에만 동결하고 명시 조회가 기존 패킷을 활성화할 수 있다", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "nowhot-review-auto-freeze-"));
  const file = path.join(dir, "feed.json");
  try {
    const store = new FeedStore({ file, clock: () => "2026-08-11T00:00:00.000Z" });
    const frozen = store.saveEditorialReviewPacket(packet("morning"), {
      date: "2026-08-11",
      slotId: "morning",
      activateIfEmpty: false
    });
    assert.equal(store.activeEditorialReviewPacket(), null);
    assert.equal(store.listEditorialReviewPackets().length, 1);

    const activated = store.saveEditorialReviewPacket(packet("morning"), {
      date: "2026-08-11",
      slotId: "morning"
    });
    assert.equal(activated.key, frozen.key);
    assert.equal(store.activeEditorialReviewPacket().key, frozen.key);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("검수 패킷 원장: 구버전의 빈 객체 저장값도 최신 대기열 구조로 복구한다", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "nowhot-review-legacy-empty-"));
  const file = path.join(dir, "feed.json");
  try {
    fs.writeFileSync(file, JSON.stringify({ editorialReviewPackets: {} }));
    const store = new FeedStore({ file });
    const saved = store.saveEditorialReviewPacket(packet("legacy"), { activateIfEmpty: false });
    assert.equal(saved.packetId, "packet-legacy");
    assert.equal(store.listEditorialReviewPackets().length, 1);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("판본 저장소: 품질 원장이 날짜·슬롯·공유 조합과 불변 저장 판을 함께 읽는다", () => {
  const store = new FeedStore();
  store.saveEditorialEdition("2026-08-11", "morning", "v13:business", {
    editionId: "edition-morning",
    generatedAt: "2026-08-10T22:00:00.000Z"
  });
  store.saveEditorialEdition("2026-08-11", "lunch", "v13:news", {
    editionId: "edition-lunch",
    generatedAt: "2026-08-11T03:00:00.000Z"
  });
  assert.deepEqual(store.allEditorialEditions().map((row) => ({
    date: row.date,
    slotId: row.slotId,
    segmentKey: row.segmentKey,
    editionId: row.edition.editionId
  })), [
    { date: "2026-08-11", slotId: "morning", segmentKey: "v13:business", editionId: "edition-morning" },
    { date: "2026-08-11", slotId: "lunch", segmentKey: "v13:news", editionId: "edition-lunch" }
  ]);
});

test("검수 조정 원장: 검수자 답과 분리해 재시작 뒤에도 보존한다", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "nowhot-review-adjudication-"));
  const file = path.join(dir, "feed.json");
  try {
    const store = new FeedStore({ file, clock: () => "2026-08-11T00:00:00.000Z" });
    store.saveEditorialReviewPacket(packet("morning"));
    store.saveEditorialReview("packet-morning", "edition-morning", "reviewer-a", [{ blindId: "BR-morning" }]);
    store.saveEditorialReview("packet-morning", "edition-morning", "reviewer-b", [{ blindId: "BR-morning" }]);
    store.saveEditorialReviewAdjudication("packet-morning", "edition-morning", "editorial-adjudicator", [{
      blindId: "BR-morning",
      field: "include",
      value: false,
      notes: "제외"
    }]);

    const restarted = new FeedStore({ file });
    const ledger = restarted.getEditorialReview("packet-morning", "edition-morning");
    assert.equal(ledger.adjudication.adjudicatorId, "editorial-adjudicator");
    assert.equal(ledger.adjudication.resolutions[0].value, false);
    assert.equal(ledger.reviewers["reviewer-a"].reviewerId, "reviewer-a");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
