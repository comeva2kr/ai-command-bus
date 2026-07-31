// 쿠팡파트너스 Open API 실연동 (David 2026-07-31 "파트너스 열어놨어").
//
// monetize.js의 `opts.productFeed` 계약을 실제로 채우는 구현이다. 그 계약의
// acceptance criteria(monetize.js pickAffiliateCandidates 헤더 주석)를 그대로
// 지킨다:
//   - title/url은 정확한 상품 상세 URL (카테고리/검색 페이지 금지)
//   - 가격은 쿠팡이 방금 돌려준 실측값만 (지어낸 정가 금지)
//   - 재고 없는 카테고리는 그 슬롯을 비운다 (다른 카테고리로 채우고 원래
//     카테고리를 주장하는 것 금지)
//
// ── 동기/비동기 경계 ─────────────────────────────────────────────────────────
// monetize.js의 productFeed 호출은 **동기**다(요청 경로 한가운데라 네트워크를
// 기다릴 수 없다). 그래서 이 모듈은 두 부분으로 나뉜다:
//   1. refreshCoupangCache(): 백그라운드에서 카테고리별 베스트 상품을 받아
//      메모리 캐시에 채운다 (server.js가 시작 시 1회 + 1시간마다 재실행).
//   2. makeCoupangProductFeed(): 캐시만 읽는 동기 함수를 돌려준다.
//      캐시가 비어 있으면(기동 직후·API 장애) 빈 배열 — 광고가 안 나갈 뿐
//      절대 지어내지 않는다.
//
// ── 인증 ────────────────────────────────────────────────────────────────────
// 쿠팡 Open API는 HMAC-SHA256 서명(CEA 스킴)을 요구한다. 서명 대상 문자열은
// `signedDate + method + path + query`, 날짜 형식은 UTC "yyMMdd'T'HHmmss'Z'".
// node:crypto만 사용(무의존성 원칙).

import crypto from "node:crypto";
import { makeSlotItem, buildHookCopy } from "./monetize.js";
import { topPreferences } from "./recommender.js";
import { categoryLabel } from "./taxonomy.js";

const API_HOST = "https://api-gateway.coupang.com";
const BEST_PATH = "/v2/providers/affiliate_open_api/apis/openapi/v1/products/bestcategories";

// 우리 카테고리 -> 쿠팡 베스트카테고리 ID (쿠팡 Open API 문서의 고정 ID).
// 대응이 어색한 카테고리는 **넣지 않는다** — 없는 카테고리는 슬롯이 비는 게
// 원칙이지, 엉뚱한 상품으로 채우는 게 아니다. politics/religion/adult는
// monetize.js가 어차피 하드 차단하지만 여기서도 아예 매핑하지 않는다.
export const COUPANG_CATEGORY_MAP = {
  tech: 1016,     // 가전디지털
  auto: 1018,     // 자동차용품
  life: 1014,     // 생활용품
  culture: 1019,  // 도서/음반/DVD
  sports: 1017,   // 스포츠/레저
  gaming: 1020,   // 완구/취미
  business: 1021, // 문구/오피스 (경제 취향엔 사무/생산성 상품이 그나마 근접)
  science: 1019   // 도서(과학 서적 계열) — 어색하면 차후 제외 검토
};

// UTC "yyMMdd'T'HHmmss'Z'" — 쿠팡 서명 스펙의 날짜 형식.
export function coupangSignedDate(nowMs = Date.now()) {
  const d = new Date(nowMs);
  const p = (n) => String(n).padStart(2, "0");
  return (
    String(d.getUTCFullYear()).slice(2) + p(d.getUTCMonth() + 1) + p(d.getUTCDate()) +
    "T" + p(d.getUTCHours()) + p(d.getUTCMinutes()) + p(d.getUTCSeconds()) + "Z"
  );
}

// CEA 서명 헤더 생성. path와 query는 분리해서 받는다(서명 대상이 정확히
// `signedDate+method+path+query`라 실수로 '?'가 섞이면 서명이 어긋난다).
export function coupangAuthHeader({ method, path, query = "", accessKey, secretKey, nowMs }) {
  const signedDate = coupangSignedDate(nowMs);
  const message = signedDate + method + path + query;
  const signature = crypto.createHmac("sha256", secretKey).update(message).digest("hex");
  return {
    authorization: `CEA algorithm=HmacSHA256, access-key=${accessKey}, signed-date=${signedDate}, signature=${signature}`,
    signedDate
  };
}

// 카테고리 하나의 베스트 상품을 받아 슬롯 후보 원료로 정규화한다.
// 실패(비 2xx·타임아웃·형식 불일치)는 빈 배열 — 상위가 캐시의 이전 값을 유지한다.
export async function fetchBestProducts({ accessKey, secretKey, categoryId, limit = 20, subId = null, fetchImpl = fetch }) {
  const path = `${BEST_PATH}/${categoryId}`;
  const params = new URLSearchParams({ limit: String(limit) });
  if (subId) params.set("subId", subId);
  const query = params.toString();
  const { authorization } = coupangAuthHeader({ method: "GET", path, query, accessKey, secretKey });
  try {
    const res = await fetchImpl(`${API_HOST}${path}?${query}`, {
      headers: { Authorization: authorization },
      signal: AbortSignal.timeout(10000)
    });
    if (!res.ok) return { ok: false, status: res.status, products: [] };
    const body = await res.json();
    const rows = Array.isArray(body && body.data) ? body.data : [];
    return {
      ok: true,
      status: res.status,
      products: rows
        .filter((r) => r && r.productName && r.productUrl)
        .map((r) => ({
          // 쿠팡이 준 값 그대로 — 가공은 표시 계층에서만.
          productId: r.productId ?? null,
          name: String(r.productName),
          price: Number.isFinite(r.productPrice) ? r.productPrice : null,
          image: r.productImage || null,
          url: r.productUrl, // 파트너스 추적 파라미터가 포함된 상세 URL
          isRocket: r.isRocket === true,
          rank: Number.isFinite(r.rank) ? r.rank : null
        }))
    };
  } catch {
    return { ok: false, status: 0, products: [] };
  }
}

