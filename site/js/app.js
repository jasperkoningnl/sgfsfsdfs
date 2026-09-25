import { brierScore, brierTerm, calibrationBins, confidenceCheck, decompose, scoresByTag } from './scoring.js';
import {
  addDays,
  createPrediction,
  groupPredictions,
  mergePredictions,
  parseJournal,
  reopenPrediction,
  resolvePrediction,
  serializeJournal,
  tagsIn,
  toISODate,
} from './journal.js';
import { examplePredictions } from './examples.js';
import { reliabilityDiagram } from './chart.js';
import { claudeBackend, localBackend } from './storage.js';

const RESOLVED_PREVIEW = 8;

const state = {
  predictions: [],
  backend: localBackend(),
  examples: examplePredictions(),
  showAllResolved: false,
  changedSinceLoad: false,
};

const $ = (selector) => document.querySelector(selector);

// ---------- small helpers ----------

function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value == null || value === false) continue;
    if (key === 'class') el.className = value;
    else if (key === 'text') el.textContent = value;
    else el.setAttribute(key, value === true ? '' : String(value));
  }
  for (const child of children.flat()) {
    if (child == null || child === false) continue;
    el.append(child instanceof Node ? child : String(child));
  }
  return el;
}

const fixed3 = (v) => v.toFixed(3);
const percent = (v) => `${Math.round(v * 100)}%`;

function parseLocalDate(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d);
}

function formatDate(value) {
  const date = value.length === 10 ? parseLocalDate(value) : new Date(value);
  const sameYear = date.getFullYear() === new Date().getFullYear();
  return date.toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: sameYear ? undefined : 'numeric',
  });
}

function daysBetween(fromISO, toISO) {
  return Math.round((parseLocalDate(toISO) - parseLocalDate(fromISO)) / 86400000);
}

function inWords(probability) {
  if (probability === 0) return 'Certain it won’t happen';
  if (probability === 100) return 'Certain it will happen';
  const gcd = (a, b) => (b ? gcd(b, a % b) : a);
  const g = gcd(probability, 100);
  return `${probability / g} in ${100 / g}`;
}

let toastTimer;
function toast(message, kind = 'info') {
  const el = $('#toast');
  el.textContent = message;
  el.classList.toggle('is-error', kind === 'error');
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (el.hidden = true), kind === 'error' ? 7000 : 3500);
}

// Two-step confirmation inside the page: first click arms, second click acts.
function confirmClick(button, armedLabel, action) {
  if (button.classList.contains('is-armed')) {
    clearTimeout(button._disarm);
    action();
    return;
  }
  const original = button.textContent;
  button.classList.add('is-armed');
  button.textContent = armedLabel;
  button._disarm = setTimeout(() => {
    button.classList.remove('is-armed');
    button.textContent = original;
  }, 4000);
}

// ---------- data ----------

const isExampleMode = () => state.predictions.length === 0;
const visible = () => (isExampleMode() ? state.examples : state.predictions);

async function commit(predictions) {
  state.predictions = predictions;
  state.changedSinceLoad = true;
  render();
  try {
    await state.backend.save(predictions);
  } catch (error) {
    toast(error.message, 'error');
  }
}

function update(id, change) {
  return commit(state.predictions.map((p) => (p.id === id ? change(p) : p)));
}

// ---------- rendering ----------

function render() {
  const predictions = visible();
  const example = isExampleMode();
  $('#example-banner').hidden = !example;
  $('#export').disabled = example;
  $('#delete-all').disabled = example;

  renderScoreboard(predictions);
  renderLists(predictions, example);
  renderStats(predictions);
  renderTagOptions();
}

