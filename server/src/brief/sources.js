import {readFileSync} from 'node:fs';
export function loadSources() { return JSON.parse(readFileSync(new URL('../../../sources.json',import.meta.url),'utf8')); }
export function sourceFeeds(sources=loadSources()) {
  return sources.filter(s=>s.enabled&&(s.feed_url||s.api_url)).map(s=>({...s,url:s.feed_url||s.api_url,type:s.adapter?'adapter':'official',paywall:false}));
}
