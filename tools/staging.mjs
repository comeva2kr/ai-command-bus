// 로컬 스테이징 — 라이브에 올리기 전에 여기서 먼저 본다.
//
// ── 왜 만들었나 (David 2026-08-06)
// "이걸 업데이트 할 때 라이브로 도는 거 말고 내부 실측용으로 하나 똑같이 해서
//  테스트해 보고 괜찮으면 배포하는 식으로 하는 게 어떨까? 다른 개발사들도
//  다 그런 식으로 하지 않아?"
//
// 맞는 지적이다. 그날 잡힌 사고가 **전부 배포 뒤에 발견됐다**:
//   · 온보딩 오버레이가 메뉴 클릭을 통째로 먹던 것 (새로 온 사람일수록 메뉴를 못 씀)
//   · 광고 카드가 깨진 것 (David가 실기기에서 발견)
//   · 홈 TTFB 4초 (현지 님 제보)
//   · 교차보도를 두 번 "고쳤다"고 배포했는데 둘 다 라이브에서 안 통함
//
// 그리고 더 나쁜 것: **배포 자체가 수집을 끊고 있었다.** 실측(2026-08-06) —
// 풀 저장 시각이 09:59에서 11:19까지 멈춰 있었고, 로그에
// `TimeoutError: The operation was aborted due to timeout`이 떠 있었다.
// 84개 소스를 도는 수집이 끝나기 전에 재배포로 컨테이너가 재시작되기를 반복했다.
// 그날 배포를 열 번 넘게 했다.
//
// ── 왜 서버를 하나 더 띄우지 않나
// 운영 VM은 1 vCPU / 1GB / 25GB($6/월)다. 같은 서버에 두 벌을 띄우면 둘 다 느려지고,
// 스테이징이 운영 수집을 방해한다 — 고치려는 문제를 그대로 재현하는 셈이다.
// 로컬(개발 Mac)에서 같은 코드를 **실수집 모드로** 띄우면 서버 비용이 0이고,
// 배포가 수집을 끊는 문제도 사라진다.
//
// ── 쓰는 법
//   node tools/staging.mjs            실수집으로 로컬 서버를 띄우고 점검까지 돌린다
//   node tools/staging.mjs --keep     점검 후 서버를 살려 둔다(브라우저로 눌러보려면)
//   node tools/staging.mjs --port 4100
//
// 운영 데이터는 건드리지 않는다. 스토어·풀 파일을 별도 경로에 쓴다.

import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const argv = process.argv.slice(2);
const keep = argv.includes("--keep");
const portIdx = argv.indexOf("--port");
const PORT = portIdx >= 0 ? Number(argv[portIdx + 1]) : 4100;
const BASE = `http://127.0.0.1:${PORT}`;

// 운영과 **다른 파일**을 쓴다. 실수로 운영 스토어를 덮어쓰면 가입자·댓글이 날아간다.
const DIR = path.join(os.tmpdir(), "nowhot-staging");
fs.mkdirSync(DIR, { recursive: true });

const env = {
  ...process.env,
  PORT: String(PORT),
  FEED_LIVE: "1",                       // 실제로 수집한다 — 목업으로는 수집 사고를 못 잡는다
  FEED_DB: path.join(DIR, "feed.json"),
  FEED_POOL_FILE: path.join(DIR, "feed-pool.json"),
  // 광고는 미리보기로 켠다. 자격증명 없이도 카드가 그려져야 구조를 볼 수 있다
  // (실제 파트너 키는 넣지 않는다 — 스테이징에서 발생한 노출이 운영 집계에 섞이면 안 된다).
  AD_PREVIEW: process.env.AD_PREVIEW || "1",
  ADMIN_TOKEN: process.env.ADMIN_TOKEN || "staging"
};

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function upWithin(ms) {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    try {
      const r = await fetch(`${BASE}/api/health`, { signal: AbortSignal.timeout(2000) });
      if (r.ok) return true;
    } catch { /* 아직 안 떴다 */ }
    await wait(500);
  }
  return false;
}

// 수집이 **끝났는지**를 본다. 뜨자마자 점검하면 풀이 비어 있어 전부 실패한다 —
// 그리고 그게 바로 운영에서 겪은 사고의 모양이다(배포 직후 수집 미완료).
async function poolReady(maxMs) {
  const until = Date.now() + maxMs;
  let last = 0;
  while (Date.now() < until) {
    try {
      const j = await (await fetch(`${BASE}/api/communities`, { signal: AbortSignal.timeout(5000) })).json();
      const live = (j.communities || []).filter((c) => (c.liveCount || 0) > 0).length;
      const total = (j.communities || []).reduce((a, c) => a + (c.liveCount || 0), 0);
      if (live !== last) {
        console.log(`  수집 중… 소스 ${live}곳 · ${total}건`);
        last = live;
      }
      // 소스가 20곳 이상 채워지면 점검할 만하다. 전부를 기다리면 느린 곳 하나에 묶인다.
      if (live >= 20) return { live, total };
    } catch { /* 아직 */ }
    await wait(3000);
  }
  return { live: last, total: 0 };
}

console.log(`스테이징 — ${BASE}`);
console.log(`데이터: ${DIR} (운영과 분리)\n`);

