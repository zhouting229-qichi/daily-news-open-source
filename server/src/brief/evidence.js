import { request as httpsRequest } from 'node:https';
import { request as httpRequest } from 'node:http';
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { parseHTML } from 'linkedom';
import { Readability } from '@mozilla/readability';
import {gunzipSync,inflateSync,brotliDecompressSync} from 'node:zlib';

const MAX_BYTES = 2_000_000;
function validURL(raw, domains) {
  try {
    const u = new URL(raw), host = u.hostname.toLowerCase();
    if (!['https:','http:'].includes(u.protocol) || u.username || u.password || u.port || isIP(host.replace(/[\[\]]/g,''))) return null;
    if (!domains.some(d=>host===d || host.endsWith('.'+d))) return null;
    return u;
  } catch { return null; }
}
export function assessSource(url, sources) { return sources.find(s=>s.enabled!==false && validURL(url,s.domains??[])) ?? null; }

function publicAddress(address) {
  if (isIP(address)===4) {
    const [a,b] = address.split('.').map(Number);
    return !(a===0 || a===10 || a===127 || a>=224 || (a===169&&b===254) || (a===172&&b>=16&&b<=31) || (a===192&&b===168) || (a===100&&b>=64&&b<=127) || (a===198&&(b===18||b===19)));
  }
  // Use IPv4 for connections below. No literal or mapped IPv6 can reach the socket.
  return false;
}

// Resolve once and pin the public address on the actual socket (DNS rebinding guard).
async function publicRequest(url) {
  const u = new URL(url);
  const addresses = await lookup(u.hostname,{family:4,all:true});
  if (!addresses.length || addresses.some(a=>!publicAddress(a.address))) throw new Error('blocked private address');
  return new Promise((resolve,reject)=>{
    let settled=false;
    const req=(u.protocol==='https:'?httpsRequest:httpRequest)(u,{
      method:'GET',headers:{'user-agent':'DailyBrief/1.0 (public news research)','accept':'text/html,application/rss+xml,application/xml;q=0.9,*/*;q=0.5'},
      lookup:(_host,opts,cb)=>opts.all ? cb(null,[addresses[0]]) : cb(null,addresses[0].address,4),
    },res=>{
      const chunks=[]; let size=0;
      res.on('data',chunk=>{size+=chunk.length;if(size>MAX_BYTES){req.destroy(new Error('response too large'));res.destroy();}else chunks.push(chunk);});
      res.on('error',reject);
      res.on('end',()=>{settled=true;clearTimeout(timer);resolve(new Response(Buffer.concat(chunks),{status:res.statusCode,headers:res.headers}));});
    });
    const timer=setTimeout(()=>req.destroy(new Error('request timeout')),15_000);
    req.on('error',e=>{clearTimeout(timer);if(!settled)reject(e);});
    req.end();
  });
}

export async function fetchPublic(url,{domains,request=publicRequest}={}) {
  let current=url;
  for(let n=0;n<5;n++) {
    const u=validURL(current,domains??[]);
    if(!u)throw new Error('blocked URL or redirect outside trusted domains');
    const res=await request(u.href);
    if([301,302,303,307,308].includes(res.status)) {
      const location=res.headers.get('location');
      if(!location)throw new Error('redirect without location');
      current=new URL(location,u).href; continue;
    }
    if(!res.ok)throw new Error(`HTTP ${res.status}`);
    // node:http(s) returns compressed bytes unchanged, unlike native fetch.
    // Bound both the wire body and every decompression stage before XML/HTML.
    let bytes=Buffer.from(await res.arrayBuffer());
    if(bytes.length>MAX_BYTES)throw new Error('response too large');
    const encodings=(res.headers.get('content-encoding')||'identity').split(',').map(s=>s.trim().toLowerCase()).reverse();
    for(const encoding of encodings){
      const decode=({gzip:gunzipSync,'x-gzip':gunzipSync,deflate:inflateSync,br:brotliDecompressSync})[encoding];
      if(encoding==='identity'||!encoding)continue;
      if(!decode)throw new Error('unsupported content encoding');
      try{bytes=decode(bytes,{maxOutputLength:MAX_BYTES});}catch(e){throw new Error(e.code==='ERR_BUFFER_TOO_LARGE'?'response too large':'invalid compressed response');}
    }
    const text=bytes.toString('utf8');
    return {text,url:u.href,content_type:res.headers.get('content-type')??''};
  }
  throw new Error('too many redirects');
}

