// Curation pipeline: map(filter per feed) -> reduce(dedup) -> map(summarize).
// Called by curate-once.js as `pipeline.runCandidates(itemsByFeed) -> Article[]`.
//
// itemsByFeed: Map<feedId, { feed, items: Item[] }>
// Article:    { title, digest, key_points:[], source_links:[{media,title,link}], heat, paywalled }
//
// Live LLM is slow/expensive, so this module is deliberately thin: orchestration only.
// All LLM I/O goes through ./llm.js (chatJSON with retries + concurrency limit).

import { chatJSON, mapLimit } from './llm.js';
import { loadPrompt, fillTemplate } from './prompts.js';

const FILTER_CONCURRENCY = 6;
const SUM_CONCURRENCY = 4;
// How many recent items per feed the filter LLM examines. Curation runs once a
// day, so this must span ~24h even for fast feeds (yomiuri/reuters publish many
// items/day; their newest-25 only covered ~15h, dropping the prior day's first
// half). 45 reaches a full day for them; getRecentItems fetches 50, so it fits.
const MAX_ITEMS_PER_FEED_IN_PROMPT = 45;

// Cross-feed dedup must not blow up a single LLM call: a reasoning model on
// 200+ candidates exceeds the request timeout (this is why full-scale curation
// previously produced 0 clusters). So we rank candidates by the filter's score,
// cap the total, and dedup in bounded chunks (each chunk is a small, fast call).
// Score-sorting keeps same-event high-score items adjacent, so a hot story's
// outlets usually land in the same chunk and its heat count stays accurate.
const MAX_DEDUP_CANDIDATES = Number(process.env.MAX_DEDUP_CANDIDATES) || 90;
const DEDUP_CHUNK_SIZE = Number(process.env.DEDUP_CHUNK_SIZE) || 24;
const DEDUP_CONCURRENCY = 3;
const DEDUP_TIMEOUT_MS = Number(process.env.DEDUP_TIMEOUT_MS) || 150_000;
const DEDUP_MAX_TOKENS = Number(process.env.DEDUP_MAX_TOKENS) || 20_000;
// When a chunk fails (timeout / truncated → invalid JSON), split it in half and
// retry; halves are smaller and far less likely to overflow the output budget.
const DEDUP_SPLIT_DEPTH = 2;

// Known paywalled feed ids — used as a hard fallback in case the summarizer
// mislabels (it is asked to set `paywalled`, but a code-level guarantee is cheap).
const PAYWALL_FEEDS = new Set(['ft', 'wsj', 'nyt', 'economist', 'thetimes', 'wapo']);

// --- Step 1: per-feed filter -------------------------------------------------
async function filterFeed({ feed, items }) {
  if (!items?.length) return [];
  const tpl = loadPrompt('filter');
  const slim = items.slice(0, MAX_ITEMS_PER_FEED_IN_PROMPT).map((i) => ({
    title: i.title,
    link: i.link,
    summary: (i.summary ?? '').slice(0, 200),
    published_at: i.published_at,
  }));
  const user = fillTemplate(tpl, {
    feed_name: feed.name,
    items_json: JSON.stringify(slim),
    today: new Date().toISOString().slice(0, 10),
  });
  const res = await chatJSON({ system: 'You are a strict JSON-only news filter.', user, maxTokens: 12000 });
  if (!res.ok || !res.data) {
    console.error(`[pipeline] filter ${feed.id} failed: ${res.error || 'no-data'} content=${JSON.stringify(res.raw?.choices?.[0]?.message?.content ?? '').slice(0, 200)}`);
    return [];
  }
  const candidates = Array.isArray(res.data.candidates) ? res.data.candidates : [];
  return candidates.map((c) => ({ ...c, _media: feed.id }));
}

// --- Step 2: cross-feed dedup ------------------------------------------------
const numScore = (c) => (Number.isFinite(c?.score) ? Number(c.score) : 0);

// Dedup one bounded chunk of candidates into clusters. Returns [] on failure
// (never throws) so one bad chunk cannot sink the whole pass.
async function dedupChunk(slimCandidates, today) {
  const tpl = loadPrompt('dedup');
  const user = fillTemplate(tpl, { candidates_json: JSON.stringify(slimCandidates), today });
  const res = await chatJSON({
    system: 'You are a strict JSON-only news editor.',
    user,
    maxTokens: DEDUP_MAX_TOKENS,
    timeoutMs: DEDUP_TIMEOUT_MS,
  });
  if (!res.ok || !res.data) {
    console.error(`[pipeline] dedup chunk(${slimCandidates.length}) failed: ${res.error || 'no-data'}`);
    return null; // signal failure (distinct from "no clusters")
  }
  return Array.isArray(res.data.clusters) ? res.data.clusters : [];
}

