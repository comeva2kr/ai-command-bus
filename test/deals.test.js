// 딜 글 판별·상품군 매칭·비율 보장 (David 2026-08-05).
//
// 지키려는 것: "뽐뿌 같은 구매글 관련도 일정 비율로 노출시켜야 바로 아래나
// 상세 페이지에 관련 광고를 달지 않겠어? 내용글과 직접 연관 있는 카테고리나
// 상품으로." — 딜이 피드에서 사라지지 않는 것과, 광고 도착지가 상품과 맞는 것.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parseDealTitle, isDeal, destForDeal, ensureDealShare, DEAL_SHARE_DEFAULT } from "../src/feed/deals.js";

test("실제 게시판 제목에서 쇼핑몰·상품·가격을 뽑는다", () => {
  const p = parseDealTitle("[지마켓] 반스 남녀공용 로퍼 어센틱 (26,180원/무배)");
  assert.equal(p.mall, "지마켓");
  assert.equal(p.name, "반스 남녀공용 로퍼 어센틱");
  assert.match(p.price, /26,180원/);
});

test("원화·외화·말머리 중 하나만 있어도 딜로 본다", () => {
  // 셋 다 그 게시판이 스스로 붙인 형식이라 우리가 추측하는 값이 아니다.
  assert.ok(isDeal({ title: "[네이버] 포크밸리 한돈 감자탕용 등뼈 (13,960원/무료)" }));
  assert.ok(isDeal({ title: "용암해수 포기김치 1kg (12,680원/무료배송)" }));
  // 해외판: 달러 표기 + 20자 말머리. 14자로 잘라 두면 이 줄이 통째로 빠진다.
  assert.ok(isDeal({ title: "[Dell Refurbished] Latitude 7440 ($488.33)" }));
  assert.ok(!isDeal({ title: "오늘 회사에서 있었던 황당한 일" }));
});

test("상품군이 광고 도착지로 이어진다", () => {
  assert.equal(destForDeal("[네이버] 포크밸리 한돈 감자탕용 등뼈 냉동 1kg"), "fresh");
  assert.equal(destForDeal("[지마켓] 반스 남녀공용 로퍼 어센틱"), "fashion");
  assert.equal(destForDeal("[쿠팡] 삼성 노트북 갤럭시북"), "dgt");
  // 상품군을 못 골라도 외화 표기가 있으면 직구다 — 제목에 적힌 증거다.
  assert.equal(destForDeal("[Amazon.com] Something Unknown ($519.99)"), "oversea");
  // 억지로 붙이지 않는다: 근거 없으면 null, 호출부가 기본 문맥 규칙으로 내려간다.
  assert.equal(destForDeal("경품 응모 이벤트 안내"), null);
});

test("딜이 하나도 없던 피드에 최소 비율만큼 들어온다", () => {
  const items = Array.from({ length: 25 }, (_, i) => ({ id: `n${i}`, title: `일반 글 ${i}` }));
  const deals = Array.from({ length: 10 }, (_, i) => ({ id: `d${i}`, title: `[쿠팡] 상품 ${i} (1,000원/무료)` }));
  const out = ensureDealShare(items, deals);
  const got = out.filter(isDeal).length;
  assert.ok(got >= Math.floor(25 * DEAL_SHARE_DEFAULT), `딜 ${got}건은 보장 비율에 못 미친다`);
  // 앞에 몰아넣으면 첫 화면이 광고판이 된다 — 첫 두 칸은 원래 글이어야 한다.
  assert.ok(!isDeal(out[0]) && !isDeal(out[1]));
  // 이미 있던 글이 밀려나거나 사라지지 않는다.
  for (const it of items) assert.ok(out.some((o) => o.id === it.id), `${it.id}가 사라졌다`);
});

test("이미 딜이 충분하면 더 넣지 않는다", () => {
  const items = Array.from({ length: 10 }, (_, i) => ({ id: `d${i}`, title: `[쿠팡] 상품 ${i} (1,000원)` }));
  const out = ensureDealShare(items, [{ id: "x", title: "[네이버] 추가 (2,000원)" }]);
  assert.equal(out.length, 10);
});

test("딜 소스가 여러 곳 등록돼 있다", () => {
  // 한 게시판만 쓰면 그 게시판 취향이 곧 우리 취향이 된다.
  const doc = JSON.parse(readFileSync(new URL("../src/feed/communities.json", import.meta.url), "utf8"));
  const deals = doc.communities.filter((s) => s.isDeal && s.enabled !== false);
  assert.ok(deals.length >= 4, `딜 소스 ${deals.length}곳 — 최소 4곳은 켜져 있어야 한다`);
  for (const s of deals) {
    assert.ok(s.adapter && s.adapter.list && s.adapter.list.parserCheckedAt,
      `${s.id}: 파서 실측일이 없다`);
  }
});

test("서버가 끼우는 광고도 딜 글의 상품군을 따라간다", async () => {
  const { injectSlots } = await import("../src/feed/monetize.js");
  // 슬롯은 items[i] **앞**에 들어간다 — 딜 글은 광고의 위·아래 어느 쪽이든 이웃이다.
  const items = [
    { id: "a", title: "일반 글" },
    { id: "b", title: "[네이버] 한돈 감자탕용 등뼈", isDeal: true, dealDest: "fresh" },
    { id: "c", title: "일반 글 2" }
  ];
  const candidates = [
    { id: "ad-dgt", dest: "dgt", relevance: 1 },
    { id: "ad-fresh", dest: "fresh", relevance: 1 }
  ];
  const r = injectSlots(items, candidates, { every: 1, skipFirst: 1, maxPerPage: 1, minRelevance: 0 });
  const ad = r.items.find((x) => x.id && x.id.startsWith("ad-"));
  assert.equal(ad.id, "ad-fresh", "딜 옆인데 상품군이 다른 배너가 붙었다");
});

