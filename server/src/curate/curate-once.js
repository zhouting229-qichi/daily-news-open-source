// One-shot curation run. Invoked by the systemd timer (deploy/curate.timer)
// or manually for the stage-2 pilot:
//   node --env-file=server/.env --experimental-sqlite server/src/curate/curate-once.js --feed=guardian
//
// Flow: load feeds -> ensure schema -> gather recent items per feed ->
// pipeline.runCandidates(itemsByFeed) -> saveBatch -> log. Errors exit 1.

import { loadFeeds } from '../collect.js';
import {
  ensureCurationSchema,
  saveBatch,
  getRecentItems,
  pruneOldBatches,
} from './db-curation.js';
import pipeline from './pipeline.js';

// Parse --feed=<id> from argv; undefined means process all feeds.
function parseFeedArg(argv) {
  for (const a of argv.slice(2)) {
    const m = a.match(/^--feed=(.+)$/);
    if (m) return m[1];
  }
  return undefined;
}

async function main() {
  const feedFilter = parseFeedArg(process.argv);
  const feeds = loadFeeds();
  const selected = feedFilter ? feeds.filter((f) => f.id === feedFilter) : feeds;

  if (selected.length === 0) {
    console.error(`[curate] no feeds matched --feed=${feedFilter}`);
    process.exit(1);
  }

  ensureCurationSchema();

  // Build itemsByFeed: feedId -> { feed, items[] }
  const itemsByFeed = new Map();
  for (const feed of selected) {
    const items = getRecentItems(feed.id, 50);
    itemsByFeed.set(feed.id, { feed, items });
  }

  const totalItems = [...itemsByFeed.values()].reduce((s, e) => s + e.items.length, 0);
  console.log(`[curate] starting: feeds=${selected.length} items=${totalItems}${feedFilter ? ` feed=${feedFilter}` : ''}`);

  const articles = await pipeline.runCandidates(itemsByFeed);
  console.log(`[curate] pipeline produced ${articles.length} articles`);

  // A run that produced nothing (e.g. every dedup chunk timed out) must NOT
  // overwrite the last good batch with an empty one — that would blank the
  // "For You" section. Leave the previous batch in place and exit non-zero so
  // the failure is visible in the timer's journal.
  if (articles.length === 0) {
    console.error('[curate] pipeline produced 0 articles — keeping previous batch, not saving');
    process.exit(1);
  }

  const batchId = saveBatch(articles, { feedCount: selected.length });
  console.log(`[curate] saved batch ${batchId} (${articles.length} articles)`);

  const removed = pruneOldBatches(30);
  if (removed) console.log(`[curate] pruned ${removed} old batches`);
}

try {
  await main();
} catch (e) {
  console.error(`[curate] failed: ${e?.stack || e?.message || e}`);
  process.exit(1);
}
