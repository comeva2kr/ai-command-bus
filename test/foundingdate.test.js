import test from "node:test";
import assert from "node:assert/strict";
import { foundingYearFromApv } from "../src/restaurants/connectors/localdata.js";
import { matchFoundingYear } from "../src/restaurants/foundingdate.js";
import { scoreNopo } from "../src/restaurants/nopo.js";

test("apvPermYmd -> founding year", () => {
  assert.equal(foundingYearFromApv("19750301"), 1975);
  assert.equal(foundingYearFromApv("2005-11-02"), 2005);
  assert.equal(foundingYearFromApv(""), null);
  assert.equal(foundingYearFromApv(null), null);
  assert.equal(foundingYearFromApv("18"), null);
});

// license rows as returned (normalized) by the localdata connector
const rows = [
  { name: "을지면옥", roadAddress: "서울특별시 중구 충무로 11-1", state: "영업/정상", foundingYear: 1985 },
  { name: "스타벅스 시청점", roadAddress: "서울특별시 중구 세종대로 100", state: "영업/정상", foundingYear: 2012 },
  { name: "옛날국밥", roadAddress: "부산광역시 중구 중앙대로 2", state: "폐업", foundingYear: 1970 }
];

test("match by road address + name returns exact founding year", () => {
  const r = matchFoundingYear({ name: "을지면옥", roadAddress: "서울 중구 충무로 11-1" }, rows);
  assert.equal(r.foundingYear, 1985);
  assert.equal(r.matched, "address+name");
});

test("closed (폐업) records are skipped", () => {
  const r = matchFoundingYear({ name: "옛날국밥", roadAddress: "부산 중구 중앙대로 2" }, rows);
  assert.equal(r.foundingYear, null);
});

test("no match returns null (no false founding date)", () => {
  const r = matchFoundingYear({ name: "없는집", roadAddress: "제주 어딘가" }, rows);
  assert.equal(r.foundingYear, null);
});

test("founding year feeds scoreNopo → exact-age verdict dominates", () => {
  const { foundingYear } = matchFoundingYear({ name: "을지면옥", roadAddress: "서울 중구 충무로 11-1" }, rows);
  const s = scoreNopo({ name: "을지면옥", foundingYear }, 2026);
  assert.equal(s.tier, "strong");
  assert.equal(s.ageYears, 41);
  assert.ok(s.reasons[0].includes("개업"));
});
