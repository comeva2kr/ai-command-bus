import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const today = fs.readFileSync(path.join(ROOT, "src/feed/public/today.html"), "utf8");
const live = fs.readFileSync(path.join(ROOT, "src/feed/public/index.html"), "utf8");

test("오늘·실시간: 두 화면이 같은 순서와 활성 표시를 유지한다", () => {
  assert.match(today, /data-view-switch data-active="today"/);
  assert.match(live, /data-view-switch data-active="live"/);
  for (const html of [today, live]) {
    assert.match(html, /data-view="today"[^>]*>오늘<\/a>[\s\S]*data-view="live"[^>]*>실시간<\/a>/);
    assert.match(html, /class="view-indicator"/);
    assert.match(html, /flex:0 0 248px/);
    assert.match(html, /flex-basis:112px/);
    assert.match(html, /지금핫[\s\S]{0,180}NowHot[\s\S]{0,180}맞춰가는 중/);
    assert.match(html, /\.brand-en\{display:none\}/,
      "모바일에서는 영문만 숨기고 지금핫·대표문구는 유지한다");
  }
});

test("오늘·실시간: 표시선이 먼저 움직인 뒤 이동하며 모션 축소 설정을 존중한다", () => {
  for (const html of [today, live]) {
    assert.match(html, /nav\.dataset\.target=target/);
    assert.match(html, /setTimeout\(\(\)=>location\.assign\(link\.href\),reduced\?0:210\)/);
    assert.match(html, /prefers-reduced-motion:reduce/);
  }
});

test("오늘판 폴백 고지: 제공된 실제 날짜·슬롯·최신판 아님이 화면 문구에 있다 (S3a, 2026-08-13)", () => {
  // API의 fallback·servedDate 존재만으로 완료 처리하지 않는다 — 사용자
  // 화면 문구가 serving 영수증(servedDate·servedSlotId) 기준으로
  // "N월 N일 X판을 보여드리고 있습니다"를 말해야 한다 (David 확정 지시).
  assert.match(today, /serving\?\.servedSlotId/,
    "슬롯은 폴백 판 자체가 아니라 serving 영수증의 servedSlotId를 쓴다");
  assert.match(today, /serving\?\.servedDate/,
    "날짜는 generatedAt이 아니라 serving 영수증의 servedDate를 쓴다");
  assert.match(today, /판을 보여드리고 있습니다 · 최신 /,
    "제공 중인 판과 '최신판 아님'을 한 문장으로 명시한다");
  assert.match(today, /:\s*`\$\{servedDateLabel\?servedDateLabel\+" · ":""\}\$\{slotLabel\[servedSlotId\]/,
    "현재판도 생성 시각의 날짜가 아니라 실제 제공 날짜·슬롯을 표시한다");
  assert.doesNotMatch(today, /:\s*`\$\{formatKst\(edition\.generatedAt\)\}/,
    "자정 뒤 생성된 저녁판을 다음 날 판으로 잘못 표시하지 않는다");
});

test("오늘판 복수 선택: 저장은 순서대로 처리하고 이전 응답은 마지막 선택을 덮지 않는다", () => {
  assert.match(today, /categoryQueue:Promise\.resolve\(\)/,
    "여러 분야 저장 요청은 한 큐에서 순서대로 처리한다");
  assert.match(today, /const revision=\+\+state\.categoryRevision/);
  assert.match(today, /body:JSON\.stringify\(\{userId:state\.userId,categories\}\)/,
    "각 저장 작업은 클릭 시점의 선택 배열을 보존한다");
  assert.match(today, /if\(revision!==state\.categoryRevision\)return/,
    "뒤에 선택이 생기면 앞 저장 작업은 화면을 갱신하지 않는다");
  assert.match(today, /state\.loadController\?\.abort\(\)/,
    "새 선택은 이미 진행 중인 이전 오늘판 요청을 즉시 취소한다");
  assert.match(today, /const loadRevision=\+\+state\.loadRevision/);
  assert.match(today, /if\(loadRevision!==state\.loadRevision\)return/,
    "늦게 도착한 이전 오늘판 응답은 렌더하지 않는다");
});

test("오늘판 복수 선택: 분야별 숫자는 다른 분야의 교차 태그로 14를 넘지 않는다", () => {
  assert.match(today, /Math\.min\(counts\.get\(category\.id\)\|\|0,categoryIssueLimit\)/,
    "분야별 표시 수는 해당 판의 분야당 편성 상한까지만 보여준다");
});

