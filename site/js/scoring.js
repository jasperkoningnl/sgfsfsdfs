// Scoring for binary probability forecasts.
//
// A prediction carries `probability` (0-100, the stated chance that the
// statement comes true) and `outcome` ('yes', 'no', 'void' or null while
// open). Only 'yes' and 'no' count towards any score.

/** Predictions with a definite outcome. */
export function scorable(predictions) {
  return predictions.filter((p) => p.outcome === 'yes' || p.outcome === 'no');
}

function forecast(p) {
  return p.probability / 100;
}

function observed(p) {
  return p.outcome === 'yes' ? 1 : 0;
}

/** Squared error of one resolved prediction: (f - o)^2, between 0 and 1. */
export function brierTerm(p) {
  const d = forecast(p) - observed(p);
  return d * d;
}

/**
 * Mean Brier score (Brier 1950), single-outcome form: 0 is perfect, 0.25 is
 * what always answering 50% earns, 1 is certain and wrong every time.
 * Returns { score, n }; score is null when nothing is resolved yet.
 */
export function brierScore(predictions) {
  const resolved = scorable(predictions);
  const n = resolved.length;
  if (n === 0) return { score: null, n };
  let sum = 0;
  for (const p of resolved) sum += brierTerm(p);
  return { score: sum / n, n };
}

/**
 * Murphy (1973) partition: brier = reliability - resolution + uncertainty.
 * Forecasts are grouped by their exact stated probability, which makes the
 * identity exact rather than approximate.
 */
export function decompose(predictions) {
  const resolved = scorable(predictions);
  const n = resolved.length;
  if (n === 0) return null;

  const groups = new Map();
  let hits = 0;
  for (const p of resolved) {
    const g = groups.get(p.probability) ?? { f: forecast(p), n: 0, hits: 0 };
    g.n += 1;
    g.hits += observed(p);
    groups.set(p.probability, g);
    hits += observed(p);
  }

  const baseRate = hits / n;
  let reliability = 0;
  let resolution = 0;
  for (const g of groups.values()) {
    const rate = g.hits / g.n;
    reliability += g.n * (g.f - rate) ** 2;
    resolution += g.n * (rate - baseRate) ** 2;
  }
  reliability /= n;
  resolution /= n;
  const uncertainty = baseRate * (1 - baseRate);

  return {
    n,
    baseRate,
    reliability,
    resolution,
    uncertainty,
    brier: reliability - resolution + uncertainty,
  };
}

/**
 * Groups resolved predictions into equal-width probability bins for a
 * reliability diagram. 100% falls into the top bin. Empty bins are kept
 * (n = 0, averages null) so callers can show the full scale.
 */
export function calibrationBins(predictions, binCount = 10) {
  const width = 100 / binCount;
  const bins = Array.from({ length: binCount }, (_, i) => ({
    lo: i * width,
    hi: (i + 1) * width,
    n: 0,
    sumForecast: 0,
    hits: 0,
  }));
  for (const p of scorable(predictions)) {
    const i = Math.min(Math.floor(p.probability / width), binCount - 1);
    bins[i].n += 1;
    bins[i].sumForecast += forecast(p);
    bins[i].hits += observed(p);
  }
  return bins.map(({ lo, hi, n, sumForecast, hits }) => ({
    lo,
    hi,
    n,
    hits,
    meanForecast: n ? sumForecast / n : null,
    observedRate: n ? hits / n : null,
  }));
}

/**
 * Over/underconfidence check. For every resolved prediction that leaned one
 * way (anything but 50%), take the confidence in the favoured side and
 * whether that side happened.
 *
 * If the forecaster were perfectly calibrated, each favoured side would
 * come true with exactly its stated confidence, so the number of hits has
 * mean sum(c) and variance sum(c(1 - c)). `z` measures how far the actual
 * hits fall from that: z <= -2 reads as overconfident, z >= 2 as
 * underconfident, anything in between as no clear sign either way.
 */
export function confidenceCheck(predictions, { minN = 5, zLimit = 2 } = {}) {
  const leaning = scorable(predictions).filter((p) => p.probability !== 50);
  const n = leaning.length;
  let expected = 0;
  let variance = 0;
  let hits = 0;
  for (const p of leaning) {
    const favoursYes = p.probability > 50;
    const c = favoursYes ? forecast(p) : 1 - forecast(p);
    expected += c;
    variance += c * (1 - c);
    if ((p.outcome === 'yes') === favoursYes) hits += 1;
  }

  const result = {
    n,
    hits,
    meanConfidence: n ? expected / n : null,
    hitRate: n ? hits / n : null,
    gap: n ? (expected - hits) / n : null, // positive = more sure than right
    z: null,
    verdict: 'too-few',
  };
  if (n < minN) return result;

  if (variance === 0) {
    // Only 0% and 100% forecasts: any miss at all is overconfidence.
    result.verdict = hits < expected ? 'overconfident' : 'consistent';
    return result;
  }
  result.z = (hits - expected) / Math.sqrt(variance);
  if (result.z <= -zLimit) result.verdict = 'overconfident';
  else if (result.z >= zLimit) result.verdict = 'underconfident';
  else result.verdict = 'consistent';
  return result;
}

/** Brier score per tag, most-used tags first. Untagged predictions are skipped. */
export function scoresByTag(predictions) {
  const byTag = new Map();
  for (const p of scorable(predictions)) {
    if (!p.tag) continue;
    const list = byTag.get(p.tag) ?? [];
    list.push(p);
    byTag.set(p.tag, list);
  }
  return [...byTag.entries()]
    .map(([tag, list]) => ({ tag, ...brierScore(list) }))
    .sort((a, b) => b.n - a.n || a.tag.localeCompare(b.tag));
}
