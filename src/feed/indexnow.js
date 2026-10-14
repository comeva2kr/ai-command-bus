// IndexNow — 새 콘텐츠를 검색엔진에 **우리가 먼저 알린다**.
//
// 네이버 웹마스터 공지(2023-07-25) "네이버 검색에서 IndexNow 프로토콜을
// 지원합니다". 빙도 같은 엔드포인트를 쓴다. 크롤러가 우리를 방문할 때까지
// 기다리는 대신, 브리핑이 갱신될 때마다 통보한다 — 하루 3회 갱신되는 구조에서
// 색인 지연이 곧 유입 손실이기 때문이다.
//
// 비용 0, 키 파일 하나로 소유 증명. 실패해도 서비스에 영향이 없어야 하므로
// 모든 오류를 삼키되 로그는 남긴다.
import { discardBody } from "./fetchers.js";

const ENDPOINT = "https://api.indexnow.org/IndexNow";

// 과도한 통보는 스팸으로 취급될 수 있다. 같은 URL은 최소 간격을 두고 보낸다.
const MIN_INTERVAL_MS = 6 * 3600 * 1000; // 6시간
const MAX_BATCH = 100;
const MAX_SENT = 1000;

export function makeIndexNow({ key, host, fetchImpl = fetch, clock = () => Date.now(), log = console,
  initialSent = [], onPersist = null } = {}) {
  if (!key || !host) return { ping: async () => ({ skipped: "not configured" }) };
  // 스로틀 상태는 **인스턴스별**로 둔다. 모듈 전역에 두면 서로 다른 설정의
  // 인스턴스가 남의 통보 이력 때문에 조용히 눌린다(테스트에서 실제로 그랬다).
  let origin;
  try { const target = new URL(`https://${host}`); origin = target.origin; host = target.host; }
  catch { return { ping: async () => ({ skipped: "invalid host" }) }; }
  const publicUrl = value => {
    if (typeof value !== "string") return null;
    try {
      const url = new URL(value, origin);
      return url.origin === origin && !url.username && !url.password && !url.search && !url.hash
        && !/^\/(api|admin)(\/|$)/.test(url.pathname) ? url.href : null;
    } catch { return null; }
  };
  const isVersion = value => typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
  const lastSent = new Map((Array.isArray(initialSent) ? initialSent : []).filter(row =>
    Array.isArray(row) && publicUrl(row[0]) === row[0] && Number.isFinite(row[1])
    && row[1] <= clock() && (isVersion(row[2]) || (row[2] == null && clock() - row[1] < MIN_INTERVAL_MS)))
    .slice(-MAX_SENT).map(([url, at, version]) => [url, { at, version: version || null }]));
  let pending = false;
  let checkpointPending = false;
  async function persistCheckpoint() {
    if (!onPersist) return true;
    try {
      await onPersist([...lastSent].map(([url, row]) => [url, row.at, row.version]));
      checkpointPending = false;
      return true;
    } catch {
      checkpointPending = true;
      log.error?.("[indexnow] 접수됐지만 체크포인트 저장 실패");
      return false;
    }
  }

  return {
    async ping(paths = []) {
      if (pending) return { skipped: "in progress" };
      const now = clock();
      for (const [url, row] of lastSent) if (!row.version && now - row.at >= MIN_INTERVAL_MS) lastSent.delete(url);
      const urlList = [];
      const versions = new Map();
      for (const p of paths) {
        const version = typeof p === "string" ? null : p?.version;
        if (typeof p !== "string" && !isVersion(version)) continue;
        const abs = publicUrl(typeof p === "string" ? p : p.path);
        if (!abs || urlList.includes(abs)) continue;
        // has()로 확인한다 — get()||0 으로 쓰면 "보낸 적 없음"이 "시각 0에 보냄"과
        // 같아져 **첫 통보가 눌린다**(실제로 그랬다). 실클럭에서는 now가 커서
        // 드러나지 않지만 로직은 틀린 것이고, 시각을 주입하는 순간 터진다.
        const previous = lastSent.get(abs);
        if (previous && (version ? previous.version === version : now - previous.at < MIN_INTERVAL_MS)) continue;
        urlList.push(abs);
        versions.set(abs, version);
        if (urlList.length === MAX_BATCH) break;
      }
      if (!urlList.length) {
        if (!checkpointPending) return { skipped: "throttled" };
        pending = true;
        try { return { skipped: "throttled", persisted: await persistCheckpoint() }; }
        finally { pending = false; }
      }

      let res;
      pending = true;
      try {
        res = await fetchImpl(ENDPOINT, {
          method: "POST",
          headers: { "content-type": "application/json; charset=utf-8" },
          body: JSON.stringify({ host, key, keyLocation: `${origin}/${key}.txt`, urlList }),
          signal: AbortSignal.timeout(8000)
        });
      } catch (e) {
        pending = false;
        log.error?.("[indexnow] 통보 실패(무시):", e && e.message);
        return { error: String(e && e.message) };
      }
      // 200/202 = 접수. 그 외는 본문을 버리고 로그만 남긴다.
      if (![200, 202].includes(res.status)) {
        pending = false;
        discardBody(res);
        log.error?.(`[indexnow] ${res.status} — 통보 거부됨`);
        return { status: res.status };
      }
      discardBody(res);
      for (const url of urlList) lastSent.set(url, { at: now, version: versions.get(url) });
      // shortcut: 최신 세 판이 1,000주소를 넘으면 체크포인트 상한을 재검토한다.
      while (lastSent.size > MAX_SENT) lastSent.delete(lastSent.keys().next().value);
      const persisted = await persistCheckpoint();
      pending = false;
      log.info?.(`[indexnow] ${res.status} — ${urlList.length}개 주소 접수`);
      return { ok: true, status: res.status, count: urlList.length, ...(persisted ? {} : {persisted:false}) };
    }
  };
}
