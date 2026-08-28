// NOWHOT D1-A — deterministic seed corpus builder.
// 정본: WRC .../NOWHOT_FINAL_SELECTION_ARCHITECTURE_AND_OPUS48_REVIEW_2026-08-18.md
//
// 명시된 세 로컬 스냅샷만 읽는다(읽기 전용). 네트워크 0, .nowhot-local 쓰기 0,
// 시각 미포함. 같은 입력에서 byte-identical corpus를 생성한다(§4).
//  - 실제 로컬 아이템이 corpus의 과반(>50%)
//  - 세 날짜 × 14 declared category 계층표집(서로 다른 소스 우선, evidence hash dedup)
//  - 공급 없는 분야는 합성으로 채우지 않고 shortage로 기록
//  - adversarial/mutation fixture는 별도 origin으로 부착(release precision 분모 아님)
//  - declared category는 sampling stratum일 뿐 gold 아님. gold 답을 생성하지 않는다.
// 금지 필드(§4): 전체 본문·댓글·사용자/작성자 개인정보·쿠키/토큰/키·원본 URL/추적쿼리.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { normalizeText, evidenceHashOf, D1_CORPUS_ID, D1_CORPUS_SUPERSEDES_ID } from "../src/feed/selection-classifier-lab.js";
import { ADMISSION_CATEGORY_IDS } from "../src/feed/selection-contract.js";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const CORPUS_PATH = path.join(ROOT, "test", "fixtures", "selection-d1-corpus.json");
const sha256hex = (s) => crypto.createHash("sha256").update(s).digest("hex");
const isNonEmptyStr = (v) => typeof v === "string" && v.trim().length > 0;

const SNAPSHOT_DATES = ["14", "15", "16"];
const PER_STRATUM_DISTINCT_SOURCES = 2; // (date×category)별 서로 다른 소스 상한(고정 총건수 아님)

function loadSnapshot(date) {
  const rel = `.nowhot-local/shadow-observation/pool-2026-08-${date}-lunch.json`;
  const raw = fs.readFileSync(path.join(ROOT, rel), "utf8");
  const w = JSON.parse(raw);
  return {
    date,
    id: `pool-2026-08-${date}-lunch`,
    rel,
    sha256: sha256hex(raw),
    count: Array.isArray(w.rows) ? w.rows.length : 0,
    items: (w.rows || []).map((r) => r.item).filter(Boolean)
  };
}

function sourceRegistry() {
  const raw = fs.readFileSync(path.join(ROOT, "src", "feed", "communities.json"), "utf8");
  const c = JSON.parse(raw);
  // 이 코퍼스는 과거 스냅샷의 동결 기록이다. 현재 레지스트리 등급이 바뀌어도
  // 이미 저장된 당시 sourceTier/country까지 소급 변경하지 않는다.
  let frozenRows = [];
  try { frozenRows = JSON.parse(fs.readFileSync(CORPUS_PATH, "utf8")).rows || []; } catch {}
  const frozenMeta = new Map(frozenRows
    .filter((row) => row.origin === "real_local_snapshot")
    .map((row) => [row.sourceId, { tier: row.sourceTier, country: row.sourceCountry }]));
  const map = new Map();
  for (const s of c.communities || []) {
    map.set(s.id, frozenMeta.get(s.id) || {
      tier: isNonEmptyStr(s.sourceTier) ? s.sourceTier : "unknown",
      country: isNonEmptyStr(s.country) ? s.country : "unknown"
    });
  }
  return map;
}

function excerptOf(it) {
  const s = typeof it.summary === "string" ? it.summary : "";
  return s.slice(0, 300);
}

function makeRealRow(snap, declaredCat, it, hash, srcMeta) {
  const meta = srcMeta.get(it.source) || {};
  return {
    blindItemId: "d1r-" + hash.slice(0, 16),
    origin: "real_local_snapshot",
    sourceId: it.source,
    sourceTier: meta.tier || "unknown",
    declaredCategory: declaredCat,                                   // stratum only — NOT gold
    declaredSection: isNonEmptyStr(it.registryCategory) ? it.registryCategory : null,
    contentKindHint: isNonEmptyStr(it.kind) ? it.kind : "unknown",
    sourceCountry: meta.country || "unknown",
    language: isNonEmptyStr(it.lang) ? it.lang : "unknown",
    title: it.title,
    excerpt: excerptOf(it),
    evidenceHash: hash,
    sourceSnapshotId: snap.id,
    sourceSnapshotSha: snap.sha256.slice(0, 16),
    stratum: `${snap.date}:${declaredCat}`,
    provenance: { date: snap.date, source: it.source, declaredCategory: declaredCat, kind: isNonEmptyStr(it.kind) ? it.kind : "unknown" }
  };
}