// Dedup a chunk; on failure, split in half and retry the smaller halves. This
// self-heals output-truncation (invalid-json) by shrinking until it fits.
async function dedupChunkResilient(slim, today, depth = 0) {
  const clusters = await dedupChunk(slim, today);
  if (clusters !== null) return clusters;
  if (slim.length <= 1 || depth >= DEDUP_SPLIT_DEPTH) {
    console.error(`[pipeline] dedup giving up on ${slim.length} candidate(s) at depth ${depth}`);
    return [];
  }
  const mid = Math.floor(slim.length / 2);
  console.log(`[pipeline] dedup splitting failed chunk of ${slim.length} -> ${mid}+${slim.length - mid}`);
  const [a, b] = await Promise.all([
    dedupChunkResilient(slim.slice(0, mid), today, depth + 1),
    dedupChunkResilient(slim.slice(mid), today, depth + 1),
  ]);
  return [...a, ...b];
}

async function dedupCandidates(allCandidates) {
  const today = new Date().toISOString().slice(0, 10);
  // Rank then cap, so the dedup workload is bounded. The filter marks cross-outlet
  // stories with `is_hot`; float those to the top so a hot event can never be
  // dropped by the cap (losing one of its outlets would undercount its heat).
  // Within each hotness tier, order by the filter's editorial score.
  const isHot = (c) => (c?.is_hot ? 1 : 0);
  const ranked = [...allCandidates]
    .sort((a, b) => isHot(b) - isHot(a) || numScore(b) - numScore(a))
    .slice(0, MAX_DEDUP_CANDIDATES);
  const hotKept = ranked.filter((c) => c?.is_hot).length;
  console.log(`[pipeline] dedup: ${allCandidates.length} candidates -> kept ${ranked.length} (hot=${hotKept} prioritized)`);
  // Slim each candidate to only what clustering needs (title/link/_media + a
  // short summary), dropping score/reason/is_hot to keep the prompt small.
  const slim = ranked.map((c) => ({
    title: c.title,
    link: c.link,
    _media: c._media,
    summary: String(c.summary ?? '').slice(0, 120),
  }));

  if (slim.length <= DEDUP_CHUNK_SIZE) {
    return dedupChunkResilient(slim, today);
  }
  // Chunk and dedup in parallel; concatenate clusters. Cross-chunk duplicates
  // are rare (score-sorting groups same-event items) and acceptable.
  const chunks = [];
  for (let i = 0; i < slim.length; i += DEDUP_CHUNK_SIZE) chunks.push(slim.slice(i, i + DEDUP_CHUNK_SIZE));
  const perChunk = await mapLimit(chunks, DEDUP_CONCURRENCY, (ch) => dedupChunkResilient(ch, today));
  const clusters = perChunk.filter((r) => r.ok).flatMap((r) => r.result || []);
  console.log(`[pipeline] dedup: chunks=${chunks.length} -> clusters=${clusters.length}`);
  // Chunking can split one event across chunks (e.g. the top story appears
  // twice). Re-merge by running dedup once more over just the cluster titles —
  // a tiny payload (no long URLs) that fits in a single call.
  return consolidateClusters(clusters, today);
}

// Union the real sources of a set of clusters, de-duplicated by link.
function unionSources(clusters) {
  const byKey = new Map();
  for (const c of clusters) {
    for (const s of c.sources || []) {
      const key = s.link || `${s.media}|${s.title}`;
      if (!byKey.has(key)) byKey.set(key, s);
    }
  }
  return [...byKey.values()];
}

