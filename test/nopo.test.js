import test from "node:test";
import assert from "node:assert/strict";
import { classifyByPhone, isOldEstablishment, scoreNopo } from "../src/restaurants/nopo.js";

const tier = (p) => classifyByPhone(p).tier;

test("6-digit subscriber number = 찐노포 (ancient), region-independent", () => {
  assert.equal(tier("02-123-456"), "ancient"); // 서울 6자리
  assert.equal(tier("031-12-3456"), "ancient"); // 비수도권 6자리
  assert.equal(classifyByPhone("02-123-456").label, "노포");
});

test("Seoul 7-digit subscriber = 오래된 집 (old)", () => {
  assert.equal(tier("02-123-4567"), "old");
  assert.equal(classifyByPhone("02-123-4567").label, "오래된 집");
});

test("non-Seoul 7-digit is current standard, not flagged as old", () => {
  assert.equal(tier("031-123-4567"), "modern");
  assert.equal(isOldEstablishment(tier("031-123-4567")), false);
});

test("Seoul 8-digit = modern", () => {
  assert.equal(tier("02-1234-5678"), "modern");
});

test("mobile / 대표번호 / 인터넷전화 / 가상번호 are not old-establishment signals", () => {
  assert.equal(tier("010-1234-5678"), "mobile");
  assert.equal(tier("1588-1234"), "unknown");
  assert.equal(tier("070-1234-5678"), "unknown");
  assert.equal(tier("0507-1234-5678"), "unknown");
  assert.equal(tier(""), "unknown");
  assert.equal(tier(null), "unknown");
});

test("isOldEstablishment only true for ancient/old", () => {
  assert.equal(isOldEstablishment("ancient"), true);
  assert.equal(isOldEstablishment("old"), true);
  assert.equal(isOldEstablishment("modern"), false);
  assert.equal(isOldEstablishment("mobile"), false);
});

// ── multi-signal scoreNopo (nationwide) ──

test("6-digit phone alone marks 노포 (strong), any region", () => {
  const r = scoreNopo({ name: "안동 소고기국밥", address: "경북 안동시 서부동", phone: "054-12-3456" });
  assert.equal(r.tier, "strong");
  assert.ok(r.reasons.some((x) => x.includes("6자리")));
});

test("지방 노포 caught with no phone signal via name+market+menu", () => {
  // 비수도권 7자리(현대 표준) → 전화 신호 0. 그래도 상호·시장·업종으로 잡힘.
  const r = scoreNopo({ name: "부산 원조 밀면", category: "음식점 > 한식 > 냉면", address: "부산 중구 중앙시장", phone: "051-123-4567" });
  assert.ok(r.tier); // moderate 이상
  assert.ok(r.reasons.some((x) => x.includes("원조")));
  assert.ok(r.reasons.some((x) => x.includes("시장")));
});

test("official founding year dominates when present", () => {
  const r = scoreNopo({ name: "아무집", phone: "010-1234-5678", foundingYear: 1975 }, 2026);
  assert.equal(r.tier, "strong");
  assert.equal(r.ageYears, 51);
  assert.ok(r.reasons[0].includes("개업"));
});

test("modern chain is not flagged (no false positive)", () => {
  const r = scoreNopo({ name: "스타벅스 강남점", category: "음식점 > 카페", address: "서울 강남구 테헤란로", phone: "02-1234-5678" });
  assert.equal(r.tier, null);
});