// adversarial/mutation fixture는 contractGold(구성상 정답)를 담는다. real 기사와 달리
// 합성 반례라 정답이 by-construction으로 정의되며, gold 파일에서 contract_fixture_only로
// 표기되고 release precision 분모에는 포함하지 않는다.
function withHash(row) {
  return { ...row, evidenceHash: evidenceHashOf({ title: row.title, excerpt: row.excerpt }) };
}

function adversarialRows() {
  const base = { origin: "adversarial_contract_fixture", sourceCountry: "KR", language: "ko" };
  const raw = [
    { blindItemId: "d1a-01-food-as-politics", sourceId: "todayhumor", sourceTier: "community", declaredCategory: "politics", declaredSection: "politics", contentKindHint: "community",
      title: "집에서 만든 마라탕 레시피 대공개", excerpt: "육수부터 사천 고추기름까지 직접 끓여 만든 마라탕 만드는 법",
      defect: "food article declared politics",
      contractGold: { contentType: "community", acceptedCategories: ["life"], rejectedCategories: ["politics"], evidenceSpans: ["마라탕 레시피"], reasonCodes: ["semantic-topic"], scopeClass: "unknown", eventJurisdictions: [], relevanceCountries: [], geoEvidenceSpans: [] } },
    { blindItemId: "d1a-02-devto-as-fashion", sourceId: "devto", sourceTier: "news", declaredCategory: "fashion", declaredSection: "fashion", contentKindHint: "news", sourceCountry: "US", language: "en",
      title: "Announcing the new dev.to open source contributor program", excerpt: "New program for open source maintainers to onboard contributors and manage pull requests",
      defect: "dev announcement declared fashion",
      contractGold: { contentType: "news", acceptedCategories: ["tech"], rejectedCategories: ["fashion"], evidenceSpans: ["open source contributor program"], reasonCodes: ["semantic-topic"], scopeClass: "unknown", eventJurisdictions: [], relevanceCountries: [], geoEvidenceSpans: [] } },
    { blindItemId: "d1a-03-community-as-news", sourceId: "clien", sourceTier: "community", declaredCategory: "tech", declaredSection: "tech", contentKindHint: "community",
      title: "제 컴퓨터 견적 좀 봐주세요 조립 처음입니다", excerpt: "예산 150만원으로 게임용 조립 PC 견적 짰는데 조언 부탁드립니다",
      defect: "community help post that a naive classifier calls news",
      contractGold: { contentType: "community", acceptedCategories: ["tech"], rejectedCategories: [], evidenceSpans: ["조립 PC 견적"], reasonCodes: ["semantic-topic"], scopeClass: "unknown", eventJurisdictions: [], relevanceCountries: [], geoEvidenceSpans: [] } },
    { blindItemId: "d1a-04-deal-as-news", sourceId: "ppomppu", sourceTier: "community", declaredCategory: "life", declaredSection: "life", contentKindHint: "deal",
      title: "[쿠팡] 삼성 정품 SSD 1TB 최저가 89000원 무료배송", excerpt: "역대 최저가 특가 링크입니다 카드할인 추가 적용",
      defect: "deal item that a naive classifier calls news",
      contractGold: { contentType: "deal", acceptedCategories: ["tech"], rejectedCategories: [], evidenceSpans: ["최저가", "특가"], reasonCodes: ["deal-price-signal"], scopeClass: "domestic", eventJurisdictions: ["KR"], relevanceCountries: ["KR"], geoEvidenceSpans: ["쿠팡", "89000원"] } },
    { blindItemId: "d1a-05-source-prior-conflict", sourceId: "gnews-sports", sourceTier: "aggregate", declaredCategory: "sports", declaredSection: "sports", contentKindHint: "news",
      title: "구단 모기업, 반도체 부문 3조원 신규 투자 발표", excerpt: "그룹 지주사가 반도체 생산라인 증설에 3조원을 투자한다고 공시했다",
      defect: "sports-section source but article is business",
      contractGold: { contentType: "news", acceptedCategories: ["business"], rejectedCategories: ["sports"], evidenceSpans: ["반도체 부문 3조원 신규 투자"], reasonCodes: ["semantic-topic"], scopeClass: "domestic", eventJurisdictions: ["KR"], relevanceCountries: ["KR"], geoEvidenceSpans: ["3조원"] } },
    { blindItemId: "d1a-06-genuine-cross-domain", sourceId: "hankyung", sourceTier: "specialist", declaredCategory: "business", declaredSection: "business", contentKindHint: "news",
      title: "국회, 반도체 특별법 본회의 통과… 세액공제 대폭 확대", excerpt: "여야 합의로 반도체 기업 세제 지원을 늘리는 특별법이 국회를 통과했다",
      defect: "genuine business+politics cross-domain event",
      contractGold: { contentType: "news", acceptedCategories: ["business", "politics"], rejectedCategories: [], evidenceSpans: ["국회", "세액공제"], reasonCodes: ["semantic-topic"], scopeClass: "domestic", eventJurisdictions: ["KR"], relevanceCountries: ["KR"], geoEvidenceSpans: ["국회", "여야"] } },
    { blindItemId: "d1a-07-secondary-only-admission", sourceId: "mk-news", sourceTier: "specialist", declaredCategory: "business", declaredSection: "business", contentKindHint: "news",
      title: "대기업 실적 발표에 정치권도 촉각", excerpt: "분기 영업이익이 시장 기대를 웃돌자 여야가 경기 진단을 놓고 공방을 벌였다",
      defect: "politics only in secondary — politics admission must NOT hold",
      contractGold: { contentType: "news", acceptedCategories: ["business"], rejectedCategories: ["politics"], descriptiveSecondaryCategories: ["politics"], evidenceSpans: ["영업이익"], reasonCodes: ["semantic-topic"], scopeClass: "domestic", eventJurisdictions: ["KR"], relevanceCountries: ["KR"], geoEvidenceSpans: ["여야"] } },
    { blindItemId: "d1a-08-primary-ok-admission-wrong", sourceId: "etnews", sourceTier: "specialist", declaredCategory: "business", declaredSection: "business", contentKindHint: "news",
      title: "중소기업 대출 연체율 상승세 지속", excerpt: "고금리 장기화로 중소기업 대출 연체율이 다섯 달째 오름세를 보였다",
      defect: "primary business correct but a prediction that rejects business admission = not TP",
      contractGold: { contentType: "news", acceptedCategories: ["business"], rejectedCategories: [], evidenceSpans: ["대출 연체율"], reasonCodes: ["semantic-topic"], scopeClass: "unknown", eventJurisdictions: [], relevanceCountries: [], geoEvidenceSpans: [] } },
    { blindItemId: "d1a-09-domestic-media-overseas-event", sourceId: "yna", sourceTier: "specialist", declaredCategory: "news", declaredSection: "news", contentKindHint: "news",
      title: "美 연준, 기준금리 동결… 연내 인하 시그널", excerpt: "미국 연방준비제도가 기준금리를 동결하고 연내 인하 가능성을 시사했다",
      defect: "domestic (KR) media reporting an overseas (US) event",
      contractGold: { contentType: "news", acceptedCategories: ["business"], rejectedCategories: [], evidenceSpans: ["연준", "기준금리"], reasonCodes: ["semantic-topic"], scopeClass: "international", eventJurisdictions: ["US"], relevanceCountries: ["KR", "US"], geoEvidenceSpans: ["美", "미국"] } },
    { blindItemId: "d1a-10-same-structure-diff-meaning", sourceId: "yozm", sourceTier: "news", declaredCategory: "tech", declaredSection: "tech", contentKindHint: "news",
      title: "애플, 새 얼굴 공개… 업계 술렁", excerpt: "애플이 신규 임원 인사를 단행하며 조직 개편에 나섰다",
      defect: "same title structure as a product-launch headline but means an exec appointment",
      contractGold: { contentType: "news", acceptedCategories: ["business"], rejectedCategories: ["tech"], evidenceSpans: ["신규 임원 인사"], reasonCodes: ["semantic-topic"], scopeClass: "unknown", eventJurisdictions: [], relevanceCountries: [], geoEvidenceSpans: [] } }
  ];
  return raw.map((r) => withHash({ ...base, ...r, stratum: "adversarial:" + r.blindItemId.slice(4) }));
}