export function extractArticle(html,url) {
  const {document}=parseHTML(html);
  let publisherBody='',publisherDate=null;
  // Only a documented public full-content field, never summary/description.
  if(new URL(url).hostname.endsWith('.thepaper.cn') || new URL(url).hostname==='thepaper.cn'){
    try{
      const detail=JSON.parse(document.querySelector('#__NEXT_DATA__')?.textContent??'{}')?.props?.pageProps?.detailData?.contentDetail;
      if(typeof detail?.content==='string'){
        const parsed=parseHTML('<html><body>'+detail.content+'</body></html>');
        parsed.document.querySelectorAll('script,style').forEach(el=>el.remove());
        publisherBody=parsed.document.body.textContent;
        if(Number.isFinite(detail.publishTime))publisherDate=detail.publishTime;
      }
    }catch{/* fall back to public article markup */}
  }
  const meta=(key)=>document.querySelector(`meta[property="${key}"],meta[name="${key}"]`)?.getAttribute('content');
  const dates=[meta('article:published_time'),meta('datePublished'),meta('publishdate'),meta('pubdate'),meta('date'),document.querySelector('time[datetime]')?.getAttribute('datetime')];
  for(const script of document.querySelectorAll('script[type="application/ld+json"]')){
    try{const walk=v=>{if(!v||typeof v!=='object')return;if(typeof v.datePublished==='string')dates.push(v.datePublished);for(const x of Object.values(v))if(typeof x==='object')Array.isArray(x)?x.forEach(walk):walk(x);};walk(JSON.parse(script.textContent));}catch{/* invalid publisher metadata is ignored */}
  }
  const urlDate=new URL(url).pathname.match(/\/(20\d{2})[-/]?(\d{2})[-/]?(\d{2})(?:\/|-|_)/);
  if(urlDate)dates.push(`${urlDate[1]}-${urlDate[2]}-${urlDate[3]}T00:00:00Z`);
  const parsedDates=dates.map(v=>Date.parse(v??'')).filter(Number.isFinite);
  if(publisherDate)parsedDates.push(publisherDate);
  const published_at=parsedDates.length?Math.min(...parsedDates):null;
  const inaccessible = /"isAccessibleForFree"\s*:\s*(?:false|"false")/i.test(html);
  document.querySelectorAll('script,style,nav,footer,header,aside,form,[hidden]').forEach(el=>el.remove());
  let article;
  try { article=new Readability(document.cloneNode(true),{charThreshold:200}).parse(); } catch { /* conservative article-only fallback */ }
  const root=document.querySelector('article') || document.querySelector('main');
  const body=(publisherBody || article?.textContent || root?.textContent || '').replace(/\s+/g,' ').trim().slice(0,18000);
  return {title:article?.title || meta('og:title') || document.title || '',body,published_at,inaccessible,url,explicit_body:!!publisherBody};
}

function originFor(source,body) {
  const lead=body.slice(0,1400);
  if(/\(Reuters\)|Source:\s*Reuters|©\s*Reuters|据路透社|来源[:：]\s*路透社/i.test(lead))return {origin:'wire:reuters',origin_verified:true};
  if(/\(AP\)|Source:\s*(?:The )?Associated Press|据美联社|来源[:：]\s*美联社/i.test(lead))return {origin:'wire:ap',origin_verified:true};
  if(/来源[:：]\s*新华社|新华社[\s\S]{0,25}电/.test(lead))return {origin:'wire:xinhua',origin_verified:true};
  // A publisher being a wire service does not prove this particular item is original.
  if(source.kind==='wire'&&(/\(Reuters\)|\(AP\)|新华社.{0,25}电|中新社.{0,25}电|中新网.{0,25}电/.test(lead)))return {origin:`wire:${source.id}`,origin_verified:true};
  return {origin:`unknown:${source.id}`,origin_verified:false};
}

export async function fetchArticle(item,source,options={}) {
  try {
    if(!assessSource(item.link,[source]))throw new Error('untrusted original URL');
    if(source.body_adapter==='nhk-zh'){
      const id=new URL(item.link).pathname.match(/^\/nhkworld\/zh\/news\/([^/]+)\/?$/)?.[1]||'';
      if(!/^(?:\d{8}_[A-Za-z0-9]+|(?:nd-)?\d{8}[a-z]{2}\d+)$/.test(id))throw new Error('invalid NHK story id');
      const api=`https://api.nhkworld.jp/nwapi/rdnewsweb/v6b/zh/detail/${id}.json`;
      const page=await fetchPublic(api,{domains:source.domains,...options}),data=JSON.parse(page.text).data;
      if(typeof data?.detail!=='string')throw new Error('missing NHK full article');
      const {document}=parseHTML('<html><body>'+data.detail+'</body></html>');document.querySelectorAll('script,style').forEach(el=>el.remove());
      const body=document.body.textContent.replace(/\s+/g,' ').trim().slice(0,18000);
      if(body.length<70)throw new Error('insufficient article body');
      return {ok:true,evidence:{id:`s${item.id}`,source_id:source.id,source_name:source.name,kind:source.kind,url:item.link,retrieved_url:api,
        title:item.title,body,published_at:Number.isFinite(Number(data.public_at))&&Number(data.public_at)>0?Number(data.public_at):item.published_at??null,fetched_at:Date.now(),...originFor(source,body)}};
    }
    const page=await fetchPublic(item.link,{domains:source.domains,...options});
    if(page.content_type && !/html|xml|text\//i.test(page.content_type))throw new Error('unsupported content type');
    const parsed=extractArticle(page.text,page.url);
    if(parsed.inaccessible)throw new Error('paywall: not accessible for free');
    if(parsed.body.length<(parsed.explicit_body?70:300))throw new Error('insufficient article body');
    return {ok:true,evidence:{id:`s${item.id}`,source_id:source.id,source_name:source.name,kind:source.kind,
      url:page.url,title:parsed.title||item.title,body:parsed.body,published_at:parsed.published_at??item.published_at,
      fetched_at:Date.now(),...originFor(source,parsed.body)}};
  }catch(e){return {ok:false,item_id:item.id,error:e.message};}
}
