// D0 — 선별 기준선 동결(2026-08-18). 정본: WRC .../
//   NOWHOT_FINAL_SELECTION_ARCHITECTURE_AND_OPUS48_REVIEW_2026-08-18.md
//
// 결정적 기준선(baseline)을 stdout으로 출력한다. **어떤 소스·서빙 데이터도
// 변경하지 않는다**(읽기 전용). legacy baseline과 미래 semantic contract를
// 구분하는 버전을 담아, D2 이후 classifier가 recall·qualified supply를 이
// 기준선 아래로 떨어뜨리지 못하게 하는 잠금값으로 쓴다(정본 §9 gate 6).
//
// 시각처럼 매 실행 달라지는 값은 핵심 fingerprint에 넣지 않는다. HEAD·SHA는
// git이 이미 시각을 캡슐화한 결정적 커밋 식별자라 포함한다.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { SELECTION_CONTRACT } from "../src/feed/selection-contract.js";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const sha256 = (s) => crypto.createHash("sha256").update(String(s)).digest("hex");
const readFile = (rel) => fs.readFileSync(path.join(ROOT, rel), "utf8");
const fileFingerprint = (rel) => {
  try { return sha256(readFile(rel)).slice(0, 16); }
  catch { return null; }
};

function git(args) {
  try { return execFileSync("git", args, { cwd: ROOT, encoding: "utf8" }).trim(); }
  catch { return null; }
}

// 소스 문자열의 특정 export/상수 이름들의 존재+값 지문(파싱 없이 결정적).
function symbolFingerprint(rel, symbols) {
  let text;
  try { text = readFile(rel); } catch { return null; }
  const parts = [];
  for (const sym of symbols) {
    const idx = text.indexOf(sym);
    parts.push(`${sym}:${idx >= 0 ? "present" : "absent"}`);
  }
  return sha256(parts.join("|") + "::" + sha256(text)).slice(0, 16);
}

// globalMustKnow 런타임 검색 — 정본 §9: "현재 globalMustKnow 런타임 검색 결과"를
// 기록한다. 자동 일반지면 삽입 함수인지, 문서 레인 정의뿐인지 정직하게 남긴다.
function globalMustKnowSearch() {
  const hits = [];
  const scan = ["src/feed/product-blueprint.js", "src/feed/public/admin.html",
    "src/feed/shadow-selection.js", "src/feed/engine.js", "src/feed/taste-share.js"];
  for (const rel of scan) {
    let text;
    try { text = readFile(rel); } catch { continue; }
    const n = (text.match(/globalMustKnow/g) || []).length;
    if (n > 0) hits.push({ file: rel, occurrences: n });
  }
  return {
    hits,
    // 실측 근거(2026-08-18): globalMustKnow는 product-blueprint.js의 레인/정책
    // 정의와 admin 표시 문자열로만 존재하며, 랭킹/서빙 경로에 자동 일반지면
    // 삽입 함수로 배선돼 있지 않다. personalizationPolicy.automaticUnselectedMixShare=0.
    runtimeAutoInsertFunction: false,
    knownRuntimeUnselectedInjection: {
      file: "src/feed/taste-share.js",
      note: "실시간 Hot의 취향 주입 루프(k>0 조건으로 첫 칸 제외). 이것이 '관심없는 분야만 뜬다'의 런타임 원인. D0에서 변경하지 않음(runtime 무변경)."
    }
  };
}

