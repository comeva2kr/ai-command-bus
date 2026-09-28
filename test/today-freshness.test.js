import test from 'node:test';
import assert from 'node:assert/strict';
import { FeedEngine, briefingAvailableAt, inBriefingWindow } from '../src/feed/engine.js';
import { FeedStore } from '../src/feed/store.js';
import { JsonSource } from '../src/feed/content.js';
import { parseRss } from '../src/feed/fetchers.js';
import { slotById } from '../src/feed/digest.js';

const ms = Date.parse;
const news = (publishedAt, extra = {}) => ({ kind: 'news', publishedAt, ...extra });

test('NH167 news age is publication, never first collection or source modification', () => {
  const item = news('2026-09-18T08:00:00+09:00', {
    firstSeenAt: ms('2026-09-19T11:30:00+09:00'), updatedAt: '2026-09-19T11:40:00+09:00'
  });
  assert.equal(briefingAvailableAt(item), ms(item.publishedAt));
  assert.ok(Number.isNaN(briefingAvailableAt({ ...item, publishedAt: null })));
  const rss = parseRss(`<feed><entry><title>기사</title><link>https://example.com/a</link><published>${item.publishedAt}</published><updated>${item.updatedAt}</updated></entry></feed>`);
  assert.equal(rss[0].publishedAt, new Date(item.publishedAt).toISOString());
  assert.equal(parseRss('<feed><entry><title>기사</title><link>https://example.com/a</link><updated>2026-09-19T11:40:00+09:00</updated></entry></feed>')[0].publishedAt, null);
});

test('NH167 morning is anchored at prior 19 KST even with early preparation', () => {
  const at = ms('2026-09-20T06:32:00+09:00');
  for (const [date, expected] of [['2026-09-19T18:59:59+09:00', false], ['2026-09-19T19:00:00+09:00', true], ['2026-09-20T06:31:59+09:00', true], ['2026-09-20T06:33:00+09:00', false]]) {
    assert.equal(inBriefingWindow(news(date), at, slotById('morning')), expected, date);
  }
  assert.equal(inBriefingWindow(news('2026-09-19T20:00:00+09:00'), ms('2026-09-19T21:00:00+09:00'), slotById('morning'), null, '2026-09-20'), true);
});

test('NH167 lunch/evening allow same-day importance without foreign 24h exceptions', () => {
  const metadata = new Map([['bbc-world', {kind: 'news', country: 'GB', editorialAuthority: 'global_major', adapter: {type: 'rss'}}]]);
  for (const slot of ['lunch', 'evening']) {
    const at = ms(`2026-09-20T${slot === 'lunch' ? '11:32' : '18:32'}:00+09:00`);
    const eligible = item => inBriefingWindow(item, at, slotById(slot), metadata);
    assert.equal(eligible(news('2026-09-20T00:00:00+09:00')), true);
    assert.equal(eligible(news('2026-09-19T23:59:59+09:00', {source:'bbc-world', firstSeenAt:at, editorialImportance:'pass'})), false);
    for (const publishedAt of [null, 'invalid', '2026-09-21T00:00:00+09:00']) assert.equal(eligible(news(publishedAt, {firstSeenAt:at})), false);
  }
});

const rows = [
  {id:'old',source:'old-news',title:'반도체 기업 공장 투자 세부 계획 공개',publishedAt:'2026-09-19T08:00:00+09:00', score:10000},
  {id:'fresh',source:'fresh-news',title:'반도체 기업 신규 공장 투자 계획 발표',publishedAt:'2026-09-20T08:00:00+09:00',score:500},
  {id:'second',source:'other-news',title:'자동차 기업 전기차 수출 실적 최대 기록',publishedAt:'2026-09-20T09:00:00+09:00',score:400},
  {id:'undated',source:'unknown-news',title:'부동산 기업 신규 건물 공사 착공',publishedAt:null,score:20000},
  {id:'future',source:'future-news',title:'은행 기업 주택 대출 금리 인하 발표',publishedAt:'2026-09-21T09:00:00+09:00',score:20000}
].map(row=>({...row,kind:'news',category:'business',url:`https://${row.source}.example.com/${row.id}`,coverage:2}));

rows[1].related = [{ ...rows[0] }, { ...rows[3] }, { ...rows[4] }];

