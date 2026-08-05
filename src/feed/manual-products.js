// 수동 등록 쿠팡 상품 — Open API 없이 제휴 수익을 내는 경로.
//
// ── 왜 필요한가 (2026-08-03)
// 쿠팡 파트너스 Open API 키는 "최종 승인" 회원만 발급된다. 조건은 판매금액
// 15만원 + 사업자 인증이다. 즉 **API는 매출이 먼저 나야 열린다.**
// 그런데 수익 자체는 '링크 생성'만으로 난다 — API는 상품을 자동으로 고르는
// 도구일 뿐이다. 그래서 그 자리를 이 모듈이 대신한다.
//
// 키가 나오면 engine이 API를 우선하고 이 목록은 폴백으로 남는다. 코드 경로가
// 하나(pickAffiliateCandidates)로 유지되므로 전환 시 바꿀 것이 없다.
//
// ── 선택 방식: 랜덤이 아니라 "문맥 우선 + 회전"
// David 요청은 "랜덤으로 골라 써"였지만, 순수 랜덤은 세제개편안 기사 옆에
// 제습기를 붙인다. 실측상 우리 피드는 경제 32% + 뉴스 20%로 절반이 상품 매칭이
// 안 되는 영역이라, 랜덤이면 대부분의 노출이 버려진다.
// 그래서 **같은 카테고리 상품을 먼저 고르고**, 없을 때만 전체에서 고른다.
// 어느 쪽이든 노출 이력을 피해 회전시키므로 같은 상품이 반복되지 않는다.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const FILE = path.join(path.dirname(fileURLToPath(import.meta.url)), "products.json");

// 광고를 붙이지 않는 카테고리 — monetize.js의 BANNED_AD_CATEGORIES와 같은 원칙.
// 여기서도 한 번 막는다(입력이 사람 손으로 들어오는 파일이라 방어선을 둔다).
const BANNED = new Set(["politics", "religion", "adult"]);

let cache = null;
let bannerCache = null;
let cacheMtime = 0;

// 배너 — 카테고리 단위 광고. 어떤 상품을 보여줄지는 쿠팡이 정하므로 품절·시즌·
// 가격 변동을 우리가 관리하지 않아도 된다. 개별 상품 링크는 품절되면 죽은 링크가
// 되지만 배너는 그렇지 않다.
export function loadBanners({ file = FILE } = {}) {
  loadProducts({ file }); // 같은 파일이라 캐시 갱신을 공유한다
  return bannerCache || [];
}

