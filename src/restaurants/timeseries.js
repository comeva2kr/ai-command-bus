// Time-series rating-spike anomaly (Xie et al., "Review Spam Detection via
// Temporal Pattern Discovery", KDD 2012). Xie's insight: a spam attack shows up
// as a spike in review VOLUME that is correlated with an abnormal shift in
// average RATING. This catches manipulation on an otherwise-established venue —
// a long, healthy history plus a sudden recent cluster of inflated 5★ reviews —
// which whole-span burst detection misses (the spike is small relative to the
// long history, so the global burst fraction stays low).

const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);

// Bucket reviews into 30-day windows and look for a volume spike whose rating
// is anomalously higher than the rest of the history.
export function timeSeriesAnomaly(reviews) {
  const clean = reviews.filter((r) => !(r.paid || r.type === "sponsored"));
  const empty = { anomaly: false, spikeShare: 0, ratingLift: 0, spikeMean: 0 };
  if (clean.length < 8) return empty;

  const days = clean.map((r) => r.daysAgo ?? 0);
  const span = Math.max(...days) - Math.min(...days);
  if (span < 60) return empty; // need real history to define a baseline

  const buckets = new Map(); // 30-day bucket index -> [ratings]
  for (const r of clean) {
    const b = Math.floor((r.daysAgo ?? 0) / 30);
    if (!buckets.has(b)) buckets.set(b, []);
    buckets.get(b).push(r.rating ?? 5);
  }
  const groups = [...buckets.values()];
  let maxi = 0;
  for (let i = 1; i < groups.length; i++) if (groups[i].length > groups[maxi].length) maxi = i;

  const spikeShare = groups[maxi].length / clean.length;
  const spikeMean = mean(groups[maxi]);
  const rest = groups.filter((_, i) => i !== maxi).flat();
  const baseMean = rest.length ? mean(rest) : spikeMean;
  const ratingLift = spikeMean - baseMean;

  // Volume concentrated in one window AND that window rated well above baseline.
  const anomaly = spikeShare >= 0.33 && ratingLift >= 0.4 && spikeMean >= 4.6;
  return {
    anomaly,
    spikeShare: Number(spikeShare.toFixed(2)),
    ratingLift: Number(ratingLift.toFixed(2)),
    spikeMean: Number(spikeMean.toFixed(2))
  };
}

export default timeSeriesAnomaly;
