import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { FeedStore } from "../src/feed/store.js";
import { sendDigestPushes, sendEditionPushes } from "../src/feed/push.js";

const vapid = { publicKey: "public", privateKey: "private", subject: "mailto:test@example.test" };
const article = (id, extra = {}) => ({ id, title: `Safe ${id}`, ...extra });

function setup(initialItems = [article("A")], initialTime = "2026-09-03T00:00:00.000Z") {
  let items = initialItems;
  let at = initialTime;
  const clock = () => at;
  const store = new FeedStore({ clock });
  const user = store.createUser("push-user");
  store.savePushSubscription(user.id, { endpoint: "https://push.example.test/user" });
  const digestCalls = [];
  const deliveries = [];
  const engine = {
    async digest(userId, options) {
      digestCalls.push({ userId, ...options });
      const excluded = new Set(options.excludeIds || []);
      const available = items.filter((item) => !excluded.has(item.id)
        && !(item.canonicalAliases || []).some((alias) => excluded.has(alias.id)));
      return { count: available.length, top: available.slice(0, options.limit) };
    }
  };
  const sendImpl = async (subscription, payload) => {
    deliveries.push({ subscription, payload: JSON.parse(payload) });
    return { status: 201 };
  };
  return {
    store, user, engine, digestCalls, deliveries,
    setItems: (next) => { items = next; },
    setTime: (next) => { at = next; },
    run: (options = {}) => sendDigestPushes(store, engine, vapid, { clock, sendImpl, ...options })
  };
}

test("push delivery records accepted top IDs and canonical aliases without consuming seen/opened", async () => {
  const h = setup([
    article("A", { canonicalAliases: [{ id: "old-A" }, { id: "A" }] }),
    article("B"), article("C")
  ]);
  h.user.opened = ["unrelated"];
  const opened = structuredClone(h.user.opened);
  assert.deepEqual(await h.run({ limit: 2, minScore: 2.5 }), { sent: 1, failed: 0 });
  assert.deepEqual(h.user.pushNotified, ["A", "old-A", "B"].map((id) => ({ id, at: "2026-09-03T00:00:00.000Z" })));
  assert.deepEqual(h.user.pushDeliveryTimes, ["2026-09-03T00:00:00.000Z"]);
  assert.deepEqual(h.user.seen, []);
  assert.deepEqual(h.user.opened, opened);
  assert.deepEqual(h.digestCalls[0], { userId: h.user.id, limit: 2, minScore: 2.5, excludeIds: [] });
  assert.equal(h.deliveries[0].payload.url, "/live#post-A");
  assert.ok(h.deliveries[0].payload.body.includes("Safe A"));
});

test("push delivery excludes the full A-B-A history and canonical replacements before digest selection", async () => {
  const h = setup([article("A", { canonicalAliases: [{ id: "old-A" }] })]);
  assert.deepEqual(await h.run(), { sent: 1, failed: 0 });
  h.setTime("2026-09-03T04:00:00.000Z");
  h.setItems([article("B")]);
  assert.deepEqual(await h.run(), { sent: 1, failed: 0 });
  h.setTime("2026-09-03T08:00:00.000Z");
  h.setItems([article("A")]);
  assert.deepEqual(await h.run(), { sent: 0, failed: 0 });
  h.setItems([article("replacement-A", { canonicalAliases: [{ id: "old-A" }] })]);
  assert.deepEqual(await h.run(), { sent: 0, failed: 0 });
  assert.deepEqual(h.digestCalls.at(-1).excludeIds, ["A", "old-A", "B"]);
  assert.equal(h.deliveries.length, 2);
  assert.equal(h.user.pushDeliveryTimes.length, 2);
});

test("push delivery accepts only 2xx and timestamps success after the send resolves", async () => {
  for (const status of [200, 201, 204, 299]) {
    const h = setup();
    const result = await h.run({ sendImpl: async () => {
      h.setTime("2026-09-03T00:01:00.000Z");
      return { status };
    } });
    assert.deepEqual(result, { sent: 1, failed: 0 }, String(status));
    assert.deepEqual(h.user.pushDeliveryTimes, ["2026-09-03T00:01:00.000Z"]);
    assert.deepEqual(h.user.pushNotified, [{ id: "A", at: "2026-09-03T00:01:00.000Z" }]);
  }
});