test("딜이 아니면 원래 로테이션 순서를 흐트러뜨리지 않는다", async () => {
  const { injectSlots } = await import("../src/feed/monetize.js");
  const items = [{ id: "a", title: "글1" }, { id: "b", title: "글2" }, { id: "c", title: "글3" }];
  const candidates = [
    { id: "ad-1", dest: "dgt", relevance: 1 },
    { id: "ad-2", dest: "fresh", relevance: 1 }
  ];
  const r = injectSlots(items, candidates, { every: 1, skipFirst: 1, maxPerPage: 2, minRelevance: 0 });
  const ads = r.items.filter((x) => x.id && x.id.startsWith("ad-")).map((x) => x.id);
  assert.deepEqual(ads, ["ad-1", "ad-2"]);
});

test("광고 자리가 코앞의 딜 글 아래까지 기다린다 (개수는 그대로)", async () => {
  const { injectSlots } = await import("../src/feed/monetize.js");
  // 자리가 되는 지점(1번)에는 일반 글이 있고, 두 칸 뒤에 딜이 있다.
  const items = [
    { id: "a", title: "글1" },
    { id: "b", title: "글2" },
    { id: "c", title: "[네이버] 한돈 등뼈", isDeal: true, dealDest: "fresh" },
    { id: "d", title: "글4" },
    { id: "e", title: "글5" }
  ];
  const candidates = [{ id: "ad-dgt", dest: "dgt", relevance: 1 }, { id: "ad-fresh", dest: "fresh", relevance: 1 }];
  const r = injectSlots(items, candidates, { every: 4, skipFirst: 1, maxPerPage: 2, minRelevance: 0 });
  const idx = r.items.findIndex((x) => x.id && x.id.startsWith("ad-"));
  assert.equal(r.items[idx - 1].id, "c", "광고가 딜 글 바로 아래에 붙지 않았다");
  assert.equal(r.items[idx].id, "ad-fresh", "딜 상품군과 다른 배너가 붙었다");
  // 자리를 옮긴 것이지 늘린 것이 아니다.
  assert.equal(r.slots.length, 1);
});

// ── David 실기기 리포트 (2026-08-06) 세 건의 회귀 방지 ───────────────────────

test("딜이 뭉치지 않는다 — 상한과 최소 간격", async () => {
  const { capDeals, DEAL_MIN_GAP } = await import("../src/feed/deals.js");
  // 실기기에서 본 모양: 연달아 2개, 조금 뒤 4개.
  const mk = (i, deal, c = 0) => ({ id: "x" + i, title: "글" + i, isDeal: deal, commentCount: c });
  const list = [
    mk(0, false), mk(1, true, 17), mk(2, true, 3), mk(3, false), mk(4, false),
    mk(5, true, 1), mk(6, true, 5), mk(7, true, 2), mk(8, true, 0), mk(9, false),
    mk(10, false), mk(11, false)
  ];
  const out = capDeals(list, { is: (i) => i.isDeal === true });
  const idx = out.map((it, i) => (it.isDeal ? i : -1)).filter((i) => i >= 0);
  assert.ok(idx.length >= 1, "딜이 통째로 사라지면 안 된다");
  for (let k = 1; k < idx.length; k++) {
    assert.ok(idx[k] - idx[k - 1] >= DEAL_MIN_GAP, `딜이 ${idx[k] - idx[k - 1]}칸 간격으로 붙었다`);
  }
  // 남는 건 가장 반응 큰 딜이어야 한다 — David: "가~장 핫한 것만".
  assert.ok(out.some((it) => it.id === "x1"), "댓글 17개짜리가 빠졌다");
  // 일반 글은 하나도 사라지지 않는다.
  for (const it of list.filter((x) => !x.isDeal)) {
    assert.ok(out.some((o) => o.id === it.id), `${it.id}가 사라졌다`);
  }
});

test("딜이 아닌 글에서도 상품군을 읽어 광고를 맞춘다", async () => {
  const { destForText } = await import("../src/feed/deals.js");
  // David: "비단 쿠팡 광고가 아니라도 말야. 다른 광고라도 연관 있는 애가 붙어야지."
  assert.equal(destForText("LG 전자레인지 MW30BDN 신제품 공개"), "dgt");
  assert.equal(destForText("가을 전어 제철, 구이용 손질법"), "fresh");
  assert.equal(destForText("올해 캠핑 텐트 트렌드"), "camp");
  // 근거가 없으면 null — 아무거나 붙이지 않는다.
  assert.equal(destForText("국회 예산안 처리 무산"), null);
});

test("애드핏 빈 지면이 쿠팡 자리를 먹지 않는다", async () => {
  const { readFileSync } = await import("node:fs");
  const html = readFileSync("src/feed/public/index.html", "utf8");
  // 실기기 실측(2026-08-06): 심사 보류 애드핏이 iframe만 만들고 비워 둬서
  // 폴백이 안 걸렸고, 짧은 페이지에서는 쿠팡 광고가 통째로 사라졌다.
  assert.match(html, /const hasPaidCard = !!document\.querySelector\("#feed \.ad-card a\.ad-native"\)/,
    "쿠팡 카드 선행 확인이 없다");
  assert.match(html, /const useAdfit = unit && hasPaidCard &&/,
    "애드핏이 여전히 첫 자리를 가져갈 수 있다");
});
