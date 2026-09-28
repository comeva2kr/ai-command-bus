import test from 'node:test';
import assert from 'node:assert/strict';

import { createCategoryRouter } from '../src/feed/category-routing.js';
import { JsonSource } from '../src/feed/content.js';
import { slotById } from '../src/feed/digest.js';
import { FeedEngine, inBriefingWindow } from '../src/feed/engine.js';
import { unsafeForLead } from '../src/feed/profanity.js';
import { loadRegistry } from '../src/feed/registry.js';
import { FeedStore } from '../src/feed/store.js';
import { slotSourceArticles } from '../tools/build-slot-canonical-edition.mjs';

const ms = Date.parse;
const sha = 'a'.repeat(64);
const snapshot = (entries, generatedAt) => ({
  contract: 'NOWHOT-CATEGORY-ROUTING-SNAPSHOT-001',
  snapshotId: 'nh167-live-audit',
  generatedAt,
  source: { packetSha256: sha, predictionsSha256: sha },
  counts: { classifiedArticles: entries.length, withheldArticles: 0 },
  entries: entries.map(([itemId, categories]) => ({
    itemId, evidenceHash: sha, categories, contentType: 'news', routingBasis: 'deterministic_tier_policy'
  }))
});

// 2026-09-28 lunch: business papers' sports/culture reports led the business-only lane.
const at = ms('2026-09-28T11:45:00+09:00');
const article = (id, source, title, url, minutesAgo, categories) => ({
  row: {
    id, source, title, url, canonicalUrl: url, kind: 'news', category: loadRegistry().find((s) => s.id === source).category,
    publishedAt: new Date(at - minutesAgo * 60000).toISOString(), score: 0, commentCount: 0, coverage: 5
  },
  categories
});
const auditArticles = [
  article('relay-chosun', 'chosunbiz', '실격 판정 뒤집혔다…韓 남자 400m 계주, 항소 끝에 결선행',
    'https://biz.chosun.com/sports/sports_general/2026/09/28/relay/', 20, ['sports']),
  article('relay-etoday', 'etoday', '육상 남자 400m 계주, 실격 번복⋯이의신청 끝 결선행 [아시안게임]',
    'https://www.etoday.co.kr/news/view/2629736', 70, ['business']),
  article('relay-herald', 'heraldbiz', '남자 400m 계주, 실격 판정 뒤집고 결선행',
    'https://biz.heraldcorp.com/article/10885491', 100, ['business']),
  article('relay-gnews', 'gnews-sports', '항소로 실격 판정 뒤집었다…400m 계주, 극적 결선행',
    'https://sports.example.com/relay', 130, ['sports']),
  article('novel-gnews', 'gnews-ent', "이영도 '눈물을 마시는 새' 프랑스 컬티심 소설상 수상",
    'https://culture.example.com/novel', 40, ['culture']),
  article('novel-etoday', 'etoday', "이영도 '눈물을 마시는 새', 프랑스 컬티심 소설상 수상",
    'https://www.etoday.co.kr/news/view/2629649', 50, ['business']),
  article('novel-mk', 'mk-news', "이영도 '눈물을 마시는 새' 佛 컬티심 소설상 수상",
    'https://www.mk.co.kr/news/culture/12162311', 45, ['business']),
  article('policy-yna', 'yna-politics', '공정위 "반복 담합 사업자에 등록취소·영업정지" 도입',
    'https://www.yna.co.kr/view/AKR20260928025651001', 25, ['politics']),
  article('policy-etoday', 'etoday', '공정위, 반복 담합 사업자 등록취소·영업정지 도입 추진',
    'https://www.etoday.co.kr/news/view/2629699', 28, ['business']),
  article('kospi-mt', 'mt', '코스피, 연휴 끝나자 7000선 붕괴…삼전닉스 2%대 하락',
    'https://www.mt.co.kr/stock/2026/09/28/kospi', 30, ['business']),
  article('kospi-herald', 'heraldbiz', '코스피 연휴 끝나자 7000선 붕괴…삼전닉스 동반 하락',
    'https://biz.heraldcorp.com/article/10885999', 35, ['business'])
];

