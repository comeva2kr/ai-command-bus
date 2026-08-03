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

export function makeIndexNow({ key, host, fetchImpl = fetch, clock = () => Date.now(), log = console } = {}) {
  if (!key || !host) return { ping: async () => ({ skipped: "not configured" }) };
  // 스로틀 상태는 **인스턴스별**로 둔다. 모듈 전역에 두면 서로 다른 설정의
  // 인스턴스가 남의 통보 이력 때문에 조용히 눌린다(테스트에서 실제로 그랬다).
  const lastSent = new Map();

  return {
    async ping(paths = []) {
      const now = clock();
      const urlList = [];
      for (const p of paths) {
        const abs = p.startsWith("http") ? p : `https://${host}${p}`;
        // has()로 확인한다 — get()||0 으로 쓰면 "보낸 적 없음"이 "시각 0에 보냄"과
        // 같아져 **첫 통보가 눌린다**(실제로 그랬다). 실클럭에서는 now가 커서
        // 드러나지 않지만 로직은 틀린 것이고, 시각을 주입하는 순간 터진다.
        if (lastSent.has(abs) && now - lastSent.get(abs) < MIN_INTERVAL_MS) continue;
        lastSent.set(abs, now);
        urlList.push(abs);
      }
      if (!urlList.length) return { skipped: "throttled" };

      let res;
      try {
        res = await fetchImpl(ENDPOINT, {
          method: "POST",
          headers: { "content-type": "application/json; charset=utf-8" },
          body: JSON.stringify({ host, key, keyLocation: `https://${host}/${key}.txt`, urlList }),
          signal: AbortSignal.timeout(8000)
        });
      } catch (e) {
        log.error?.("[indexnow] 통보 실패(무시):", e && e.message);
        return { error: String(e && e.message) };
      }
      // 200/202 = 접수. 그 외는 본문을 버리고 로그만 남긴다.
      if (!res.ok) {
        discardBody(res);
        log.error?.(`[indexnow] ${res.status} — 통보 거부됨`);
        return { status: res.status };
      }
      discardBody(res);
      return { ok: true, count: urlList.length };
    }
  };
}
