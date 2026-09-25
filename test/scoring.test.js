import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  brierScore,
  brierTerm,
  calibrationBins,
  confidenceCheck,
  decompose,
  scoresByTag,
} from '../site/js/scoring.js';
import { examplePredictions } from '../site/js/examples.js';

const p = (probability, outcome, tag = '') => ({ probability, outcome, tag });
const close = (actual, expected, eps = 1e-12) =>
  assert.ok(Math.abs(actual - expected) < eps, `${actual} is not close to ${expected}`);

test('brierTerm is the squared distance between forecast and outcome', () => {
  close(brierTerm(p(70, 'yes')), 0.09);
  close(brierTerm(p(70, 'no')), 0.49);
  close(brierTerm(p(100, 'yes')), 0);
  close(brierTerm(p(0, 'yes')), 1);
});

test('brierScore averages resolved predictions and ignores open and void ones', () => {
  const result = brierScore([p(70, 'yes'), p(70, 'no'), p(90, null), p(10, 'void')]);
  assert.equal(result.n, 2);
  close(result.score, (0.09 + 0.49) / 2);
});

test('brierScore is null with nothing resolved', () => {
  assert.deepEqual(brierScore([p(60, null)]), { score: null, n: 0 });
});

test('always answering 50% scores 0.25 whatever happens', () => {
  const result = brierScore([p(50, 'yes'), p(50, 'no'), p(50, 'no')]);
  close(result.score, 0.25);
});

test('Murphy decomposition adds up to the Brier score exactly', () => {
  for (const set of [
    examplePredictions(new Date('2026-06-01T12:00:00Z')),
    [p(90, 'yes'), p(90, 'no'), p(90, 'yes'), p(20, 'no'), p(20, 'yes'), p(55, 'yes')],
    [p(100, 'yes'), p(0, 'no')],
  ]) {
    const parts = decompose(set);
    close(parts.brier, brierScore(set).score);
  }
});

test('decomposition terms have the expected values on a small case', () => {
  // Two groups: 80% (3 yes, 1 no) and 20% (0 yes, 2 no). Base rate 3/6.
  const set = [p(80, 'yes'), p(80, 'yes'), p(80, 'yes'), p(80, 'no'), p(20, 'no'), p(20, 'no')];
  const parts = decompose(set);
  close(parts.baseRate, 0.5);
  close(parts.uncertainty, 0.25);
  close(parts.reliability, (4 * (0.8 - 0.75) ** 2 + 2 * (0.2 - 0) ** 2) / 6);
  close(parts.resolution, (4 * (0.75 - 0.5) ** 2 + 2 * (0 - 0.5) ** 2) / 6);
});

test('decompose returns null with nothing resolved', () => {
  assert.equal(decompose([]), null);
});

test('calibrationBins puts 100% in the top bin and keeps empty bins', () => {
  const bins = calibrationBins([p(100, 'yes'), p(95, 'no'), p(5, 'no'), p(50, 'void')]);
  assert.equal(bins.length, 10);
  assert.equal(bins[9].n, 2);
  close(bins[9].meanForecast, 0.975);
  close(bins[9].observedRate, 0.5);
  assert.equal(bins[0].n, 1);
  assert.equal(bins[5].n, 0);
  assert.equal(bins[5].meanForecast, null);
});

test('confidenceCheck needs a minimum number of leaning predictions', () => {
  const result = confidenceCheck([p(90, 'no'), p(50, 'yes')]);
  assert.equal(result.n, 1);
  assert.equal(result.verdict, 'too-few');
});

test('confidenceCheck treats a low forecast that fails as a hit', () => {
  const result = confidenceCheck([p(10, 'no'), p(20, 'no'), p(30, 'no'), p(40, 'no'), p(25, 'no')], {
    minN: 1,
  });
  assert.equal(result.hits, 5);
  close(result.meanConfidence, (0.9 + 0.8 + 0.7 + 0.6 + 0.75) / 5);
});

test('confidenceCheck flags clear overconfidence', () => {
  // Twenty 90% calls, only ten right: z is far below -2.
  const set = [...Array(10).fill(p(90, 'yes')), ...Array(10).fill(p(90, 'no'))];
  const result = confidenceCheck(set);
  assert.equal(result.verdict, 'overconfident');
  close(result.gap, 0.4);
  assert.ok(result.z < -2);
});

test('confidenceCheck flags clear underconfidence', () => {
  const set = Array(20).fill(p(60, 'yes'));
  assert.equal(confidenceCheck(set).verdict, 'underconfident');
});

test('confidenceCheck does not over-read small gaps', () => {
  // 8 of 10 at 70%: a little lucky, well within chance.
  const set = [...Array(8).fill(p(70, 'yes')), ...Array(2).fill(p(70, 'no'))];
  assert.equal(confidenceCheck(set).verdict, 'consistent');
});

test('confidenceCheck handles certain forecasts without dividing by zero', () => {
  const miss = confidenceCheck([...Array(5).fill(p(100, 'yes')), p(0, 'yes')]);
  assert.equal(miss.verdict, 'overconfident');
  const perfect = confidenceCheck(Array(5).fill(p(100, 'yes')));
  assert.equal(perfect.verdict, 'consistent');
});

test('scoresByTag skips untagged predictions and sorts by count', () => {
  const rows = scoresByTag([p(80, 'yes', 'work'), p(60, 'no', 'work'), p(70, 'yes', 'home'), p(50, 'yes')]);
  assert.deepEqual(
    rows.map((r) => [r.tag, r.n]),
    [
      ['work', 2],
      ['home', 1],
    ],
  );
});
