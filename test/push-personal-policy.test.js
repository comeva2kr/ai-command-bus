import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { FeedStore } from "../src/feed/store.js";
import { FeedEngine } from "../src/feed/engine.js";
import { sendDigestPushes, sendEditionPushes } from "../src/feed/push.js";
import { decideEventMerge } from "../src/feed/event-cluster.js";

const vapid = { publicKey: "public", privateKey: "private", subject: "mailto:test@example.test" };
const kst = (time, date = "2026-09-08") => `${date}T${time}+09:00`;
const news = (id, title = "인공지능 연구 결과 공식 발표", category = "tech") => ({
  id, title, category, source: `test-${id}`, sourceLabel: "시험 매체", kind: "news",
  url: `https://example.test/news/${id}`, topics: [], tags: [], score: 30,
  commentCount: 0, coverage: 4, length: 500
});
const independent = () => news("charging", "전기차 충전 표준 공식 발표", "auto");

function setup(time = "09:00:00", file = null) {
  let at = kst(time), rows = [news("research")];
  const clock = () => at;
  let store = new FeedStore({ clock, file });
  const userId = store.createUser("personal-policy").id;
  store.saveSurvey(userId, { categories: ["tech", "auto", "realestate"] });
  store.savePushSubscription(userId, { endpoint: "https://push.example.test/policy" });
  const makeEngine = () => {
    const engine = new FeedEngine(store, []);
    engine._clock = clock;
    // Replace collection only; real digest ranking, interests and safety gates run.
    engine._items = async () => rows.map(row => ({ publishedAt: at, ...row }));
    return engine;
  };
  let engine = makeEngine();
  const delivered = [];
  const sendImpl = async (subscription, raw, keys, options) => {
    delivered.push({ payload: JSON.parse(raw), options });
    return { status: 201 };
  };
  const reader = { read: async ({ date, slotId }) => ({ editionDate: date, slot: { id: slotId },
    serving: { state: "slot_canonical_verified", fallback: false }, issues: [{}] }) };
  return {
    get store() { return store; }, get user() { return store.getUser(userId); },
    get engine() { return engine; }, clock, reader, delivered,
    setTime(time, date) { at = kst(time, date); },
    setRows(next) { rows = next; },
    restart() { store = new FeedStore({ file, clock }); engine = makeEngine(); },
    live(options = {}) { return sendDigestPushes(store, engine, vapid,
      { alertsOnly: true, limit: 5, minScore: 0, clock, sendImpl, ...options }); },
    edition(options = {}) { return sendEditionPushes(store, reader, vapid, { clock, sendImpl, ...options }); }
  };
}

test("NH152 KST boundaries reserve 30 minutes around Today and keep all pushes inside 07–21", async () => {
  const cases = [
    ["06:59:59", 0, 0], ["07:00:00", 0, 1], ["07:29:59", 0, 1], ["07:30:00", 1, 1],
    ["11:29:59", 1, 1], ["11:30:00", 0, 1], ["11:59:59", 0, 1], ["12:00:00", 0, 1],
    ["12:29:59", 0, 1], ["12:30:00", 1, 1], ["18:29:59", 1, 1], ["18:30:00", 0, 1],
    ["18:59:59", 0, 1], ["19:00:00", 0, 1], ["19:29:59", 0, 1], ["19:30:00", 1, 1],
    ["20:59:59", 1, 1], ["21:00:00", 0, 0]
  ];
  const actual = [];
  for (const [time] of cases) {
    const live = setup(time), edition = setup(time);
    actual.push([time, (await live.live()).sent, (await edition.edition()).sent]);
  }
  assert.deepEqual(actual, cases);
  for (const time of ["06:59:59", "21:00:00"]) {
    assert.equal((await setup(time).live({ alertsOnly: false })).sent, 0, `general digest at ${time}`);
  }
});

