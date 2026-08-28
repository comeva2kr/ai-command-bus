// 지출 — API 실비와 고정비를 같은 자리에서 본다.
//
// ── 왜 (2026-08-04, David "관리자 페이지는 유지보수비, api 호출비 등 지출에
//    대한 관리도 동시에 가능해야한다")
//
// 수익만 보면 흑자처럼 보인다. 우리는 지금 Claude API를 브리핑 해설과 광고
// 문구 행렬에 쓰고 VM을 돌린다 — 이 둘을 빼지 않은 매출은 순이익이 아니다.
// 그리고 LLM 비용은 호출 수에 비례해 늘어나므로, 트래픽이 커질수록 "매출은
// 늘었는데 남는 게 줄어드는" 구간이 생길 수 있다. 그 구간을 미리 보려면
// 지출을 수익과 같은 시간축에 올려야 한다.
//
// ── 두 종류를 구분한다
//   실비(variable) — LLM 호출. 토큰 수 × 공개 단가로 **실측 계산**한다.
//                    호출할 때마다 그 자리에서 기록하므로 추정이 아니다.
//   고정비(fixed)  — VM, 도메인 등. 우리가 자동으로 알 길이 없으므로
//                    David가 월 단위로 직접 입력한다. 입력 전에는 0이 아니라
//                    "미입력"으로 표시한다 — 0으로 두면 순이익이 부풀어 보인다.

// 공개 단가 (USD / 100만 토큰). 임의 추정치를 넣지 않는다 — 목록에 없는
// 모델로 호출하면 비용을 null로 남기고 "단가 미등록"으로 보고한다.
// 출처: Anthropic 공개 가격표 (2026-06 기준).
export const MODEL_PRICING = {
  "claude-opus-5": { in: 5.0, out: 25.0 },
  "claude-sonnet-5": { in: 3.0, out: 15.0 },
  "claude-sonnet-4-6": { in: 3.0, out: 15.0 },
  "claude-haiku-4-5": { in: 1.0, out: 5.0 },
  "claude-haiku-4-5-20251001": { in: 1.0, out: 5.0 },
  "claude-fable-5": { in: 10.0, out: 50.0 }
};

// 환율은 우리가 실측할 수 없다. 표시용 참고값으로만 쓰고, 원장은 USD로 남긴다.
// 화면에서는 두 통화를 함께 보여주되 원화 쪽에 "참고" 표시를 붙인다.
export const USD_KRW_REFERENCE = Number(process.env.USD_KRW || 1380);

export function costOf(model, inputTokens, outputTokens) {
  const p = MODEL_PRICING[model];
  if (!p) return null; // 단가를 모르면 지어내지 않는다
  const i = Number(inputTokens) || 0;
  const o = Number(outputTokens) || 0;
  return (i / 1e6) * p.in + (o / 1e6) * p.out;
}

export function emptyCostBucket() {
  return { calls: 0, inputTokens: 0, outputTokens: 0, usd: 0, unpriced: 0, byModel: {}, byPurpose: {} };
}

// LLM 호출 한 건 기록. purpose는 "briefing" / "admatrix" 처럼 무엇에 썼는지다 —
// 어느 기능이 돈을 먹는지 갈라 봐야 줄일 대상을 정할 수 있다.
export function recordCall(bucket, { model, inputTokens, outputTokens, purpose }) {
  const b = bucket;
  b.calls += 1;
  const i = Number(inputTokens) || 0, o = Number(outputTokens) || 0;
  b.inputTokens += i; b.outputTokens += o;
  const usd = costOf(model, i, o);
  if (usd == null) b.unpriced += 1; else b.usd += usd;

  const m = String(model || "unknown").slice(0, 40);
  if (!b.byModel[m]) b.byModel[m] = { calls: 0, usd: 0, inputTokens: 0, outputTokens: 0 };
  b.byModel[m].calls += 1; b.byModel[m].inputTokens += i; b.byModel[m].outputTokens += o;
  if (usd != null) b.byModel[m].usd += usd;

  const p = String(purpose || "기타").slice(0, 40);
  if (!b.byPurpose[p]) b.byPurpose[p] = { calls: 0, usd: 0 };
  b.byPurpose[p].calls += 1;
  if (usd != null) b.byPurpose[p].usd += usd;
  return b;
}

export function mergeCostBuckets(list) {
  const out = emptyCostBucket();
  for (const b of list) {
    if (!b) continue;
    out.calls += b.calls || 0;
    out.inputTokens += b.inputTokens || 0;
    out.outputTokens += b.outputTokens || 0;
    out.usd += b.usd || 0;
    out.unpriced += b.unpriced || 0;
    for (const [k, v] of Object.entries(b.byModel || {})) {
      if (!out.byModel[k]) out.byModel[k] = { calls: 0, usd: 0, inputTokens: 0, outputTokens: 0 };
      out.byModel[k].calls += v.calls || 0; out.byModel[k].usd += v.usd || 0;
      out.byModel[k].inputTokens += v.inputTokens || 0; out.byModel[k].outputTokens += v.outputTokens || 0;
    }
    for (const [k, v] of Object.entries(b.byPurpose || {})) {
      if (!out.byPurpose[k]) out.byPurpose[k] = { calls: 0, usd: 0 };
      out.byPurpose[k].calls += v.calls || 0; out.byPurpose[k].usd += v.usd || 0;
    }
  }
  return out;
}

// 고정비: { "2026-08": [{ label, krw }] }. 그 달의 일수로 나눠 일할 계산한다.
export function daysInMonth(monthKey) {
  const [y, m] = monthKey.split("-").map(Number);
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

export function fixedForRange(fixedByMonth, days) {
  // days는 'YYYY-MM-DD' 배열. 각 날짜에 그 달 고정비의 1일치를 얹는다.
  let krw = 0;
  let missingMonths = new Set();
  for (const d of days) {
    const mk = d.slice(0, 7);
    const entries = (fixedByMonth || {})[mk];
    if (!entries || !entries.length) { missingMonths.add(mk); continue; }
    const monthly = entries.reduce((s, e) => s + (Number(e.krw) || 0), 0);
    krw += monthly / daysInMonth(mk);
  }
  return { krw, missingMonths: [...missingMonths] };
}

// 한 기간의 손익. 수익(krw)은 호출자가 넘긴다 — 쿠팡 정산은 우리가 자동으로
// 못 읽으므로 David 입력값이거나 0이다. 어느 쪽인지 화면에서 밝힌다.
export function profitAndLoss({ costBucket, fixedByMonth, days, revenueKrw = null, usdKrw = USD_KRW_REFERENCE }) {
  const variableUsd = costBucket ? costBucket.usd : 0;
  const variableKrw = variableUsd * usdKrw;
  const { krw: fixedKrw, missingMonths } = fixedForRange(fixedByMonth, days);
  const totalKrw = variableKrw + fixedKrw;
  return {
    variableUsd,
    variableKrw: Math.round(variableKrw),
    fixedKrw: Math.round(fixedKrw),
    totalKrw: Math.round(totalKrw),
    revenueKrw,
    // 수익이 입력되지 않았으면 순이익을 계산하지 않는다. 0으로 두면
    // "적자 -N원"이라는 틀린 결론이 나온다.
    netKrw: revenueKrw == null ? null : Math.round(revenueKrw - totalKrw),
    fixedMissingMonths: missingMonths,
    usdKrwReference: usdKrw,
    unpricedCalls: costBucket ? costBucket.unpriced : 0
  };
}
