// 피드·상세·브리핑의 제휴 지면과 이미지 위생 — 2026-08-03 David 실기기 제보 3건에서 나온 계약.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { isJunkImage } from "../src/feed/enrich.js";
import * as ADCOPY from "../src/feed/ad-copy.js";
const AD_COPY_KEYS = Object.keys(ADCOPY.AD_COPY);

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const HTML = fs.readFileSync(path.join(ROOT, "src/feed/public/index.html"), "utf8");
const SERVER = fs.readFileSync(path.join(ROOT, "src/feed/server.js"), "utf8");

test("배너 사진은 실으로되, 못 받는 사용자에게도 카드가 성립한다", () => {
  // 계약 변경 2026-08-03 오후. 오전에는 실기기에서 사진이 안 떠서 이미지를
  // 통째로 뺐는데, 같은 날 재실측 결과 아이폰 사파리 UA + Referer로도
  // 302 → 200 image/png 46KB가 정상으로 온다. 쿠팡이 막은 게 아니라 그 폰의
  // 콘텐츠 차단기가 ads-partners 도메인을 거른 것이었다.
  // 사진 있는 광고가 글자만 있는 광고보다 잘 눌리므로 사진을 기본으로 두고,
  // 차단당한 사용자에게만 onerror가 img를 지워 글자 카드가 남게 한다.
  const imgTags = [...HTML.matchAll(/<img[^>]*ad-img[^>]*>/g), ...SERVER.matchAll(/<img[^>]*ad-img[^>]*>/g)].map((m) => m[0]);
  assert.ok(imgTags.length >= 2, "피드·발행 페이지 양쪽에 배너 사진이 있어야 한다");
  for (const t of imgTags) {
    // 썸네일 상자째 지운다 — img만 지우면 76px 빈 테두리가 남는다
    // (카드가 콘텐츠 카드와 같은 모양이 된 2026-08-05부터).
    assert.match(t, /onerror="this\.parentNode\.remove\(\)"/, "못 받으면 깨진 자리를 남기지 말고 지워야 한다");
    assert.ok(!/alt=""/.test(t), "배너 alt가 비면 안 된다");
  }
  assert.match(HTML, /ad-native/, "네이티브 제휴 카드가 없다");
});