const srv = spawn(process.execPath, ["src/feed/server.js"], {
  env, stdio: ["ignore", "pipe", "pipe"]
});
let serverLog = "";
const keepLog = (buf) => {
  const s = String(buf);
  serverLog += s;
  // 수집·헬스 로그는 그대로 보여 준다 — 여기서 사고가 먼저 보인다.
  for (const line of s.split("\n")) {
    if (/\[feed\]|\[health\]|unhandled|uncaught|Error/i.test(line) && line.trim()) {
      console.log(`  ${line.trim().slice(0, 160)}`);
    }
  }
};
srv.stdout.on("data", keepLog);
srv.stderr.on("data", keepLog);

const stop = () => { try { srv.kill("SIGTERM"); } catch {} };
process.on("SIGINT", () => { stop(); process.exit(130); });
// SIGTERM도 받는다 — 없으면 `kill <pid>`나 프로세스 매니저가 보낼 때
// Node 기본 동작(즉시 종료)으로 finally가 안 돌아 자식 서버가 좀비로 남는다.
process.on("SIGTERM", () => { stop(); process.exit(143); });

let code = 0;
try {
  if (!(await upWithin(30000))) {
    console.error("서버가 30초 안에 뜨지 않았습니다.");
    console.error(serverLog.slice(-1200));
    stop();
    process.exit(1);
  }
  console.log("서버 기동 OK. 수집을 기다립니다 (최대 5분)…");
  const { live, total } = await poolReady(5 * 60 * 1000);
  if (live < 5) {
    console.error(`\n수집이 거의 안 됐습니다 — 소스 ${live}곳. 이 상태로 점검하면 전부 실패합니다.`);
    console.error("네트워크 또는 어댑터 문제일 수 있습니다. 위 로그를 보세요.");
    stop();
    process.exit(1);
  }
  console.log(`수집 OK — 소스 ${live}곳 · ${total}건\n`);

  // ── 운영과 다른 점을 **먼저 말한다**
  //
  // 스테이징이 운영과 다르면 그 차이만큼 못 잡는다. 조용히 통과시키는 것이
  // 가장 나쁘다 — "스테이징 통과"를 믿고 올렸는데 운영에서 터진다.
  // 쿠팡 자격증명은 **서버 .env에만** 둔다(David 원칙: 시크릿을 화면·로컬로
  // 옮기지 않는다). 그래서 로컬에는 없고, 광고 후보가 만들어지지 않는다.
  const noPartner = !process.env.COUPANG_PARTNER_ID;
  // 번역도 운영과 다르다 — docker-compose는 FEED_TRANSLATE=1을 켜지만 여기는 없다.
  // 해외 소스(하입비스트·랍스터스·라이브도어 등)가 원문 그대로 보인다.
  if (!process.env.FEED_TRANSLATE) {
    console.log("※ 번역이 꺼져 있습니다 — 해외 소스는 원문(영어·일본어)으로 보입니다.");
    console.log("  운영은 FEED_TRANSLATE=1이라 한국어로 나갑니다. 번역 결과를 보려면");
    console.log("  FEED_TRANSLATE=1 과 번역 키를 넣고 다시 실행하세요.\n");
  }
  if (noPartner) {
    console.log("※ 이 스테이징에 없는 것: 쿠팡 파트너 자격증명(서버 .env 전용).");
    console.log("  → 광고 슬롯 관련 점검은 여기서 통과할 수 없습니다. 그 항목은");
    console.log("     운영 배포 직후 autodeploy의 preflight가 확인합니다.");
    console.log("  → 나머지 항목(피드·페이지·자체 콘텐츠·애드핏 지면·렌더러 일관성)은");
    console.log("     여기서 그대로 유효합니다.\n");
  }

  // 배포 전 점검을 **로컬 대상으로** 돌린다. 운영에 올리기 전에 같은 검사를 통과시킨다.
  console.log("배포 전 점검을 로컬에 돌립니다…\n");
  const pre = spawn(process.execPath, ["tools/preflight.mjs", BASE], { stdio: "inherit" });
  code = await new Promise((r) => pre.on("close", r));

  // 자격증명이 없어서 실패한 항목만 남았다면, 그것은 코드 결함이 아니라
  // 환경 차이다. 다만 **통과했다고 말하지는 않는다** — 별도 종료코드로 구분한다.
  if (code !== 0 && noPartner) {
    console.log("\n※ 실패 항목이 광고 슬롯뿐이라면 자격증명이 없어서입니다(코드 결함 아님).");
    console.log("  위 목록에서 광고 외 항목이 전부 OK인지 눈으로 확인하세요.");
    code = 2;   // 0(통과)도 1(실패)도 아닌 "환경 차이로 일부 미검증"
  }

  if (keep) {
    console.log(`\n서버를 살려 둡니다 — ${BASE}`);
    console.log("브라우저로 열어 메뉴·피드·광고를 직접 눌러 보세요. 끝내려면 Ctrl+C.");
    await new Promise(() => {});   // 사용자가 끊을 때까지
  }
} finally {
  if (!keep) stop();
}

console.log(
  code === 0 ? "\n스테이징 점검 통과 — 배포해도 됩니다."
  : code === 2 ? "\n일부 항목 미검증(자격증명 없음) — 광고 외 항목을 눈으로 확인한 뒤 배포하세요."
  : "\n스테이징 점검 실패 — 배포하지 마세요.");
process.exit(code);