test("오늘판 카드: 제목 반복 문장·중복 이유를 걷고 출처를 분야 옆에 둔다", () => {
  assert.doesNotMatch(today, /class="issue-summary"/,
    "제목과 출처를 되풀이하던 목록 요약문을 렌더하지 않는다");
  assert.doesNotMatch(today, /<b>지금 주목할 이유<\/b>/,
    "왜 중요한가와 같은 내용을 되풀이하던 칸을 렌더하지 않는다");
  assert.match(today, /issue-kicker[\s\S]{0,500}source-links[\s\S]{0,300}<\/div>\s*<h2>/,
    "출처는 카드 하단이 아니라 분야가 있는 윗줄에 표시한다");
  assert.match(today, /상위 \(\?:목록\|리스트\)에[\s\S]*제목이 올라/,
    "상세에서도 출처 상위 목록·제목 재인용 문장을 요약으로 쓰지 않는다");
});

test("오늘판 상세: 카드 클릭으로 사진·한국어 요약·원문 링크가 있는 플로팅 패널을 연다", () => {
  assert.match(today, /class="detail-overlay" id="issueDetail"/);
  assert.match(today, /role="dialog" aria-modal="true"/);
  assert.match(today, /openIssueDetail\(Number\(button\.dataset\.openIssue\),button\)/);
  assert.doesNotMatch(today, /\/api\/item\?userId=/,
    "카드를 누른 뒤 기사 정보를 다시 가져오지 않는다");
  assert.match(today, /<h3>기사 요약<\/h3>/);
  assert.match(today, /class="detail-image"/);
  assert.match(today, /row\.relay\?"중계 링크 열기":"원문 보기"/);
  assert.match(today, /event\.key==="Escape"/,
    "키보드에서도 플로팅 상세를 닫을 수 있다");
});