const baseline = {
  contract: "NOWHOT-SELECTION-BASELINE-001",
  kind: "legacy_baseline_freeze",
  // legacy baseline과 미래 semantic contract를 구분하는 버전. 재검수 수리 1:
  // 계약 실제 버전을 코드에서 읽어 잠근다(하드코딩 문자열이 v2와 어긋나던 것).
  baselineVersion: 1,
  semanticContractVersion: `${SELECTION_CONTRACT.stableId} v${SELECTION_CONTRACT.version} (runtimeWired:${SELECTION_CONTRACT.runtimeWired})`,
  git: {
    head: git(["rev-parse", "HEAD"]),
    branch: git(["rev-parse", "--abbrev-ref", "HEAD"]),
    aheadOfOriginMain: git(["rev-list", "--count", "origin/main..HEAD"])
  },
  canonicalSpec: {
    path: "/Users/hyundonghwang/Documents/WRC_MANUS_HANDOFF/system/reports/NOWHOT_FINAL_SELECTION_ARCHITECTURE_AND_OPUS48_REVIEW_2026-08-18.md",
    expectedSha256: "1bbde69e18f1b162e4528b4071e4dc7c65c4a3092a2c92cff0d67f902fb380e5",
    actualSha256: (() => {
      try {
        return sha256(fs.readFileSync(
          "/Users/hyundonghwang/Documents/WRC_MANUS_HANDOFF/system/reports/NOWHOT_FINAL_SELECTION_ARCHITECTURE_AND_OPUS48_REVIEW_2026-08-18.md",
          "utf8"));
      } catch { return null; }
    })(),
    // 재검수 수리 1: 예상 SHA가 아니라 실제 SHA 일치 여부를 잠금에 담는다.
    get matches() { return this.actualSha256 === this.expectedSha256; }
  },
  fingerprints: {
    // 재검수 수리 1: 새 계약 파일(selection-contract.js) 자체를 지문에 포함해
    // v2 계약 변경이 drift로 잡히게 한다.
    selectionContract: fileFingerprint("src/feed/selection-contract.js"),
    // taxonomy ID + fingerprint (정본 §10 D0 freeze taxonomy)
    taxonomy: symbolFingerprint("src/feed/taxonomy.js",
      ["news", "tech", "auto", "science", "business", "gaming", "sports", "culture",
        "life", "humor", "politics", "realestate", "fashion", "art"]),
    // legacy classifier / category-policy (지문만; 의미 무변경)
    legacyClassifier: symbolFingerprint("src/feed/classify.js",
      ["MARGIN_MIN", "KNOWN_MIN", "OVERRIDE_CATEGORIES", "UNTRAINED_CATEGORIES",
        "CATEGORY_GUARDS", "BOARD_CATEGORY_RULES", "classifyTitle"]),
    categoryPolicy: symbolFingerprint("src/feed/category-policy.js",
      ["SPECIALIST_CORRECTION_MIN_HITS", "specialistCorrection", "aggregateReclassification"]),
    // shadow-selection parameters (해외 공식 marketSignal 포함)
    shadowSelectionParams: symbolFingerprint("src/feed/shadow-selection.js",
      ["SHADOW_PACK_PARAMS", "SHADOW_SELECTION_CONTRACT", "marketSignal", "allMembersOverseas"]),
    // event cluster + lineage 계약
    eventCluster: symbolFingerprint("src/feed/event-cluster.js",
      ["EVENT_MERGE_RULES", "EVENT_LINEAGE_RULES", "buildEventClusters"]),
    // source registry + identity
    sourceRegistry: fileFingerprint("src/feed/communities.json"),
    sourceIdentity: symbolFingerprint("src/feed/editorial-source-identity.js",
      ["EDITORIAL_SOURCE_IDENTITY_CONTRACT", "operationalSourceIdentity", "sameOperationalSourceGroup"])
  },
  taxonomyIds: ["news", "tech", "auto", "science", "business", "gaming", "sports",
    "culture", "life", "humor", "politics", "realestate", "fashion", "art"],
  globalMustKnow: globalMustKnowSearch(),
  knownLimitations: [
    // 정본 §5·D0 반례 6~10: 현재 해외 판정은 소스 국적 기반(사건 위치 아님).
    {
      id: "overseas-by-source-country",
      where: "src/feed/shadow-selection.js allMembersOverseas",
      statement: "현재 해외 판정은 memberArticles의 소스 country만 본다. 사건 위치(event jurisdiction)가 아니다. 손흥민 EPL(발생지 GB)이 gnews-sports(KR)라 국내로 오분류됨. 새 계약(selection-contract.resolveScopeClass)은 사건 위치 기준이나 D0에서 런타임 미연결."
    },
    {
      id: "operator-group-not-claim-independence",
      where: "src/feed/editorial-source-identity.js source_id_fallback",
      statement: "operatorGroup 미설정 소스는 source id 자체가 그룹이 되어, 같은 보도자료를 받아쓴 두 매체가 '독립 2'로 계수될 수 있다. 새 계약(claimOriginGroup)이 주장 기원을 분리하나 D0에서 legacy independentReportingGroups 의미는 무변경."
    }
  ],
  // D0 co-gate 사전등록(정본 §9 gate 4·6): 미래 classifier가 이 아래로 recall/
  // qualified supply를 떨어뜨리려면 문서화된 제품 결정이 필요하다. 값은 D1에서
  // 실측으로 채운다 — D0는 게이트의 존재와 잠금 대상을 등록만 한다.
  coGatesRegistered: {
    recall: { status: "registered_pending_measurement", lockedBaseline: null },
    qualifiedSupply: { status: "registered_pending_measurement", lockedBaseline: null },
    abstainRate: { status: "registered_pending_measurement", lockedBaseline: null },
    note: "프롬프트 튜닝 전에 등록됨(정본 §9 gate 4). 실측 잠금값은 D1."
  }
};

