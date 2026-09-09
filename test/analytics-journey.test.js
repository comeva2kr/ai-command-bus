import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { FeedStore } from '../src/feed/store.js';
import { createServer } from '../src/feed/server.js';
import { mergeBuckets, summarize, JOURNEY_IDLE_MS, retentionRows, attributionParams, acquisitionLabel, campaignKey, linkEntryKey } from '../src/feed/analytics.js';

const vid='a'.repeat(32), pageId='b'.repeat(32);
const ctx={visitorId:vid,selfHost:'nowhot.kr',ua:'Mozilla/5.0 SamsungBrowser/26.0 Android Mobile Safari'};
const event=(seq,type='view',extra={})=>({pageId,seq,type,path:'/',referrer:'https://m.search.naver.com/?query=private',params:{utm_source:'naver',utm_medium:'post',utm_campaign:'launch'},...extra});
function fixture(){let time=Date.parse('2026-09-07T09:00:00+09:00');const store=new FeedStore({clock:()=>new Date(time).toISOString()});return {store,advance:n=>time+=n,get:()=>summarize(mergeBuckets(Object.values(store.analyticsBuckets()))).journey};}

test('one browser: duplicate batch, refresh, Today→Live→detail keep one attributed session',()=>{
 const {store,get}=fixture();
 store.recordJourneyEvents([event(1),event(2,'engage')],ctx);
 store.recordJourneyEvents([event(1),event(2,'engage')],ctx);
 store.recordJourneyEvents([event(1,'view',{pageId:'c'.repeat(32),path:'/live'}),event(2,'click',{pageId:'c'.repeat(32),path:'/live',category:'tech',source:'community',rank:0}),event(3,'view',{pageId:'c'.repeat(32),path:'/live/detail'}),event(4,'action',{pageId:'c'.repeat(32),path:'/live/detail',action:'preferences'})],ctx);
 const j=get();assert.equal(j.browsers,1);assert.equal(j.sessions,1);assert.equal(j.pv,3);assert.equal(j.engagedBrowsers,1);
 assert.equal(j.referrers[0].key,'네이버');assert.equal(j.referrers[0].content,1);assert.equal(j.referrers[0].preferences,1);assert.equal(j.campaigns[0].sessions,1);
 assert.equal(j.transitions.length,2);assert.ok(!JSON.stringify(store.analytics).includes('query=private'));
});

test('NH155: channel/post link arrivals survive a second campaign within one session without inflating visitors',()=>{
 const {store,get,advance}=fixture();
 const params={utm_source:'threads',utm_medium:'social',utm_campaign:'launch',utm_content:'post-a'};
 const first=event(1,'view',{params});
 store.recordJourneyEvents([first,first,event(2,'view',{params,resume:true})],ctx);
 store.recordJourneyEvents([event(1,'view',{pageId:'c'.repeat(32),params})],ctx); // reload
 store.recordJourneyEvents([event(1,'view',{pageId:'d'.repeat(32),params:{...params,utm_source:'kakao',utm_content:'post-b'}})],ctx);
 assert.equal(get().sessions,1);assert.equal(get().browsers,1);
 assert.equal(get().campaigns.length,1);assert.equal(get().campaigns[0].key,'threads | social | launch');
 assert.deepEqual(get().linkEntries.map(r=>[r.key,r.count]),[['kakao | social | launch | post-b',1],['threads | social | launch | post-a',1]]);
 // A late event in the first tab must neither reattribute nor add a second arrival.
 store.recordJourneyEvents([event(3,'action',{params,action:'outbound'})],ctx);
 assert.equal(get().campaigns[0].outbound,1);assert.equal(get().linkEntries.length,2);
 advance(JOURNEY_IDLE_MS+1);store.recordJourneyEvents([event(4,'view',{params,resume:true})],ctx);
 assert.equal(get().sessions,2);assert.equal(get().linkEntries[0].count,2);
});

test('NH155: URL and event attribution use the same bounded allowlist',()=>{
 const p=new URLSearchParams({utm_source:' ka\u0000kao ',utm_medium:'social',utm_campaign:'launch | a',utm_content:'b'.repeat(81),token:'secret'});
 const clean=attributionParams(p);
 assert.equal(clean.utm_source,'kakao');assert.equal(clean.utm_content.length,80);assert.equal(clean.token,undefined);
 assert.deepEqual(attributionParams(Object.fromEntries(p)),clean);
 assert.equal(acquisitionLabel('', 'nowhot.kr',Object.fromEntries(p)),'카카오');
 assert.equal(campaignKey(clean),'kakao | social | launch / a');assert.equal(linkEntryKey(clean).split(' | ').length,4);
 assert.deepEqual(attributionParams({utm_source:[],utm_content:{},utm_medium:'  '}),{});
});