for (const preselected of [false,true]) test(`NH167 actual Today ${preselected ? 'preselected' : 'normal'} path rejects stale quota and event reattachment`, async () => {
  const at=ms('2026-09-20T11:32:00+09:00');
  const engine=new FeedEngine(new FeedStore({clock:()=>new Date(at).toISOString()}),rows.map(row=>new JsonSource(row.source,async()=>[row],'news')));
  engine.editorialPreselectedPool=preselected;
  engine.editorialPreselectedReferenceMs=at;
  const edition=await engine.todayEdition({categories:['business'],slotId:'lunch',asOfMs:at,allowCarryover:true,includeCandidates:true});
  assert.ok(edition.issues.length>0, 'fresh important supply remains');
  assert.ok(edition.issues.length<14, 'short supply remains short');
  const forbidden=new Set(['old','undated','future']);
  for(const issue of edition.issues) for(const ref of [...issue.refs,...(issue.eventSources||[]),...(issue.sourceEvidence||[])]) assert.equal(forbidden.has(ref.id || ref.itemId),false,ref.id || ref.itemId);
  const [enriched]=await engine.canonicalEventSources([{refs:[{...rows[1],canonicalUrl:rows[1].url}]}],{asOfMs:at,slotId:'lunch'});
  assert.ok(enriched.eventSources.length>0);
  assert.equal(enriched.eventSources.some(ref=>forbidden.has(ref.id)),false);
  assert.equal(edition.editorialCarryover.selectedIssueCount,0);
});


test('NH167 community list boards retain current-hot discovery time', () => {
  const at = ms('2026-09-20T11:32:00+09:00');
  const metadata = new Map([['board', {kind: 'community', adapter: {type: 'list'}}]]);
  const item = {kind:'community', source:'board', publishedAt:'2026-09-18T08:00:00+09:00', firstSeenAt:at};
  assert.equal(briefingAvailableAt(item, metadata.get('board')), at);
  assert.equal(inBriefingWindow(item, at, slotById('lunch'), metadata), true);
});

test('NH167 cached context respects edition date and pool evidence cutoff', async () => {
  const at = ms('2026-09-20T11:32:00+09:00');
  const engine = new FeedEngine(new FeedStore({clock:()=>new Date(at).toISOString()}), rows.map(row=>new JsonSource(row.source,async()=>[row],'news')));
  engine.editorialPreselectedPool = true;
  engine.editorialPreselectedReferenceMs = at;
  await engine.refresh();
  const args = {asOfMs:at, slotId:'morning', editionDate:'2026-09-20'};
  const first = await engine._sharedBriefingContext(args);
  assert.ok(first.baseItems.some(row=>row.id==='fresh'));
  assert.equal(await engine._sharedBriefingContext(args), first);
  const nextDate = await engine._sharedBriefingContext({...args, editionDate:'2026-09-21'});
  assert.equal(nextDate.baseItems.length, 0, 'cached candidates cannot leak into another dated slot');
  engine.editorialPreselectedReferenceMs = ms('2026-09-20T07:00:00+09:00');
  const earlier = await engine._sharedBriefingContext(args);
  assert.equal(earlier.baseItems.length, 0, 'routing time cannot advance pool evidence time');
});


for (const preselected of [false, true]) test(`NH167 folded same-title fresh news survives ${preselected ? 'preselected' : 'normal'} Today`, async () => {
  const at = ms('2026-09-19T21:00:00+09:00');
  const title = '반도체 기업 신규 공장 투자 계획 발표';
  const older = {...rows[0], id:'daytime', title, publishedAt:'2026-09-19T08:00:00+09:00'};
  const fresh = {...rows[1], id:'evening', title, publishedAt:'2026-09-19T20:00:00+09:00'};
  const engine = new FeedEngine(new FeedStore({clock:()=>new Date(at).toISOString()}),
    [older, fresh].map(row=>new JsonSource(row.source, async()=>[row], 'news')));
  engine.editorialPreselectedPool = preselected;
  engine.editorialPreselectedReferenceMs = at;
  await engine.refresh();
  assert.equal(engine._cache.some(row=>row.id==='evening'), false, 'fixture exercises actual collect folding');
  assert.ok(engine._cache.find(row=>row.id==='daytime').related.some(row=>row.id==='evening'));
  const args = {asOfMs:at, slotId:'morning', editionDate:'2026-09-20'};
  const edition = await engine.todayEdition({...args, categories:['business'], allowCarryover:true});
  assert.ok(edition.issues.some(issue=>issue.refs.some(ref=>ref.id==='evening')), 'own fresh article survives stale parent');
  const enriched = await engine.canonicalEventSources(edition.issues, args);
  for (const issue of enriched) {
    for (const ref of [...issue.refs, ...(issue.eventSources || []), ...(issue.sourceEvidence || [])]) {
      assert.notEqual(ref.id || ref.itemId, 'daytime');
      assert.equal(inBriefingWindow(news(ref.publishedAt), at, slotById('morning'), null, '2026-09-20'), true);
    }
  }
});


