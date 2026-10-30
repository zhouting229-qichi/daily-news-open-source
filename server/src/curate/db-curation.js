// Curation data layer. Opens its own connection to the same news.db file
// used by server/src/db.js (WAL mode allows multiple readers/writers).
//
// No new dependencies — uses Node 22 built-in `node:sqlite`.

import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DB_PATH = join(__dirname, '..', '..', 'data', 'news.db');

export const db = new DatabaseSync(DB_PATH);
db.exec('PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL;');

// Manual transaction wrapper (node:sqlite has no .transaction helper).
function tx(fn) {
  db.exec('BEGIN');
  try { const r = fn(); db.exec('COMMIT'); return r; }
  catch (e) { db.exec('ROLLBACK'); throw e; }
}

// Idempotent schema creation for the curation tables.
export function ensureCurationSchema() {
  db.exec(`
CREATE TABLE IF NOT EXISTS curation_batches (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  generated_at INTEGER NOT NULL,
  feed_count   INTEGER
);

CREATE TABLE IF NOT EXISTS curation_articles (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  batch_id     INTEGER NOT NULL REFERENCES curation_batches(id),
  title        TEXT,
  digest       TEXT,
  key_points   TEXT,
  source_links TEXT,
  heat         INTEGER,
  paywalled    INTEGER,
  ord          INTEGER,
  created_at   INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS curation_articles_batch_id ON curation_articles(batch_id);
`);

  // Prepare statements now that the tables exist.
  stmtInsertBatch = db.prepare(
    `INSERT INTO curation_batches (generated_at, feed_count) VALUES (?, ?)`
  );
  stmtInsertArticle = db.prepare(
    `INSERT INTO curation_articles
       (batch_id, title, digest, key_points, source_links, heat, paywalled, ord, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  // Latest batch that actually has articles — never surface an empty batch
  // (a failed curation run) to the frontend.
  stmtLatestBatch = db.prepare(
    `SELECT id, generated_at, feed_count FROM curation_batches b
     WHERE EXISTS (SELECT 1 FROM curation_articles a WHERE a.batch_id = b.id)
     ORDER BY id DESC LIMIT 1`
  );
  stmtArticlesByBatch = db.prepare(
    `SELECT title, digest, key_points, source_links, heat, paywalled, ord
     FROM curation_articles WHERE batch_id = ? ORDER BY ord ASC`
  );
  stmtRecentItems = db.prepare(
    `SELECT id, title, link, summary, published_at, paywall
     FROM items WHERE feed_id = ?
     ORDER BY COALESCE(published_at, fetched_at) DESC
     LIMIT ?`
  );
}

let stmtInsertBatch;
let stmtInsertArticle;
let stmtLatestBatch;
let stmtArticlesByBatch;
let stmtRecentItems;

// Save a batch of articles atomically. `articles` items have shape:
//   { title, digest, key_points:[], source_links:[{media,title,link}], heat, paywalled }
// `ord` is the array index. Returns the new batch id.
export function saveBatch(articles, { feedCount } = {}) {
  const now = Date.now();
  return tx(() => {
    const info = stmtInsertBatch.run(now, feedCount == null ? null : feedCount);
    const batchId = info.lastInsertRowid;
    for (let i = 0; i < articles.length; i++) {
      const a = articles[i];
      stmtInsertArticle.run(
        batchId,
        a.title ?? null,
        a.digest ?? null,
        JSON.stringify(a.key_points ?? []),
        JSON.stringify(a.source_links ?? []),
        a.heat ?? null,
        a.paywalled ? 1 : 0,
        i,
        now
      );
    }
    return batchId;
  });
}

// Keep only the most recent `keep` batches; delete older batches and their
// articles atomically. Returns number of batches removed.
export function pruneOldBatches(keep = 30) {
  return tx(() => {
    const olds = db.prepare(
      'SELECT id FROM curation_batches ORDER BY id DESC LIMIT -1 OFFSET ?'
    ).all(keep).map((r) => r.id);
    if (!olds.length) return 0;
    const placeholders = olds.map(() => '?').join(',');
    db.prepare(`DELETE FROM curation_articles WHERE batch_id IN (${placeholders})`).run(...olds);
    db.prepare(`DELETE FROM curation_batches WHERE id IN (${placeholders})`).run(...olds);
    return olds.length;
  });
}

// Load the most recent batch with its articles (parsed back to structures).
// Returns null when no batch exists yet.
export function getLatestBatch() {
  const batch = stmtLatestBatch.get();
  if (!batch) return null;
  const rows = stmtArticlesByBatch.all(batch.id);
  const articles = rows.map((r) => ({
    title: r.title,
    digest: r.digest,
    key_points: safeParse(r.key_points, []),
    source_links: safeParse(r.source_links, []),
    heat: r.heat,
    paywalled: !!r.paywalled,
    ord: r.ord,
  }));
  return {
    id: batch.id,
    generated_at: batch.generated_at,
    feed_count: batch.feed_count,
    articles,
  };
}

function safeParse(s, fallback) {
  if (s == null) return fallback;
  try { return JSON.parse(s); } catch (_) { return fallback; }
}

export function getRecentItems(feedId, limit = 50) {
  return stmtRecentItems.all(feedId, limit).map((r) => ({
    id: r.id,
    title: r.title,
    link: r.link,
    summary: r.summary,
    published_at: r.published_at,
    paywall: !!r.paywall,
  }));
}
