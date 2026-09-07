// Isolated local browser scenarios. Requires installed Playwright, never production credentials.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createServer} from '../src/feed/server.js';
import {buildEditorialReviewDesk} from '../src/feed/editorial-review-desk.js';
const {chromium}=createRequire(import.meta.url)('playwright');
process.env.NODE_TEST_CONTEXT='browser-qa';
const output=fs.mkdtempSync(path.join(os.tmpdir(),'nowhot-traffic-qa-'));
const server=createServer({adminToken:'local-qa-token',localEditorial:true,localEditorialInventorySchedule:false,localCanonicalPrepublishSchedule:false,pushDigestMs:0,sources:[]});
await new Promise(r=>server.listen(0,r));const base=`http://localhost:${server.address().port}`;
const browser=await chromium.launch({headless:true,executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH});
const context=await browser.newContext({viewport:{width:393,height:852},userAgent:'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/130.0 Mobile Safari/537.36 SamsungBrowser/26.0',serviceWorkers:'block'});
const errors=[];
context.on('page',page=>page.on('pageerror',error=>errors.push(error.message)));
await context.route('**/*',route=>new URL(route.request().url()).origin===base?route.continue():route.abort());
const summary=()=>context.request.get(base+'/api/admin/analytics',{headers:{'x-admin-token':'local-qa-token'}}).then(r=>r.json());
const wait=ms=>new Promise(r=>setTimeout(r,ms));
try{
 const page=await context.newPage();await page.goto(base+'/?utm_source=qa&utm_medium=post');
 await page.waitForFunction(()=>window.NowHotTrack);await wait(1200);
 const before=(await summary()).summary.journey;
 assert.equal(before.sessions,1);assert.equal(before.browsers,1);assert.equal(before.pv,1);
 const noFalseClicks=await page.evaluate(()=>{
  const events=[];const old=window.NowHotTrack;
  window.NowHotTrack={click:()=>events.push('click'),view:()=>events.push('view')};
  const issue={headline:'QA 기사',categoryIds:['tech'],reader:{headline:'QA 기사',whyImportant:'QA 근거'},sourceEvidence:[]};
  try{renderIssues({issues:[issue,issue],availableCategories:[{id:'tech',label:'기술'}]});}finally{window.NowHotTrack=old;}
  return events;
 });assert.deepEqual(noFalseClicks,[]);
 await page.evaluate(()=>{
  const box=document.createElement('aside');box.id='qaAd';box.className='ad-slot';box.dataset.audienceSlot='today-feed';
  box.style.cssText='position:fixed;top:300px;left:15px;width:200px;height:80px;z-index:999999;background:white';
  const link=document.createElement('a');link.href='https://example.invalid/qa-only';link.textContent='QA local ad';link.onclick=e=>e.preventDefault();box.append(link);document.body.append(box);
  NowHotTrack.observeAds(document.body);
 });await wait(150);
 await page.locator('#qaAd a').click();await page.evaluate(()=>NowHotTrack.flush());await wait(100);
 const adJourney=(await summary()).summary.journey;
 assert.equal(adJourney.adSlots.find(r=>r.key==='ad_impression:today-feed')?.count,1);
 assert.equal(adJourney.adSlots.find(r=>r.key==='ad_click:today-feed')?.count,1);
 assert.equal(adJourney.actions.find(r=>r.key==='ad')?.count,1);
 await page.evaluate(()=>document.getElementById('qaAd').remove());
 await page.goto(base+'/live');await page.waitForFunction(()=>window.NowHotTrack);await wait(1200);
 let j=(await summary()).summary.journey;assert.equal(j.sessions,1);assert.equal(j.browsers,1);assert.equal(j.pv,2);
 await page.reload();await wait(1200);j=(await summary()).summary.journey;assert.equal(j.sessions,1);assert.equal(j.browsers,1);assert.equal(j.pv,3);
 // Response-dependent retry after cookie initialization; no unobservable beacon ack.
 await context.clearCookies();await page.evaluate(()=>{NowHotTrack.action('share');return NowHotTrack.flush();});
 await wait(150);assert.ok((await context.cookies()).some(c=>c.name==='nh_vid'));
 j=(await summary()).summary.journey;assert.equal(j.browsers,2);assert.equal(j.actions.find(a=>a.key==='share')?.count,1);
 const yesterday=new Date(Date.now()+9*3600000-86400000).toISOString().slice(0,10);
 await page.route('**/api/admin/analytics?*',async route=>{
  const response=await route.fetch(),data=await response.json();
  data.rows.unshift({...data.rows[0],key:yesterday,label:yesterday,journey:null,visitors:14,pv:147,contentClicks:19});
  await route.fulfill({response,json:data});
 });
 await page.evaluate(()=>localStorage.setItem('admin_token','local-qa-token'));
 await page.goto(base+'/admin');await page.waitForFunction(()=>document.getElementById('panel')?.textContent.includes('실제 이용 현황'));
 assert.equal(await page.getByText('기간 PV',{exact:true}).isVisible(),true,'Existing visit history must be visible without opening a disclosure');
 const button=name=>page.getByRole('button',{name,exact:true});
 await button('행동 분석').click();await page.waitForFunction(()=>document.getElementById('panel')?.textContent.includes('공통 브라우저 계측'));
 const historyRow=page.locator('tr').filter({hasText:yesterday}).filter({hasText:'147'});
 assert.equal(await historyRow.count(),1,'Legacy row must coexist with v2 instead of disappearing');
 assert.equal(await historyRow.isVisible(),true);
 assert.equal(await page.locator('#rgFrom').count(),1,'Both measurement periods use one date selector');
 await page.screenshot({path:path.join(output,'history-mobile.png'),fullPage:true});
 await page.unroute('**/api/admin/analytics?*');
 for(const name of ['행동 분석','수익·지출','커뮤니티','게시글','개선 요청','광고','우리 딜','댓글','금지어','사용자','개발관리']){
  await button(name).click();await page.waitForFunction(()=>document.getElementById('panel')?.textContent!=='불러오는 중…');
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),name+' mobile overflow');
 }
 const blueprint=await context.request.get(base+'/api/admin/product-blueprint',{headers:{'x-admin-token':'local-qa-token'}}).then(r=>r.json());
 blueprint.blueprint.localEditorialEvidence.reviewQueue.items=[{packetId:'first',editionId:'first-edition',issueCount:1}];
 let firstSelection=null;
 await page.route('**/api/admin/product-blueprint',route=>route.fulfill({contentType:'application/json',body:JSON.stringify(blueprint)}));
 await page.route('**/api/admin/editorial-review-packet',route=>{firstSelection=route.request().postDataJSON();return route.fulfill({contentType:'application/json',body:'{"ok":true}'});});
 await button('개발관리').click();await page.locator('#editorialReviewPacketActivate').click();
 await page.waitForFunction(()=>document.getElementById('editorialReviewPacketActivate')?.disabled===false);
 assert.deepEqual(firstSelection,{packetId:'first',editionId:'first-edition'});
 await page.unroute('**/api/admin/product-blueprint');await page.unroute('**/api/admin/editorial-review-packet');
 await page.route('**/api/admin/analytics?*',route=>route.fulfill({status:503,contentType:'application/json',body:'{"error":"QA unavailable"}'}));
 await button('행동 분석').click();await page.waitForFunction(()=>document.getElementById('panel').textContent.includes('QA unavailable'));
 await page.unroute('**/api/admin/analytics?*');
 await page.route('**/api/admin/analytics?*',async route=>{await wait(500);await route.continue();});
 await button('행동 분석').click();await button('광고').click();await wait(650);
 assert.ok((await page.locator('#panel').innerText()).includes('광고 — 연결 현황'));
 await page.unroute('**/api/admin/analytics?*');
 await button('행동 분석').click();await page.waitForFunction(()=>document.getElementById('panel').textContent.includes('공통 브라우저 계측'));
 await page.screenshot({path:path.join(output,'analytics-mobile.png'),fullPage:true});
 // Desk A draft must save under A before B can load; failed save keeps A editable.
 const packet={packetId:'qa-packet',editionId:'qa-edition',rows:[{blindId:'QA-1',categoryIds:['tech'],subject:'검수 예시',headline:'검수 예시',paragraph:'자료',sourceEvidence:[]}]};
 const saved=new Map();let failSave=false;
 await page.route('**/api/admin/editorial-desk?*',route=>{
  const id=new URL(route.request().url()).searchParams.get('reviewerId');
  return route.fulfill({contentType:'application/json',body:JSON.stringify(buildEditorialReviewDesk({packet,reviewerId:id,review:saved.get(id)}))});
 });
 const writes=[];
 await page.route('**/api/admin/editorial-review',async route=>{
  const body=route.request().postDataJSON();writes.push(body);await wait(150);
  if(failSave)return route.fulfill({status:409,contentType:'application/json',body:'{"error":"packet changed"}'});
  const review={annotations:body.annotations,savedAt:new Date().toISOString()};saved.set(body.reviewerId,review);
  return route.fulfill({contentType:'application/json',body:JSON.stringify(review)});
 });
 await page.goto(base+'/admin/editorial-desk');await page.waitForSelector('#reviewNotes');
 await page.locator('#reviewNotes').fill('검수자 A의 초안');await page.locator('[data-seat="reviewer-b"]').click();
 await page.waitForFunction(()=>state.reviewerId==='reviewer-b');
 assert.equal(writes[0].reviewerId,'reviewer-a');assert.equal(writes[0].annotations[0].notes,'검수자 A의 초안');
 assert.equal(await page.locator('#reviewNotes').inputValue(),'');
 failSave=true;await page.locator('#reviewNotes').fill('검수자 B 보존');await page.locator('[data-seat="reviewer-a"]').click();
 await page.waitForFunction(()=>state.saveError);assert.equal(await page.evaluate(()=>state.reviewerId),'reviewer-b');
 assert.equal(await page.locator('#reviewNotes').inputValue(),'검수자 B 보존');
 failSave=false;await page.locator('#retrySave').click();await page.waitForFunction(()=>!state.dirty&&!state.saving);
 assert.equal(saved.get('reviewer-b').annotations[0].notes,'검수자 B 보존');
 assert.deepEqual(errors,[]);
 fs.writeFileSync(path.join(output,'result.json'),JSON.stringify({passed:true,scenarios:13,at:new Date().toISOString(),errors},null,2));
 console.log(JSON.stringify({passed:true,scenarios:13,output}));
}finally{await browser.close();await new Promise(r=>server.close(r));}