const auditEngine = (articles = auditArticles) => {
  const router = createCategoryRouter(
    snapshot(articles.map(({ row, categories }) => [row.id, categories]), new Date(at - 60000).toISOString()),
    loadRegistry(), { now: () => at });
  const bySource = Map.groupBy(articles.map(({ row }) => row), (row) => row.source);
  const engine = new FeedEngine(new FeedStore({ clock: () => new Date(at).toISOString() }),
    [...bySource].map(([source, rows]) => new JsonSource(source, async () => rows, 'news')));
  engine.editorialCategoryRouter = (items) => router.project(items);
  engine.editorialCategoryRoutingStatus = router.status;
  engine.editorialPreselectedPool = true;
  engine.editorialPreselectedReferenceMs = at;
  return engine;
};
const issueIds = (issue) => new Set([...(issue.refs || []), ...(issue.eventSources || []), ...(issue.sourceEvidence || [])]
  .map((row) => row.id || row.itemId).filter(Boolean));

test('NH167 audit: a business paper beat cannot route a sports or culture event into business', async () => {
  const engine = auditEngine();
  const args = { slotId: 'lunch', asOfMs: at, editionDate: '2026-09-28' };
  const business = await engine.todayEdition({ ...args, categories: ['business'] });
  const sports = await engine.todayEdition({ ...args, categories: ['sports'] });
  const culture = await engine.todayEdition({ ...args, categories: ['culture'] });
  const relay = sports.issues.find((issue) => issueIds(issue).has('relay-chosun'));
  assert.ok(relay, 'relay event stays in sports');
  assert.ok(['relay-etoday', 'relay-herald', 'relay-gnews'].some((id) => issueIds(relay).has(id)),
    'fixture forms one multi-source event');
  assert.ok(culture.issues.some((issue) => issueIds(issue).has('novel-gnews')), 'novel award stays in culture');
  for (const issue of business.issues) {
    for (const id of ['relay-chosun', 'relay-etoday', 'relay-herald', 'relay-gnews', 'novel-gnews', 'novel-etoday', 'novel-mk']) {
      assert.equal(issueIds(issue).has(id), false, `${id} leaked into business: ${issue.subject}`);
    }
    assert.equal((issue.categoryIds || []).includes('sports'), false);
  }
  assert.ok(business.issues.some((issue) => issueIds(issue).has('kospi-mt')), 'real business event is preserved');
  assert.ok(business.issues.some((issue) => issueIds(issue).has('policy-etoday') || issueIds(issue).has('policy-yna')),
    'policy decision with business impact keeps business co-admission');
  assert.deepEqual(relay.categoryIds, ['sports'], 'card categories follow event subject evidence');
});

test('NH167 audit: a culture award relayed by gnews and withheld desks does not enter business on an etoday beat', async () => {
  const engine = auditEngine([
    article('live-novel-gnews', 'gnews-ent', '이영도 ‘눈물을 마시는 새’ 프랑스 컬티심 소설상 수상',
      'https://news.google.com/rss/articles/CBMiWkFVX3lxTE1RVGRKQjNj?oc=5', 30, ['culture']),
    article('live-novel-yna', 'yna', "이영도 '눈물을 마시는 새', 프랑스 컬티심 소설상 수상",
      'https://www.yna.co.kr/view/AKR20260928027200005', 45, []),
    article('live-novel-etoday', 'etoday', '이영도 ‘눈물을 마시는 새’, 프랑스 컬티심 소설상 수상',
      'https://www.etoday.co.kr/news/view/2629649', 60, ['business']),
    article('live-novel-khan', 'khan', '이영도 ‘눈물을 마시는 새’ 프랑스 컬티심 소설상 수상',
      'https://www.khan.co.kr/article/202609280948001/', 30, []),
    article('live-kospi-mt', 'mt', '코스피, 연휴 끝나자 7000선 붕괴…삼전닉스 2%대 하락',
      'https://www.mt.co.kr/stock/2026/09/28/kospi', 30, ['business']),
    article('live-kospi-herald', 'heraldbiz', '코스피 연휴 끝나자 7000선 붕괴…삼전닉스 동반 하락',
      'https://biz.heraldcorp.com/article/10885999', 35, ['business'])
  ]);
  const args = { slotId: 'lunch', asOfMs: at, editionDate: '2026-09-28' };
  const business = await engine.todayEdition({ ...args, categories: ['business'] });
  const mixed = await engine.todayEdition({ ...args, categories: ['business', 'culture'] });
  const novel = ['live-novel-gnews', 'live-novel-yna', 'live-novel-etoday', 'live-novel-khan'];
  for (const issue of business.issues) {
    for (const id of novel) assert.equal(issueIds(issue).has(id), false, `${id} leaked into business: ${issue.subject}`);
  }
  assert.ok(business.issues.some((issue) => issueIds(issue).has('live-kospi-mt')), 'real business event is preserved');
  const award = mixed.issues.find((issue) => novel.some((id) => issueIds(issue).has(id)));
  assert.ok(award, 'award stays in the culture lane');
  assert.deepEqual(award.categoryIds, ['culture']);
});