function mutationRows() {
  const base = { origin: "mutation_fixture", sourceId: "yozm", sourceTier: "news", sourceCountry: "KR", language: "ko", contentKindHint: "news", declaredSection: null };
  const raw = [
    // semantic pair: 의미 단어 하나가 바뀌어 정답 category가 변함(tech → sports)
    { blindItemId: "d1m-01a", mutationPairId: "m01", mutationRole: "original", mutationType: "semantic", declaredCategory: "tech",
      title: "삼성 갤럭시 신제품 공개", excerpt: "삼성전자가 새 갤럭시 스마트폰 라인업을 공개했다",
      contractGold: { contentType: "news", acceptedCategories: ["tech"], rejectedCategories: [], evidenceSpans: ["갤럭시 스마트폰"], reasonCodes: ["semantic-topic"], scopeClass: "domestic" } },
    { blindItemId: "d1m-01b", mutationPairId: "m01", mutationRole: "variant", mutationType: "semantic", declaredCategory: "tech",
      title: "삼성 라이온즈 신인 공개", excerpt: "삼성 라이온즈가 새 신인 야구선수 라인업을 공개했다",
      contractGold: { contentType: "news", acceptedCategories: ["sports"], rejectedCategories: [], evidenceSpans: ["야구선수"], reasonCodes: ["semantic-topic"], scopeClass: "domestic" } },
    // semantic pair 2: business → sports
    { blindItemId: "d1m-02a", mutationPairId: "m02", mutationRole: "original", mutationType: "semantic", declaredCategory: "business",
      title: "현대차 분기 영업이익 발표", excerpt: "현대차가 분기 영업이익 실적을 발표했다",
      contractGold: { contentType: "news", acceptedCategories: ["business"], rejectedCategories: [], evidenceSpans: ["영업이익 실적"], reasonCodes: ["semantic-topic"], scopeClass: "domestic" } },
    { blindItemId: "d1m-02b", mutationPairId: "m02", mutationRole: "variant", mutationType: "semantic", declaredCategory: "business",
      title: "현대차 분기 우승기록 발표", excerpt: "현대차 축구단이 분기 우승기록 성적을 발표했다",
      contractGold: { contentType: "news", acceptedCategories: ["sports"], rejectedCategories: [], evidenceSpans: ["축구단", "우승기록"], reasonCodes: ["semantic-topic"], scopeClass: "domestic" } },
    // invariance pair: 구두점·공백만 바뀌고 정답 유지(sports)
    { blindItemId: "d1m-03a", mutationPairId: "m03", mutationRole: "original", mutationType: "invariance", declaredCategory: "sports",
      title: "손흥민 멀티골 폭발", excerpt: "손흥민이 한 경기 멀티골을 넣으며 팀 승리를 이끌었다",
      contractGold: { contentType: "news", acceptedCategories: ["sports"], rejectedCategories: [], evidenceSpans: ["멀티골"], reasonCodes: ["semantic-topic"], scopeClass: "international" } },
    { blindItemId: "d1m-03b", mutationPairId: "m03", mutationRole: "variant", mutationType: "invariance", declaredCategory: "sports",
      title: "손흥민,   멀티골  폭발!!!", excerpt: "손흥민이 한 경기 멀티골을 넣으며 팀 승리를 이끌었다...",
      contractGold: { contentType: "news", acceptedCategories: ["sports"], rejectedCategories: [], evidenceSpans: ["멀티골"], reasonCodes: ["semantic-topic"], scopeClass: "international" } },
    // invariance pair 2: 대소문자·공백만(tech)
    { blindItemId: "d1m-04a", mutationPairId: "m04", mutationRole: "original", mutationType: "invariance", declaredCategory: "tech",
      title: "OpenAI releases new API", excerpt: "OpenAI announced a new developer API for building applications",
      sourceCountry: "US", language: "en",
      contractGold: { contentType: "news", acceptedCategories: ["tech"], rejectedCategories: [], evidenceSpans: ["developer API"], reasonCodes: ["semantic-topic"], scopeClass: "global" } },
    { blindItemId: "d1m-04b", mutationPairId: "m04", mutationRole: "variant", mutationType: "invariance", declaredCategory: "tech",
      title: "openai releases   new api", excerpt: "OpenAI announced a new developer API for building applications.",
      sourceCountry: "US", language: "en",
      contractGold: { contentType: "news", acceptedCategories: ["tech"], rejectedCategories: [], evidenceSpans: ["developer API"], reasonCodes: ["semantic-topic"], scopeClass: "global" } }
  ];
  return raw.map((r) => withHash({ ...base, ...r, stratum: "mutation:" + r.mutationPairId }));
}

