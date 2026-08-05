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