test("push delivery failures never mark items or consume cadence and can retry immediately", async () => {
  for (const status of [199, 300, 400, 429, 500, undefined, "throw"]) {
    const h = setup();
    const result = await h.run({ sendImpl: async () => {
      if (status === "throw") throw new Error("offline");
      return { status };
    } });
    assert.deepEqual(result, { sent: 0, failed: 1 }, String(status));
    assert.deepEqual(h.user.pushNotified || [], []);
    assert.deepEqual(h.user.pushDeliveryTimes || [], []);
    assert.ok(h.user.pushSubscription);
    assert.deepEqual(await h.run(), { sent: 1, failed: 0 });
    assert.equal(h.user.pushDeliveryTimes.length, 1);
  }
});

test("push delivery clears expired 404/410 subscriptions through the real store", async () => {
  for (const status of [404, 410]) {
    const h = setup();
    assert.deepEqual(await h.run({ sendImpl: async () => ({ status }) }), { sent: 0, failed: 1 });
    assert.equal(h.user.pushSubscription, null);
    assert.equal(h.user.notifyEnabled, false);
    assert.deepEqual(h.user.pushNotified || [], []);
    assert.deepEqual(h.user.pushDeliveryTimes || [], []);
    assert.deepEqual(await h.run(), { sent: 0, failed: 0 });
    assert.equal(h.digestCalls.length, 1);
  }
});

test("push delivery keeps a replacement subscription when the old endpoint returns 404/410", async () => {
  for (const status of [404, 410]) {
    const h = setup();
    const replacement = { endpoint: "https://push.example.test/replacement" };
    assert.deepEqual(await h.run({ sendImpl: async (subscription) => {
      assert.equal(subscription.endpoint, "https://push.example.test/user");
      await Promise.resolve();
      h.store.savePushSubscription(h.user.id, replacement);
      return { status };
    } }), { sent: 0, failed: 1 });
    assert.deepEqual(h.user.pushSubscription, replacement);
    assert.equal(h.user.notifyEnabled, true);
    assert.deepEqual(h.user.pushNotified || [], []);
    assert.deepEqual(h.user.pushDeliveryTimes || [], []);
    assert.deepEqual(await h.run(), { sent: 1, failed: 0 });
    assert.equal(h.deliveries[0].subscription.endpoint, replacement.endpoint);
  }
});

test("push delivery retains notified IDs and cadence after real-file restart", async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "nowhot-push-restart-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, "store.json");
  let at = "2026-09-03T00:00:00.000Z";
  const clock = () => at;
  let store = new FeedStore({ file, clock });
  const userId = store.createUser("restart-user").id;
  store.savePushSubscription(userId, { endpoint: "https://push.example.test/restart" });
  let items = [article("A", { canonicalAliases: [{ id: "old-A" }] })];
  const digestCalls = [];
  const engine = { async digest(id, options) {
    digestCalls.push(options);
    return { count: items.length, top: items };
  } };
  const run = () => sendDigestPushes(store, engine, vapid, { clock, sendImpl: async () => ({ status: 201 }) });
  assert.deepEqual(await run(), { sent: 1, failed: 0 });

  store = new FeedStore({ file, clock });
  assert.deepEqual(store.getUser(userId).pushNotified, ["A", "old-A"].map((id) => ({ id, at })));
  assert.deepEqual(store.getUser(userId).pushDeliveryTimes, [at]);
  at = "2026-09-03T01:00:00.000Z";
  items = [article("B")];
  assert.deepEqual(await run(), { sent: 0, failed: 0 });
  assert.equal(digestCalls.length, 1, "reloaded cadence prevents even requesting digest");
  at = "2026-09-03T04:00:00.000Z";
  items = [article("replacement-A", { canonicalAliases: [{ id: "old-A" }] })];
  assert.deepEqual(await run(), { sent: 0, failed: 0 });
  assert.deepEqual(digestCalls.at(-1).excludeIds, ["A", "old-A"]);
  items = [article("B")];
  assert.deepEqual(await run(), { sent: 1, failed: 0 });
  at = "2026-09-03T08:00:00.000Z";
  items = [article("C")];
  assert.deepEqual(await run(), { sent: 1, failed: 0 });

  store = new FeedStore({ file, clock });
  assert.deepEqual(store.getUser(userId).pushNotified.map((row) => row.id), ["A", "old-A", "B", "C"]);
  assert.deepEqual(store.getUser(userId).pushDeliveryTimes,
    ["2026-09-03T00:00:00.000Z", "2026-09-03T04:00:00.000Z", "2026-09-03T08:00:00.000Z"]);
  at = "2026-09-03T12:00:00.000Z";
  items = [article("D")];
  assert.deepEqual(await run(), { sent: 0, failed: 0 }, "daily cap survives restart after four hours elapsed");
  at = "2026-09-03T15:00:00.000Z";
  assert.deepEqual(await run(), { sent: 1, failed: 0 }, "next KST calendar day reopens the budget");
});