export function buildCorpus() {
  const snapshots = SNAPSHOT_DATES.map(loadSnapshot);
  const srcMeta = sourceRegistry();
  const CATS = [...ADMISSION_CATEGORY_IDS];

  const usedHash = new Set();
  const realRows = [];
  const shortages = [];
  for (const snap of snapshots) {
    for (const cat of CATS) {
      const group = snap.items
        .filter((it) => it.category === cat && isNonEmptyStr(it.title))
        .map((it) => ({ it, h: evidenceHashOf({ title: it.title, excerpt: excerptOf(it) }) }))
        .sort((a, b) => (a.h < b.h ? -1 : a.h > b.h ? 1 : 0));
      const usedSources = new Set();
      let picked = 0;
      for (const { it, h } of group) {
        if (picked >= PER_STRATUM_DISTINCT_SOURCES) break;
        if (usedHash.has(h) || usedSources.has(it.source)) continue;
        usedSources.add(it.source);
        usedHash.add(h);
        realRows.push(makeRealRow(snap, cat, it, h, srcMeta));
        picked += 1;
      }
      if (picked === 0) shortages.push({ stratum: `${snap.date}:${cat}`, reason: "no_declared_supply" });
      else if (picked < PER_STRATUM_DISTINCT_SOURCES) shortages.push({ stratum: `${snap.date}:${cat}`, reason: "below_distinct_source_target", have: picked, target: PER_STRATUM_DISTINCT_SOURCES });
    }
  }

  const adversarial = adversarialRows();
  const mutation = mutationRows();
  // content-kind shortage: 스냅샷에 deal/other kind 없음 → 합성으로 채우지 않고 기록.
  const realKinds = new Set(realRows.map((r) => r.contentKindHint));
  for (const kind of ["deal", "other"]) {
    if (!realKinds.has(kind)) shortages.push({ stratum: `content_kind:${kind}`, reason: "no_real_supply_in_snapshots" });
  }

  const rows = [...realRows, ...adversarial, ...mutation];
  const realCount = realRows.length;
  const total = rows.length;
  return {
    contract: D1_CORPUS_ID,
    supersedes: D1_CORPUS_SUPERSEDES_ID,
    phase: "D1-A",
    note: "실제 로컬 스냅샷 과반 + 적대/변형 계약 fixture. declared category는 stratum일 뿐 gold 아님. 실제 기사 정답은 이 파일에 없다(독립 gold 별도).",
    snapshots: snapshots.map((s) => ({ id: s.id, path: s.rel, sha256: s.sha256, rows: s.count })),
    counts: {
      real: realCount,
      adversarial: adversarial.length,
      mutation: mutation.length,
      total,
      realMajority: realCount * 2 > total,
      realRatioBps: total > 0 ? Math.round((realCount / total) * 10000) : 0
    },
    coverage: {
      categories: [...new Set(realRows.map((r) => r.declaredCategory))].sort(),
      dates: [...new Set(realRows.map((r) => r.provenance.date))].sort(),
      kinds: [...new Set(realRows.map((r) => r.contentKindHint))].sort(),
      sources: [...new Set(realRows.map((r) => r.sourceId))].sort()
    },
    shortages,
    rows
  };
}

