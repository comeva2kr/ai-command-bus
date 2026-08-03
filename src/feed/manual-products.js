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

// size로 고르고, 같은 사이즈 안에서 카테고리 문맥 → 나머지 순으로 회전한다.
export function pickBanner({ category = null, size = "320x100", seen = new Set(), pick = 0, file } = {}) {
  const all = loadBanners(file ? { file } : {}).filter((b) => b.size === size);
  if (!all.length) return null;
  const inCat = category ? all.filter((b) => b.category === category) : [];
  const tiers = inCat.length ? [inCat, all.filter((b) => b.category !== category)] : [all];
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
      size: typeof b.size === "string" ? b.size : "320x100",
      href: b.href.trim(),
      img: b.img.trim(),
      // 쿠팡 배너 원본은 alt=""다. 네이버 가이드가 alt로 내용을 설명하라고
      // 요구하므로 label로 채운다 — 비면 최소한 광고임은 밝힌다.
      label: (typeof b.label === "string" && b.label.trim()) || "쿠팡 파트너스 광고"
    }));

  cacheMtime = stat.mtimeMs;
  return cache;
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