test("제휴 카드에는 대가성 문구가 항상 함께 나간다", () => {
  // 쿠팡 활동 준수 사항 — 빠지면 수익금 지급이 중단될 수 있다.
  const card = HTML.slice(HTML.indexOf("function coupangCardHtml"), HTML.indexOf("function coupangCardHtml") + 1600);
  assert.match(card, /ad-disclosure/);
  assert.match(card, /disclosure/);
  // 문구 원문은 ad-copy.js 단일 출처로 옮겼다 — server.js에는 더 이상 없다.
  const copy = fs.readFileSync(path.join(ROOT, "src/feed/ad-copy.js"), "utf8");
  assert.match(copy, /이 포스팅은 쿠팡 파트너스 활동의 일환으로/);
  assert.match(SERVER, /class="ad-disclosure">\$\{COUPANG_DISCLOSURE\}/);
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
  assert.match(HTML, /\$\{detailAdHtml\(item\.category, item\.dealDest \|\| item\.adDest\)\}/);
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

test("자체 제작 문구에 쿠팡 하위 상표를 쓰지 않는다", () => {
  // 쿠팡 파트너스 이용가이드는 로켓·로켓배송·로켓프레시 등을 제한 상표로 두고,
  // 파트너스가 제공한 배너·위젯 **외에서** 상표를 자체 문구에 넣는 것을 탈퇴
  // 처리 대상으로 명시한다. 배너 이미지를 우리가 직접 그리기로 한 이상 그
  // 예외의 보호를 못 받는다. "쿠팡"은 판매처 식별에 불가피하므로 남긴다.
  const copy = fs.readFileSync(path.join(ROOT, "src/feed/ad-copy.js"), "utf8");
  const table = copy.slice(copy.indexOf("export const AD_COPY"), copy.indexOf("export function adCopy"));
  assert.ok(!/로켓/.test(table), "카피에 로켓* 상표가 남아 있다");
});

test("카피는 한 곳에서만 정의된다", () => {
  // 예전엔 server.js와 index.html에 같은 표가 복붙돼 있었고 폴백 값마저 달랐다.
  assert.ok(!HTML.includes("const COUPANG_COPY"), "클라이언트에 카피 사본이 남아 있다");
  assert.match(SERVER, /from "\.\/ad-copy\.js"/, "서버가 단일 출처를 쓰지 않는다");
});

test("피드 광고는 바로 앞 카드의 카테고리를 따라간다", () => {
  // dataset.category는 어디서도 세팅되지 않는 이름이라 항상 undefined였고,
  // 그 결과 피드 광고 100%가 문맥 무관 라운드로빈이었다(2026-08-03 검수).
  assert.match(HTML, /pickCoupangLink\(anchor\.dataset\.cat/);
  // 주석에 옛 이름을 설명으로 적어둔 건 괜찮다 — **코드**만 본다.
  const code = HTML.replace(/\/\/[^\n]*/g, "");
  assert.ok(!/dataset\.category/.test(code), "존재하지 않는 dataset 키를 다시 쓰고 있다");
});

test("AD 배지가 유기 배지와 구별된다", () => {
  // .badge의 !important가 배경·글자색을 덮어써서 "커뮤"/"뉴스" 배지와
  // 픽셀 단위로 같게 렌더됐다 — 광고 표시가 표시로서 기능하지 못했다.
  const rule = HTML.slice(HTML.indexOf(".card-top .badge.ad-badge-static{"), HTML.indexOf(".card-top .badge.ad-badge-static{") + 300);
  assert.match(rule, /background:var\(--color-text\)!important/);
  assert.match(rule, /color:var\(--color-bg\)!important/);
});

test("설문 제출 바가 콘텐츠를 가리거나 비치지 않는다", () => {
  // 버튼만 sticky로 띄웠더니 disabled의 opacity가 버튼에 걸려 뒤 칩이 비쳤고,
  // bottom:0이라 사파리 하단 툴바에 가려졌다(David 실기기 2026-08-03).
  assert.match(HTML, /\.start-bar \{[^}]*background: var\(--bg\)/);
  assert.match(HTML, /\.start-bar \{[^}]*env\(safe-area-inset-bottom\)/);
  assert.ok(!/\.start:disabled \{ opacity/.test(HTML), "disabled 투명도로 뒤가 비친다");
});

test("취향 재설정에서는 나갈 수 있다", () => {
  assert.match(HTML, /id="surveyBack"/);
});

test("모든 배너에 도착지(dest)와 그에 맞는 문구가 있다", () => {
  // 2026-08-03 David 실기기: "가전·디지털"이라 써놓고 로켓직구로, "완구·취미"라
  // 써놓고 여성패션으로 보냈다. 문구를 배너가 아니라 카테고리 묶음에서 뽑아서,
  // 같은 묶음에 든 다른 배너의 설명이 붙은 것이다. 문구≠도착지는 허위표시다.
  const data = JSON.parse(fs.readFileSync(path.join(ROOT, "src/feed/products.json"), "utf8"));
  const copy = AD_COPY_KEYS;
  for (const b of data.banners || []) {
    assert.ok(b.dest, `배너에 dest가 없다: ${b.label}`);
    assert.ok(copy.includes(b.dest), `dest에 대응하는 문구가 없다: ${b.dest} (${b.label})`);
  }
});

test("문구의 도착지 표기가 배너 라벨과 일치한다", () => {
  // 라벨은 David가 쿠팡 콘솔에서 그대로 가져온 이름이라 도착지의 진실이다.
  // 문구의 브랜드 줄이 그 이름의 핵심어를 담고 있어야 거짓말이 아니다.
  const { AD_COPY } = ADCOPY;
  const data = JSON.parse(fs.readFileSync(path.join(ROOT, "src/feed/products.json"), "utf8"));
  for (const b of data.banners || []) {
    const brand = AD_COPY[b.dest][1];
    // 라벨에서 상표(로켓*)와 수식어를 뺀 핵심 명사가 브랜드 줄에 있어야 한다
    const core = String(b.label).replace(/쿠팡\s*/g, "").replace(/로켓\S*\s*/g, "").replace(/\s*특가$/, "").trim();
    const head = core.split(/[·\s]/)[0];
    assert.ok(brand.includes(head),
      `문구가 도착지를 잘못 말한다: 라벨 "${b.label}" → 문구 "${brand}"`);
  }
});

test("카테고리로는 문구를 뽑지 않는다", () => {
  // 회귀 방지. adCopy에 카테고리를 넘기면 다른 배너 설명이 아니라 폴백이 나와야 한다.
  const { adCopy } = ADCOPY;
  for (const cat of ["tech", "life", "humor", "gaming", "sports", "auto", "business", "culture", "news"]) {
    assert.deepEqual(adCopy(cat), ["쿠팡에서 볼 것 있으면", "쿠팡"], `${cat}가 도착지 키처럼 동작한다`);
  }
});