// size로 고르고, 같은 사이즈 안에서 **이벤트 우선 → 카테고리 문맥 → 나머지**
// 순으로 회전한다.
//
// 이벤트/프로모션 배너는 "여름 액세서리", "썸머펫 페스티벌"처럼 구체적이고
// 시의성이 있어 카테고리 배너보다 클릭 유인이 크다. 다만 **기간 한정**이라
// 만료되면 죽은 링크가 된다 — 눌렀는데 페이지가 없으면 수익은 0이고 불쾌감만
// 남는다. 그래서 expires가 지난 것은 자동으로 빠지고 카테고리 배너로 폴백한다.
// 관리 부담 없이 시의성만 취하는 구조다.
export function pickBanner({ category = null, dest = null, size = null, seen = new Set(), pick = 0, now = Date.now(), file } = {}) {
  const all = loadBanners(file ? { file } : {})
    // size 인자는 받되 **거르지 않는다.** 크리에이티브를 우리가 그리므로 배너의
    // 픽셀 크기는 의미가 없고, 2026-08-05부터 재고가 200x200 한 종류다.
    // 거르면 옛 크기를 넘기는 호출부에서 재고가 통째로 0이 되어 광고가 사라진다
    // (실제로 그렇게 깨졌다 — 320x100을 다 걷어낸 직후).
    // 인자를 지우지 않는 것은 호출부 시그니처를 건드리지 않기 위해서다.
    .filter((b) => !b.expires || b.expires >= now)
    ;
  if (!all.length) return null;
  // 이벤트가 있으면 먼저 쓴다 — 같은 자리라도 "여름 시즌오프"가 "로켓패션"보다
  // 눌릴 이유가 분명하다. 문맥까지 맞으면 최우선.
  const ev = all.filter((b) => b.expires);
  const evCat = category ? ev.filter((b) => b.category === category) : [];
  const inCat = category ? all.filter((b) => !b.expires && b.category === category) : [];
  const rest = all.filter((b) => !b.expires && b.category !== category);

  // ── 정사각을 분야보다 먼저 본다 (2026-08-05)
  //
  // 광고 카드가 콘텐츠 카드와 같은 모양이 되려면 썸네일이 정사각이어야 한다.
  // 가로 배너(3.2:1)가 76px 정사각 자리에 들어가면 가운데만 남고 글자가 잘린다 —
  // 그러면 "광고만 혼자 다른 모양"이 다시 살아난다.
  //
  // 실측: David가 준 정사각 18종에 경제(business)에 맞는 것이 없어서, 경제 글
  // 옆에만 가로 배너가 나갔다. 분야를 먼저 맞추면 그 한 칸이 계속 어긋난다.
  //
  // 그래서 **정사각 안에서 분야를 맞추고**, 정사각이 아예 없을 때만 가로로
  // 내려간다. 분야 정확도를 조금 내주고 모양 일관성을 얻는다 — 어차피
  // 범용(쇼핑·골드박스)은 어느 글 옆에 놓아도 거짓말이 아니다.
  const sq = (list) => list.filter((b) => b.size === "200x200");
  const wide = (list) => list.filter((b) => b.size !== "200x200");
  // 도착지를 콕 집어 달라고 하면 그것부터 본다 — 딜 글이나 상품군이 읽히는
  // 글 옆에서 쓴다(deals.js destForText). 재고에 없으면 아래 순서로 내려간다.
  const byDest = dest ? all.filter((b) => b.dest === dest) : [];
  const tiers = [
    sq(byDest), wide(byDest),
    sq(evCat), sq(inCat), sq(ev), sq(rest),
    wide(evCat), wide(inCat), wide(ev), wide(rest)
  ].filter((t) => t.length);
  for (const tier of tiers) {
    for (const group of [tier.filter((b) => !seen.has(b.id)), tier.filter((b) => seen.has(b.id))]) {
      if (group.length) return group[pick % group.length];
    }
  }
  return null;
}

