import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createPrediction,
  groupPredictions,
  mergePredictions,
  normalizePrediction,
  parseJournal,
  reopenPrediction,
  resolvePrediction,
  serializeJournal,
  toISODate,
} from '../site/js/journal.js';
import { examplePredictions } from '../site/js/examples.js';
import { claudeBackend, localBackend, LOCAL_KEY, UNREADABLE_KEY } from '../site/js/storage.js';

const NOW = new Date('2026-09-25T09:00:00Z');

function make(overrides = {}, id = 'a') {
  return createPrediction(
    { statement: 'It rains tomorrow', probability: 70, resolveBy: '2026-09-26', ...overrides },
    NOW,
    id,
  );
}

test('createPrediction cleans input and starts open', () => {
  const pred = make({ statement: '  It   rains\ntomorrow ', tag: ' Weather ', notes: ' dark clouds ' });
  assert.equal(pred.statement, 'It rains tomorrow');
  assert.equal(pred.tag, 'weather');
  assert.equal(pred.notes, 'dark clouds');
  assert.equal(pred.outcome, null);
  assert.equal(pred.createdAt, NOW.toISOString());
});

test('createPrediction rejects bad input with readable messages', () => {
  assert.throws(() => make({ statement: '   ' }), /Write down/);
  assert.throws(() => make({ probability: 101 }), /0 to 100/);
  assert.throws(() => make({ probability: 33.3 }), /whole number/);
  assert.throws(() => make({ resolveBy: '2026-02-30' }), /valid date/);
});

test('the check date is optional', () => {
  assert.equal(make({ resolveBy: '' }).resolveBy, null);
});

test('resolving keeps statement and probability and can be undone', () => {
  const pred = make();
  const done = resolvePrediction(pred, 'no', NOW);
  assert.equal(done.outcome, 'no');
  assert.equal(done.probability, 70);
  assert.equal(done.statement, pred.statement);
  assert.deepEqual(reopenPrediction(done), { ...pred });
  assert.throws(() => resolvePrediction(pred, 'maybe'), /Unknown outcome/);
});

test('journal survives a round trip through the file format', () => {
  const preds = [make(), resolvePrediction(make({}, 'b'), 'yes', NOW)];
  const { predictions, skipped } = parseJournal(serializeJournal(preds));
  assert.equal(skipped, 0);
  assert.deepEqual(predictions, preds);
});

test('parseJournal skips broken and duplicate rows instead of failing', () => {
  const good = make();
  const text = JSON.stringify({
    app: 'hindsight',
    version: 1,
    predictions: [good, good, { id: 'x', statement: 'no probability', createdAt: NOW.toISOString() }, null],
  });
  const { predictions, skipped } = parseJournal(text);
  assert.equal(predictions.length, 1);
  assert.equal(skipped, 3);
});

test('parseJournal refuses files that are not a journal', () => {
  assert.throws(() => parseJournal('not json'), /not valid JSON/);
  assert.throws(() => parseJournal('{"hello":1}'), /does not contain/);
  assert.throws(() => parseJournal('{"app":"other","predictions":[]}'), /not made by Hindsight/);
  assert.throws(() => parseJournal('{"app":"hindsight","version":99,"predictions":[]}'), /newer version/);
});

test('normalizePrediction drops an outcome it does not recognise', () => {
  const pred = normalizePrediction({ ...make(), outcome: 'maybe', resolvedAt: NOW.toISOString() });
  assert.equal(pred.outcome, null);
  assert.equal(pred.resolvedAt, null);
});

test('merging never overwrites what is already in the journal', () => {
  const existing = [resolvePrediction(make(), 'yes', NOW)];
  const backup = [make(), make({}, 'b')];
  const merged = mergePredictions(existing, backup);
  assert.equal(merged.added, 1);
  assert.equal(merged.kept, 1);
  assert.equal(merged.predictions.find((p) => p.id === 'a').outcome, 'yes');
});

