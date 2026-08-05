import test from "node:test";
import assert from "node:assert/strict";
import { parseDriving, parseReverseGeocode } from "../src/restaurants/connectors/ncp.js";

// Response shapes per NCP Maps docs (fixtures for the pure parsers).
test("parseDriving: duration(ms) -> minutes, distance(m) -> km", () => {
  const json = { route: { trafast: [{ summary: { duration: 1_512_000, distance: 8300 } }] } };
  const r = parseDriving(json);
  assert.equal(r.durationMin, 25); // 1,512,000ms ≈ 25.2min → 25
  assert.equal(r.distanceKm, 8.3);
});

test("parseDriving: missing route -> null (no fabricated time)", () => {
  assert.equal(parseDriving({}), null);
  assert.equal(parseDriving({ route: {} }), null);
});

test("parseReverseGeocode: coords response -> 시/도·시군구·동", () => {
  const json = { results: [{ region: { area1: { name: "서울특별시" }, area2: { name: "중구" }, area3: { name: "충무로1가" } }, code: { id: "1114010300" } }] };
  const r = parseReverseGeocode(json);
  assert.equal(r.sido, "서울특별시");
  assert.equal(r.sigungu, "중구");
  assert.equal(r.legalCode, "1114010300");
});