// 파일이 바뀌면 자동으로 다시 읽는다 — 상품을 추가할 때 서버를 안 내려도 된다.
export function loadProducts({ file = FILE } = {}) {
  let stat;
  try { stat = fs.statSync(file); } catch { return []; }
  if (cache && stat.mtimeMs === cacheMtime) return cache;

  let parsed;
  try { parsed = JSON.parse(fs.readFileSync(file, "utf8")); } catch { return cache || []; }
  const list = Array.isArray(parsed) ? parsed : (parsed.products || []);

  cache = list
    .filter((p) => p && typeof p.url === "string" && typeof p.title === "string")
    // 링크는 반드시 파트너스 링크여야 한다. 일반 쿠팡 상품 URL을 넣으면 수수료가
    // 붙지 않아 "광고를 띄우고 돈은 못 버는" 최악이 된다 — 조용히 넘어가지 않게 거른다.
    .filter((p) => /^https:\/\/link\.coupang\.com\//.test(p.url.trim()))
    .filter((p) => !BANNED.has(p.category))
    .map((p, i) => ({
      id: `cp_${i}_${hash(p.url)}`,
      title: String(p.title).trim(),
      url: p.url.trim(),
      category: typeof p.category === "string" && p.category ? p.category : "life",
      image: typeof p.image === "string" && /^https?:\/\//.test(p.image) ? p.image : null,
      hook: typeof p.hook === "string" ? p.hook.trim() : ""
    }));
  // 배너도 같은 파일에서 읽는다. img/href 둘 다 쿠팡 도메인이어야 한다 —
  // 임의 URL이 들어오면 우리 페이지에서 남의 스크립트를 띄우는 셈이 된다.
  bannerCache = (parsed.banners || [])
    .filter((b) => b && typeof b.href === "string" && typeof b.img === "string")
    .filter((b) => /^https:\/\/link\.coupang\.com\//.test(b.href.trim()))
    .filter((b) => /^https:\/\/ads-partners\.coupang\.com\//.test(b.img.trim()))
    .filter((b) => !BANNED.has(b.category))
    .map((b) => ({
      id: `cb_${hash(b.href)}`,
      category: typeof b.category === "string" && b.category ? b.category : "life",
      // dest = 이 배너가 실제로 여는 곳. 문구는 반드시 여기서 뽑는다 —
      // 카테고리로 뽑으면 같은 묶음의 다른 배너 설명이 붙는다(2026-08-03).
      dest: typeof b.dest === "string" ? b.dest : null,
      size: typeof b.size === "string" ? b.size : "320x100",
      href: b.href.trim(),
      img: b.img.trim(),
      // 쿠팡 배너 원본은 alt=""다. 네이버 가이드가 alt로 내용을 설명하라고
      // 요구하므로 label로 채운다 — 비면 최소한 광고임은 밝힌다.
      label: (typeof b.label === "string" && b.label.trim()) || "쿠팡 파트너스 광고",
      // "2026-08-09" 같은 종료일. 그 날 하루는 살아 있어야 하므로 23:59:59로 본다.
      // 값이 없으면 상시 배너(만료 없음).
      expires: parseExpiry(b.expires)
    }));

  cacheMtime = stat.mtimeMs;
  return cache;
}

// 종료일 파싱. 형식이 이상하면 null(= 상시)로 두지 않고 **0으로 만들어 제외**한다 —
// 만료 관리가 목적인데 오타 하나로 죽은 배너가 영원히 남으면 의미가 없다.
function parseExpiry(v) {
  if (v == null || v === "") return null;
  const t = Date.parse(`${String(v).trim()}T23:59:59+09:00`);
  return Number.isFinite(t) ? t : 0;
}

function hash(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = ((h << 5) - h + s.charCodeAt(i)) | 0;
  return Math.abs(h).toString(36);
}

// 문맥 우선 선택. seen에 있는 것은 뒤로 미룬다(회전).
//
// category: 이 광고가 끼어들 자리의 카테고리. 없으면 전체에서 고른다.
// seen: 이미 이 사용자에게 보여준 상품 id 집합.
// pick: 결정적으로 고르기 위한 정수(같은 입력 → 같은 결과, 테스트 가능).
export function pickManualProducts({ category = null, seen = new Set(), limit = 1, pick = 0, file } = {}) {
  const all = loadProducts(file ? { file } : {});
  if (!all.length) return [];

  const inCat = category ? all.filter((p) => p.category === category) : [];
  // 문맥이 맞는 것 → 나머지 순으로 본다. 문맥이 없으면 전체가 후보다.
  const tiers = inCat.length ? [inCat, all.filter((p) => p.category !== category)] : [all];

  const out = [];
  for (const tier of tiers) {
    // 안 본 것부터, 그 다음 본 것 — 두 그룹 각각 pick으로 회전시킨다
    for (const group of [tier.filter((p) => !seen.has(p.id)), tier.filter((p) => seen.has(p.id))]) {
      if (!group.length) continue;
      for (let k = 0; k < group.length && out.length < limit; k++) {
        const cand = group[(pick + k) % group.length];
        if (!out.some((o) => o.id === cand.id)) out.push(cand);
      }
      if (out.length >= limit) return out;
    }
  }
  return out;
}
