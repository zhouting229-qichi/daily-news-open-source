// Public endpoints documented in MIT-licensed NewsNow and DailyHotApi.
// See OPEN_SOURCE_SOURCES.md for upstream paths and attribution.
import {fetchPublic,assessSource} from './evidence.js';
const timestamp=value=>{
  if(value===null||value===undefined||value==='')return null;
  const n=Number(value);if(Number.isFinite(n)&&n>0)return n<1e12?n*1000:n;
  const date=Date.parse(value);return Number.isFinite(date)?date:null;
};
const plain=value=>String(value??'').replace(/<[^>]*>/g,'').trim();
export function parseAdapter(adapter,data){
  if(adapter==='nhk-zh')return (data?.data??[]).map(v=>({guid:String(v.id),title:plain(v.title),summary:plain(v.description).slice(0,600),link:new URL(v.page_url,'https://www3.nhk.or.jp').href,published_at:timestamp(v.public_at)}));
  if(adapter==='cctv')return (data?.data?.list??[]).map(v=>({guid:String(v.id),title:plain(v.title),summary:plain(v.brief).slice(0,600),link:v.url,published_at:typeof v.focus_date==='string'?Date.parse(v.focus_date.replace(' ','T')+'+08:00'):null}));
  if(adapter==='thepaper')return (data?.data?.hotNews??[]).map(v=>({guid:String(v.contId),title:plain(v.name),summary:'',link:`https://www.thepaper.cn/newsDetail_forward_${v.contId}`,published_at:timestamp(v.pubTimeLong)}));
  if(adapter==='wallstreetcn-news')return (data?.data?.items??[]).filter(v=>v.resource&&!['ad','theme'].includes(v.resource_type)&&v.resource.type!=='live').map(({resource:v})=>({guid:String(v.id),title:plain(v.title||v.content_short),summary:plain(v.content_short).slice(0,600),link:v.uri,published_at:timestamp(v.display_time)}));
  throw new Error('unsupported source adapter');
}
export async function collectAdapter(source,options={}){
  const result=await fetchPublic(source.api_url,{domains:source.domains,...options});
  const wrapped=result.text.trim().match(/^[A-Za-z_$][\w$]*\(([\s\S]*)\);?\s*$/);
  const data=JSON.parse(wrapped?wrapped[1]:result.text);
  return parseAdapter(source.adapter,data).filter(i=>i.guid&&i.title&&assessSource(i.link,[source])).slice(0,30);
}
