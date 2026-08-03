// 피드·상세·브리핑의 제휴 지면과 이미지 위생 — 2026-08-03 David 실기기 제보 3건에서 나온 계약.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { isJunkImage } from "../src/feed/enrich.js";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const HTML = fs.readFileSync(path.join(ROOT, "src/feed/public/index.html"), "utf8");
const SERVER = fs.readFileSync(path.join(ROOT, "src/feed/server.js"), "utf8");

test("제휴 크리에이티브는 남의 도메인 이미지에 의존하지 않는다", () => {
  // ads-partners.coupang.com 이미지는 모바일 사파리 추적 차단에 걸려 실기기에서
  // 안 떴다. 링크(수수료의 근거)만 쓰고 크리에이티브는 우리가 그린다.
  // 주석에 도메인 이름이 나오는 건 설명이므로, **실제 마크업**만 본다.
  const imgTags = [...HTML.matchAll(/<img[^>]*>/g), ...SERVER.matchAll(/<img[^>]*>/g)].map((m) => m[0]);
  assert.ok(!imgTags.some((t) => /ads-partners|b\.img|cp\.img/.test(t)),
    "쿠팡 배너 이미지를 <img>로 여전히 렌더한다");
  assert.match(HTML, /ad-native/, "네이티브 제휴 카드가 없다");
});

test("제휴 카드에는 대가성 문구가 항상 함께 나간다", () => {
  // 쿠팡 활동 준수 사항 — 빠지면 수익금 지급이 중단될 수 있다.
  const card = HTML.slice(HTML.indexOf("function coupangCardHtml"), HTML.indexOf("function coupangCardHtml") + 900);
  assert.match(card, /ad-disclosure/);
  assert.match(card, /disclosure/);
  assert.match(SERVER, /이 포스팅은 쿠팡 파트너스 활동의 일환으로/);
});

test("제휴 링크는 nofollow sponsored로 나간다", () => {
  assert.match(HTML, /rel="nofollow sponsored noopener"/);
});

test("피드 광고는 첫 화면을 비우고 이후 주기적으로 들어간다", () => {
  // 하단에 한 번만 넣으면 아무도 못 본다(David). 첫 화면은 콘텐츠로만.
  const first = Number(HTML.match(/const AD_FIRST = (\d+)/)[1]);
  const every = Number(HTML.match(/const AD_EVERY = (\d+)/)[1]);
  assert.ok(first >= 4, "첫 광고가 너무 앞에 있다");
  assert.ok(every >= 6 && every <= 12, "광고 간격이 상식 범위를 벗어난다");
});

test("상세 화면에도 제휴 지면이 있다", () => {
  assert.match(HTML, /\$\{detailAdHtml\(item\.category\)\}/);
});

test("자체 콘텐츠 링크는 한 자리에만 있다", () => {
  // 브리핑 스트립과 별도 칩줄이 같은 곳을 가리켜 상단이 어정쩡했다(David).
  assert.ok(!HTML.includes("own-nav"), "중복 네비게이션이 남아 있다");
  assert.match(SERVER, /bs-seed/, "크롤러용 정적 링크가 없다");
});

test("그만보기 버튼은 상세 화면 헤더에만 붙는다", () => {
  // querySelector(".detail-head")가 문서 첫 번째, 즉 내 공간 헤더를 잡아
  // 내 공간에 "○○ 그만보기"가 뜬금없이 남아 있었다.
  assert.match(HTML, /querySelector\("#detail \.detail-head"\)/);
});

test("취향은 나중에 다시 설정할 수 있다", () => {
  assert.match(HTML, /id="retakeSurvey"/);
});

test("깨진 이미지는 빗금 박스가 아니라 영역째 사라진다", () => {
  assert.match(HTML, /\.card-thumb\.noimg\{display:none\}/);
});

test("사이트 장식물은 대표 이미지로 채택하지 않는다", () => {
  // 라이브 실측에서 실제로 깨진 URL들.
  for (const u of [
    "https://www.82cook.com//banner/data/20130725_kit.gif",
    "http://thimg.todayhumor.co.kr/test.png",
    "https://img.youtube.com/vi/player/cliplink/rvodkydbz8aot52gj30oawn9p/mqdefault.jpg"
  ]) assert.equal(isJunkImage(new URL(u)), true, u);
});

test("정상 사진은 계속 통과한다", () => {
  for (const u of [
    "https://img.youtube.com/vi/yUndH3Y_GVk/hqdefault.jpg",
    "https://cdn2.ppomppu.co.kr/zboard/data3/2026/0803/photo.jpg",
    "https://img.hankyung.com/photo/202608/contest.jpg",   // 파일명에 test가 들어가지만 정상
    "https://edgio.clien.net/service/board/park/x.webp"
  ]) assert.equal(isJunkImage(new URL(u)), false, u);
});
