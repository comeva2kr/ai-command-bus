import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { FeedStore } from '../src/feed/store.js';
import { createServer } from '../src/feed/server.js';
import { createRequire } from 'node:module';
let chromium;try {({chromium}=createRequire(import.meta.url)('playwright'));}catch{}

const day=86400000, start=Date.parse('2026-09-30T03:00:00Z');
const params={utm_source:'threads',utm_medium:'social',utm_campaign:'post-a',utm_content:'one'};
const ctx={visitorId:'a'.repeat(32),selfHost:'nowhot.kr',ua:'Mozilla/5.0'};
const ev=(seq,extra={})=>({pageId:'b'.repeat(32),seq,type:'view',path:'/',params,...extra});
const query=(from=start,to=start+day)=>({fromAt:new Date(from).toISOString(),toAt:new Date(to).toISOString(),params});

test('exact campaign interval excludes its end, deduplicates browser, preserves first attribution and action time',()=>{
 let now=start;const store=new FeedStore({clock:()=>new Date(now).toISOString()});
 store.recordJourneyEvents([ev(1)],ctx);
 now+=60000;store.recordJourneyEvents([ev(2,{params:{...params,utm_campaign:'other'}}),ev(3,{type:'action',action:'detail'})],ctx);
 now=start+3600000;store.recordJourneyEvents([ev(4)],ctx);
 now=start+day;store.recordJourneyEvents([ev(5),ev(6,{type:'engage'})],ctx);
 const r=store.campaignWindow(query());
 assert.equal(r.state,'complete');assert.equal(r.metrics.sessions,2);assert.equal(r.metrics.browsers,1);
 assert.equal(r.metrics.returningBrowsers,1);assert.equal(r.metrics.engagedSessions,1);
 assert.equal(r.metrics.actions.detail,1);assert.equal(r.day7,null);
 assert.equal(JSON.stringify(r).includes(ctx.visitorId),false);
 assert.equal(store.campaignWindow({...query(),params:{...params,utm_campaign:'other'}}).metrics.sessions,0);
});

test('D7 is mature only after rolling day7 closes; return uses same browser in any campaign',()=>{
 let now=start;const store=new FeedStore({clock:()=>new Date(now).toISOString()});
 store.recordJourneyEvents([ev(1)],ctx);
 now=start+7*day;store.recordJourneyEvents([ev(2,{params:{}})],ctx);
 assert.equal(store.campaignWindow(query()).day7,null);
 now=start+8*day;
 assert.deepEqual(store.campaignWindow(query()).day7,{count:1,total:1});
});

test('unmeasured, unfinished and expired windows stay null; restart keeps closed and active session facts',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'nh-window-')),file=path.join(dir,'feed.json');let now=start;
 try {
  let store=new FeedStore({file,clock:()=>new Date(now).toISOString()});
  store.recordJourneyEvents([ev(1)],ctx);store.flushPending();
  store=new FeedStore({file,clock:()=>new Date(now).toISOString()});
  assert.equal(store.campaignWindow(query()).state,'pending');assert.equal(store.campaignWindow(query()).metrics,null);
  now+=day;store.recordJourneyEvents([ev(2)],ctx);store.flushPending();
  store=new FeedStore({file,clock:()=>new Date(now).toISOString()});
  assert.equal(store.campaignWindow(query()).metrics.sessions,1);
  assert.equal(store.campaignWindow(query(start-1,start+day)).metrics,null);
  now=start+46*day;assert.equal(store.campaignWindow(query()).metrics,null);
  store.flushPending();
 } finally {fs.rmSync(dir,{recursive:true,force:true});}
});

test('window API requires admin auth, explicit timezone and bounded valid interval',async()=>{
 const server=createServer({adminToken:'test',localEditorial:true,localCanonicalSchedule:false,localInventorySchedule:false});
 await new Promise(r=>server.listen(0,r));const base=`http://localhost:${server.address().port}/api/admin/analytics/window`;
 try {
  assert.equal((await fetch(base)).status,401);
  const headers={'x-admin-token':'test'};
  for(const suffix of ['', '?fromAt=2026-09-30T10:00&toAt=2026-10-01T10:00', '?fromAt=bad&toAt=bad'])assert.equal((await fetch(base+suffix,{headers})).status,400);
  const r=await fetch(base+'?'+new URLSearchParams({...query(),params:undefined}),{headers});
  assert.equal(r.status,200);assert.equal((await r.json()).metrics,null);
 } finally {await new Promise(r=>server.close(r));}
});