test("NH152 personal alerts allow 3+3+2 successful sends across restarts without consuming three Today editions", async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "nh152-push-cadence-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const h = setup("07:00:00", path.join(dir, "store.json"));
  assert.equal((await h.edition()).sent, 1);
  assert.equal((await h.edition()).sent, 0, "each edition is delivered only once");
  const morning = [news("research"), independent(),
    news("housing", "8·13 부동산대책 발표…대출 규제 대폭 강화", "realestate")];
  for (const [index, time] of ["07:30:00", "08:30:00", "09:30:00"].entries()) {
    h.setTime(time); h.setRows([morning[index]]);
    assert.equal((await h.live()).sent, 1, `morning alert ${index + 1}`);
  }
  h.restart();
  h.setRows([news("chip", "삼성전자 2나노 반도체 양산 수율 70% 달성")]);
  h.setTime("10:30:00");
  assert.equal((await h.live()).sent, 0, "restart preserves the exhausted morning budget");
  h.setTime("12:00:00"); assert.equal((await h.edition()).sent, 1);
  for (const [time, item] of [
    ["12:30:00", news("chip", "삼성전자 2나노 반도체 양산 수율 70% 달성")],
    ["13:30:00", news("rocket", "누리호 발사 성공…달 탐사선 목표 궤도 진입")],
    ["14:30:00", news("battery", "현대차 전고체 배터리 전기차 주행거리 1000km 인증", "auto")]
  ]) {
    h.setTime(time); h.setRows([item]);
    assert.equal((await h.live()).sent, 1, `afternoon alert at ${time}`);
  }
  h.setRows([news("quantum", "양자컴퓨터 오류 보정 신기록…연산 정확도 99.9% 입증")]);
  h.setTime("15:30:00"); assert.equal((await h.live()).sent, 0, "afternoon also stops after three");
  h.setTime("19:00:00"); assert.equal((await h.edition()).sent, 1);
  h.setTime("19:29:59"); assert.equal((await h.live()).sent, 0);
  h.setTime("19:30:00"); assert.equal((await h.live()).sent, 1);
  h.setRows([news("security", "메신저 보안 취약점 긴급 패치…계정 탈취 차단")]);
  h.setTime("20:29:59"); assert.equal((await h.live()).sent, 0, "Live spacing remains 60 minutes");
  h.setTime("20:30:00"); assert.equal((await h.live()).sent, 1, "second evening alert fits before 21:00");
  assert.equal(h.user.pushDeliveryTimes.length, 8);
  assert.equal(h.delivered.filter(row => row.payload.kind === "live").length, 8);
  assert.deepEqual(h.delivered.filter(row => row.payload.kind === "edition").map(row => row.payload.tag),
    ["today:2026-09-08:morning", "today:2026-09-08:lunch", "today:2026-09-08:evening"]);
  h.setRows([news("robots", "물류 로봇 공장 자동화 시스템 전국 도입")]);
  h.setTime("07:30:00", "2026-09-09");
  assert.equal((await h.live()).sent, 1, "next KST day reopens the personal budget");
});

test("NH152 a delayed verified Today has priority and Live waits 30 minutes from its actual delivery", async () => {
  const delayed = setup("12:00:00"), verifiedRead = delayed.reader.read;
  delayed.reader.read = async request => ({ ...(await verifiedRead(request)), serving: { state: "unverified" } });
  assert.deepEqual([await delayed.edition(), await delayed.live()], [{ sent: 0, failed: 0 }, { sent: 0, failed: 0 }]);
  delayed.setTime("12:30:00"); assert.equal((await delayed.live()).sent, 1);
  delayed.reader.read = verifiedRead;
  delayed.setTime("13:10:00");
  assert.equal((await delayed.edition()).sent, 1, "late Today is not starved by a recent Live alert");
  assert.equal((await delayed.edition()).sent, 0);
  delayed.setRows([independent()]);
  delayed.setTime("13:39:59"); assert.equal((await delayed.live()).sent, 0);
  delayed.setTime("13:40:00"); assert.equal((await delayed.live()).sent, 1, "30-minute gap starts at actual edition delivery");
});

test("NH152 a new interval does not erase the Live gap measured at provider acceptance", async () => {
  const h = setup("11:29:59");
  assert.equal((await h.live({ sendImpl: async () => {
    h.setTime("11:30:01");
    return { status: 201 };
  } })).sent, 1);
  h.setTime("12:00:00"); assert.equal((await h.edition()).sent, 1);
  h.setRows([independent()]);
  h.setTime("12:30:00"); assert.equal((await h.live()).sent, 0, "new interval cannot bypass a 59:59 Live gap");
  h.setTime("12:30:01"); assert.equal((await h.live()).sent, 1);
});

