// R4 — 연속 관찰 도구 (블루프린트 "2026-08-14 P3-A 판정" 결함 4의 관찰 배선).
//
// 결함 4: 평가 도구가 이전 판 상태를 넘기지 않아 재등장 검사가 실제 관찰에서
// 꺼져 있었다. R1이 영구 계보(previousLineage·서빙 지문)를 만들었고 게이트
// 배선까지 됐지만, 도구가 판을 낱개로 돌리면 호르무즈형(같은 사건 실질 변화
// 없이 재등장)이 관찰에서 보이지 않는다.
//
// 이 도구는 아침→점심→저녁을 **실제 슬롯 순서로 연속 실행**한다:
//   슬롯 N의 shadowSelectBriefing 반환 lineage.records(서빙 지문 포함)를
//   슬롯 N+1의 previousLineage로 그대로 넘긴다.
//
// 슬롯 시각 계약: digest.js SLOTS의 publishHour(모닝 7시·런치 12시·이브닝
// 19시 KST — 블루프린트 하루 세 판)를 그대로 재사용한다. 하드코딩 금지.
//
// ── 풀 소스 2모드 (자동 선택 — 어떤 모드였는지 반드시 출력)
//  ① real  — .nowhot-local의 실제 서빙판(eval-shadow-vs-today.mjs 로더 재사용)
//            이 같은 날짜에 복수 슬롯 있으면: asOf = 각 판의 generatedAt(실제
//            발행 시각), 입력 풀 = .nowhot-local/feed-data-pool.json.
//  ② snapshot — 신선 풀 스냅샷 1개를 각 슬롯 asOf(publishHour) 기준으로
//            신선도 창만 다르게 잘라 3판 시뮬레이션.
//            **정직성 주의: 같은 풀이라 재등장 압력이 실제보다 높다** — 실제
//            운영에서는 슬롯마다 새 글이 유입되는데 여기서는 같은 재료가 세 번
//            후보에 오르므로, 재등장 차단 수를 실제 비율로 읽으면 안 된다.
//
// 정직 규칙: 읽기 전용(.nowhot-local/ 어떤 파일도 쓰지 않는다), 4100 무접촉,
// 현행 서빙 경로 무변경, 저장된 판이 없으면 없다고 출력(모형 대체 금지).
//
// 사용:
//   node tools/eval-shadow-continuity.mjs                              # 기본 조합·모드 자동
//   node tools/eval-shadow-continuity.mjs --date 2026-08-13 --cats business,humor,news,tech
//   node tools/eval-shadow-continuity.mjs --mode snapshot --pool /path/pool.json
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import {
  shadowSelectBriefing, shadowBriefingReceipt, sha256Hex
} from "../src/feed/shadow-selection.js";
import { SLOTS } from "../src/feed/digest.js";
import { loadRegistry } from "../src/feed/registry.js";
import { DEFAULT_EDITORIAL_PREVIEW } from "../src/feed/engine.js";
import {
  loadServedEdition, listServedEditions, articlesFromPool
} from "./eval-shadow-vs-today.mjs";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const LOCAL_DATA_FILE = path.join(ROOT, ".nowhot-local", "feed-data.json");
const LOCAL_POOL_FILE = path.join(ROOT, ".nowhot-local", "feed-data-pool.json");
const DEFAULT_SNAPSHOT_POOL =
  "/private/tmp/claude-501/-Users-hyundonghwang-Documents-FreeBoard/76dcd583-4aaf-4a07-929d-2dc5058ae60f/scratchpad/fresh-feed-pool.json";

// 슬롯 순서는 digest.js SLOTS 정의 순서(morning→lunch→evening)를 그대로 쓴다.
const SLOT_SEQUENCE = SLOTS.map((slot) => ({ id: slot.id, label: slot.label, publishHour: slot.publishHour }));

// KST 날짜 + 시(publishHour) → epoch ms. KST는 UTC+9 고정(서머타임 없음).
export function kstSlotTime(date, hour) {
  return Date.parse(`${date}T${String(hour).padStart(2, "0")}:00:00+09:00`);
}

const kstDateOf = (epochMs) => new Date(epochMs + 9 * 3600000).toISOString().slice(0, 10);

// ---------------------------------------------------------------------------
// 모드 결정 — real 가능(같은 날짜에 저장 실제판 슬롯 2개 이상)이면 real,
// 아니면 snapshot. --mode로 강제 가능.
// ---------------------------------------------------------------------------