test('NH155: full bounded campaign/post keys remain distinct; daily and period overflow stays visible',()=>{
 const {store,get,advance}=fixture();
 const params={utm_source:'a'.repeat(40),utm_medium:'b'.repeat(40),utm_campaign:'c'.repeat(39)+'1',utm_content:'d'.repeat(79)+'1'};
 store.recordJourneyEvents([event(1,'view',{params})],ctx);
 store.recordJourneyEvents([event(1,'view',{params:{...params,utm_campaign:'c'.repeat(39)+'2',utm_content:'d'.repeat(79)+'2'}})],{...ctx,visitorId:'e'.repeat(32)});
 assert.equal(get().campaigns.length,2);assert.equal(get().linkEntries.length,2);
 for(let i=0;i<125;i++)store.recordJourneyEvents([event(i+2,'view',{params:{utm_source:'x',utm_content:'placement-'+i}})],ctx);
 assert.ok(get().linkEntries.length<=121);assert.ok(get().limitedEvents>0);
 advance(86400000);store.recordJourneyEvents([event(200,'view',{params})],ctx);
 assert.equal(get().linkEntries.find(r=>r.key.endsWith(params.utm_content)).count,2);
 assert.equal(get().linkSince,'2026-09-07T00:00:00.000Z');
});

test('NH155: tagged arrivals survive restart and midnight without recounting a continued link',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'nh155-')),file=path.join(dir,'feed.json');
 let now=Date.parse('2026-09-07T23:55:00+09:00');
 const clock=()=>new Date(now).toISOString(),params={utm_source:'x',utm_content:'post-one'};
 try{
  const store=new FeedStore({file,clock});store.recordJourneyEvents([event(1,'view',{params})],ctx);store.flushPending();
  const restarted=new FeedStore({file,clock});now+=10*60000;
  restarted.recordJourneyEvents([event(2,'view',{params,resume:true}),event(1,'view',{pageId:'e'.repeat(32),params}),event(3,'view',{params:{...params,utm_content:'post-two'}})],ctx);
  const j=summarize(mergeBuckets(Object.values(restarted.analyticsBuckets()))).journey;
  assert.equal(j.sessions,1);assert.equal(j.browsers,1);assert.equal(j.linkEntries.length,2);
  assert.ok(j.linkEntries.every(row=>row.count===1));
  assert.equal(summarize(restarted.analytics['2026-09-08']).journey.linkEntries[0].key,'x | - | - | post-two');
  restarted.flushPending();
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});

test('NH155: organic links cannot consume tracked-post capacity, and period merge retains both days',()=>{
 const {store,get,advance}=fixture();
 let n=0;
 const arrive=(source,content)=>store.recordJourneyEvents([event(1,'view',{params:{utm_source:source,utm_content:content}})],{...ctx,visitorId:(++n).toString(16).padStart(32,'0')});
 for(let i=0;i<130;i++)arrive('shared_link','post:'+i);
 for(let i=0;i<100;i++)arrive('kakao','day1-'+i);
 advance(86400000);
 for(let i=0;i<100;i++)arrive('kakao','day2-'+i);
 const rows=get().linkEntries;
 assert.equal(rows.filter(r=>r.key.startsWith('kakao |')).length,200);
 assert.equal(rows.filter(r=>!r.key.startsWith('kakao |')).reduce((n,r)=>n+r.count,0),130);
 assert.equal(rows.reduce((n,r)=>n+r.count,0),330);
});

test('background resume is not another PV; inactivity finalizes actual final screen once',()=>{
 const {store,get,advance}=fixture();
 store.recordJourneyEvents([event(1),event(2,'checkpoint',{dwellMs:12000,depth:40}),event(3,'engage')],ctx);
 advance(20000);store.recordJourneyEvents([event(4,'view',{resume:true})],ctx);
 assert.equal(get().pv,1);assert.equal(get().finished,0);
 advance(JOURNEY_IDLE_MS+1);store.finishJourneySessions();store.finishJourneySessions();
 assert.equal(get().finished,1);assert.equal(get().exits[0].key,'오늘판');assert.equal(get().avgDwellSec,12);
 store.recordJourneyEvents([event(5,'view',{resume:true})],ctx);
 assert.equal(get().sessions,2);assert.equal(get().pv,2);assert.equal(get().browsers,1);
});