test('NH167 audit: a cultural-industry event with business vocabulary keeps its business co-admission', async () => {
  const engine = auditEngine([
    article('profit-gnews', 'gnews-ent', '하이브 영업이익 급증…BTS 컴백 효과',
      'https://news.google.com/rss/articles/CBMiWkFVX3lxTE1RVGRKQjNk?oc=5', 30, ['culture']),
    article('profit-yna', 'yna', '하이브, 영업이익 급증…BTS 컴백 효과',
      'https://www.yna.co.kr/view/AKR20260928027300005', 45, []),
    article('profit-etoday', 'etoday', '하이브 영업이익 급증⋯BTS 컴백 효과',
      'https://www.etoday.co.kr/news/view/2629650', 60, ['business']),
    article('profit-khan', 'khan', '하이브 영업이익 급증…BTS 컴백 효과',
      'https://www.khan.co.kr/article/202609280948002/', 30, [])
  ]);
  const args = { slotId: 'lunch', asOfMs: at, editionDate: '2026-09-28' };
  const members = ['profit-gnews', 'profit-yna', 'profit-etoday', 'profit-khan'];
  const business = await engine.todayEdition({ ...args, categories: ['business'] });
  const mixed = await engine.todayEdition({ ...args, categories: ['business', 'culture'] });
  assert.ok(business.issues.some((issue) => members.some((id) => issueIds(issue).has(id))), 'business lane keeps it');
  const event = mixed.issues.find((issue) => members.some((id) => issueIds(issue).has(id)));
  assert.deepEqual([...event.categoryIds].sort(), ['business', 'culture']);
});

test('NH167 audit: a single business-paper report with definite sports or culture evidence stays out of business', async () => {
  const engine = auditEngine([
    article('solo-relay-etoday', 'etoday', '육상 남자 400m 계주, 실격 번복⋯이의신청 끝 결선행 [아시안게임]',
      'https://www.etoday.co.kr/news/view/2629736', 20, ['business']),
    article('solo-handball-chosun', 'chosunbiz', '여자 핸드볼, 일본 꺾고 4강 진출',
      'https://biz.chosun.com/sports/sports_general/2026/09/28/handball/', 30, ['business']),
    article('solo-idol-mk', 'mk-news', '뉴진스 컴백 앞두고 신곡 공개…음원차트 1위',
      'https://www.mk.co.kr/news/culture/12160001', 40, ['business']),
    article('solo-agency-herald', 'heraldbiz', '뉴진스 소속사 어도어 영업이익 공개…컴백 앞둬',
      'https://biz.heraldcorp.com/article/10886001', 50, ['business']),
    article('solo-kospi-etoday', 'etoday', '코스피, 7000선 붕괴…외국인 매도 폭탄',
      'https://www.etoday.co.kr/news/view/2629800', 60, ['business']),
    article('solo-kbo-gnews', 'gnews-sports', 'KBO 포스트시즌 대진 확정…LG 1위 직행',
      'https://sports.example.com/kbo', 70, ['sports']),
    article('solo-pingpong-etoday', 'etoday', '남자 탁구 단체전, 중국 꺾고 금메달 [아시안게임]',
      'https://www.etoday.co.kr/news/view/2629810', 80, ['business', 'sports']),
    article('solo-ambiguous-etoday', 'etoday', '추석 연휴 끝 첫 출근길…도심 곳곳 정체',
      'https://www.etoday.co.kr/news/view/2629820', 90, ['business'])
  ]);
  const args = { slotId: 'lunch', asOfMs: at, editionDate: '2026-09-28' };
  const ids = (edition) => new Set(edition.issues.flatMap((issue) => [...issueIds(issue)]));
  const business = ids(await engine.todayEdition({ ...args, categories: ['business'] }));
  const sports = ids(await engine.todayEdition({ ...args, categories: ['sports'] }));
  for (const id of ['solo-relay-etoday', 'solo-handball-chosun', 'solo-idol-mk', 'solo-pingpong-etoday']) {
    assert.equal(business.has(id), false, `${id} leaked into business`);
  }
  assert.ok(business.has('solo-kospi-etoday'), 'true business report is preserved');
  assert.ok(business.has('solo-agency-herald'), 'a title with business evidence keeps its business admission');
  assert.ok(business.has('solo-ambiguous-etoday'), 'without definite evidence the routed business admission is held');
  assert.ok(sports.has('solo-kbo-gnews'));
  assert.ok(sports.has('solo-pingpong-etoday'), 'an approved sports co-admission is kept');
  assert.equal(sports.has('solo-relay-etoday'), false, 'no sports admission is invented without routing approval');
});

