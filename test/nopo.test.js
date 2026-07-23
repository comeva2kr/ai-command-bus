import test from "node:test";
import assert from "node:assert/strict";
import { classifyByPhone, isOldEstablishment } from "../src/restaurants/nopo.js";

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
