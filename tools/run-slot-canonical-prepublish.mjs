import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { isDeepStrictEqual } from "node:util";
import { fileURLToPath, pathToFileURL } from "node:url";

import { validateCategoryRoutingSnapshot } from "../src/feed/category-routing.js";
import {
  activateSlotCanonicalEditions,
  assertSlotCanonicalEdition
} from "../src/feed/slot-canonical-edition.js";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const BUILDER = path.join(ROOT, "tools/build-slot-canonical-edition.mjs");
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

export function runBuilder(job, outDir, {
  allowPaid = false,
  spawn = spawnSync,
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
  if (allowPaid) args.push("--allow-paid");
  const env = { ...environment };
  if (!allowPaid) delete env.ANTHROPIC_API_KEY;
  const result = spawn(process.execPath, args, {
    cwd: ROOT,
    encoding: "utf8",
    env,
    timeout: 30 * 60 * 1000
  });
  if (result.status !== 0) throw new Error(String(result.stderr || result.stdout || "builder failed").trim());
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

async function main() {
  const args = process.argv.slice(2);
  const manifestFile = arg(args, "--manifest");
  if (!manifestFile) throw new Error("usage: --manifest <jobs.json> [--out-dir dir]");
  const resolved = path.resolve(manifestFile);
  const outDir = path.resolve(arg(args, "--out-dir") || path.join(ROOT, ".nowhot-local/slot-editions"));
  const result = await runPrepublishManifest(JSON.parse(fs.readFileSync(resolved, "utf8")), {
    baseDir: path.dirname(resolved), outDir, allowPaid: args.includes("--allow-paid")
  });
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) {
  main().catch((error) => {
    process.stderr.write(`${error.stack || error}\n`);
    process.exitCode = 1;
  });
}