test('NH167 audit: explicit sexual humor title never enters default Today routing', () => {
  const title = '섹스를 해야하는 이유.jpg';
  assert.equal(unsafeForLead(title), true);
  assert.equal(unsafeForLead('연휴 뒤 출근길 안개 주의···낮 최고 29도'), false);
  const router = createCategoryRouter(snapshot([['humor-unsafe', ['humor']], ['humor-safe', ['humor']]],
    new Date(at - 60000).toISOString()), [], { now: () => at });
  const projected = router.project([
    { id: 'humor-unsafe', title, source: 'theqoo', kind: 'community', category: 'humor' },
    { id: 'humor-safe', title: '고양이가 택배 상자를 지키는 이유', source: 'theqoo', kind: 'community', category: 'humor' }
  ]);
  assert.deepEqual(projected.map((row) => row.id), ['humor-safe']);
});

test('NH167 audit: news between evening evidence cutoff and 19 KST reaches next morning', () => {
  const morning = slotById('morning');
  const nextMorningAsOf = ms('2026-09-29T06:32:00+09:00');
  const eveningCutoff = ms('2026-09-28T18:30:00+09:00');
  const gap = { kind: 'news', publishedAt: '2026-09-28T18:45:00+09:00' };
  assert.equal(inBriefingWindow(gap, eveningCutoff, slotById('evening'), null, '2026-09-28'), false,
    'not yet published at the evening cutoff');
  assert.equal(inBriefingWindow(gap, nextMorningAsOf, morning, null, '2026-09-29'), true);
  assert.equal(inBriefingWindow({ kind: 'news', publishedAt: '2026-09-28T16:59:59+09:00' },
    nextMorningAsOf, morning, null, '2026-09-29'), false, 'daytime news stays with the evening edition');
});

test('NH167 audit: previous-slot served articles are not re-candidates; new developments are', () => {
  const metadata = new Map(loadRegistry().map((source) => [source.id, source]));
  const row = (id, kind, source, url, publishedAt) => ({ id, kind, source, url, canonicalUrl: url, title: id, publishedAt });
  const pool = {
    savedAt: ms('2026-09-28T11:45:00+09:00'),
    rows: [
      row('humor-served', 'community', 'theqoo', 'https://theqoo.net/hot/1', null),
      row('humor-new', 'community', 'theqoo', 'https://theqoo.net/hot/2', null),
      row('news-served', 'news', 'yna', 'https://www.yna.co.kr/view/served', '2026-09-28T06:00:00+09:00'),
      row('news-followup', 'news', 'khan', 'https://www.khan.co.kr/article/followup', '2026-09-28T10:30:00+09:00')
    ].map((item) => ({ item }))
  };
  const morning = {
    editionDate: '2026-09-28',
    slot: { id: 'morning' },
    issueTable: {
      a: { refs: [{ id: 'humor-served', url: 'https://theqoo.net/hot/1' }] },
      b: { eventSources: [{ id: 'news-served', canonicalUrl: 'https://www.yna.co.kr/view/served' }] }
    }
  };
  const target = { editionDate: '2026-09-28', slotId: 'lunch', evidenceAsOfMs: pool.savedAt };
  const ids = (servedArtifact) => slotSourceArticles({ pool, target, metadata, servedArtifact })
    .map((item) => item.id).sort();
  assert.deepEqual(ids(null), ['humor-new', 'humor-served', 'news-followup', 'news-served']);
  assert.deepEqual(ids(morning), ['humor-new', 'news-followup']);
  assert.deepEqual(ids({ ...morning, slot: { id: 'lunch' } }),
    ['humor-new', 'humor-served', 'news-followup', 'news-served'], 'same-slot rebuild keeps its own inputs');
});
