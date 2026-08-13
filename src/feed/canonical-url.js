// URL 정규화 — 사건 클러스터링(블루프린트 v4 P1)의 전처리.
//
// 순수 함수만 있고 부작용·네트워크 요청이 없다. 특히 구글뉴스 리다이렉트
// (news.google.com/rss/articles/CBMi…)는 **추가 HTTP 요청 없이** 디코딩 가능한
// 범위만 해소한다: 구식 포맷은 아티클 ID(base64url)가 protobuf 안에 원문 URL
// 문자열을 그대로 내장하므로 오프라인 복원이 되고, 2024년 이후 신식 포맷
// (내장 문자열이 "AU_yqL…" 불투명 토큰)은 네트워크 없이 복원이 불가능하므로
// **추측하지 않고 null**을 돌려준다(스냅샷 실측: 현행 수집분은 대부분 신식).

const TRACKING_PARAM_EXACT = new Set([
  // 보수적 목록 — 명백한 트래킹/클릭 식별자만. 내용 주소에 쓰일 수 있는
  // 일반 파라미터(ref, source 등)는 건드리지 않는다.
  "fbclid", "gclid", "gclsrc", "dclid", "msclkid", "twclid", "igshid",
  "mc_cid", "mc_eid", "yclid", "srsltid"
]);

const isTrackingParam = (name) => {
  const key = String(name || "").toLowerCase();
  return key.startsWith("utm_") || TRACKING_PARAM_EXACT.has(key);
};

// base64url → bytes. Node 22의 Buffer가 base64url을 그대로 받는다.
function base64UrlBytes(value) {
  try {
    const buf = Buffer.from(String(value || ""), "base64url");
    return buf.length ? buf : null;
  } catch {
    return null;
  }
}

// 아주 작은 protobuf 워커: length-delimited(와이어타입 2) 필드의 문자열만 걷는다.
// 구식 구글뉴스 아티클 ID는 이 문자열 중 하나가 원문 http(s) URL이다.
function protobufStrings(bytes, depth = 0) {
  const out = [];
  if (!bytes || depth > 2) return out;
  let i = 0;
  const readVarint = () => {
    let shift = 0;
    let value = 0;
    while (i < bytes.length) {
      const b = bytes[i++];
      value += (b & 0x7f) * 2 ** shift;
      if ((b & 0x80) === 0) return value;
      shift += 7;
      if (shift > 35) return null;
    }
    return null;
  };
  while (i < bytes.length) {
    const tag = readVarint();
    if (tag == null) break;
    const wire = tag & 0x7;
    if (wire === 0) {
      if (readVarint() == null) break;
    } else if (wire === 2) {
      const len = readVarint();
      if (len == null || len < 0 || i + len > bytes.length) break;
      const chunk = bytes.subarray(i, i + len);
      i += len;
      out.push(chunk.toString("utf8"));
      // 드물게 한 겹 더 감싼 포맷이 있어 얕게만 재귀한다.
      out.push(...protobufStrings(chunk, depth + 1));
    } else if (wire === 5) {
      i += 4;
    } else if (wire === 1) {
      i += 8;
    } else {
      break; // 모르는 와이어타입 — 추측하지 않고 중단
    }
  }
  return out;
}

// 구글뉴스 리다이렉트 URL인지.
export function isGoogleNewsRedirect(url) {
  try {
    const u = new URL(String(url || ""));
    return u.hostname.replace(/^www\./, "") === "news.google.com"
      && /\/(?:rss\/)?articles\//.test(u.pathname);
  } catch {
    return false;
  }
}

// 구글뉴스 리다이렉트에서 원문 URL을 오프라인 복원. 불가하면 null(추측 금지).
export function decodeGoogleNewsUrl(url) {
  if (!isGoogleNewsRedirect(url)) return null;
  let articleId = "";
  try {
    const u = new URL(String(url));
    const m = u.pathname.match(/\/(?:rss\/)?articles\/([^/]+)/);
    articleId = m ? m[1] : "";
  } catch {
    return null;
  }
  const bytes = base64UrlBytes(articleId);
  if (!bytes) return null;
  const candidates = protobufStrings(bytes).filter((s) => /^https?:\/\/\S+$/.test(s));
  // 구식 포맷: 첫 번째 원문 URL(두 번째는 보통 AMP 변형). 신식 포맷: 후보 0건.
  return candidates.length ? candidates[0] : null;
}

// 트래킹 파라미터 제거(보수적 목록) — 그 외 파라미터·순서는 보존.
export function stripTrackingParams(url) {
  try {
    const u = new URL(String(url || ""));
    const keep = [...u.searchParams.entries()].filter(([k]) => !isTrackingParam(k));
    u.search = "";
    for (const [k, v] of keep) u.searchParams.append(k, v);
    return u.toString();
  } catch {
    return null;
  }
}

// m./amp./mobile. 호스트 접두 정규화 + 스킴·호스트 소문자화 + 말미 슬래시 정리.
function normalizeHostAndPath(u) {
  u.hostname = u.hostname
    .toLowerCase()
    .replace(/^(?:m|amp|mobile)\./, "");
  if (u.pathname.length > 1 && u.pathname.endsWith("/")) {
    u.pathname = u.pathname.replace(/\/+$/, "");
  }
  return u;
}

// 종합 정규화. 반환:
//   - 해소·정규화된 절대 http(s) URL 문자열
//   - 구글뉴스 리다이렉트인데 오프라인 복원 불가 → null
//   - http(s) URL이 아니거나 파싱 불가 → null
export function canonicalizeUrl(url) {
  const input = String(url || "").trim();
  if (!/^https?:\/\//i.test(input)) return null;
  let resolved = input;
  if (isGoogleNewsRedirect(input)) {
    const decoded = decodeGoogleNewsUrl(input);
    if (!decoded) return null; // 신식 불투명 포맷 — 추측 금지
    resolved = decoded;
  }
  const stripped = stripTrackingParams(resolved);
  if (!stripped) return null;
  try {
    const u = normalizeHostAndPath(new URL(stripped));
    return u.toString();
  } catch {
    return null;
  }
}