test('new cookie differs from verified account count; next day is return, period dedupes',()=>{
 const {store,get,advance}=fixture();
 store.recordJourneyEvents([event(1)],{...ctx,accountId:'verified-account'});
 store.recordJourneyEvents([event(1)],{...ctx,visitorId:'d'.repeat(32),accountId:'verified-account'});
 assert.equal(get().browsers,2);assert.equal(get().accounts,1);
 advance(86400000);store.recordJourneyEvents([event(2)],ctx);
 const daily=summarize(Object.values(store.analyticsBuckets()).at(-1)).journey;
 assert.equal(daily.firstObserved,0);assert.equal(daily.returning,1);assert.equal(get().browsers,2);
});

test('midnight continuation is activity but not a new visit; direct detail records display without a card click',()=>{
 const {store,get,advance}=fixture();advance(14*3600000+50*60000);
 store.recordJourneyEvents([event(1,'view',{path:'/live/detail',referrer:'',params:{utm_source:'web_push'}})],ctx);
 assert.equal(get().referrers[0].detail,1);assert.equal(get().referrers[0].content,0);
 advance(20*60000);store.recordJourneyEvents([event(2,'checkpoint',{dwellMs:10000})],ctx);
 let day=summarize(store.analytics['2026-09-08']).journey;
 assert.equal(day.sessions,0);assert.equal(day.browsers,1);
 assert.deepEqual(retentionRows(store.analytics,['2026-09-07'],'2026-09-09')[0].day1,{count:0,total:1});
 advance(31*60000);store.recordJourneyEvents([event(3,'view',{path:'/live'})],ctx);
 assert.deepEqual(retentionRows(store.analytics,['2026-09-07'],'2026-09-09')[0].day1,{count:1,total:1});
});

test('invalid event types, prototype keys and out-of-order duplicate sequences do not corrupt metrics',()=>{
 const {store,get}=fixture();
 store.recordJourneyEvents([null,event(1,'unknown'),event(2,'action',{action:'__proto__'}),event(3),event(2,'engage')],ctx);
 store.recordJourneyEvents([event(2,'engage'),event(4,'ad_click',{slot:'__proto__',variant:'constructor'})],ctx);
 assert.equal(get().pv,1);assert.equal(get().sessions,1);assert.equal(get().engagedBrowsers,1);
 assert.equal(Object.prototype.imp,undefined);assert.equal(Object.prototype.click,undefined);
 assert.doesNotThrow(()=>new FeedStore().recordJourneyEvents([event(1,'view',{params:null})],ctx));
});

test('finance rejects whole invalid save, allows explicit revenue clear, preserves zero',()=>{
 const {store}=fixture();store.setFinance('2026-09',{fixed:[{label:'VM',krw:0}],revenueKrw:200});
 assert.throws(()=>store.setFinance('2026-09',{fixed:[{label:'VM',krw:100}],revenueKrw:-2}));
 assert.equal(store.fixedCosts['2026-09'][0].krw,0);assert.equal(store.revenue['2026-09'],200);
 assert.throws(()=>store.setFinance('2026-13',{fixed:[]}));
 store.setFinance('2026-09',{revenueKrw:null});assert.equal(store.revenue['2026-09'],undefined);
});

test('tagged push/shared entries survive a missing referrer, sparse calendar retention is bounded',()=>{
 const {store,get,advance}=fixture();
 store.recordJourneyEvents([event(1,'view',{referrer:'',params:{utm_source:'web_push',utm_medium:'notification'}})],ctx);
 assert.equal(get().referrers[0].key,'웹 푸시');
 advance(86400000);store.recordJourneyEvents([event(2)],ctx);
 advance(6*86400000);store.recordJourneyEvents([event(3)],ctx);
 const retention=retentionRows(store.analyticsBuckets(),['2026-09-07'],'2026-09-15')[0];
 assert.deepEqual(retention.day1,{count:1,total:1});assert.deepEqual(retention.day7,{count:1,total:1});
 advance(60*86400000);store.recordJourneyEvents([event(4)],ctx);
 assert.equal(store.analytics['2026-09-07'].journey.uids,undefined);
 assert.equal(store.analytics['2026-09-07'].journey.uidsCount,1);
 advance(400*86400000);store.recordJourneyEvents([event(5)],ctx);
 assert.equal(store.analytics['2026-09-07'],undefined);
});