function renderScoreboard(predictions) {
  const { score, n } = brierScore(predictions);
  const groups = groupPredictions(predictions);
  const voided = groups.resolved.length - n;

  $('#brier-value').textContent = score == null ? '–' : fixed3(score);
  $('#brier-meter').hidden = score == null;
  if (score != null) {
    $('#brier-marker').style.left = `${(Math.min(score, 0.5) / 0.5) * 100}%`;
    const vsCoin =
      score < 0.25
        ? 'Better than answering 50% every time.'
        : score > 0.25
          ? 'Worse than answering 50% every time.'
          : 'The same as answering 50% every time.';
    $('#brier-note').textContent = `${vsCoin} Lower is better.`;
  } else {
    $('#brier-note').textContent = 'Settle a prediction to get a score.';
  }

  const check = confidenceCheck(predictions);
  const valueEl = $('#confidence-value');
  valueEl.classList.remove('is-over', 'is-under');
  const words = {
    'too-few': 'Not enough yet',
    consistent: 'No clear bias',
    overconfident: 'Overconfident',
    underconfident: 'Underconfident',
  };
  valueEl.textContent = words[check.verdict];
  if (check.verdict === 'overconfident') valueEl.classList.add('is-over');
  if (check.verdict === 'underconfident') valueEl.classList.add('is-under');
  $('#confidence-note').textContent =
    check.n === 0
      ? 'Needs settled predictions that lean one way (not 50%).'
      : `You were ${percent(check.meanConfidence)} sure on average, and right ${percent(check.hitRate)} of the time` +
        (check.verdict === 'too-few' ? `. Needs ${5 - check.n} more to judge.` : ` (${check.n} predictions).`);

  $('#count-value').textContent = String(n);
  const bits = [`${groups.open.length + groups.due.length} open`];
  if (groups.due.length) bits.push(`${groups.due.length} ready to check`);
  if (voided) bits.push(`${voided} void`);
  $('#count-note').textContent = bits.join(', ');
}

function renderLists(predictions, example) {
  const today = toISODate(new Date());
  const { due, open, resolved } = groupPredictions(predictions, today);

  const fill = (listId, items) => {
    $(listId).replaceChildren(...items.map((p) => predictionItem(p, { example, today })));
  };

  $('#due-section').hidden = due.length === 0;
  $('#due-count').textContent = due.length;
  fill('#due-list', due);

  $('#open-count').textContent = open.length || '';
  $('#open-empty').hidden = open.length > 0;
  fill('#open-list', open);

  const shown = state.showAllResolved ? resolved : resolved.slice(0, RESOLVED_PREVIEW);
  $('#resolved-count').textContent = resolved.length || '';
  $('#resolved-empty').hidden = resolved.length > 0;
  fill('#resolved-list', shown);
  const more = $('#show-all');
  more.hidden = resolved.length <= RESOLVED_PREVIEW;
  more.textContent = state.showAllResolved ? 'Show fewer' : `Show all ${resolved.length}`;
}

function predictionItem(p, { example, today }) {
  const meta = [];
  if (p.outcome === 'yes') meta.push(h('span', { class: 'chip chip-yes', text: 'Happened' }));
  if (p.outcome === 'no') meta.push(h('span', { class: 'chip chip-no', text: "Didn't happen" }));
  if (p.outcome === 'void') meta.push(h('span', { class: 'chip', text: 'Void' }));

  if (!p.outcome && p.resolveBy) {
    const days = daysBetween(today, p.resolveBy);
    if (days <= 0) {
      const late = -days;
      meta.push(
        h('span', {
          class: 'chip chip-due',
          text: late === 0 ? 'Check today' : `Check was due ${late} day${late === 1 ? '' : 's'} ago`,
        }),
      );
    } else {
      meta.push(h('span', { text: `Check on ${formatDate(p.resolveBy)}` }));
    }
  }
  if (p.tag) meta.push(h('span', { class: 'chip chip-tag', text: p.tag }));
  meta.push(h('span', { text: `Logged ${formatDate(p.createdAt)}` }));
  if (p.outcome && p.outcome !== 'void') {
    meta.push(h('span', { class: 'pred-score', text: `Score ${fixed3(brierTerm(p))}` }));
  }

  const actions = [];
  if (!example) {
    const label = (verb) => `${verb}: ${p.statement}`;
    if (!p.outcome) {
      actions.push(
        h('button', { class: 'button button-small button-yes', type: 'button', 'data-action': 'yes', 'aria-label': label('It happened') }, 'It happened'),
        h('button', { class: 'button button-small button-no', type: 'button', 'data-action': 'no', 'aria-label': label("It didn't happen") }, "It didn't"),
        h('button', { class: 'button button-small button-text', type: 'button', 'data-action': 'void', title: "Can't be judged fairly anymore; leave it out of the score", 'aria-label': label('Mark void') }, 'Void'),
      );
    } else {
      actions.push(h('button', { class: 'button button-small button-text', type: 'button', 'data-action': 'reopen', 'aria-label': label('Reopen') }, 'Reopen'));
    }
    actions.push(
      h('span', { class: 'spacer' }),
      h('button', { class: 'button button-small button-text', type: 'button', 'data-action': 'delete', 'aria-label': label('Delete') }, 'Delete'),
    );
  }

  return h(
    'li',
    { class: 'pred', 'data-id': p.id },
    h('div', { class: 'pred-prob' }, String(p.probability), h('small', { text: '%' })),
    h(
      'div',
      { class: 'pred-body' },
      h('p', { class: 'pred-statement', text: p.statement }),
      h('p', { class: 'pred-meta' }, meta),
      p.notes ? h('p', { class: 'pred-notes', text: p.notes }) : null,
    ),
    actions.length ? h('div', { class: 'pred-actions' }, actions) : null,
  );
}

