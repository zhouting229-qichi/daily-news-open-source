import { XMLParser } from 'fast-xml-parser';
import { fetchPublic } from './brief/evidence.js';
import { collectAdapter } from './brief/adapters.js';

const UA = 'NewsAggregator/1.0 (+https://github.com/local/news-aggregator)';
const parser = new XMLParser({
  ignoreAttributes: false,
  trimValues: true,
  processEntities: { enabled: true, maxTotalExpansions: 100000 },
});

// Fetch with timeout + redirect handling. Returns text or throws.
async function fetchText(url, { timeoutMs = 15000 } = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(new Error('fetch timeout')), timeoutMs);
  try {
    const res = await fetch(url, { headers: { 'user-agent': UA, accept: 'application/rss+xml,application/xml,text/xml,*/*' }, signal: ctrl.signal, redirect: 'follow' });
    if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
    return await res.text();
  } finally {
    clearTimeout(timer);
  }
}

// Google News prefixes titles like "Source Name - Actual Title"; strip it.
function stripGooglePrefix(title) {
  // Google News titles look like "Headline - Publisher"; keep only the headline.
  for (const sep of [' - ', ' \u2013 ']) {
    const i = title.lastIndexOf(sep);
    if (i > 0) return title.slice(0, i).trim();
  }
  return title;
}

// Coerce a possibly-object/undefined text value into a trimmed string (or '').
function txt(v) {
  if (v == null) return '';
  if (typeof v === 'string') return v.trim();
  if (typeof v === 'object') {
    // Atom / fast-xml-parser containers: { '#text': '...', '@_attr': '...' } or { _: 'text' }
    if (typeof v['#text'] === 'string') return v['#text'].trim();
    if (typeof v._ === 'string') return v._.trim();
    if (typeof v.href === 'string') return v.href.trim();
    if (typeof v['@_href'] === 'string') return v['@_href'].trim();
    return '';
  }
  return String(v).trim();
}

// Reject obviously-wrong publish dates (misparsed formats, far future/past)
// so they don't poison the published_at-DESC sort or the age-based pruning.
// Out-of-range values become null and fall back to fetched_at downstream.
const MAX_FUTURE_MS = 36 * 60 * 60 * 1000;      // ~1.5 days ahead (timezone slack)
const MAX_PAST_MS = 730 * 24 * 60 * 60 * 1000;  // ~2 years back
export function sanePublished(ms, now) {
  if (typeof ms !== 'number' || Number.isNaN(ms)) return null;
  if (ms > now + MAX_FUTURE_MS) return null;
  if (ms < now - MAX_PAST_MS) return null;
  return ms;
}

// Normalize RSS/Atom/Google-News items into a common shape.
function normalizeFromChannel(channel, type, host) {
  const out = [];
  const now = Date.now();
  let raw = [];
  // RSS 2.0
  if (Array.isArray(channel.item)) raw = channel.item;
  else if (channel.item) raw = [channel.item];
  // Atom
  if (raw.length === 0 && Array.isArray(channel.entry)) raw = channel.entry;
  else if (raw.length === 0 && channel.entry) raw = [channel.entry];

  for (const it of raw) {
    // google-news items carry <source url="...">; filter to configured host.
    if (type === 'google-news' && host) {
      const src = it.source;
      const srcUrl = typeof src === 'object' ? src?.['@_url'] : (typeof src === 'string' ? src : '');
      if (!String(srcUrl).includes(host)) continue;
    }
    const guid = txt(it.guid || it.id || it.link || it['@_rdf:about']);
    const linkRaw = it.link;
    let link = '';
    if (Array.isArray(linkRaw)) {
      const alt = linkRaw.find((l) => !l.rel || l.rel === 'alternate');
      link = txt(alt);
    } else {
      link = txt(linkRaw);
    }
    if (!guid || !link) continue;
    let title = txt(it.title);
    if (type === 'google-news') title = stripGooglePrefix(title);
    if (!title) continue;
    const rawSummary = txt(it.summary || it.description || it.content);
    const summary = rawSummary.replace(/<[^>]+>/g, '').trim().slice(0, 600);
    let published = it.pubDate ? Date.parse(txt(it.pubDate)) : it.published ? Date.parse(txt(it.published)) : it['dc:date'] ? Date.parse(txt(it['dc:date'])) : null;
    published = sanePublished(published, now);
    out.push({ guid, title, link, summary, published_at: published });
  }
  return out;
}

// Parse a whole feed document into normalized items.
export function parseFeed(xml, type, host) {
  const doc = parser.parse(xml);
  if(doc['rdf:RDF'])return normalizeFromChannel(doc['rdf:RDF'],type,host);
  // RSS: rss > channel ; Atom: feed (channel itself)
  const root = doc.rss?.channel ?? doc.feed ?? doc.rdf?.channel ?? {};
  const channel = doc.rss ? root : (doc.feed ? doc.feed : root);
  return normalizeFromChannel(channel, type, host);
}

// Fetch + parse one feed. Throws on hard failure (caller logs + skips).
export async function collectFeed(feed) {
  if(feed.adapter)return collectAdapter(feed);
  const {text:xml} = await fetchPublic(feed.url,{domains:[new URL(feed.url).hostname]});
  const items = parseFeed(xml, feed.type, feed.host);
  // Keep only the freshest ~30 per feed to bound DB growth.
  return items.slice(0, 30);
}