export function planSlots({ data, date, categories }) {
  const plans = [];
  for (const slot of SLOT_SEQUENCE) {
    const served = data ? loadServedEdition(data, { date, slotId: slot.id, categories }) : { found: false };
    plans.push({
      slotId: slot.id,
      label: slot.label,
      publishHour: slot.publishHour,
      servedFound: Boolean(served.found),
      generatedAt: served.found ? served.edition.generatedAt : null
    });
  }
  return plans;
}

// ---------------------------------------------------------------------------
// 연속 실행 — 슬롯 간에 lineage.records를 넘긴다 (이 파일의 존재 이유).
// ---------------------------------------------------------------------------

// slots: [{ slotId, asOf }...] 실제 순서. articles: 공통 입력 풀.
// 반환: 슬롯별 관찰(선별·재등장 차단·재통과·신규)과 요약.
// onBriefing(slot, briefingResult): R7 영수증 등 슬롯별 원본 반환이 필요한
// 호출자용 훅 — 관찰 계산에는 관여하지 않는다(없으면 기존과 동일).
export function runContinuity(articles, { slots, categories, registry, onBriefing = null }) {
  let previousLineage = [];
  // lineageId → 마지막 서빙 슬롯·그때 지문 (도구 관찰용 — 게이트 판정은
  // shadow-selection이 계보 레코드로 스스로 한다).
  const lastServed = new Map();
  const slotReports = [];

  for (const slot of slots) {
    const out = shadowSelectBriefing(articles, {
      requestedCategories: categories,
      now: slot.asOf,
      slotId: slot.slotId,
      registry,
      previousLineage
    });
    if (onBriefing) onBriefing(slot, out);

    // 선별 목록.
    const selected = out.briefing.map((entry, index) => ({
      rank: index + 1,
      lineageId: entry.lineageId,
      eventId: entry.eventId,
      tier: entry.tier,
      S: entry.S,
      categories: entry.selectedByCategories,
      fingerprint: entry.view.event.factsFingerprint,
      inherited: Boolean(entry.view.lineage && entry.view.lineage.inherited),
      previousServedFingerprint: entry.view.lineage
        ? entry.view.lineage.previousServedFingerprint : null,
      title: entry.view.memberArticles[0] && entry.view.memberArticles[0].title
        || entry.view.reactionArticles[0] && entry.view.reactionArticles[0].title || "(제목 없음)"
    }));

    // 재등장 차단 목록 — 분야별 게이트 탈락 중 reappear 사유. 같은 사건이
    // 복수 분야 후보라 중복 관찰될 수 있으므로 lineageId로 1회만 남긴다.
    const reappearBlocked = new Map();
    const gateFailureCounts = new Map();
    for (const [category, run] of Object.entries(out.perCategory)) {
      for (const row of run.excluded.gate) {
        for (const failure of row.gate.failures) {
          gateFailureCounts.set(failure, (gateFailureCounts.get(failure) || 0) + 1);
        }
        if (!row.gate.failures.includes("reappear_no_material_change")) continue;
        const lineageId = row.view.lineage ? row.view.lineage.lineageId : String(row.view.event.eventId);
        if (reappearBlocked.has(lineageId)) {
          reappearBlocked.get(lineageId).categories.push(category);
          continue;
        }
        const prev = lastServed.get(lineageId) || null;
        reappearBlocked.set(lineageId, {
          lineageId,
          eventId: row.view.event.eventId,
          categories: [category],
          fingerprint: row.view.event.factsFingerprint,
          previousServedSlot: prev ? prev.slotId : null,
          previousServedFingerprint: row.view.lineage
            ? row.view.lineage.previousServedFingerprint : null,
          title: row.view.memberArticles[0] && row.view.memberArticles[0].title || "(제목 없음)"
        });
      }
    }

    // 실질 변화로 재통과한 사건 — 계보 승계 + 직전 서빙 지문 존재 + 지문 변천.
    const repassed = selected.filter((row) => row.inherited
      && row.previousServedFingerprint
      && row.previousServedFingerprint !== row.fingerprint)
      .map((row) => ({
        ...row,
        fingerprintTransition: `${row.previousServedFingerprint} → ${row.fingerprint}`,
        previousServedSlot: (lastServed.get(row.lineageId) || {}).slotId || null
      }));
    const repassedIds = new Set(repassed.map((row) => row.lineageId));
    // 신규 사건 — 직전 서빙 지문이 없는 선별(계보 신규 또는 서빙된 적 없음).
    const fresh = selected.filter((row) => !repassedIds.has(row.lineageId));

    slotReports.push({
      slotId: slot.slotId,
      asOf: slot.asOf,
      asOfIso: new Date(slot.asOf).toISOString(),
      counts: {
        inputArticles: out.counts.inputArticles,
        events: out.counts.events,
        selected: selected.length,
        reappearBlocked: reappearBlocked.size,
        repassed: repassed.length,
        fresh: fresh.length,
        perCategorySelected: out.counts.perCategorySelected
      },
      selected,
      reappearBlocked: [...reappearBlocked.values()],
      repassed,
      fresh,
      gateFailureCounts: Object.fromEntries([...gateFailureCounts.entries()].sort())
    });

    // 다음 슬롯으로 상태를 넘긴다 — 도구의 핵심 한 줄.
    previousLineage = out.lineage.records;
    for (const row of selected) {
      lastServed.set(row.lineageId, { slotId: slot.slotId, fingerprint: row.fingerprint });
    }
  }

  // 요약 — 판 간 동일 사건 중복: 같은 lineageId가 두 슬롯 이상에서 **같은
  // 지문으로** 선별되면 중복(성공지표 "판 내 동일 사건 중복 0"의 판 간 확장).
  // 지문이 바뀐 재통과는 중복이 아니라 속보 갱신이다.
  const seen = new Map(); // lineageId → [{ slotId, fingerprint }]
  for (const report of slotReports) {
    for (const row of report.selected) {
      if (!seen.has(row.lineageId)) seen.set(row.lineageId, []);
      seen.get(row.lineageId).push({ slotId: report.slotId, fingerprint: row.fingerprint });
    }
  }
  const crossSlotDuplicates = [];
  for (const [lineageId, entries] of seen) {
    for (let index = 1; index < entries.length; index += 1) {
      if (entries[index].fingerprint === entries[index - 1].fingerprint) {
        crossSlotDuplicates.push({
          lineageId,
          slots: entries.map((entry) => entry.slotId),
          fingerprint: entries[index].fingerprint
        });
        break;
      }
    }
  }

  return { slotReports, crossSlotDuplicates };
}