test('NH167 persisted folded news uses its own packet and routing identity before builder admission', async () => {
  const {poolRows, assertSamePoolInputs} = await import('../tools/build-slot-canonical-edition.mjs');
  const {buildSelectionShadowPacket} = await import('../tools/prepare-selection-shadow.mjs');
  const {CANDIDATE_REGISTRY} = await import('../tools/selection-candidate-registry.mjs');
  const {createHash} = await import('node:crypto');
  const sha = value => createHash('sha256').update(value).digest('hex');
  const fresh = {...rows[1], related:undefined};
  const pool = {savedAt:ms('2026-09-20T11:32:00+09:00'), rows:[{item:{...rows[0], related:[fresh]}}]};
  const poolRaw = JSON.stringify(pool);
  const packet = buildSelectionShadowPacket(pool, {candidate:CANDIDATE_REGISTRY['p6-policy-shadow-haiku'], sourceSnapshotSha256:sha(poolRaw)});
  const packetRaw = JSON.stringify(packet);
  assert.deepEqual(poolRows(pool).map(row=>row.id).sort(), ['fresh','old']);
  assert.equal(poolRows(pool).find(row=>row.id==='fresh').publishedAt, fresh.publishedAt);
  const ids = packet.targets.flatMap(row=>row.sourceArticleIds).sort();
  assert.deepEqual(ids, ['fresh','old'], 'observed child is explicitly classified, never inherits a parent snapshot id');
  const routingSnapshot = {source:{packetSha256:sha(packetRaw)}, entries:ids.map(itemId=>({itemId}))};
  assert.doesNotThrow(()=>assertSamePoolInputs({poolRaw,packet,packetRaw,routingSnapshot}));
  assert.throws(()=>assertSamePoolInputs({poolRaw,packet,packetRaw,routingSnapshot:{...routingSnapshot,entries:[{itemId:'old'}]}}), /routing entry coverage mismatch/);
});

// NH167 v4: priority uses the same frozen evidence time before caps and final rank.
const priorityRow = (id, title, publishedAt, extra = {}) => ({
  id, title, publishedAt, source: `publisher-${id}`, sourceLabel: `매체 ${id}`,
  url: `https://${id}.example.com/article`, kind: 'news', category: 'business',
  score: 0, commentCount: 0, coverage: 5, ...extra
});
const priorityEngine = (items, at) => {
  const engine = new FeedEngine(new FeedStore({clock:()=>new Date(at).toISOString()}),
    items.map(item=>new JsonSource(item.source, async()=>[item], item.kind)));
  engine.editorialPreselectedPool = true;
  engine.editorialPreselectedReferenceMs = at;
  return engine;
};