test('first frozen queued packet can be explicitly selected, never by GET',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'nowhot-first-review-')),file=path.join(dir,'feed.json');
 const store=new FeedStore({file});
 const packet={packetId:'first',editionId:'edition-first',rows:[{blindId:'BR-1'}],metrics:{machinePass:1,machineHold:0}};
 store.saveEditorialReviewPacket(packet,{activateIfEmpty:false});
 const server=createServer({file,adminToken:'test',localEditorial:true,localCanonicalPrepublishSchedule:false,localEditorialInventorySchedule:false});
 await new Promise(r=>server.listen(0,r));const base=`http://localhost:${server.address().port}`,headers={'x-admin-token':'test','content-type':'application/json'};
 try{
  const read=()=>fetch(base+'/api/admin/product-blueprint',{headers}).then(r=>r.json());
  let evidence=(await read()).blueprint.localEditorialEvidence;
  assert.equal(evidence.reviewPacket,null);assert.equal(evidence.reviewQueue.items.length,1);
  assert.equal(new FeedStore({file}).activeEditorialReviewPacket(),null);
  const select=token=>fetch(base+'/api/admin/editorial-review-packet',{method:'POST',headers:{...headers,'x-admin-token':token},body:JSON.stringify({packetId:'first',editionId:'edition-first'})});
  assert.equal((await select('wrong')).status,401);
  assert.equal((await select('test')).status,200);
  evidence=(await read()).blueprint.localEditorialEvidence;
  assert.equal(evidence.reviewPacket.packetId,'first');assert.equal(evidence.reviewQueue.state,'active_current_packet');
 }finally{await new Promise(r=>server.close(r));fs.rmSync(dir,{recursive:true,force:true});}
});

test('track API: cookie attribution, bots/internal excluded, body identity ignored and replay deduped',async()=>{
 const server=createServer({adminToken:'test',localEditorial:true,localCanonicalSchedule:false,localInventorySchedule:false});
 await new Promise(r=>server.listen(0,r));const base=`http://localhost:${server.address().port}`;
 try{
  const home=await fetch(base+'/');const cookie=home.headers.getSetCookie().find(c=>c.startsWith('nh_vid=')).split(';')[0];
  const send=(headers={},body={version:2,userId:'forged',events:[event(1)]})=>fetch(base+'/api/track',{method:'POST',headers:{'content-type':'application/json','user-agent':'Mozilla/5.0 SamsungBrowser/26.0',cookie,...headers},body:JSON.stringify(body)});
  await send({'user-agent':'Googlebot'});await send({'x-nowhot-check':'test'});
  const read=()=>fetch(base+'/api/admin/analytics',{headers:{'x-admin-token':'test'}}).then(r=>r.json());
  assert.equal((await read()).summary,null);
  assert.equal((await send({origin:'https://other.test'})).status,403);
  assert.equal((await send()).status,204);await send();
  const j=(await read()).summary.journey;assert.equal(j.browsers,1);assert.equal(j.accounts,0);assert.equal(j.pv,1);
 }finally{await new Promise(r=>server.close(r));}
});

test('admin editorial GETs never create stored packets on empty state',async()=>{
 const server=createServer({adminToken:'test',localEditorial:true,localCanonicalSchedule:false,localInventorySchedule:false});
 await new Promise(r=>server.listen(0,r));const base=`http://localhost:${server.address().port}`;
 try{
  for(const route of ['/api/admin/product-blueprint','/api/admin/editorial-desk?reviewerId=reviewer-a','/api/admin/editorial-review?reviewerId=reviewer-a']){
   const res=await fetch(base+route,{headers:{'x-admin-token':'test'}});
   assert.equal(res.status,route.includes('product-blueprint')?200:409);
   if(res.status===200){const body=await res.json();assert.equal(body.blueprint.localEditorialEvidence.reviewPacket,null);assert.equal(body.blueprint.localEditorialEvidence.evidenceBasis,'persisted_only');}
  }
 }finally{await new Promise(r=>server.close(r));}
});