// ---------------------------------------------------------------------------
// 출력
// ---------------------------------------------------------------------------

function printReport(result, { mode, categories, date, notes }) {
  console.log(`\n모드: ${mode} · 날짜 ${date} · 조합 [${[...categories].sort().join(", ")}]`);
  for (const note of notes) console.log(`  ※ ${note}`);

  for (const report of result.slotReports) {
    console.log(`\n${"=".repeat(78)}\n슬롯 ${report.slotId} · asOf ${report.asOfIso} (KST ${new Date(report.asOf + 9 * 3600000).toISOString().slice(11, 16)})`);
    console.log(`입력 ${report.counts.inputArticles}건 → 사건 ${report.counts.events} · 선별 ${report.counts.selected} · 재등장 차단 ${report.counts.reappearBlocked} · 재통과 ${report.counts.repassed} · 신규 ${report.counts.fresh}`);
    console.log(`분야별 선별: ${JSON.stringify(report.counts.perCategorySelected)}`);

    console.log(`\n── 선별 (${report.selected.length}건)`);
    for (const row of report.selected) {
      console.log(`  [${row.rank}·층${row.tier}·S ${row.S}·${row.categories.join(",")}] ${row.title.slice(0, 52)}`);
    }
    console.log(`\n── 재등장 차단 (${report.reappearBlocked.length}건 — 호르무즈형)`);
    for (const row of report.reappearBlocked) {
      console.log(`  [${row.lineageId}] ${row.title.slice(0, 48)}`);
      console.log(`      └ 직전 서빙 슬롯 ${row.previousServedSlot || "(불명 — 이 실행 밖)"} · 서빙 지문 ${row.previousServedFingerprint} = 현재 지문 ${row.fingerprint}`);
    }
    console.log(`\n── 실질 변화로 재통과 (${report.repassed.length}건)`);
    for (const row of report.repassed) {
      console.log(`  [${row.lineageId}·직전 ${row.previousServedSlot || "?"}] ${row.title.slice(0, 48)}`);
      console.log(`      └ 지문 변천 ${row.fingerprintTransition}`);
    }
    console.log(`\n── 게이트 탈락 사유 분포: ${JSON.stringify(report.gateFailureCounts)}`);
  }

  console.log(`\n${"=".repeat(78)}\n요약`);
  console.log("슬롯       선별  재등장차단  재통과  신규");
  for (const report of result.slotReports) {
    const c = report.counts;
    console.log(`${report.slotId.padEnd(10)} ${String(c.selected).padStart(4)}  ${String(c.reappearBlocked).padStart(8)}  ${String(c.repassed).padStart(6)}  ${String(c.fresh).padStart(4)}`);
  }
  if (result.crossSlotDuplicates.length === 0) {
    console.log("판 간 동일 사건(같은 지문) 중복: 0 — 성공지표 충족");
  } else {
    console.log(`판 간 동일 사건(같은 지문) 중복: ${result.crossSlotDuplicates.length}건 — 게이트 구멍`);
    for (const dup of result.crossSlotDuplicates) {
      console.log(`  [${dup.lineageId}] 슬롯 ${dup.slots.join("→")} · 지문 ${dup.fingerprint}`);
    }
  }
}