test("NH150 overlapping Live and Today runs cannot deliver twice to one subscriber", { timeout: 2000 }, async () => {
  for (const firstKind of ["live", "edition"]) {
    const h = setup();
    let enter, release, sendCount = 0;
    const entered = new Promise(resolve => { enter = resolve; });
    const pending = new Promise(resolve => { release = resolve; });
    const first = h[firstKind]({ sendImpl: async () => { sendCount++; enter(); return pending; } });
    await entered;
    let overlapping;
    try {
      overlapping = await h[firstKind === "live" ? "edition" : "live"]({
        sendImpl: async () => { sendCount++; return { status: 201 }; }
      });
    } finally { release({ status: 201 }); await first; }
    assert.equal(sendCount, 1, firstKind);
    assert.deepEqual(overlapping, { sent: 0, failed: 0 }, firstKind);
  }
});

test("NH150 work started before 21:00 cannot send after an asynchronous digest or edition read crosses the fence", async () => {
  for (const kind of ["live", "edition"]) {
    const h = setup("20:59:59");
    if (kind === "live") {
      const collect = h.engine._items;
      h.engine._items = async () => { const rows = await collect(); h.setTime("21:00:00"); return rows; };
    } else {
      const read = h.reader.read;
      h.reader.read = async request => { const edition = await read(request); h.setTime("21:00:00"); return edition; };
    }
    assert.deepEqual(await h[kind](), { sent: 0, failed: 0 }, kind);
    assert.equal(h.delivered.length, 0, kind);
    assert.equal((h.user.pushDeliveryTimes || []).length + (h.user.editionPushDeliveries || []).length, 0);
  }
});

test("NH150 push lifetime is one hour for Live, two for Today, and both expire by 21:00", async () => {
  for (const [kind, time, ttl, expiresAt] of [
    ["live", "09:00:00", 3600, "2026-09-08T01:00:00.000Z"],
    ["edition", "12:00:00", 7200, "2026-09-08T05:00:00.000Z"],
    ["live", "20:59:30", 30, "2026-09-08T12:00:00.000Z"],
    ["edition", "20:59:30", 30, "2026-09-08T12:00:00.000Z"]
  ]) {
    const h = setup(time);
    assert.equal((await h[kind]()).sent, 1, `${kind} at ${time}`);
    assert.equal(h.delivered[0].options.ttl, ttl, `${kind} TTL at ${time}`);
    assert.equal(new Date(h.delivered[0].payload.expiresAt).toISOString(), expiresAt);
  }
});

test("NH150 successful event history survives restart and suppresses changed IDs while a new independent event survives", async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "nh150-push-policy-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const h = setup("09:00:00", path.join(dir, "store.json"));
  h.setRows([news("housing-first", "8·13 부동산대책 발표…대출 규제 대폭 강화", "realestate")]);
  assert.equal((await h.live()).sent, 1);
  h.restart();
  h.setTime("10:00:00");
  h.setRows([news("housing-other-source", "정부 8·13 대책, 다주택자 대출 정조준", "realestate")]);
  assert.deepEqual(await h.live(), { sent: 0, failed: 0 }, "same event, unrelated article ID and publisher");
  h.setRows([news("housing-third", "8·13 부동산대책에 시장 술렁…대출 문턱 높아진다", "realestate"), independent()]);
  assert.equal((await h.live()).sent, 1, "unrelated event still makes it through the real digest");
  assert.equal(h.delivered.at(-1).payload.url, "/live?nh-open=charging");
  assert.equal(h.user.pushDeliveryTimes.length, 2);
  assert.deepEqual(h.user.seen, []);
  assert.deepEqual(h.user.opened || [], []);
});

test("NH150 declined and failed sends consume no receipt, allowing an immediate successful retry", async () => {
  for (const kind of ["live", "edition"]) {
    const h = setup();
    for (const failure of [429, "throw"]) {
      assert.deepEqual(await h[kind]({ sendImpl: async () => {
        if (failure === "throw") throw new Error("synthetic network failure");
        return { status: failure };
      } }), { sent: 0, failed: 1 });
      assert.equal((h.user.pushDeliveryTimes || []).length + (h.user.editionPushDeliveries || []).length, 0);
      assert.deepEqual(h.user.pushNotified || [], []);
    }
    assert.deepEqual(await h[kind](), { sent: 1, failed: 0 }, kind);
    assert.equal((h.user.pushDeliveryTimes || []).length + (h.user.editionPushDeliveries || []).length, 1);
  }
});

