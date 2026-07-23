// Match a place (from Kakao) to its official license record (from localdata) to
// recover the exact founding year. localdata has no name search, so the
// architecture is: ingest license rows for a region, then match locally by
// normalized road address + business name. This module is the pure matcher.

function normAddr(s) {
  return String(s || "")
    .replace(/\(.*?\)/g, " ") // drop "(상세)" parentheticals
    .replace(/[^0-9a-z가-힣]/gi, "")
    .toLowerCase();
}
function normName(s) {
  return String(s || "").replace(/\s+/g, "").replace(/[^0-9a-z가-힣]/gi, "").toLowerCase();
}
const isOpen = (state) => !/폐업|말소|취소/.test(String(state || ""));

// Length of shared suffix — robust to 시/도/구 prefix variance (both addresses
// end with the same 도로명+번지, e.g. "…충무로11-1").
function commonSuffix(a, b) {
  let i = 0;
  while (i < a.length && i < b.length && a[a.length - 1 - i] === b[b.length - 1 - i]) i++;
  return i;
}
// Same building if the addresses share a long tail (road name + number).
const addrMatch = (a, b) => Boolean(a && b && (a.includes(b) || b.includes(a) || commonSuffix(a, b) >= 6));

// place: { name, roadAddress?, address? }. rows: normalized localdata rows.
// Returns { foundingYear, matched } — matched=how it was found, or null year.
export function matchFoundingYear(place, rows = []) {
  const pAddr = normAddr(place.roadAddress || place.address);
  const pName = normName(place.name);
  let nameOnly = null;

  for (const r of rows) {
    if (!isOpen(r.state) || r.foundingYear == null) continue;
    const rAddr = normAddr(r.roadAddress || r.landAddress);
    const rName = normName(r.name);
    const addrHit = addrMatch(pAddr, rAddr);
    const nameHit = pName && rName && (rName.includes(pName) || pName.includes(rName));
    if (addrHit && nameHit) return { foundingYear: r.foundingYear, matched: "address+name" };
    if (nameHit && addrHit === false && nameOnly == null) nameOnly = r.foundingYear;
  }
  // Address is the strong key; a name-only hit is weaker — return it as a fallback.
  return nameOnly != null ? { foundingYear: nameOnly, matched: "name-only" } : { foundingYear: null, matched: null };
}

export default { matchFoundingYear };