test('tracking capacity drops invalidate exact counts instead of claiming a complete zero',()=>{
 let now=start;const store=new FeedStore({clock:()=>new Date(now).toISOString()});
 store.journeyPages=Object.fromEntries(Array.from({length:20000},(_,i)=>['p'+i,{at:now}]));
 store.recordJourneyEvents([ev(1)],ctx);
 now+=day;
 assert.equal(store.campaignWindow(query()).state,'unmeasured');
 assert.equal(store.campaignWindow(query()).metrics,null);
});

test('a later collection gap preserves closed windows but makes overlapping D7 unknown',()=>{
 let now=start;const store=new FeedStore({clock:()=>new Date(now).toISOString()});store.recordJourneyEvents([ev(1)],ctx);
 now=start+7*day;
 store.journeyPages=Object.fromEntries(Array.from({length:20000},(_,i)=>['p'+i,{at:now}]));
 store.recordJourneyEvents([ev(2)],ctx);
 now=start+8*day;
 const r=store.campaignWindow(query());assert.equal(r.state,'complete');assert.equal(r.metrics.browsers,1);assert.equal(r.day7,null);
 assert.equal(store.campaignWindow(query(start+7*day,start+8*day)).state,'unmeasured');
});

test('archive overflow and retention remove identities and mark coverage accurately',()=>{
 let now=start+day;const store=new FeedStore({clock:()=>new Date(now).toISOString()});
 store.journeyWindow={since:start,rows:Array.from({length:100001},(_,i)=>({vid:'v'+i,at:start+i,camp:'threads | social | post-a'}))};
 assert.equal(store.campaignWindow(query()).metrics,null);
 assert.equal(store.journeyWindow.rows.length,100000);
 now+=46*day;store.finishJourneySessions();assert.equal(store.journeyWindow.rows.length,0);
});

test('admin window form uses KST and displays real measured results without exposing identities', {skip:!chromium}, async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'nh-window-ui-')),file=path.join(dir,'feed.json');let now=start;
 const store=new FeedStore({file,clock:()=>new Date(now).toISOString()});store.recordJourneyEvents([ev(1),ev(2,{type:'action',action:'detail'})],ctx);store.flushPending();
 now=start+day;
 const server=createServer({file,clock:()=>new Date(now).toISOString(),adminToken:'test',localEditorial:true,localCanonicalSchedule:false,localInventorySchedule:false});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const browser=await chromium.launch({headless:true,executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH});
 try {
  const page=await browser.newPage({timezoneId:'America/Los_Angeles'});const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(`http://127.0.0.1:${server.address().port}/admin.html`);
  await page.evaluate(()=>{token='test';document.body.innerHTML=campaignWindowForm();});
  await page.locator('[name=published]').fill('2026-09-30T12:00');
  for(const [name,value] of Object.entries(params))await page.locator(`[name=${name}]`).fill(value);
  await page.getByRole('button',{name:'성과 확인'}).click();
  await page.waitForSelector('#campaign-window-result .card');
  assert.deepEqual(await page.locator('#campaign-window-result .v').allTextContents(),['1','1','0','1','1','0','0']);
  await page.locator('[name=hours]').selectOption('72');await page.getByRole('button',{name:'성과 확인'}).click();
  await page.waitForFunction(()=>document.getElementById('campaign-window-result').textContent.includes('아직 끝나지'));
  assert.equal(await page.locator('#campaign-window-result .card').count(),0);assert.deepEqual(errors,[]);
 }finally {await browser.close();server.closeAllConnections();await new Promise(r=>server.close(r));fs.rmSync(dir,{recursive:true,force:true});}
});