test('NH167 priority spans preserve major news and favor dawn with actual pool cutoffs', async () => {
  const {newsPriorityWeight: weight} = await import('../src/feed/digest.js');
  const score = (slot, at, published, value) => weight(news(published), value, slot, ms(at));
  const day = '2026-09-20T';
  assert.ok(Math.abs(score('evening',day+'18:30+09:00',day+'15:00+09:00',400)-356.36)<0.01);
  assert.ok(score('evening',day+'18:30+09:00',day+'15:00+09:00',400)>score('evening',day+'18:30+09:00',day+'09:00+09:00',400));
  assert.ok(score('lunch',day+'12:00+09:00',day+'11:00+09:00',500)>score('lunch',day+'12:00+09:00',day+'11:59+09:00',100));
  assert.ok(score('lunch',day+'11:30+09:00',day+'06:50+09:00',500)>score('lunch',day+'11:30+09:00',day+'08:00+09:00',100));
  assert.ok(score('morning',day+'06:30+09:00',day+'06:00+09:00',400)>score('morning',day+'06:30+09:00','2026-09-19T22:00+09:00',400));
  assert.equal(score('lunch',day+'11:30+09:00',day+'07:00+09:00',400),score('lunch',day+'11:30+09:00','2026-09-19T22:00Z',400),'KST uses actual publisher instant');
  for (const timestamp of [null,'invalid',day+'12:01+09:00']) assert.equal(score('lunch',day+'12:00+09:00',timestamp,500),0);
  assert.equal(weight({kind:'community',publishedAt:'2000-01-01'},500,'lunch',ms(day+'12:00+09:00')),500);
  const original=news(day+'06:00+09:00');
  assert.equal(weight({...original,firstSeenAt:ms(day+'11:59+09:00'),updatedAt:day+'11:59+09:00',related:[news(day+'11:59+09:00')]},500,'lunch',ms(day+'12:00+09:00')),weight(original,500,'lunch',ms(day+'12:00+09:00')));
});

for (const slot of ['morning','lunch','evening']) test(`NH167 priority ${slot} survives engine candidate cap and final digest`, async () => {
  const times = {morning:['2026-09-19T22:00+09:00','2026-09-20T06:00+09:00','2026-09-20T06:30+09:00'],lunch:['2026-09-20T06:00+09:00','2026-09-20T11:00+09:00','2026-09-20T11:30+09:00'],evening:['2026-09-20T09:00+09:00','2026-09-20T15:00+09:00','2026-09-20T18:30+09:00']}[slot];
  const at=ms(times[2]);
  const items=[priorityRow('old','은행 주택 대출 금리 조정안 발표',times[0]),priorityRow('fresh','자동차 기업 해외 수출 역대 최대 실적',times[1])];
  const engine=priorityEngine(items,at);
  const edition=await engine.briefing({slotId:slot,asOfMs:at+3600000,categories:['business'],personalized:true,candidateLimit:1,perCategory:1});
  assert.equal(edition.issues.length,1);
  assert.equal(edition.issues[0].refs[0].id,'fresh','fresh leader must survive a one-item candidate cap');
  assert.equal(ms(edition.issues[0].refs[0].publishedAt),ms(times[1]));
});

test('NH167 priority missed morning major remains eligible ahead of newer minor', async () => {
  const at=ms('2026-09-20T11:30+09:00');
  const engine=priorityEngine([
    priorityRow('major','정부 금융 위기 긴급 대응 대책 발표','2026-09-20T06:50+09:00',{score:500}),
    priorityRow('minor','자동차 기업 지역 전시장 행사 일정 공개','2026-09-20T08:00+09:00',{score:100,coverage:0})
  ],at);
  const edition=await engine.briefing({slotId:'lunch',asOfMs:at,personalized:true,categories:['business'],candidateLimit:1});
  assert.equal(edition.issues[0].refs[0].id,'major');
});

test('NH167 priority ranks the actual canonical news representative instead of a fresh related member', async () => {
  const {buildDigest}=await import('../src/feed/digest.js');
  const at=ms('2026-09-20T18:30+09:00');
  const old=priorityRow('earlier','반도체 기업 신규 공장 투자 계획 발표','2026-09-20T09:00+09:00');
  const newer=priorityRow('related','반도체 기업 신규 공장 투자 계획 발표','2026-09-20T15:00+09:00');
  const competitor=priorityRow('competitor','자동차 기업 해외 수출 역대 최대 실적','2026-09-20T15:00+09:00');
  const input=[newer,competitor];
  const options={slotId:'evening',asOfMs:at,maxIssues:2};
  assert.equal(buildDigest(input,options).issues[0].refs[0].id,'related');
  const result=buildDigest(input,{...options,representativeFor:draft=>draft.refs[0].id==='related'?old:competitor});
  assert.equal(result.issues[0].refs[0].id,'competitor','old canonical lead cannot borrow related lead time');
  assert.equal(old.publishedAt,'2026-09-20T09:00+09:00');
});
