// 소스 헬스 — 수집이 조용히 죽는 것을 잡는다.
//
// ── 왜 만들었나 (2026-08-04)
// David 질문("html 로 가져오는거에 단점이나 부담이나 위험성은 없는건가")에
// 답하면서 정리한 결론: HTML 파싱의 최대 위험은 **조용히 깨지는 것**이다.
// RSS는 스펙이 고정이라 잘 안 깨지지만 HTML은 사이트 개편 한 번에 0건이
// 되고, 아무도 모른다. 실제로 그날 실측에서 47개 소스 중 17곳이 0건이었고
// 언제부터 그랬는지 아무 기록이 없었다.
//
// ── 그런데 "0건"만으로는 부족했다
// 같은 조사에서 더 나쁜 실패 모드가 나왔다. **건수는 정상인데 숫자만 0인**
// 경우다:
//   이토랜드  38건 수집 · 추천/댓글 전부 0 (JSON-LD를 읽고 있었다 — 거기엔 숫자가 없다)
//   인스티즈  20건 수집 · 추천/댓글 전부 0 (숫자가 없는 블록을 읽고 있었다)
//   보배드림  19건 수집 · 추천만 0        (정규식은 맞는데 창이 좁아 못 닿았다)
//   뽐뿌      20건 수집 · 추천만 0        (같은 원인)
// 건수만 보는 헬스체크는 이 넷을 전부 "정상"으로 보고한다. 그런데 화제성
// 순위에서 신호 0은 사실상 탈락이라, 커뮤니티가 통째로 뉴스에 밀린다.
// 그래서 이 모듈은 **건수와 신호를 따로 본다.**
//
// ── 판정 원칙: "원래 없었다"와 "있다가 사라졌다"를 구분한다
// 뉴스 RSS는 추천·댓글을 원래 주지 않는다. 그걸 고장이라 부르면 경보가
// 매일 울려서 아무도 안 본다. 반대로 **어제까지 신호가 있던 소스가 오늘 0**
// 이면 그건 거의 확실히 파서 고장이다. 그래서 판정 기준은 절대값이 아니라
// 그 소스 자신의 과거다 — 마지막으로 신호가 있었던 시각을 기억해 둔다.
//
// 여기서 만드는 건 판정과 근거뿐이고, 알림을 어디로 보낼지는 호출자가 정한다.
// 실측 안 된 숫자는 만들지 않는다 — 세지 못한 건 null로 남긴다.

// 파서가 반응 수치를 **읽으려고 시도하는지** — 설정에 정규식이 있는가.
// RSS나 정규식이 없는 소스는 신호가 0이어도 고장이 아니다.
export function expectsSignal(entry) {
  const a = entry && entry.adapter;
  if (!a) return false;
  const l = a.list;
  if (l && (l.scoreRegex || l.commentRegex)) return true;
  // list 외 어댑터(api/json 등)도 반응 수치를 실을 수 있다 — 명시 플래그로만 인정.
  return a.expectsSignal === true;
}

// 이번 수집 사이클의 소스별 실측치. items는 이 소스의 현재 풀 아이템 배열.
export function sampleSources(items, registry) {
  const by = new Map();
  for (const entry of registry) {
    if (entry.enabled === false) continue;
    by.set(entry.id, { id: entry.id, label: entry.labelKo || entry.label || entry.id, kind: entry.kind || null, items: 0, withSignal: 0, expectsSignal: expectsSignal(entry) });
  }
  for (const it of items) {
    const e = by.get(it.source);
    if (!e) continue;
    e.items++;
    if ((Number(it.score) || 0) + (Number(it.commentCount) || 0) > 0) e.withSignal++;
  }
  return [...by.values()];
}

const DAY = 24 * 3600 * 1000;

