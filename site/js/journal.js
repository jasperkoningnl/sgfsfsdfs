// The prediction record, its rules, and the journal file format.

export const APP_ID = 'hindsight';
export const SCHEMA_VERSION = 1;
export const OUTCOMES = ['yes', 'no', 'void'];
export const MAX_STATEMENT = 280;
export const MAX_NOTES = 2000;
export const MAX_TAG = 32;

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function randomId() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return `p-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/** Local calendar date as YYYY-MM-DD. */
export function toISODate(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function addDays(date, days) {
  const copy = new Date(date);
  copy.setDate(copy.getDate() + days);
  return copy;
}

function isValidDate(value) {
  if (!DATE_RE.test(value)) return false;
  const [y, m, d] = value.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  return date.getFullYear() === y && date.getMonth() === m - 1 && date.getDate() === d;
}

function isTimestamp(value) {
  return typeof value === 'string' && !Number.isNaN(Date.parse(value));
}

function clean(text, max) {
  return String(text ?? '').trim().replace(/\s+/g, ' ').slice(0, max);
}

/**
 * Builds a new open prediction from form input. Throws an Error whose
 * message can be shown to the person as-is.
 */
export function createPrediction(input, now = new Date(), id = randomId()) {
  const statement = clean(input.statement, MAX_STATEMENT);
  if (!statement) throw new Error('Write down what you are predicting.');

  const probability = Number(input.probability);
  if (!Number.isInteger(probability) || probability < 0 || probability > 100) {
    throw new Error('Probability must be a whole number from 0 to 100.');
  }

  const resolveBy = input.resolveBy ? String(input.resolveBy) : null;
  if (resolveBy && !isValidDate(resolveBy)) {
    throw new Error('Pick a valid date to check the outcome.');
  }

  return {
    id,
    statement,
    probability,
    createdAt: now.toISOString(),
    resolveBy,
    tag: clean(input.tag, MAX_TAG).toLowerCase(),
    notes: String(input.notes ?? '').trim().slice(0, MAX_NOTES),
    outcome: null,
    resolvedAt: null,
  };
}

/** Records the outcome. Statement and probability never change after logging. */
export function resolvePrediction(prediction, outcome, now = new Date()) {
  if (!OUTCOMES.includes(outcome)) throw new Error(`Unknown outcome: ${outcome}`);
  return { ...prediction, outcome, resolvedAt: now.toISOString() };
}

export function reopenPrediction(prediction) {
  return { ...prediction, outcome: null, resolvedAt: null };
}

/**
 * Checks and normalises one stored or imported prediction. Returns null when
 * the record cannot be trusted, so a bad row never breaks the journal.
 */
export function normalizePrediction(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const { id, statement, probability, createdAt } = raw;
  if (typeof id !== 'string' || !id || id.length > 100) return null;
  if (typeof statement !== 'string' || !statement.trim()) return null;
  if (!Number.isInteger(probability) || probability < 0 || probability > 100) return null;
  if (!isTimestamp(createdAt)) return null;

  const outcome = OUTCOMES.includes(raw.outcome) ? raw.outcome : null;
  return {
    id,
    statement: clean(statement, MAX_STATEMENT),
    probability,
    createdAt,
    resolveBy: typeof raw.resolveBy === 'string' && isValidDate(raw.resolveBy) ? raw.resolveBy : null,
    tag: clean(raw.tag, MAX_TAG).toLowerCase(),
    notes: typeof raw.notes === 'string' ? raw.notes.trim().slice(0, MAX_NOTES) : '',
    outcome,
    resolvedAt: outcome && isTimestamp(raw.resolvedAt) ? raw.resolvedAt : outcome ? createdAt : null,
  };
}

export function journalDocument(predictions) {
  return { app: APP_ID, version: SCHEMA_VERSION, predictions };
}

export function serializeJournal(predictions) {
  return JSON.stringify(journalDocument(predictions), null, 2);
}

/**
 * Reads a journal object (parsed JSON). Accepts the full document or a bare
 * array of predictions. Returns { predictions, skipped }.
 */
export function readJournal(data) {
  let rows;
  if (Array.isArray(data)) rows = data;
  else if (data && typeof data === 'object' && Array.isArray(data.predictions)) {
    if (data.app !== undefined && data.app !== APP_ID) {
      throw new Error('This file was not made by Hindsight.');
    }
    if (typeof data.version === 'number' && data.version > SCHEMA_VERSION) {
      throw new Error('This file comes from a newer version of Hindsight.');
    }
    rows = data.predictions;
  } else {
    throw new Error('This file does not contain a Hindsight journal.');
  }

  const predictions = [];
  const seen = new Set();
  let skipped = 0;
  for (const row of rows) {
    const p = normalizePrediction(row);
    if (!p || seen.has(p.id)) {
      skipped += 1;
      continue;
    }
    seen.add(p.id);
    predictions.push(p);
  }
  return { predictions, skipped };
}

export function parseJournal(text) {
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error('This file is not valid JSON.');
  }
  return readJournal(data);
}

/**
 * Adds imported predictions to the journal. A prediction already in the
 * journal (same id) is kept as it is, so an old backup can never undo
 * newer outcomes.
 */
export function mergePredictions(existing, incoming) {
  const ids = new Set(existing.map((p) => p.id));
  const added = incoming.filter((p) => !ids.has(p.id));
  return {
    predictions: [...existing, ...added],
    added: added.length,
    kept: incoming.length - added.length,
  };
}

/**
 * Splits the journal into what needs attention now (open and past its
 * date), what is still open, and what is settled.
 */
export function groupPredictions(predictions, today = toISODate(new Date())) {
  const due = [];
  const open = [];
  const resolved = [];
  for (const p of predictions) {
    if (p.outcome) resolved.push(p);
    else if (p.resolveBy && p.resolveBy <= today) due.push(p);
    else open.push(p);
  }
  const byDate = (a, b) =>
    (a.resolveBy ?? '9999-12-31').localeCompare(b.resolveBy ?? '9999-12-31') ||
    a.createdAt.localeCompare(b.createdAt);
  due.sort(byDate);
  open.sort(byDate);
  resolved.sort((a, b) => b.resolvedAt.localeCompare(a.resolvedAt));
  return { due, open, resolved };
}

export function tagsIn(predictions) {
  return [...new Set(predictions.map((p) => p.tag).filter(Boolean))].sort();
}