function renderStats(predictions) {
  const { n } = brierScore(predictions);
  const hasData = n > 0;
  $('#chart-empty').hidden = hasData;
  $('#bins-wrap').hidden = !hasData;
  $('#decomposition-block').hidden = !hasData;

  const bins = calibrationBins(predictions);
  $('#chart').innerHTML = hasData ? reliabilityDiagram(bins) : '';

  $('#bins-table tbody').replaceChildren(
    ...bins
      .filter((b) => b.n > 0)
      .reverse()
      .map((b) => {
        const off = Math.abs(b.observedRate - b.meanForecast) >= 0.15 && b.n >= 3;
        return h(
          'tr',
          {},
          h('td', { text: `${b.lo}–${b.hi}%` }),
          h('td', { text: String(b.n) }),
          h('td', { text: percent(b.meanForecast) }),
          h('td', { class: off ? 'is-off' : null, text: `${b.hits} of ${b.n} (${percent(b.observedRate)})` }),
        );
      }),
  );

  const parts = decompose(predictions);
  if (parts) {
    const row = (name, explain, value) => [
      h('dt', {}, h('strong', { text: name }), h('span', { text: explain })),
      h('dd', { text: fixed3(value) }),
    ];
    $('#decomposition').replaceChildren(
      ...row('Calibration error', 'Gap between your chances and what happened. Lower is better.', parts.reliability),
      ...row('Discrimination', 'How well you told apart what would and wouldn’t happen. Higher is better.', parts.resolution),
      ...row('Uncertainty', `How hard the questions were: ${percent(parts.baseRate)} of them came true.`, parts.uncertainty),
    );
    $('#equation').textContent = `${fixed3(parts.reliability)} − ${fixed3(parts.resolution)} + ${fixed3(parts.uncertainty)} = ${fixed3(parts.brier)} Brier score`;
  }

  const tagRows = scoresByTag(predictions);
  $('#tags-block').hidden = tagRows.length === 0;
  $('#tags-table tbody').replaceChildren(
    ...tagRows.map((r) =>
      h('tr', {}, h('td', { text: r.tag }), h('td', { text: String(r.n) }), h('td', { text: fixed3(r.score) })),
    ),
  );
}

function renderTagOptions() {
  $('#tag-list').replaceChildren(...tagsIn(state.predictions).map((t) => h('option', { value: t })));
}

function renderStorageNote() {
  $('#storage-note').textContent =
    state.backend.kind === 'account'
      ? 'Your journal is saved to your claude.ai account, in a private space only you can read. Export a backup if you want a copy of your own.'
      : 'Your journal is kept in this browser only. Nothing is sent anywhere. Clearing site data deletes it, so export a backup now and then.';
}

// ---------- form ----------

function resetForm() {
  const form = $('#prediction-form');
  form.reset();
  $('#resolve-by').value = toISODate(addDays(new Date(), 30));
  syncProbability(70);
}

function syncProbability(value) {
  const clamped = Math.max(0, Math.min(100, Math.round(Number(value) || 0)));
  $('#probability').value = clamped;
  $('#probability-number').value = clamped;
  $('#probability-words').textContent = inWords(clamped);
}