test('groupPredictions separates due, open and resolved', () => {
  const today = '2026-09-25';
  const preds = [
    make({ resolveBy: '2026-09-20' }, 'overdue'),
    make({ resolveBy: '2026-09-25' }, 'today'),
    make({ resolveBy: '2026-10-01' }, 'later'),
    make({ resolveBy: '' }, 'undated'),
    resolvePrediction(make({}, 'old'), 'yes', new Date('2026-09-01T00:00:00Z')),
    resolvePrediction(make({}, 'new'), 'no', new Date('2026-09-10T00:00:00Z')),
  ];
  const groups = groupPredictions(preds, today);
  assert.deepEqual(groups.due.map((p) => p.id), ['overdue', 'today']);
  assert.deepEqual(groups.open.map((p) => p.id), ['later', 'undated']);
  assert.deepEqual(groups.resolved.map((p) => p.id), ['new', 'old']);
});

test('toISODate uses the local calendar date', () => {
  assert.equal(toISODate(new Date(2026, 0, 5, 23, 30)), '2026-01-05');
});

test('example predictions are valid records with every outcome type', () => {
  const examples = examplePredictions(NOW);
  for (const ex of examples) assert.ok(normalizePrediction(ex), ex.id);
  const outcomes = new Set(examples.map((e) => e.outcome));
  assert.deepEqual([...outcomes].sort(), [null, 'no', 'void', 'yes'].sort());
  const today = toISODate(NOW);
  assert.equal(groupPredictions(examples, today).due.length, 1);
});

test('localBackend round-trips and survives a storage that throws', async () => {
  const map = new Map();
  const storage = { getItem: (k) => map.get(k) ?? null, setItem: (k, v) => map.set(k, v) };
  const backend = localBackend(storage);
  assert.equal(await backend.load(), null);
  await backend.save([make()]);
  assert.ok(map.has(LOCAL_KEY));
  assert.deepEqual(await backend.load(), [make()]);

  const broken = localBackend({
    getItem() {
      throw new Error('blocked');
    },
    setItem() {
      throw new Error('full');
    },
  });
  assert.equal(await broken.load(), null);
  await assert.rejects(broken.save([make()]), /refused to save/);
});

test('localBackend sets unreadable data aside instead of letting it be overwritten', async () => {
  const future = JSON.stringify({ app: 'hindsight', version: 2, predictions: [] });
  const map = new Map([[LOCAL_KEY, future]]);
  const storage = { getItem: (k) => map.get(k) ?? null, setItem: (k, v) => map.set(k, v) };
  await assert.rejects(localBackend(storage).load(), /newer version.*unreadable/);
  assert.equal(map.get(UNREADABLE_KEY), future);
});

test('claudeBackend is absent outside claude.ai', async () => {
  assert.equal(await claudeBackend(undefined), null);
  assert.equal(await claudeBackend({ use: async () => null }), null);
});

test('claudeBackend stores the journal under the viewer’s private path, one write at a time', async () => {
  const writes = [];
  let active = 0;
  let maxActive = 0;
  let stored;
  const ref = {
    async get() {
      return { exists: stored !== undefined, data: () => stored };
    },
    async set(body) {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await new Promise((r) => setTimeout(r, 5));
      stored = body;
      writes.push(body.predictions.length);
      active -= 1;
    },
  };
  let path;
  const claude = {
    async use(name) {
      if (name === 'db') return { doc: (p) => ((path = p), ref) };
      if (name === 'user') return { id: async () => 'viewer-1' };
      return null;
    },
  };

  const backend = await claudeBackend(claude);
  assert.equal(path, 'data/users/viewer-1/journal');
  assert.equal(await backend.load(), null);

  const one = [make()];
  const two = [make(), make({}, 'b')];
  const three = [make(), make({}, 'b'), make({}, 'c')];
  await Promise.all([backend.save(one), backend.save(two), backend.save(three)]);
  assert.equal(maxActive, 1);
  assert.equal(writes.at(-1), 3);
  assert.ok(writes.length <= 2, `expected bursts to collapse, got ${writes.length} writes`);
  assert.deepEqual(await backend.load(), three);
});
