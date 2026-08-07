import test from "node:test";
import assert from "node:assert/strict";
import { unsafeForLead, maskProfanity } from "../src/feed/profanity.js";

// 2026-08-07 애드센스 정책 감사 실측:
//   /briefing 패션 섹션 대표 헤드라인이
//   "스페인 누나 피팅룸 룩북 노브라 가슴"으로 나갔다(재확인까지 완료).
//   광고 슬롯 사이 자리다.
//
// maskProfanity는 통과한다 — PROFANITY에 성적 함의 낱말이 없고, 그건 의도된
// 설계다(일상어 오탐 방지). 문제는 다른 데 있었다:
//
//   **커뮤니티 원글을 보여주는 것과, 우리가 "가장 뜨거운 글은 X입니다"라고
//   직접 쓰는 것은 성격이 다르다.** 뒤엣것은 우리 문장이고 우리가 고른다.
//
// 그래서 마스킹이 아니라 **대표 후보 배제**로 푼다. 글은 지우지 않는다 —
// 피드에는 그대로 남는다(성인 콘텐츠는 삭제가 아니라 게이트로 다룬다는 원칙).

test("성적 표현이 든 제목은 대표 후보에서 배제된다", () => {
  assert.equal(unsafeForLead("스페인 누나 피팅룸 룩북 노브라 가슴"), true);
  assert.equal(unsafeForLead("비키니 화보 공개"), true);
  assert.equal(unsafeForLead("속옷 브랜드 신상"), true);
});

test("평범한 글은 그대로 대표가 된다 — 오탐이 곧 조용한 검열이다", () => {
  assert.equal(unsafeForLead("삼성전자 주가 3% 상승"), false);
  assert.equal(unsafeForLead("서울 아파트값 3주 연속 상승"), false);
  assert.equal(unsafeForLead("파리 패션위크 런웨이"), false);
  assert.equal(unsafeForLead(""), false);
  assert.equal(unsafeForLead(null), false);
});

test("마스킹과 배제는 다른 일이다 — maskProfanity는 그대로 둔다", () => {
  // 마스킹은 문장 안 낱말을 가리는 것이고, 배제는 문장의 주어를 고르는 것이다.
  // 목적이 다르므로 목록도 따로 둔다(성적 함의어를 PROFANITY에 넣으면
  // 피드 카드의 일상어까지 ●로 가려진다).
  assert.equal(maskProfanity("가슴이 뭉클한 이야기").includes("●"), false,
    "일상어가 마스킹되면 안 된다");
});

test("대표 선정이 다음 순위로 넘어간다", async () => {
  const fs = await import("node:fs");
  const src = fs.readFileSync("src/feed/server.js", "utf8");
  assert.match(src, /const pickLead = \(arr\) =>/, "pickLead 헬퍼가 없다");
  assert.match(src, /const lead = pickLead\(sec\.items\)/, "브리핑 섹션이 pickLead를 안 쓴다");
  assert.match(src, /const lead = pickLead\(catItems\)/, "카테고리 브리핑이 pickLead를 안 쓴다");
  // 전부 걸리면 예전처럼 1위를 쓴다 — 악화시키지 않는다
  assert.match(src, /\|\| \(arr \|\| \[\]\)\[0\]/, "전부 걸릴 때 폴백이 없다");
});