test("오늘판 상세 계약: 편집 요약 우선·URL별 원문·실패 상태·모달 기본 접근성을 지킨다", () => {
  assert.match(today, /articleSummary/);
  assert.doesNotMatch(today, /\/api\/today\/summary/,
    "요약은 판을 내기 전에 준비하며 클릭 시 생성 API를 부르지 않는다");
  assert.match(today, /let articleSummary=issue\.articleSummary\|\|\{\}/,
    "카드에 저장된 기사 요약 정본을 그대로 연다");
  assert.match(today, /\["ready","excerpt_only"\]\.includes\(articleSummary\.status\)/,
    "준비된 편집 요약과 공개 본문 발췌를 상세의 첫 내용으로 사용한다");
  assert.match(today, /articleSummary\.textKo/);
  assert.match(today, /sourceCount/);
  assert.match(today, /sourceLabel/);
  assert.match(today, /unavailableReasonCode/);
  for (const code of ["AUTH_REQUIRED", "ACCESS_DENIED", "RATE_LIMITED", "NOT_FOUND", "HTTP_ERROR", "NON_HTML", "TIMEOUT", "NETWORK_ERROR", "UNSAFE_URL", "NO_PUBLIC_BODY", "PUBLIC_BODY_TOO_SHORT", "PUBLISHER_URL_UNAVAILABLE", "SUMMARY_VERIFICATION_HOLD", "SUMMARY_GENERATION_ERROR", "ARTICLE_IDENTITY_MISMATCH", "ARTICLE_SUMMARY_NOT_PREPARED"]) {
    assert.match(today, new RegExp(code), `폴백 사유 ${code}를 한국어로 고지한다`);
  }
  assert.match(today, /원문 서버가 외부 자동접근을 거부해 공개 본문을 읽지 못했습니다/);
  assert.match(today, /function issueSourceLinks[\s\S]*const seen=new Set\(\)/,
    "요약·근거·참조의 원문 URL을 한 목록에서 중복 제거한다");
  assert.match(today, /const summaryPrepared=\["ready","excerpt_only","source_unavailable"\]/,
    "준비된 기사 요약의 출처 정본 여부를 구분한다");
  assert.match(today, /summaryPrepared\?summaryLinks:\[\.\.\.eventSources,\.\.\.evidence,\.\.\.\(issue\.refs\|\|\[\]\)\]/,
    "준비된 요약에는 출처 정본만 쓰고 준비 전 이슈에만 과거 경로를 사용한다");
  assert.match(today, /row\.relay&&directGroups\.has\(row\.sourceGroup\)/,
    "직접 언론사 URL이 있으면 같은 매체의 Google 뉴스 중계 링크는 감춘다");
  assert.match(today, /evidenceRole!=="related_observation"/,
    "커뮤니티 반응 관찰은 기사 원문 출처 목록에 섞지 않는다");
  assert.match(today, /summarySourceCount/,
    "사건을 다룬 전체 원문 수와 실제 요약에 사용한 공개 본문 수를 구분한다");
  assert.match(today, /공개 발췌/,
    "장문 요약이 불가능해도 확보된 200자 발췌를 무엇인지 밝혀 표시한다");
  assert.match(today, /사진을 불러오지 못했습니다/,
    "실패한 이미지도 상태 고지를 남긴다");
  assert.match(today, /기사에서 사용할 수 있는 사진을 확인하지 못했습니다/,
    "기사 사진 자체가 없을 때도 무음으로 비워두지 않는다");
  assert.match(today, /aria-describedby="detailDescription"/);
  assert.match(today, /aria-controls="issueDetail"/);
  assert.match(today, /aria-expanded/);
  assert.match(today, /safe-area-inset-bottom/);
  assert.match(today, /focus trap|focusTrap|keydown[\s\S]{0,500}Tab/i,
    "모달 안에서 Tab 포커스를 순환한다");
  const detailBlock=today.match(/function openIssueDetail\([\s\S]*?\n\}/)?.[0]||"";
  assert.doesNotMatch(detailBlock, /\b(?:fetch|json)\s*\(|\bawait\b/,
    "상세를 여는 동안 네트워크나 비동기 요약 생성을 시작하지 않는다");
});

test("오늘판 분야 상태: 요청 조합을 확정값으로 보존하고 저장 실패 때 되돌린다", () => {
  assert.match(today, /confirmedCategories/,
    "서버에 저장된 분야와 화면의 임시 선택을 같은 배열로 쓰면 실패 복구가 불가능하다");
  assert.match(today, /edition\.requestedCategories&&edition\.requestedCategories\.length[\s\S]{0,220}state\.confirmedCategories/,
    "부분 제공 응답에서도 사용자가 요청한 분야 조합을 확정 상태로 보존해야 한다");
  assert.match(today, /catch\(\(error\)=>\{[\s\S]{0,500}state\.confirmedCategories[\s\S]{0,500}renderCategories/,
    "분야 저장 실패 때 마지막 서버 확정 조합으로 칩을 되돌려야 한다");
  assert.match(today, /if\(revision!==state\.categoryRevision\)return;[\s\S]{0,220}\/api\/today\/categories/,
    "빠르게 연속 선택하면 중간 조합을 저장하지 않고 마지막 조합만 처리한다");
  assert.match(today, /AbortSignal\.timeout\(10000\)/,
    "분야 저장 요청 하나가 멈춰 이후 선택까지 영구 대기시키지 않는다");
  assert.match(today, /loadEdition\(false,state\.editionDate,categories\)/,
    "오늘판 조회는 mutable 전역값이 아니라 저장이 끝난 정확한 조합을 사용한다");
});

test("오늘판 출처: Google 뉴스 중계는 언론사 원문으로 위장하지 않고 기본 이미지를 쓰지 않는다", () => {
  assert.match(today, /Google 뉴스 중계/,
    "언론사 이름만 붙인 Google 뉴스 주소는 원문으로 오인된다");
  assert.match(today, /PUBLISHER_URL_UNAVAILABLE[\s\S]{0,600}summaryImage/,
    "실제 언론사 주소를 못 푼 경우 Google 뉴스 기본 이미지를 기사 사진으로 쓰면 안 된다");
  assert.match(today, /hostname==="news\.google\.com"\|\|hostname\.endsWith\("\.news\.google\.com"\)/,
    "www.news.google.com 같은 하위 호스트도 언론사 원문으로 표시하면 안 된다");
  assert.match(today, /publisherKey/,
    "KBS 뉴스와 KBS뉴스처럼 표기만 다른 같은 매체의 직접 링크와 중계 링크를 중복 노출하면 안 된다");
});