// ---------------------------------------------------------------------------
// 실행
// ---------------------------------------------------------------------------

function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === "--date") args.date = argv[++index];
    else if (argv[index] === "--cats") args.cats = String(argv[++index]).split(",").map((v) => v.trim()).filter(Boolean);
    else if (argv[index] === "--mode") args.mode = argv[++index]; // auto|real|snapshot
    else if (argv[index] === "--pool") args.pool = argv[++index];
    // R7 — 슬롯별 경량 영수증을 이 디렉토리에 파일로 남긴다. **기본은 끔**
    // (도구는 여전히 읽기 전용 기본 — 이 옵션을 준 경우에만 지정 디렉토리에 쓴다).
    else if (argv[index] === "--receipts") args.receipts = argv[++index];
    // 코드 버전 식별자(HEAD 커밋 등) — 실행 환경에서 주입. 코드가 git을 직접
    // 호출하지 않는다(R7 계약).
    else if (argv[index] === "--code-version") args.codeVersion = argv[++index];
  }
  return args;
}

// R7 — 영수증 기록기. 파일명: 날짜-슬롯-조합해시8.json (조합해시 = 정렬된
// 카테고리 목록의 SHA-256 앞 8자리). 같은 입력이면 같은 영수증(결정성).
function makeReceiptWriter({ dir, date, categories, poolHash, codeVersion, notes }) {
  if (!dir) return { onBriefing: null, written: [] };
  fs.mkdirSync(dir, { recursive: true });
  const comboHash = sha256Hex([...categories].sort().join(",")).slice(0, 8);
  const written = [];
  const onBriefing = (slot, out) => {
    const { json, hash } = shadowBriefingReceipt(out, { poolHash, codeVersion });
    const file = path.join(dir, `${date}-${slot.slotId}-${comboHash}.json`);
    fs.writeFileSync(file, `${json}\n`);
    written.push({ slotId: slot.slotId, file, hash });
  };
  notes.push(`R7 영수증: ${dir} · 조합해시 ${comboHash} · poolHash ${poolHash ? poolHash.slice(0, 12) : "(없음)"}… · codeVersion ${codeVersion || "(미주입)"}`);
  return { onBriefing, written };
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const categories = args.cats || DEFAULT_EDITORIAL_PREVIEW;
  const registry = loadRegistry();
  const notes = [];

  // .nowhot-local은 읽기 전용으로만 연다(없으면 snapshot 모드로).
  let data = null;
  if (fs.existsSync(LOCAL_DATA_FILE)) {
    data = JSON.parse(fs.readFileSync(LOCAL_DATA_FILE, "utf8"));
  }

  // real 모드 재료 탐색: 날짜 미지정이면 저장 실제판에서 이 조합의 슬롯이
  // 가장 많은 날짜를 고른다.
  let date = args.date || null;
  let plans = null;
  if (data) {
    if (!date) {
      const byDate = new Map();
      for (const row of listServedEditions(data)) {
        if (!byDate.has(row.date)) byDate.set(row.date, 0);
      }
      let best = null;
      for (const candidate of byDate.keys()) {
        const plan = planSlots({ data, date: candidate, categories });
        const found = plan.filter((slot) => slot.servedFound).length;
        if (!best || found > best.found) best = { date: candidate, found, plan };
      }
      if (best) { date = best.date; plans = best.plan; }
    } else {
      plans = planSlots({ data, date, categories });
    }
  }
  const realSlotCount = plans ? plans.filter((slot) => slot.servedFound).length : 0;
  const wantMode = args.mode || "auto";
  const mode = wantMode === "auto"
    ? (realSlotCount >= 2 ? "real" : "snapshot")
    : wantMode;

  let articles;
  let slots;
  let poolRaw = null; // R7 — 영수증 poolHash 재료(풀 파일 원문)
  if (mode === "real") {
    if (realSlotCount < 2) {
      console.log(`real 모드 불가 — 날짜 ${date || "(없음)"}에 이 조합의 저장 실제판 슬롯이 ${realSlotCount}개(2 미만). 모형 대체 금지.`);
      console.log("snapshot 모드로 다시 실행하거나 --date/--cats를 바꿔라.");
      return;
    }
    poolRaw = fs.readFileSync(LOCAL_POOL_FILE, "utf8");
    const pool = JSON.parse(poolRaw);
    articles = articlesFromPool(pool);
    // asOf = 각 실제판의 generatedAt(실제 발행 시각). 없는 슬롯은 건너뛰되
    // "없음"을 정직하게 남긴다.
    slots = [];
    for (const plan of plans) {
      if (!plan.servedFound) {
        notes.push(`슬롯 ${plan.slotId}: 저장 실제판 없음 — 건너뜀(모형 대체 금지)`);
        continue;
      }
      slots.push({ slotId: plan.slotId, asOf: Date.parse(plan.generatedAt) });
    }
    notes.push(`real 모드: asOf = 실제판 generatedAt · 입력 풀 = ${LOCAL_POOL_FILE} (savedAt ${new Date(pool.savedAt).toISOString()})`);
    const maxGapMin = Math.max(...slots.map((slot) => Math.abs(slot.asOf - pool.savedAt))) / 60000;
    if (maxGapMin > 60) {
      notes.push(`⚠ 풀 savedAt과 판 시각의 최대 간격 ${Math.round(maxGapMin)}분 — 그 판이 실제로 본 재료와 다르다. 수치는 방향 관찰용으로만.`);
    }
  } else {
    const poolPath = args.pool || DEFAULT_SNAPSHOT_POOL;
    if (!fs.existsSync(poolPath)) {
      console.log(`snapshot 모드 불가 — 풀 파일 없음: ${poolPath}`);
      return;
    }
    poolRaw = fs.readFileSync(poolPath, "utf8");
    const pool = JSON.parse(poolRaw);
    articles = articlesFromPool(pool);
    if (!date) date = kstDateOf(pool.savedAt || Date.now());
    slots = SLOT_SEQUENCE.map((slot) => ({
      slotId: slot.id, asOf: kstSlotTime(date, slot.publishHour)
    }));
    notes.push(`snapshot 모드: 풀 ${poolPath} (savedAt ${pool.savedAt ? new Date(pool.savedAt).toISOString() : "?"}) · asOf = digest.js SLOTS publishHour(07·12·19 KST)`);
    notes.push("⚠ 같은 풀 3판 시뮬레이션 — 슬롯마다 새 글 유입이 없어 재등장 압력이 실제보다 높다. 차단 수를 실제 비율로 읽지 말 것.");
  }

  // R7 — 영수증(옵션·기본 끔). poolHash는 풀 파일 원문 SHA-256.
  const receiptWriter = makeReceiptWriter({
    dir: args.receipts || null,
    date,
    categories,
    poolHash: poolRaw === null ? null : sha256Hex(poolRaw),
    codeVersion: args.codeVersion || null,
    notes
  });

  console.log(`shadow 연속 관찰 (R4) · 읽기 전용 · 서빙 무접촉 · 기사 ${articles.length}건`);
  const result = runContinuity(articles, {
    slots, categories, registry, onBriefing: receiptWriter.onBriefing
  });
  printReport(result, { mode, categories, date, notes });
  if (receiptWriter.written.length) {
    console.log("\nR7 영수증 기록:");
    for (const row of receiptWriter.written) {
      console.log(`  ${row.slotId.padEnd(8)} ${path.basename(row.file)} · 해시 ${row.hash}`);
    }
  }
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) main();