test("NH150 retained original titles keep a background incident from suppressing a different investigation", async () => {
  const h = setup("09:00:00");
  h.setRows([{ ...news("german-website", "OpenAI 요원은 Hugging Face 해킹 이전에 독일 웹사이트를 하이재킹했습니다."),
    originalTitle: "OpenAI agents hijacked German website before Hugging Face hack, report claims" }]);
  assert.equal((await h.live()).sent, 1);
  h.setTime("10:00:00");
  h.setRows([{ ...news("california-probe", "캘리포니아 AG Rob Bonta는 Hugging Face 해킹에 대해 OpenAI를 조사하고 있습니다."),
    originalTitle: "California AG Rob Bonta is investigating OpenAI over the Hugging Face hack in July, after more than a dozen states joined Alabama in its investigation (Chase DiFeliciantonio/Politico)" }]);
  assert.equal((await h.live()).sent, 1, "German website incident and California investigation are separate news events");
  assert.equal(h.delivered.at(-1).payload.url, "/live?nh-open=california-probe");
});

test("NH152 a new confirmed outcome can follow a scheduled event once, including after restart", async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "nh152-push-followup-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const h = setup("09:00:00", path.join(dir, "store.json"));
  const planned = news("chip-plan", "삼성전자 2나노 반도체 양산 예정");
  h.setRows([planned]); assert.equal((await h.live()).sent, 1);
  h.restart(); h.setTime("10:00:00");
  const confirmed = news("chip-confirmed", "삼성전자 2나노 반도체 양산 확정");
  assert.equal(decideEventMerge({ ...planned, publishedAt: kst("09:00:00") },
    { ...confirmed, publishedAt: h.clock() }).merge, true, "this is the same event, not a clustering miss");
  h.setRows([confirmed]); assert.equal((await h.live()).sent, 1, "new outcome survives the 24-hour event block");
  h.setTime("11:00:00");
  h.setRows([news("chip-restated", "삼성전자 2나노 반도체 양산 확정…업계 주목")]);
  assert.equal((await h.live()).sent, 0, "another report of the confirmed outcome is still a duplicate");
  assert.equal(h.user.pushDeliveryTimes.length, 2);
});

test("NH152 follow-up requires a newer unambiguous news outcome, never mere wording or an already seen article", async () => {
  const planned = news("chip-plan", "삼성전자 2나노 반도체 양산 예정");
  for (const change of [
    { title: "삼성전자 2나노 반도체 양산 예정…업계 주목", coverage: 20 },
    { title: "삼성전자 2나노 반도체 양산 확정 예정" },
    { title: "삼성전자 2나노 반도체 양산 성공 가능성" },
    { title: "삼성전자 2나노 반도체 양산 확정?" },
    { title: "삼성전자 2나노 반도체 양산 확정 아냐" },
    ...["성공 기대", "성공 기원", "승인 요청", "승인 신청", "확정 여부", "실패 우려", "확정 보도 부인", "확정 오보"]
      .map(ending => ({ title: `삼성전자 2나노 반도체 양산 ${ending}` })),
    { title: "삼성전자 2나노 반도체 양산 확정", publishedAt: kst("08:00:00") },
    { title: "삼성전자 2나노 반도체 양산 성공", kind: "community", score: 1000, heatHist: [20, 100, 300] },
    { title: "삼성전자 2나노 반도체 양산 확정", id: planned.id },
    { title: "삼성전자 2나노 반도체 양산 확정", canonicalAliases: [{ id: planned.id }] }
  ]) {
    const h = setup(); h.setRows([planned]); assert.equal((await h.live()).sent, 1);
    h.setTime("10:00:00"); h.setRows([{ ...news("changed"), ...change }]);
    assert.equal((await h.live()).sent, 0, JSON.stringify(change));
  }
  for (const ending of ["allegedly failed", "reportedly confirmed", "approval requested and approved claim"]) {
    const h = setup(); h.setRows([news("rocket-plan", "SpaceX Starship lunar mission launch scheduled")]);
    assert.equal((await h.live()).sent, 1);
    h.setTime("10:00:00");
    h.setRows([news("rocket-result", `SpaceX Starship lunar mission launch ${ending}`)]);
    assert.equal((await h.live()).sent, 0, ending);
  }
});
