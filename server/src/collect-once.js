import { loadFeeds, collectAll } from './collect.js';

const feeds = loadFeeds();
console.log(`[collect-once] starting ${feeds.length} feeds…`);
const t0 = Date.now();
const results = await collectAll(feeds);
const ok = results.filter((r) => r.ok).length;
const inserted = results.reduce((s, r) => s + (r.inserted || 0), 0);
console.log(`[collect-once] done in ${Date.now() - t0}ms — ok=${ok}/${feeds.length} inserted=${inserted}`);