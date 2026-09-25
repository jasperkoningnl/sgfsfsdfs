// Reliability diagram as SVG markup. Only numbers go into the markup, never
// user text, so the result is safe to assign to innerHTML.

const W = 340;
const H = 300;
const M = { top: 14, right: 14, bottom: 44, left: 54 };
const PW = W - M.left - M.right;
const PH = H - M.top - M.bottom;
const TICKS = [0, 0.2, 0.4, 0.6, 0.8, 1];

const x = (v) => M.left + v * PW;
const y = (v) => M.top + (1 - v) * PH;
const r1 = (v) => Math.round(v * 10) / 10;
const pct = (v) => `${Math.round(v * 100)}%`;

function pointRadius(n) {
  return Math.min(4 + 2.2 * Math.sqrt(n), 13);
}

function polygon(points, cls) {
  const d = points.map(([px, py]) => `${r1(x(px))},${r1(y(py))}`).join(' ');
  return `<polygon class="${cls}" points="${d}" fill="currentColor"/>`;
}

/**
 * @param bins output of calibrationBins()
 * @returns SVG string with a viewBox, scaling to its container width
 */
export function reliabilityDiagram(bins) {
  const parts = [];
  parts.push(
    `<svg class="rd" viewBox="0 0 ${W} ${H}" role="img" aria-labelledby="rd-title rd-desc" xmlns="http://www.w3.org/2000/svg">`,
    '<title id="rd-title">Calibration chart</title>',
    '<desc id="rd-desc">Each dot compares the average chance you gave with how often those predictions came true. Dots on the diagonal are perfectly calibrated.</desc>',
  );

  // Overconfident zones: said likely but it happened less often, or said
  // unlikely but it happened more often.
  parts.push(polygon([[0.5, 0], [1, 0], [1, 1], [0.5, 0.5]], 'rd-zone'));
  parts.push(polygon([[0, 0], [0, 1], [0.5, 1], [0.5, 0.5]], 'rd-zone'));
  parts.push(
    `<text class="rd-zone-label" x="${r1(x(0.97))}" y="${r1(y(0.04))}" text-anchor="end">Overconfident</text>`,
    `<text class="rd-zone-label" x="${r1(x(0.03))}" y="${r1(y(0.96) + 9)}" text-anchor="start">Overconfident</text>`,
  );

  for (const t of TICKS) {
    parts.push(
      `<line class="rd-grid" x1="${r1(x(t))}" y1="${r1(y(0))}" x2="${r1(x(t))}" y2="${r1(y(1))}" fill="none"/>`,
      `<line class="rd-grid" x1="${r1(x(0))}" y1="${r1(y(t))}" x2="${r1(x(1))}" y2="${r1(y(t))}" fill="none"/>`,
      `<text class="rd-tick" x="${r1(x(t))}" y="${r1(y(0) + 17)}" text-anchor="middle">${pct(t)}</text>`,
      `<text class="rd-tick" x="${r1(x(0) - 8)}" y="${r1(y(t) + 4)}" text-anchor="end">${pct(t)}</text>`,
    );
  }

  parts.push(
    `<text class="rd-axis" x="${r1(x(0.5))}" y="${H - 6}" text-anchor="middle">Chance you gave</text>`,
    `<text class="rd-axis" transform="translate(13 ${r1(y(0.5))}) rotate(-90)" text-anchor="middle">How often it happened</text>`,
    `<line class="rd-diagonal" x1="${r1(x(0))}" y1="${r1(y(0))}" x2="${r1(x(1))}" y2="${r1(y(1))}" fill="none"/>`,
  );

  const filled = bins.filter((b) => b.n > 0);
  if (filled.length > 1) {
    const d = filled
      .map((b, i) => `${i ? 'L' : 'M'}${r1(x(b.meanForecast))},${r1(y(b.observedRate))}`)
      .join(' ');
    parts.push(`<path class="rd-line" d="${d}" fill="none"/>`);
  }
  for (const b of filled) {
    const label = `${b.lo}–${b.hi}%: ${b.n} prediction${b.n === 1 ? '' : 's'}, average chance ${pct(b.meanForecast)}, came true ${pct(b.observedRate)}`;
    parts.push(
      `<circle class="rd-point" cx="${r1(x(b.meanForecast))}" cy="${r1(y(b.observedRate))}" r="${r1(pointRadius(b.n))}" fill="currentColor"><title>${label}</title></circle>`,
    );
  }

  parts.push('</svg>');
  return parts.join('');
}