// ---------------------------------------------------------------------------
// 캐시 + productFeed
// ---------------------------------------------------------------------------

const CACHE_TTL_MS = Number(process.env.COUPANG_CACHE_TTL_MS || 60 * 60 * 1000);
const _cache = new Map(); // ourCategory -> { at, products: [...] }

export function coupangCreds(env = process.env) {
  const accessKey = env.COUPANG_ACCESS_KEY || null;
  const secretKey = env.COUPANG_SECRET_KEY || null;
  const partnerId = env.COUPANG_PARTNER_ID || null;
  return accessKey && secretKey && partnerId ? { accessKey, secretKey, partnerId } : null;
}

// 전 카테고리 캐시 갱신. server.js가 시작 시 + 주기적으로 부른다.
// 반환값은 관측용 요약(어느 카테고리가 몇 건인지) — 로그로 남겨 실패를 조기 발견.
export async function refreshCoupangCache(env = process.env, fetchImpl = fetch) {
  const creds = coupangCreds(env);
  if (!creds) return { enabled: false };
  const out = {};
  for (const [ours, categoryId] of Object.entries(COUPANG_CATEGORY_MAP)) {
    const fresh = _cache.get(ours);
    if (fresh && Date.now() - fresh.at < CACHE_TTL_MS) { out[ours] = fresh.products.length; continue; }
    const { ok, products } = await fetchBestProducts({
      ...creds, categoryId, limit: 20, subId: env.COUPANG_SUB_ID || "nowhot", fetchImpl
    });
    // 실패 시 이전 캐시 유지(있다면) — 일시 장애로 광고가 요동치지 않게.
    if (ok) _cache.set(ours, { at: Date.now(), products });
    out[ours] = (_cache.get(ours) || { products: [] }).products.length;
  }
  return { enabled: true, counts: out };
}

export function clearCoupangCache() { _cache.clear(); } // 테스트용

// monetize.js 계약을 채우는 동기 productFeed를 만든다.
// sampleAffiliateCandidates와 같은 골격(관심 상위 3 카테고리, seed 로테이션,
// excludeIds 회피, relevance = weight/6)을 따르되 재고는 실상품 캐시다.
export function makeCoupangProductFeed(env = process.env) {
  return function coupangProductFeed(preferences, opts = {}) {
    const creds = coupangCreds(env);
    if (!creds) return [];
    const top = topPreferences(preferences, 3).categories;
    const seed = Number.isFinite(opts.seed) ? opts.seed : 1;
    const excludeIds = opts.excludeIds instanceof Set ? opts.excludeIds : new Set(opts.excludeIds || []);

    const eligible = top.filter((c) => (_cache.get(c.id) || { products: [] }).products.length > 0);
    if (!eligible.length) return []; // 재고 없는 카테고리는 슬롯을 비운다 — 백필 금지

    const catN = eligible.length;
    const catOffset = ((seed % catN) + catN) % catN;
    const rotated = eligible.map((_, i) => eligible[(i + catOffset) % catN]);

    return rotated.map((c, i) => {
      const products = _cache.get(c.id).products;
      const n = products.length;
      let idx = (((seed + i) % n) + n) % n;
      for (let tries = 0; tries < n && excludeIds.has(`ad_cp_${c.id}_${products[idx].productId ?? idx}`); tries++) {
        idx = (idx + 1) % n;
      }
      const p = products[idx];
      const relevance = Math.max(0, Math.min(1, c.weight / 6));
      const reason = relevance >= 0.6
        ? `${categoryLabel(c.id)} 관심사와 잘 맞아요`
        : `${categoryLabel(c.id)} 관심사와 관련있어요`;
      return makeSlotItem({
        id: `ad_cp_${c.id}_${p.productId ?? idx}`,
        category: c.id,
        // 실상품엔 사람이 쓴 hook이 없으므로 규칙 기반 폴백(buildHookCopy) —
        // 상품명만 넘기면 "○○ 취향이면 한 번쯤 보게 되는 {상품명}" 톤이 된다.
        hook: buildHookCopy({ category: c.id, name: p.name }),
        productName: p.name,
        title: p.name,
        summary: null,
        url: p.url, // 쿠팡이 준 파트너스 상세 URL 그대로
        image: p.image,
        // 실측값만: 쿠팡 베스트 API는 판매가 하나만 준다 — 정가/할인율을
        // 지어내지 않고 priceSale만 채운다(monetize.js 안티더미 원칙).
        priceSale: p.price,
        priceOriginal: null,
        bestseller: Number.isFinite(p.rank) && p.rank <= 3, // 실제 랭킹 기반
        sample: false,
        relevance,
        reason
      });
    });
  };
}