// 판정. prior는 이 소스의 지난 기록 { lastItemsAt, lastSignalAt } (없으면 null).
//
//   down        건수 0이 DOWN_AFTER_MS 이상 지속 — 수집 자체가 죽었다
//   stalled     건수 0이지만 아직 유예 안 — 일시적 실패일 수 있다
//   signal-lost 건수는 있는데 신호가 0이고, 과거엔 신호가 있었다 — 파서 고장
//   no-signal   건수는 있고 신호가 0인데, 정규식이 애초에 없다 — 정상(뉴스 RSS 등)
//   ok          정상
export function classify(sample, prior, now, opts = {}) {
  const downAfter = opts.downAfterMs ?? DAY;
  const signalLostAfter = opts.signalLostAfterMs ?? DAY;
  const lastItemsAt = prior && prior.lastItemsAt;
  const lastSignalAt = prior && prior.lastSignalAt;

  if (sample.items === 0) {
    // 한 번도 성공한 적이 없으면 기준 시각이 없다 — 유예 중으로 본다.
    // 없는 시각을 지어내 "3일째 죽음"이라고 쓰지 않는다.
    const since = Number.isFinite(lastItemsAt) ? lastItemsAt : null;
    const downFor = since == null ? null : now - since;
    return {
      status: downFor != null && downFor >= downAfter ? "down" : "stalled",
      reason: since == null ? "수집 성공 기록이 없다" : `${Math.floor(downFor / 3600e3)}시간째 0건`,
      since, downFor
    };
  }
  if (sample.withSignal === 0 && sample.expectsSignal) {
    const since = Number.isFinite(lastSignalAt) ? lastSignalAt : null;
    const lostFor = since == null ? null : now - since;
    if (since == null) {
      // 정규식은 있는데 성공한 적이 한 번도 없다 = 처음부터 안 맞는 정규식.
      return { status: "signal-lost", reason: "반응 수치 정규식이 있으나 한 번도 매칭된 적이 없다", since: null, lostFor: null };
    }
    if (lostFor >= signalLostAfter) {
      return { status: "signal-lost", reason: `${Math.floor(lostFor / 3600e3)}시간째 반응 수치가 0 — 마크업이 바뀐 것으로 보인다`, since, lostFor };
    }
    return { status: "stalled", reason: "반응 수치가 0이지만 아직 유예 안", since, lostFor };
  }
  if (sample.withSignal === 0) {
    return { status: "no-signal", reason: "이 소스는 반응 수치를 제공하지 않는다(정규식 없음)", since: null };
  }
  return { status: "ok", reason: null, since: null };
}

// 사이클 한 번의 전체 판정. prior는 store에 저장된 { id: {lastItemsAt, lastSignalAt} }.
// 판정 결과와 **갱신된 기록**을 함께 돌려준다 — 호출자가 저장한다.
export function evaluate(samples, priors, now, opts = {}) {
  const report = [];
  const next = {};
  for (const s of samples) {
    const prior = priors && priors[s.id];
    const verdict = classify(s, prior, now, opts);
    report.push({ ...s, ...verdict });
    next[s.id] = {
      lastItemsAt: s.items > 0 ? now : (prior && prior.lastItemsAt) || null,
      lastSignalAt: s.withSignal > 0 ? now : (prior && prior.lastSignalAt) || null
    };
  }
  // 나쁜 것부터. 관리자가 위에서부터 읽으면 되도록.
  const order = { down: 0, "signal-lost": 1, stalled: 2, "no-signal": 3, ok: 4 };
  report.sort((a, b) => order[a.status] - order[b.status] || a.id.localeCompare(b.id));
  return { report, next };
}

// 한 줄 요약 — 서버 로그와 관리자 화면 상단에 같은 문장을 쓴다.
export function summarize(report) {
  const n = (s) => report.filter((r) => r.status === s).length;
  return {
    total: report.length,
    down: n("down"),
    signalLost: n("signal-lost"),
    stalled: n("stalled"),
    noSignal: n("no-signal"),
    ok: n("ok")
  };
}
