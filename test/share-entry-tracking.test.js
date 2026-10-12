import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('../src/feed/public/audience-client.js', import.meta.url), 'utf8');
const key = 'nh_share_referrer';
function storage(value) {
  const rows = new Map(value ? [[key, JSON.stringify(value)]] : []);
  return { rows, getItem: k => rows.get(k), removeItem: k => rows.delete(k), setItem: (k, v) => rows.set(k, v) };
}
async function collect({ referrer = 'https://nowhot.kr/p?id=one', params = 'utm_source=shared_link', handoff, pathname = '/live', blocked = false } = {}) {
  const sessionStorage = storage(handoff), batches = [];
  if (blocked) sessionStorage.getItem = () => { throw new Error('blocked'); };
  const window = {};
  vm.runInNewContext(source, { window, URL, URLSearchParams, Date, sessionStorage,
    location: new URL(`https://nowhot.kr${pathname}?${params}`),
    crypto: { randomUUID: () => 'a'.repeat(32) },
    document: { referrer, readyState: 'complete', visibilityState: 'hidden', addEventListener() {} },
    addEventListener() {}, setTimeout() {}, setInterval() {},
    fetch: async (url, init) => { batches.push(...JSON.parse(init.body).events); return { ok: true }; }
  });
  await window.NowHotTrack.flush();
  return { events: batches, sessionStorage };
}

test('share handoff preserves only an external origin once, without query or path', async () => {
  const result = await collect({ handoff: { origin: 'https://www.threads.com', at: Date.now() } });
  assert.equal(result.events[0].referrer, 'https://www.threads.com');
  assert.equal(result.sessionStorage.rows.has(key), false);
  assert.equal(result.events[0].params.utm_source, 'shared_link');
  const direct = await collect({ referrer: 'https://search.naver.com/search?query=private' });
  assert.equal(direct.events[0].referrer, 'https://search.naver.com');
  assert.doesNotMatch(JSON.stringify(direct.events), /query=private|\/search[?]/);
});

test('handoff cannot overwrite a direct arrival, a later internal visit, or an expired handoff', async () => {
  for (const options of [
    { referrer: 'https://www.google.com/search?q=private' },
    { referrer: '' },
    { referrer: 'https://nowhot.kr/post/one' },
    { handoff: { origin: 'https://x.com', at: Date.now() - 31000 } },
    { handoff: { origin: 'https://x.com/private?query=private', at: Date.now() } },
    { handoff: { origin: 'javascript:alert(1)', at: Date.now() } },
    { handoff: { origin: 'https://x.com', at: Date.now() + 60000 } },
    { blocked: true }
  ]) {
    const { events, sessionStorage } = await collect({ handoff: { origin: 'https://x.com', at: Date.now() }, ...options });
    assert.equal(events[0].referrer, options.referrer === '' ? '' : new URL(options.referrer || 'https://nowhot.kr/p?id=one').origin);
    if (!options.blocked) assert.equal(sessionStorage.rows.has(key), false);
  }
});

test('arbitrary referrer query is ignored and explicit UTM remains unchanged', async () => {
  const { events } = await collect({ referrer: '', params: 'referrer=https://x.com&source=google&utm_source=kakao&utm_medium=social&utm_campaign=launch&utm_content=post-01' });
  assert.equal(events[0].referrer, '');
  assert.deepEqual(events[0].params, { utm_source: 'kakao', utm_medium: 'social', utm_campaign: 'launch', utm_content: 'post-01' });
});