// Second dedup pass: merge clusters that are the same event across chunks.
// Uses a dedicated prompt (consolidate.md) that takes id-tagged cluster titles
// and returns groups of ids — a tiny payload that fits in one call. We map the
// ids back to the originals and union their real sources. Falls back to the
// input unchanged on any failure (never loses clusters).
async function consolidateClusters(clusters, today) {
  if (clusters.length <= 1) return clusters;
  const slim = clusters.map((c, i) => ({
    id: i,
    title: c.canonical_title ?? '',
    summary: String(c.summary ?? '').slice(0, 120),
  }));
  const tpl = loadPrompt('consolidate');
  const user = fillTemplate(tpl, { clusters_json: JSON.stringify(slim), today });
  const res = await chatJSON({
    system: 'You are a strict JSON-only news editor.',
    user,
    maxTokens: DEDUP_MAX_TOKENS,
    timeoutMs: DEDUP_TIMEOUT_MS,
  });
  const groups = res.ok && Array.isArray(res.data?.groups) ? res.data.groups : null;
  if (!groups) {
    console.error(`[pipeline] consolidate failed: ${res.error || 'no-groups'} — keeping ${clusters.length} clusters`);
    return clusters;
  }

  const out = [];
  const used = new Set();
  for (const g of groups) {
    const idxs = [...new Set((g.members || [])
      .map((n) => Number(n))
      .filter((n) => Number.isInteger(n) && n >= 0 && n < clusters.length && !used.has(n)))];
    if (!idxs.length) continue;
    idxs.forEach((i) => used.add(i));
    const members = idxs.map((i) => clusters[i]);
    // Lead title = the member that already merged the most outlets.
    const lead = [...members].sort((a, b) => (b.sources?.length || 0) - (a.sources?.length || 0))[0];
    out.push({ canonical_title: lead.canonical_title, summary: lead.summary, sources: unionSources(members) });
  }
  // Preserve any cluster the merge pass left out (model omitted its id).
  for (let i = 0; i < clusters.length; i++) if (!used.has(i)) out.push(clusters[i]);
  console.log(`[pipeline] consolidate: ${clusters.length} -> ${out.length} clusters`);
  return out;
}

// --- Step 3: per-cluster summarize ------------------------------------------
async function summarizeCluster(cluster) {
  const tpl = loadPrompt('summarize');
  const user = fillTemplate(tpl, { cluster_json: JSON.stringify(cluster) });
  const res = await chatJSON({ system: 'You are a strict JSON-only news rewriter.', user, maxTokens: 6000 });
  if (!res.ok || !res.data) {
    console.error(`[pipeline] summarize "${cluster.canonical_title ?? ''}" failed: ${res.error || 'no-data'} content=${JSON.stringify(res.raw?.choices?.[0]?.message?.content ?? '').slice(0, 200)}`);
    return null;
  }
  return res.data;
}

export async function runCandidates(itemsByFeed) {
  const feedEntries = [...itemsByFeed.values()].filter((e) => e.items?.length);

  // Step 1 — parallel per-feed filtering.
  const filterResults = await mapLimit(feedEntries, FILTER_CONCURRENCY, (entry) => filterFeed(entry));
  const allCandidates = filterResults.filter((r) => r.ok).flatMap((r) => r.result);
  console.log(`[pipeline] step1 filter: feeds=${feedEntries.length} candidates=${allCandidates.length}`);
  if (!allCandidates.length) return [];

  // Step 2 — single cross-feed dedup pass.
  const clusters = await dedupCandidates(allCandidates);
  console.log(`[pipeline] step2 dedup: clusters=${clusters.length}`);
  if (!clusters.length) return [];

  // Step 3 — parallel summarization.
  const sumResults = await mapLimit(clusters, SUM_CONCURRENCY, (c) => summarizeCluster(c));
  const summaries = sumResults.map((r) => (r.ok ? r.result : null));

  const articles = [];
  for (let i = 0; i < clusters.length; i++) {
    const c = clusters[i];
    const s = summaries[i];
    if (!c) continue;
    const sources = Array.isArray(c.sources) ? c.sources.map((x) => ({
      media: String(x.media ?? ''),
      title: String(x.title ?? ''),
      link: String(x.link ?? ''),
    })) : [];
    // Paywall is determined at code level from the source feed ids — the
    // summarizer is no longer asked to judge it (it cannot see source bodies).
    const anyPaywall = sources.some((s) => PAYWALL_FEEDS.has(s.media));
    // Heat = number of distinct outlets covering the event, computed from the
    // (de-duplicated) sources so it stays correct after the consolidation merge.
    const heat = Math.max(1, new Set(sources.map((s) => s.media)).size);
    articles.push({
      title: c.canonical_title ?? '(untitled)',
      digest: s?.digest ?? c.summary ?? '',
      key_points: Array.isArray(s?.key_points) ? s.key_points.map(String) : [],
      source_links: sources,
      heat,
      paywalled: anyPaywall,
    });
  }
  // Higher heat first, ties by title.
  articles.sort((a, b) => b.heat - a.heat || a.title.localeCompare(b.title));
  return articles;
}

export default { runCandidates };