test("push delivery enforces four hours even across KST midnight and allows the exact boundary", async () => {
  const h = setup([article("A")], "2026-09-03T14:30:00.000Z");
  assert.deepEqual(await h.run(), { sent: 1, failed: 0 });
  h.setItems([article("B")]);
  for (const at of ["2026-09-03T15:00:00.000Z", "2026-09-03T18:29:59.999Z"]) {
    h.setTime(at);
    assert.deepEqual(await h.run(), { sent: 0, failed: 0 });
    assert.equal(h.digestCalls.length, 1, "cadence is checked before digest");
  }
  h.setTime("2026-09-03T18:30:00.000Z");
  assert.deepEqual(await h.run(), { sent: 1, failed: 0 });
});

test("push delivery is capped at three successes per KST date, not per UTC date", async () => {
  const h = setup();
  const times = ["2026-09-02T16:00:00.000Z", "2026-09-02T20:00:00.000Z", "2026-09-03T00:00:00.000Z"];
  for (const [index, at] of times.entries()) {
    h.setTime(at);
    h.setItems([article(`day-one-${index}`)]);
    assert.deepEqual(await h.run(), { sent: 1, failed: 0 });
  }
  h.setItems([article("day-two")]);
  h.setTime("2026-09-03T14:59:59.999Z");
  assert.deepEqual(await h.run(), { sent: 0, failed: 0 });
  assert.equal(h.digestCalls.length, 3);
  h.setTime("2026-09-03T15:00:00.000Z");
  assert.deepEqual(await h.run(), { sent: 1, failed: 0 });
  assert.equal(h.user.pushDeliveryTimes.length, 4);
});

test("push delivery locks overlapping runs per store, without blocking another store", async () => {
  const h = setup();
  const other = setup();
  let release;
  let entered;
  const enteredSend = new Promise((resolve) => { entered = resolve; });
  const response = new Promise((resolve) => { release = resolve; });
  const first = h.run({ sendImpl: async () => { entered(); return response; } });
  await enteredSend;
  try {
    assert.deepEqual(await h.run(), { sent: 0, failed: 0 });
    assert.equal(h.digestCalls.length, 1);
    assert.deepEqual(await other.run(), { sent: 1, failed: 0 });
  } finally {
    release({ status: 201 });
    await first;
  }
  h.setTime("2026-09-03T04:00:00.000Z");
  h.setItems([article("B")]);
  assert.deepEqual(await h.run(), { sent: 1, failed: 0 }, "lock released after success");
});

test("push delivery never previews adult titles and skips when no safe new top remains", async () => {
  const h = setup([
    article("adult-flag", { title: "SECRET FLAGGED TITLE", adult: true }),
    article("adult-topic", { title: "SECRET TOPIC TITLE", topics: ["adult"] }),
    article("safe")
  ]);
  assert.deepEqual(await h.run(), { sent: 1, failed: 0 });
  assert.doesNotMatch(h.deliveries[0].payload.body, /SECRET/);
  assert.equal(h.deliveries[0].payload.url, "/live#post-safe");
  assert.deepEqual(h.user.pushNotified.map((row) => row.id), ["safe"]);
  h.setTime("2026-09-03T04:00:00.000Z");
  assert.deepEqual(await h.run(), { sent: 0, failed: 0 });
  h.engine.digest = async () => ({ count: 3, top: [] });
  assert.deepEqual(await h.run(), { sent: 0, failed: 0 });
  assert.equal(h.deliveries.length, 1);
});

test("push delivery ignores stale digest repeats defensively and keeps links same-origin", async () => {
  const h = setup();
  h.user.pushNotified = [{ id: "old-A", at: "2026-09-02T00:00:00.000Z" }];
  h.engine.digest = async () => ({ count: 1, top: [article("A", { canonicalAliases: [{ id: "old-A" }] })] });
  assert.deepEqual(await h.run(), { sent: 0, failed: 0 });
  const id = "safe/id#part";
  h.engine.digest = async () => ({ count: 1, top: [article(id, { url: "https://external.example.test/story" })] });
  assert.deepEqual(await h.run(), { sent: 1, failed: 0 });
  assert.equal(h.deliveries[0].payload.url, `/live#post-${encodeURIComponent(id)}`);
});

