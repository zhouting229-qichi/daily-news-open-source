import {readFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';

export function siteOrigin(value) {
  if (typeof value !== 'string' || !value.trim()) return null;
  try {
    const url = new URL(value.trim());
    if (url.protocol !== 'https:' || url.username || url.password || url.port || url.pathname !== '/' || url.search || url.hash) throw Error();
    return url.origin;
  } catch { throw new Error('Invalid DAILY_NEWS_SITE_URL; use an HTTPS origin without credentials, path, query or fragment.'); }
}
export function selectEditions(state) {
  const candidates = [state.edition, ...(Array.isArray(state.editions) ? state.editions : [])];
  const editions = new Map();
  for (const e of candidates) {
    if (e?.mode === 'live' && Array.isArray(e.articles) && e.articles.length && Number.isSafeInteger(e.generated_at) && e.generated_at > 0) {
      if (!editions.has(e.generated_at)) editions.set(e.generated_at, e);
    }
  }
  return [...editions.values()].sort((a,b) => b.generated_at-a.generated_at).slice(0,30);
}

export async function syncSite(state, token, fetcher = fetch, siteUrl = process.env.DAILY_NEWS_SITE_URL) {
  const site = siteOrigin(siteUrl);
  if (!site) return {changed:false,skipped:true,reason:'site-not-configured'};
  if (!token) throw new Error('Configure DAILY_NEWS_SITE_TOKEN in GitHub Actions repository Secrets.');
  const editions = selectEditions(state);
  if (!editions.length) throw new Error('No live non-empty edition; existing website data retained.');
  const latest = editions[0];
  const request = async (path, body) => {
    const response = await fetcher(site+path, {
      method: body ? 'POST' : 'GET', redirect: 'error', signal: AbortSignal.timeout(60000),
      headers: {'OAI-Sites-Authorization': 'Bearer '+token, ...(body ? {'Content-Type':'application/json'} : {})},
      ...(body ? {body:JSON.stringify(body)} : {})
    });
    if (!response.ok) throw new Error('Site request failed: HTTP '+response.status);
    try { return await response.json(); } catch { throw new Error('Site returned invalid JSON.'); }
  };
  const matches = data => data?.edition?.generated_at === latest.generated_at && data.edition.articles?.length === latest.articles.length;
  if (matches(await request('/api/brief'))) return {changed:false,generated_at:latest.generated_at,articles:latest.articles.length};
  const result = await request('/api/sync', {editions});
  if (!result?.ok) throw new Error('Site rejected synchronization.');
  if (!matches(await request('/api/brief'))) throw new Error('Synchronization readback mismatch.');
  return {changed:true,generated_at:latest.generated_at,articles:latest.articles.length};
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const state = JSON.parse(await readFile('.news-state/state.json', 'utf8'));
    console.log(JSON.stringify(await syncSite(state, process.env.DAILY_NEWS_SITE_TOKEN)));
  } catch (error) {
    // Never log request headers, credentials, response bodies, or source data.
    console.error(error.message.startsWith('Configure ') ? error.message : 'Direct website sync failed; inspect endpoint access and source validity. Existing editions retained.');
    process.exitCode=1;
  }
}
