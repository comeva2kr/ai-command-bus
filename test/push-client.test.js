import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import vm from "node:vm";

const source = fs.readFileSync(new URL("../src/feed/public/push-client.js", import.meta.url), "utf8");

test("shared push client restores only existing permission and subscriptions, and explicitly enables real push", async () => {
  const subscription = { endpoint: "https://push.example.test/device",
    toJSON: () => ({ endpoint: "https://push.example.test/device", keys: { p256dh: "public", auth: "secret" } }) };
  let current = subscription, permissionResult = "granted", apiStatus = 200, apiError = false, key = "AAEC-v8";
  const calls = [], prompts = [], subscriptions = [];
  const context = {
    Notification: { permission: "granted", requestPermission: async () => {
      prompts.push(true); return context.Notification.permission = permissionResult;
    } },
    navigator: { serviceWorker: { ready: Promise.resolve({ pushManager: {
      getSubscription: async () => current,
      subscribe: async options => { subscriptions.push(options); return current = subscription; }
    } }) } },
    fetch: async (url, options) => {
      calls.push({ url, options });
      if (apiError) throw new Error("network error");
      return { ok: apiStatus === 200, json: async () => ({ key }) };
    },
    atob, Uint8Array
  };
  context.window = context;
  vm.runInNewContext(source, context);
  const client = context.NowHotPush;

  assert.equal(await client.restore("user-1"), true);
  assert.deepEqual(JSON.parse(calls[0].options.body), { userId: "user-1", subscription: subscription.toJSON() });
  assert.equal(calls[0].url, "/api/push/subscribe");
  assert.equal(calls[0].options.method, "POST");
  assert.equal(prompts.length, 0);
  assert.equal(subscriptions.length, 0);

  for (const permission of ["default", "denied"]) {
    context.Notification.permission = permission;
    assert.equal(await client.restore("user-1"), false);
  }
  assert.equal(calls.length, 1);
  assert.equal(prompts.length, 0);
  await assert.rejects(client.enable("user-1"), /알림을 허용/);
  assert.equal(prompts.length, 0, "denied permission is not requested again");

  context.Notification.permission = "granted";
  current = null;
  assert.equal(await client.restore("user-1"), false);
  assert.equal(subscriptions.length, 0, "startup never creates a subscription");
  assert.equal(calls.length, 1);

  context.Notification.permission = "default";
  assert.equal(await client.enable("user-1"), true);
  assert.equal(prompts.length, 1);
  assert.deepEqual(Array.from(subscriptions[0].applicationServerKey), [0, 1, 2, 250, 255]);
  assert.equal(subscriptions[0].userVisibleOnly, true);
  assert.deepEqual(calls.slice(1).map(call => call.url), ["/api/push/vapid-key", "/api/push/subscribe"]);
  assert.equal(await client.enable("user-1"), true);
  assert.equal(prompts.length, 1, "granted permission is not requested again");
  assert.equal(subscriptions.length, 1, "an existing subscription is reused");

  apiStatus = 403;
  await assert.rejects(client.enable("user-1"), /알림 연결에 실패/);
  assert.equal(await client.restore("user-1"), false);
  apiStatus = 200;
  apiError = true;
  await assert.rejects(client.enable("user-1"), /알림 연결에 실패/);
  assert.equal(await client.restore("user-1"), false);
  apiError = false;
  current = null;
  key = null;
  await assert.rejects(client.enable("user-1"), /알림 연결에 실패/);
  assert.equal(subscriptions.length, 1);

  context.Notification.permission = "default";
  permissionResult = "denied";
  await assert.rejects(client.enable("user-1"), /알림을 허용/);
  delete context.navigator.serviceWorker;
  assert.equal(await client.restore("user-1"), false);
  await assert.rejects(client.enable("user-1"), /지원하지 않아요/);
});