test("push delivery preserves empty, missing-key, and digest-error no-ops and releases its lock", async () => {
  const h = setup([]);
  assert.deepEqual(await h.run(), { sent: 0, failed: 0 });
  const digest = h.engine.digest;
  h.engine.digest = async () => { throw new Error("user unavailable"); };
  assert.deepEqual(await h.run(), { sent: 0, failed: 0 });
  h.engine.digest = digest;
  h.setItems([article("A")]);
  assert.deepEqual(await sendDigestPushes(h.store, h.engine, null, {
    sendImpl: async () => { assert.fail("must not send without keys"); }
  }), { sent: 0, failed: 0 });
  assert.deepEqual(await h.run(), { sent: 1, failed: 0 });
});

test("edition notifications follow ready 07/12/19 slots independently of Live quota and survive restart", async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "nowhot-edition-push-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, "feed.json");
  let at = "2026-09-06T21:59:59Z", ready = true;
  let store = new FeedStore({ file, clock: () => at });
  const id = store.createUser("edition").id;
  store.savePushSubscription(id, { endpoint: "https://push.example.test/edition" });
  store.getUser(id).pushDeliveryTimes = Array(6).fill("2026-09-06T21:00:00Z");
  const payloads = [];
  const reader = { read({date,slotId}) {
    if (!ready) throw new Error("edition unavailable");
    return { editionDate: date, slot: {id:slotId}, issues: [{}], serving: {state:"slot_canonical_verified",fallback:false} };
  } };
  const run = options => sendEditionPushes(store,reader,vapid,{clock:()=>at,sendImpl:async(sub,body)=>{payloads.push(JSON.parse(body));return {status:201};},...options});
  assert.deepEqual(await run(),{sent:0,failed:0});
  for (const [time,slot] of [["22:00:00","morning"],["03:00:00","lunch"],["10:00:00","evening"]]) {
    at = `2026-09-${slot==="morning"?"06":"07"}T${time}Z`;
    ready=false;assert.deepEqual(await run(),{sent:0,failed:0});
    ready=true;assert.deepEqual(await run(),{sent:1,failed:0});
    assert.equal(payloads.at(-1).url,`/?date=2026-09-07&slot=${slot}`);
    assert.equal(payloads.at(-1).tag,`today:2026-09-07:${slot}`);
    store = new FeedStore({file,clock:()=>at});
    assert.deepEqual(await run(),{sent:0,failed:0});
  }
  assert.equal(payloads.length,3);
  assert.equal(store.getUser(id).pushDeliveryTimes.length,6);
});

test("edition push retries failures, locks overlap, expires only the attempted subscription", async () => {
  const h=setup([],"2026-09-06T22:00:00Z");
  const reader={read:()=>({editionDate:"2026-09-07",slot:{id:"morning"},issues:[{}],serving:{state:"slot_canonical_verified",fallback:false}})};
  const options={clock:()=>"2026-09-06T22:00:00Z"};
  let release, entered;
  const wait=new Promise(r=>{release=r;}), start=new Promise(r=>{entered=r;});
  const first=sendEditionPushes(h.store,reader,vapid,{...options,sendImpl:async()=>{entered();await wait;return {status:500};}});
  await start;
  assert.deepEqual(await sendEditionPushes(h.store,reader,vapid,options),{sent:0,failed:0});
  release();assert.deepEqual(await first,{sent:0,failed:1});
  assert.deepEqual(h.user.editionPushDeliveries||[],[]);
  assert.deepEqual(await sendEditionPushes(h.store,reader,vapid,{...options,sendImpl:async()=>({status:201})}),{sent:1,failed:0});
  h.user.editionPushDeliveries=[];
  assert.deepEqual(await sendEditionPushes(h.store,reader,vapid,{...options,sendImpl:async()=>({status:410})}),{sent:0,failed:1});
  assert.equal(h.user.pushSubscription,null);
});

test("live alerts have separate bounded cadence, one matching preview and honor disabled notifications",async()=>{
  const h=setup();
  const options={alertsOnly:true,minScore:0,limit:1};
  assert.deepEqual(await h.run(options),{sent:1,failed:0});
  assert.equal(h.digestCalls[0].alertsOnly,true);
  assert.equal(h.deliveries[0].payload.kind,"live");
  h.setItems([article("B")]);h.setTime("2026-09-03T00:29:59Z");
  assert.deepEqual(await h.run(options),{sent:0,failed:0});
  h.setTime("2026-09-03T00:30:00Z");assert.deepEqual(await h.run(options),{sent:1,failed:0});
  h.user.notifyEnabled=false;h.setTime("2026-09-03T02:00:00Z");h.setItems([article("C")]);
  assert.deepEqual(await h.run(options),{sent:0,failed:0});
});