// ---------------------------------------------------------------------------
// Codex 수리 7: baseline 결과를 고정 JSON으로 저장하고 --check가 drift 시 exit 1.
//   잠금 대상은 결정적 지문·taxonomy·계약 버전뿐이다. HEAD·dirty처럼 매 커밋
//   달라지는 값은 잠그지 않는다(그건 정상 진행이지 drift가 아니다).
// ---------------------------------------------------------------------------
const LOCK_PATH = path.join(ROOT, "test", "fixtures", "selection-baseline.lock.json");

export function lockedSnapshot() {
  return {
    contract: baseline.contract,
    baselineVersion: baseline.baselineVersion,
    semanticContractVersion: baseline.semanticContractVersion,
    canonicalSpecSha256: baseline.canonicalSpec.expectedSha256,
    // 재검수 수리 1: 정본의 실제 SHA와 일치하는지(내용 변조 감지) + 계약 파일 지문.
    canonicalSpecActualSha256: baseline.canonicalSpec.actualSha256,
    canonicalSpecMatches: baseline.canonicalSpec.matches,
    fingerprints: baseline.fingerprints,
    taxonomyIds: baseline.taxonomyIds,
    globalMustKnowRuntimeAutoInsert: baseline.globalMustKnow.runtimeAutoInsertFunction,
    knownLimitationIds: baseline.knownLimitations.map((l) => l.id).sort(),
    coGatesRegistered: Object.keys(baseline.coGatesRegistered).filter((k) => k !== "note").sort()
  };
}

export function compareToLock() {
  let saved;
  try { saved = JSON.parse(fs.readFileSync(LOCK_PATH, "utf8")); }
  catch { return { ok: false, reason: "lock file missing", drift: ["<no lock file>"] }; }
  const current = lockedSnapshot();
  const drift = [];
  const walk = (a, b, prefix) => {
    const keys = new Set([...Object.keys(a || {}), ...Object.keys(b || {})]);
    for (const k of keys) {
      const pa = a ? a[k] : undefined;
      const pb = b ? b[k] : undefined;
      const path = prefix ? `${prefix}.${k}` : k;
      if (pa && typeof pa === "object" && pb && typeof pb === "object") walk(pa, pb, path);
      else if (JSON.stringify(pa) !== JSON.stringify(pb)) drift.push(`${path}: ${JSON.stringify(pb)} -> ${JSON.stringify(pa)}`);
    }
  };
  walk(current, saved, "");
  return { ok: drift.length === 0, drift };
}

const mode = process.argv[2];
if (mode === "--write") {
  fs.writeFileSync(LOCK_PATH, JSON.stringify(lockedSnapshot(), null, 2) + "\n");
  process.stdout.write(`wrote ${path.relative(ROOT, LOCK_PATH)}\n`);
} else if (mode === "--check") {
  const res = compareToLock();
  if (res.ok) {
    process.stdout.write("baseline lock: OK (no drift)\n");
    process.exit(0);
  } else {
    process.stderr.write("baseline lock DRIFT:\n" + (res.drift || []).map((d) => "  " + d).join("\n") + "\n");
    process.exit(1);
  }
} else {
  process.stdout.write(JSON.stringify(baseline, null, 2) + "\n");
}