function serialize(corpus) {
  return JSON.stringify(corpus, null, 2) + "\n";
}

const mode = process.argv[2];
if (import.meta.url === `file://${process.argv[1]}`) {
  if (mode === "--write") {
    fs.writeFileSync(CORPUS_PATH, serialize(buildCorpus()));
    process.stdout.write(`wrote ${path.relative(ROOT, CORPUS_PATH)}\n`);
  } else if (mode === "--check") {
    const built = serialize(buildCorpus());
    let saved;
    try { saved = fs.readFileSync(CORPUS_PATH, "utf8"); }
    catch { process.stderr.write("corpus fixture missing\n"); process.exit(1); }
    if (built === saved) { process.stdout.write("corpus: OK (byte-identical)\n"); process.exit(0); }
    process.stderr.write("corpus DRIFT: rebuilt bytes differ from fixture\n"); process.exit(1);
  } else {
    const c = buildCorpus();
    process.stdout.write(`real=${c.counts.real} adversarial=${c.counts.adversarial} mutation=${c.counts.mutation} total=${c.counts.total} realMajority=${c.counts.realMajority} realRatioBps=${c.counts.realRatioBps}\n`);
    process.stdout.write(`shortages=${c.shortages.length}: ${c.shortages.map((s) => s.stratum).join(", ")}\n`);
    process.stdout.write(`categories=${c.coverage.categories.length} dates=${c.coverage.dates.join(",")} kinds=${c.coverage.kinds.join(",")} sources=${c.coverage.sources.length}\n`);
  }
}
