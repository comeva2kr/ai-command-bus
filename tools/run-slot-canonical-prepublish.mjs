import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";
import { isDeepStrictEqual, promisify } from "node:util";
import { fileURLToPath, pathToFileURL } from "node:url";

import { validateCategoryRoutingSnapshot } from "../src/feed/category-routing.js";
import { nextEditorialSlot, resolveEditorialTarget } from "../src/feed/editorial-inventory.js";
import { loadRegistry } from "../src/feed/registry.js";
import {
  activateSlotCanonicalEditions,
  assertSlotCanonicalEdition
} from "../src/feed/slot-canonical-edition.js";
import { buildRecoveredCategoryRoutingSnapshot } from "./build-category-routing-snapshot.mjs";
import { resolveSlotCanonicalBuildTarget } from "./build-slot-canonical-edition.mjs";
import { buildSelectionShadowPacket } from "./prepare-selection-shadow.mjs";
import { getCandidate } from "./selection-candidate-registry.mjs";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const BUILDER = path.join(ROOT, "tools/build-slot-canonical-edition.mjs");
const COMMUNITIES = path.join(ROOT, "src/feed/communities.json");
const CATEGORY_POLICY = path.join(ROOT, "src/feed/category-admission-policy.json");
const DEFAULT_CANDIDATE = "p14-policy-shadow-haiku-full-nh91-20260828-evening";
const SLOTS = new Set(["morning", "lunch", "evening"]);
const SLOT_ORDER = new Map(["morning", "lunch", "evening"].map((id, index) => [id, index]));
const sha256 = (value) => crypto.createHash("sha256").update(value).digest("hex");
const arg = (args, name) => {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] || null : null;
};
const atomicJson = (file, value) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`);
  fs.renameSync(temporary, file);
};
const serializeJson = (value) => `${JSON.stringify(value, null, 2)}\n`;
const atomicText = (file, value) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(temporary, value);
  fs.renameSync(temporary, file);
};

function normalizeJob(job, baseDir) {
  const editionDate = String(job?.editionDate || "");
  const slotId = String(job?.slotId || "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(editionDate) || !SLOTS.has(slotId)) {
    throw new Error("prepublish: valid editionDate and slotId required");
  }
  const resolve = (value) => value ? path.resolve(baseDir, value) : null;
  const normalized = {
    editionDate,
    slotId,
    pool: resolve(job.pool),
    packet: resolve(job.packet),
    predictions: resolve(job.predictions),
    routingSnapshot: resolve(job.routingSnapshot)
  };
  if (!normalized.pool || !normalized.packet || (!normalized.predictions && !normalized.routingSnapshot)) {
    throw new Error(`prepublish: ${editionDate}:${slotId} input paths required`);
  }
  return normalized;
}

function inputIdentity(job) {
  const files = [job.pool, job.packet, job.predictions || job.routingSnapshot];
  return sha256(JSON.stringify({
    editionDate: job.editionDate,
    slotId: job.slotId,
    files: files.map((file) => sha256(fs.readFileSync(file)))
  }));
}

export function slotAlreadyActive(job, outDir, { allowPaid = false } = {}) {
  const pointerFile = path.join(outDir, "active.json");
  if (!fs.existsSync(pointerFile)) return false;
  try {
    const pointer = JSON.parse(fs.readFileSync(pointerFile, "utf8"));
    const entry = pointer.editions?.[`${job.editionDate}:${job.slotId}`];
    if (!entry?.file) return false;
    const base = path.resolve(path.dirname(pointerFile));
    const artifactFile = path.resolve(base, entry.file);
    if (artifactFile !== base && !artifactFile.startsWith(`${base}${path.sep}`)) return false;
    const artifact = assertSlotCanonicalEdition(JSON.parse(fs.readFileSync(artifactFile, "utf8")));
    if (artifact.artifactId !== entry.artifactId || artifact.contentSha256 !== entry.contentSha256
      || artifact.editionDate !== job.editionDate || artifact.slot?.id !== job.slotId) return false;
    if (allowPaid && artifact.summaryBuildMode !== "paid_allowed") return false;
    const poolRaw = fs.readFileSync(job.pool);
    const packetRaw = fs.readFileSync(job.packet);
    const packet = JSON.parse(packetRaw);
    if (artifact.builderPacketSha256 !== sha256(packetRaw)
      || packet?.sourceSnapshot?.sha256 !== sha256(poolRaw)) return false;
    if (job.predictions) {
      return artifact.routingSnapshot?.source?.predictionsSha256 === sha256(fs.readFileSync(job.predictions));
    }
    return isDeepStrictEqual(
      artifact.routingSnapshot,
      validateCategoryRoutingSnapshot(JSON.parse(fs.readFileSync(job.routingSnapshot, "utf8")))
    );
  } catch {
    return false;
  }
}

export async function runBuilder(job, outDir, {
  allowPaid = false,
  execute = promisify(execFile),
  environment = process.env
} = {}) {
  const args = [
    BUILDER,
    "--pool", job.pool,
    "--packet", job.packet,
    job.predictions ? "--predictions" : "--routing-snapshot",
    job.predictions || job.routingSnapshot,
    "--date", job.editionDate,
    "--slot", job.slotId,
    "--out-dir", outDir
  ];
  // Reuse only a validated earlier edition; cache availability must not block a new build.
  try {
    const pointer = JSON.parse(fs.readFileSync(path.join(outDir, "active.json"), "utf8"));
    const entries = Object.entries(pointer.editions || {}).filter(([key]) => {
      const [date, slot] = key.split(":");
      return date < job.editionDate || date === job.editionDate && SLOT_ORDER.get(slot) <= SLOT_ORDER.get(job.slotId);
    }).sort(([a], [b]) => {
      const [ad, as] = a.split(":");
      const [bd, bs] = b.split(":");
      return ad.localeCompare(bd) || SLOT_ORDER.get(as) - SLOT_ORDER.get(bs);
    });
    const row = entries.at(-1)?.[1];
    if (row) {
      readActiveArtifact(outDir, row);
      args.push("--reuse-edition", path.resolve(outDir, row.file));
    }
  } catch { /* A missing or invalid prior edition is a cache miss. */ }
  if (allowPaid) args.push("--allow-paid");
  const env = { ...environment };
  if (!allowPaid) delete env.ANTHROPIC_API_KEY;
  const result = await execute(process.execPath, args, {
    cwd: ROOT,
    encoding: "utf8",
    env,
    timeout: 30 * 60 * 1000,
    maxBuffer: 1024 * 1024
  });
  const line = String(result.stdout || "").trim().split("\n").at(-1);
  return JSON.parse(line);
}

function activateBuiltCandidates(rows, outDir) {
  const base = path.resolve(outDir);
  const artifacts = rows.map((row) => {
    const candidateFile = path.resolve(row.candidateFile || "");
    if (candidateFile !== base && !candidateFile.startsWith(`${base}${path.sep}`)) {
      throw new Error("prepublish: candidate file escapes output directory");
    }
    const artifact = assertSlotCanonicalEdition(JSON.parse(fs.readFileSync(candidateFile, "utf8")));
    if (artifact.artifactId !== row.artifactId || artifact.contentSha256 !== row.contentSha256) {
      throw new Error("prepublish: candidate identity mismatch");
    }
    return artifact;
  });
  return activateSlotCanonicalEditions({
    artifacts,
    directory: outDir,
    pointerFile: path.join(outDir, "active.json")
  });
}

export async function runPrepublishManifest(manifest, {
  baseDir = ROOT,
  outDir = path.join(ROOT, ".nowhot-local/slot-editions"),
  isActive = slotAlreadyActive,
  runBuild = runBuilder,
  activateBuilt = activateBuiltCandidates,
  allowPaid = false
} = {}) {
  if (!Array.isArray(manifest?.jobs) || !manifest.jobs.length) throw new Error("prepublish: jobs required");
  const jobs = manifest.jobs.map((job) => normalizeJob(job, baseDir)).sort((a, b) =>
    a.editionDate.localeCompare(b.editionDate) || SLOT_ORDER.get(a.slotId) - SLOT_ORDER.get(b.slotId));
  const unique = new Set(jobs.map((job) => `${job.editionDate}:${job.slotId}`));
  if (unique.size !== jobs.length) throw new Error("prepublish: duplicate date-slot job");
  const results = [];
  const built = [];
  for (const job of jobs) {
    const identity = inputIdentity(job);
    if (await isActive(job, outDir, { allowPaid })) {
      results.push({ editionDate: job.editionDate, slotId: job.slotId, state: "already_active", inputIdentity: identity });
      continue;
    }
    try {
      const result = { ...(await runBuild(job, outDir, { allowPaid })), inputIdentity: identity };
      built.push(result);
      results.push(result);
    } catch (error) {
      const receipt = {
        state: "hold",
        editionDate: job.editionDate,
        slotId: job.slotId,
        inputIdentity: identity,
        error: String(error?.message || error)
      };
      atomicJson(path.join(outDir,
        `prepublish-hold-${job.editionDate}-${job.slotId}-${identity.slice(0, 12)}.json`), receipt);
      throw new Error(`prepublish: ${job.slotId} ${receipt.error}`);
    }
  }
  if (built.length) {
    let activation;
    try {
      activation = await activateBuilt(built, outDir);
    } catch (error) {
      const identity = sha256(JSON.stringify(built.map((row) => ({
        editionDate: row.editionDate,
        slotId: row.slotId,
        artifactId: row.artifactId || null,
        contentSha256: row.contentSha256 || null
      }))));
      const receipt = {
        state: "hold",
        stage: "activation",
        identity,
        error: String(error?.message || error)
      };
      atomicJson(path.join(outDir, `prepublish-hold-activation-${identity.slice(0, 12)}.json`), receipt);
      throw new Error(`prepublish: activation ${receipt.error}`);
    }
    const activatedFiles = activation?.artifactFiles || [];
    built.forEach((row, index) => {
      row.state = "activated";
      row.activatedFile = activatedFiles[index] || row.activatedFile || null;
    });
  }
  return { state: "complete", jobs: results };
}

function readActiveArtifact(outDir, row) {
  if (!row?.file) throw new Error("prepublish: active canonical artifact required");
  const base = path.resolve(outDir);
  const artifactFile = path.resolve(base, row.file);
  if (artifactFile !== base && !artifactFile.startsWith(`${base}${path.sep}`)) {
    throw new Error("prepublish: active artifact escapes output directory");
  }
  const artifact = assertSlotCanonicalEdition(JSON.parse(fs.readFileSync(artifactFile, "utf8")));
  if (artifact.artifactId !== row.artifactId || artifact.contentSha256 !== row.contentSha256) {
    throw new Error("prepublish: active artifact identity mismatch");
  }
  return artifact;
}

function latestActiveRoutingSnapshot(outDir, pointer) {
  const entries = Object.entries(pointer?.editions || {}).sort(([left], [right]) => {
    const [leftDate, leftSlot] = left.split(":");
    const [rightDate, rightSlot] = right.split(":");
    return leftDate.localeCompare(rightDate) || SLOT_ORDER.get(leftSlot) - SLOT_ORDER.get(rightSlot);
  });
  const [, row] = entries.at(-1) || [];
  if (!row) throw new Error("prepublish: active canonical routing required");
  const artifact = readActiveArtifact(outDir, row);
  return validateCategoryRoutingSnapshot(artifact.routingSnapshot);
}

export async function runDueSlotPrepublish({
  nowMs = Date.now(),
  poolFile,
  outDir = path.join(ROOT, ".nowhot-local/slot-editions"),
  workDir = null,
  candidateId = DEFAULT_CANDIDATE,
  runManifest = runPrepublishManifest,
  allowPaid = false
} = {}) {
  if (!poolFile) throw new Error("prepublish: current pool file required");
  const resolvedPool = path.resolve(poolFile);
  const resolvedOut = path.resolve(outDir);
  const poolRaw = fs.readFileSync(resolvedPool, "utf8");
  const pool = JSON.parse(poolRaw);
  const nextTarget = nextEditorialSlot(nowMs);
  const target = nextTarget.asOfMs - nowMs <= 20 * 60_000 ? nextTarget : resolveEditorialTarget(nowMs);
  const pointer = JSON.parse(fs.readFileSync(path.join(resolvedOut, "active.json"), "utf8"));
  const activeRow = pointer?.editions?.[`${target.date}:${target.slot.id}`];
  if (activeRow) {
    const artifact = readActiveArtifact(resolvedOut, activeRow);
    return {
      state: "already_active",
      editionDate: target.date,
      slotId: target.slot.id,
      artifactId: artifact.artifactId,
      paidCalls: 0
    };
  }
  resolveSlotCanonicalBuildTarget({
    pool,
    editionDate: target.date,
    slotId: target.slot.id
  });
  const priorSnapshot = latestActiveRoutingSnapshot(resolvedOut, pointer);
  const registryRaw = fs.readFileSync(COMMUNITIES, "utf8");
  const policyRaw = fs.readFileSync(CATEGORY_POLICY, "utf8");
  const packet = buildSelectionShadowPacket(pool, {
    candidate: getCandidate(candidateId),
    registry: loadRegistry(),
    sourceSnapshotSha256: sha256(poolRaw)
  });
  const packetRaw = serializeJson(packet);
  const predictions = {
    generatedAt: new Date(Number(pool.savedAt)).toISOString(),
    candidate: { candidateId },
    results: []
  };
  const predictionsRaw = serializeJson(predictions);
  const priorRaw = serializeJson(priorSnapshot);
  const routingSnapshot = buildRecoveredCategoryRoutingSnapshot(
    packet,
    predictions,
    priorSnapshot,
    loadRegistry(),
    {
      packetSha256: sha256(packetRaw),
      predictionsSha256: sha256(predictionsRaw),
      priorSnapshotSha256: sha256(priorRaw),
      registrySha256: sha256(registryRaw),
      categoryPolicySha256: sha256(policyRaw)
    }
  );
  const resolvedWork = path.resolve(workDir || path.join(
    path.dirname(resolvedOut), "slot-prepublish", `${target.date}-${target.slot.id}`
  ));
  const frozenPoolFile = path.join(resolvedWork, "pool.json");
  const packetFile = path.join(resolvedWork, "packet.json");
  const routingSnapshotFile = path.join(resolvedWork, "routing.json");
  // Collection can continue while the child builds; keep packet and pool bytes paired.
  atomicText(frozenPoolFile, poolRaw);
  atomicText(packetFile, packetRaw);
  atomicText(routingSnapshotFile, serializeJson(routingSnapshot));
  const manifest = {
    jobs: [{
      editionDate: target.date,
      slotId: target.slot.id,
      pool: frozenPoolFile,
      packet: packetFile,
      routingSnapshot: routingSnapshotFile
    }]
  };
  const result = await runManifest(manifest, {
    baseDir: resolvedWork,
    outDir: resolvedOut,
    allowPaid
  });
  return {
    state: result.state,
    editionDate: target.date,
    slotId: target.slot.id,
    routingCounts: routingSnapshot.counts,
    paidCalls: allowPaid ? null : 0,
    result
  };
}

async function main() {
  const args = process.argv.slice(2);
  const manifestFile = arg(args, "--manifest");
  const outDir = path.resolve(arg(args, "--out-dir") || path.join(ROOT, ".nowhot-local/slot-editions"));
  const allowPaid = args.includes("--allow-paid");
  let result;
  if (manifestFile) {
    const resolved = path.resolve(manifestFile);
    result = await runPrepublishManifest(JSON.parse(fs.readFileSync(resolved, "utf8")), {
      baseDir: path.dirname(resolved), outDir, allowPaid
    });
  } else {
    const poolFile = arg(args, "--pool");
    if (!poolFile) throw new Error("usage: --manifest <jobs.json> | --pool <current-pool.json> [--out-dir dir] [--work-dir dir]");
    const now = arg(args, "--now");
    result = await runDueSlotPrepublish({
      nowMs: now ? Date.parse(now) : Date.now(),
      poolFile,
      outDir,
      workDir: arg(args, "--work-dir"),
      candidateId: arg(args, "--candidate") || DEFAULT_CANDIDATE,
      allowPaid
    });
  }
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) {
  main().catch((error) => {
    process.stderr.write(`${error.stack || error}\n`);
    process.exitCode = 1;
  });
}