function onSubmit(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const error = $('#form-error');
  try {
    const prediction = createPrediction({
      statement: form.statement.value,
      probability: Number($('#probability').value),
      resolveBy: form.resolveBy.value,
      tag: form.tag.value,
      notes: form.notes.value,
    });
    error.hidden = true;
    const wasExample = isExampleMode();
    commit([...state.predictions, prediction]);
    resetForm();
    toast(wasExample ? 'Logged. This is now your own journal.' : 'Prediction logged.');
    form.statement.focus();
  } catch (e) {
    error.textContent = e.message;
    error.hidden = false;
  }
}

// ---------- actions ----------

function onListClick(event) {
  const button = event.target.closest('button[data-action]');
  if (!button) return;
  const id = button.closest('[data-id]')?.dataset.id;
  if (!id) return;
  const action = button.dataset.action;

  if (action === 'yes' || action === 'no' || action === 'void') {
    update(id, (p) => resolvePrediction(p, action));
  } else if (action === 'reopen') {
    update(id, reopenPrediction);
  } else if (action === 'delete') {
    confirmClick(button, 'Confirm delete', () => {
      commit(state.predictions.filter((p) => p.id !== id));
      toast('Prediction deleted.');
    });
  }
}

async function exportJournal() {
  const text = serializeJournal(state.predictions);
  const filename = `hindsight-${toISODate(new Date())}.json`;
  const downloads = typeof globalThis.claude?.use === 'function' ? await globalThis.claude.use('downloads') : null;
  if (downloads) {
    try {
      await downloads.save({ filename, data: text });
      toast('Backup saved.');
    } catch (e) {
      if (e?.code !== 'declined') toast('The backup could not be saved here.', 'error');
    }
    return;
  }
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  const link = h('a', { href: url, download: filename });
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function importJournal(event) {
  const input = event.currentTarget;
  const file = input.files?.[0];
  input.value = '';
  if (!file) return;
  try {
    const { predictions, skipped } = parseJournal(await file.text());
    const merged = mergePredictions(state.predictions, predictions);
    await commit(merged.predictions);
    const notes = [];
    if (merged.kept) notes.push(`${merged.kept} already in your journal`);
    if (skipped) notes.push(`${skipped} unreadable`);
    toast(`Imported ${merged.added} prediction${merged.added === 1 ? '' : 's'}${notes.length ? ` (${notes.join(', ')} skipped)` : ''}.`);
  } catch (e) {
    toast(e.message, 'error');
  }
}

function deleteAll(event) {
  confirmClick(event.currentTarget, 'Yes, delete all', () => {
    commit([]);
    toast('Journal deleted.');
  });
}

// ---------- start ----------

async function connectAccount() {
  const account = await claudeBackend().catch(() => null);
  if (!account) return;
  try {
    const stored = await account.load();
    if (stored) {
      state.predictions = state.changedSinceLoad
        ? mergePredictions(stored, state.predictions).predictions
        : stored;
    }
    // Carry over anything made before the account answered; never write on a plain load.
    if (state.changedSinceLoad || (!stored && state.predictions.length)) await account.save(state.predictions);
    state.backend = account;
    renderStorageNote();
    render();
  } catch {
    // Keep using browser storage.
  }
}

async function start() {
  $('#prediction-form').addEventListener('submit', onSubmit);
  $('#probability').addEventListener('input', (e) => syncProbability(e.target.value));
  $('#probability-number').addEventListener('input', (e) => {
    if (e.target.value !== '') syncProbability(e.target.value);
  });
  $('#probability-number').addEventListener('blur', (e) =>
    syncProbability(e.target.value === '' ? $('#probability').value : e.target.value),
  );
  document.querySelector('.journal').addEventListener('click', onListClick);
  $('#show-all').addEventListener('click', () => {
    state.showAllResolved = !state.showAllResolved;
    render();
  });
  $('#export').addEventListener('click', exportJournal);
  $('#import-file').addEventListener('change', importJournal);
  $('#delete-all').addEventListener('click', deleteAll);

  resetForm();
  try {
    state.predictions = (await state.backend.load()) ?? [];
  } catch (error) {
    toast(error.message, 'error');
  }
  render();
  renderStorageNote();
  connectAccount();
}

start();
