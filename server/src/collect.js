import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { db, syncFeeds, insertItems } from './db.js';
import { collectFeed } from './feed.js';
import { sourceFeeds } from './brief/sources.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FEEDS_FILE = join(__dirname, '..', '..', 'feeds.json');

export function loadFeeds() {
  return sourceFeeds();
}

// Run a mapper over an array with limited concurrency.
async function mapLimit(arr, limit, mapper) {
  const ret = new Array(arr.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(limit, arr.length) }, async () => {
    while (cursor < arr.length) {
      const i = cursor++;
      ret[i] = await mapper(arr[i], i);
    }
  });
  await Promise.all(workers);
  return ret;
}

// Collect every feed in parallel (bounded). Returns a per-feed summary.
export async function collectAll(feeds) {
  syncFeeds(feeds);
  const results = await mapLimit(feeds, 6, async (feed) => {
    try {
      const items = await collectFeed(feed);
      const inserted = insertItems(feed, items);
      return { feed: feed.id, ok: true, fetched: items.length, inserted };
    } catch (e) {
      console.error(`[collect] ${feed.id} failed: ${e.message}`);
      return { feed: feed.id, ok: false, error: e.message };
    }
  });
  return results;
}
