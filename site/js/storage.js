// Where the journal is kept.
//
// The default is the browser's localStorage. When the page runs as a
// claude.ai artifact, the journal is kept in the artifact's database under
// the viewer's own private path instead, so it survives cleared site data.

import { journalDocument, parseJournal, readJournal, serializeJournal } from './journal.js';

export const LOCAL_KEY = 'hindsight.journal.v1';
export const UNREADABLE_KEY = `${LOCAL_KEY}.unreadable`;

export function localBackend(storage = safeLocalStorage()) {
  return {
    kind: 'browser',
    // Resolves null when nothing is stored. If something is stored but can't
    // be read, a copy is set aside first so the next save can't destroy it.
    async load() {
      let raw;
      try {
        raw = storage?.getItem(LOCAL_KEY);
      } catch {
        return null;
      }
      if (!raw) return null;
      try {
        return parseJournal(raw).predictions;
      } catch (error) {
        try {
          storage.setItem(UNREADABLE_KEY, raw);
        } catch {
          // Nothing more we can do; the error below still warns the person.
        }
        throw new Error(
          `The journal saved in this browser could not be read: ${error.message} A copy was kept under "${UNREADABLE_KEY}" so it isn't lost.`,
        );
      }
    },
    async save(predictions) {
      if (!storage) throw new Error('This browser is not letting Hindsight save anything.');
      try {
        storage.setItem(LOCAL_KEY, serializeJournal(predictions));
      } catch {
        throw new Error('This browser refused to save the journal. Export a backup to keep your data.');
      }
    },
  };
}

function safeLocalStorage() {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

/**
 * Resolves a backend on claude.ai's private per-viewer store, or null when
 * the page is not running there (GitHub Pages, a saved file, a viewer
 * without write access).
 */
export async function claudeBackend(claude = globalThis.claude) {
  if (typeof claude?.use !== 'function') return null;
  const [db, user] = await Promise.all([claude.use('db'), claude.use('user')]);
  if (!db || !user) return null;
  const uid = await user.id();
  if (!uid) return null;

  const ref = db.doc(`data/users/${uid}/journal`);
  let writing = null;
  let queued = null;

  async function write(predictions) {
    try {
      await ref.set(journalDocument(predictions));
    } catch (e) {
      if (e?.code === 'invalid_argument' || e?.code === 'quota_exceeded') {
        throw new Error('The journal could not be saved to your account. Export a backup to keep your data.');
      }
      throw new Error('Saving failed for a moment. Your change is still on screen; try again shortly.');
    }
  }

  return {
    kind: 'account',
    async load() {
      const snap = await ref.get();
      return snap.exists ? readJournal(snap.data()).predictions : null;
    },
    // One write at a time; bursts collapse into a final write of the latest state.
    async save(predictions) {
      queued = predictions;
      if (writing) return writing;
      writing = (async () => {
        try {
          while (queued) {
            const next = queued;
            queued = null;
            await write(next);
          }
        } finally {
          writing = null;
        }
      })();
      return writing;
    },
  };
}
