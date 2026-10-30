import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { mkdirSync } from 'node:fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, '..', 'data');
mkdirSync(DATA_DIR, { recursive: true });

export const db = new DatabaseSync(join(DATA_DIR, 'news.db'));
db.exec('PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL;');

db.exec(`
CREATE TABLE IF NOT EXISTS feeds (
  id        TEXT PRIMARY KEY,
  name      TEXT NOT NULL,
  type      TEXT NOT NULL,
  url       TEXT NOT NULL,
  paywall   INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS items (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  feed_id       TEXT NOT NULL,
  guid          TEXT NOT NULL,
  title         TEXT NOT NULL,
  link          TEXT NOT NULL,
  summary       TEXT,
  published_at  INTEGER,
  fetched_at    INTEGER NOT NULL,
  paywall       INTEGER NOT NULL DEFAULT 0,
  UNIQUE (feed_id, guid)
);

CREATE INDEX IF NOT EXISTS items_feed_id ON items(feed_id);
CREATE INDEX IF NOT EXISTS items_published_at ON items(published_at DESC);
`);

const stmtUpsertFeed = db.prepare(
  `INSERT INTO feeds (id,name,type,url,paywall) VALUES (?, ?, ?, ?, ?)
   ON CONFLICT(id) DO UPDATE SET name=excluded.name, type=excluded.type, url=excluded.url, paywall=excluded.paywall`
);
const stmtUpsertItem = db.prepare(
  `INSERT INTO items (feed_id,guid,title,link,summary,published_at,fetched_at,paywall)
   VALUES (?, ?, ?, ?, ?, ?, ?, ?)
   ON CONFLICT(feed_id,guid) DO NOTHING`
);

// Manual transaction wrapper (node:sqlite has no .transaction helper).
export function tx(fn) {
  db.exec('BEGIN');
  try { const r = fn(); db.exec('COMMIT'); return r; }
  catch (e) { db.exec('ROLLBACK'); throw e; }
}

export function syncFeeds(feeds) {
  tx(() => {
    for (const f of feeds) stmtUpsertFeed.run(f.id, f.name, f.type, f.url, f.paywall ? 1 : 0);
  });
}

export function insertItems(feed, items) {
  const now = Date.now();
  let inserted = 0;
  tx(() => {
    for (const it of items) {
      const info = stmtUpsertItem.run(
        feed.id, it.guid, it.title, it.link, it.summary, it.published_at, now, feed.paywall ? 1 : 0
      );
      if (info.changes > 0) inserted++;
    }
  });
  return inserted;
}

// Delete items older than `days` (by published_at, falling back to fetched_at),
// but always keep the most recent KEEP_PER_FEED rows of each feed so slow feeds
// never go empty. Returns number of rows deleted.
const RETENTION_DAYS = 30;
const KEEP_PER_FEED = 30;
export function pruneOldItems({ days = RETENTION_DAYS, keepPerFeed = KEEP_PER_FEED } = {}) {
  const cutoff = Date.now() - days * 86_400_000;
  // Protect the newest keepPerFeed ids per feed, delete the rest if older than cutoff.
  const info = db.prepare(`
    DELETE FROM items
    WHERE COALESCE(published_at, fetched_at) < ?
      AND id NOT IN (
        SELECT id FROM (
          SELECT id, ROW_NUMBER() OVER (
            PARTITION BY feed_id ORDER BY COALESCE(published_at, fetched_at) DESC
          ) AS rn FROM items
        ) WHERE rn <= ?
      )
  `).run(cutoff, keepPerFeed);
  return info.changes;
}

// Truncate the WAL so it does not grow unbounded under a long-lived process.
export function checkpointWal() {
  db.exec('PRAGMA wal_checkpoint(TRUNCATE);');
}