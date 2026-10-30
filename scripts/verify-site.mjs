import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {selectEditions,siteOrigin} from './sync-site.mjs';

// Read-only production checks use the same owner-private service access as sync.
// AI needs a signed-in visitor; a service credential must never impersonate one.
export async function verifySite(state,token,fetcher=fetch,siteUrl=process.env.DAILY_NEWS_SITE_URL){
  const SITE=siteOrigin(siteUrl);
  if(!SITE)return {ok:true,skipped:true,checks:0,reason:'site-not-configured'};
  if(!token)throw Error('missing site service configuration');
  const latest=selectEditions(state)[0];assert.ok(latest);
  let checks=0;
  const get=async(path,headers={})=>{
    const r=await fetcher(SITE+path,{redirect:'error',signal:AbortSignal.timeout(20000),headers:{'OAI-Sites-Authorization':'Bearer '+token,...headers}});
    assert.equal(r.status,200,'GET '+path);checks++;return r;
  };
  const brief=await get('/api/brief'),etag=brief.headers.get('etag'),data=await brief.json();
  assert.equal(data.edition.generated_at,latest.generated_at);assert.equal(data.edition.articles.length,latest.articles.length);
  const html=await(await get('/')).text();assert.ok(html.includes('news-bootstrap'));assert.ok(html.includes('每日新闻'));
  for(const section of ['finance','technology','world'])await get('/?section='+section);
  for(const a of latest.articles){const html=await(await get('/story/'+latest.generated_at+'/'+a.id)).text();assert.ok(html.includes('查看逐句原文依据'));assert.ok(html.includes('原文摘录'));}
  for(const edition of selectEditions(state)){const archived=await(await get('/api/edition/'+edition.generated_at)).json();assert.equal(archived.articles.length,edition.articles.length);}
  const manifest=await(await get('/manifest.webmanifest')).json();assert.equal(manifest.display,'standalone');assert.equal(manifest.start_url,'/');
  for(const icon of manifest.icons){const b=Buffer.from(await(await get(icon.src)).arrayBuffer());assert.equal(b.subarray(1,4).toString(),'PNG');assert.equal(b.readUInt32BE(16),Number(icon.sizes.split('x')[0]));}
  for(const path of ['/app.js?v=4','/view.js?v=4','/feed.js?v=4','/ask.js?v=4','/ask-context.js?v=4','/runtime.js','/install.js','/sw.js','/style.css?v=4'])await get(path);
  assert.ok(etag);
  const conditional=await fetcher(SITE+'/api/brief',{redirect:'error',signal:AbortSignal.timeout(20000),headers:{'OAI-Sites-Authorization':'Bearer '+token,'If-None-Match':etag}});
  assert.equal(conditional.status,304);checks++;
  const anonymous=await fetcher(SITE+'/api/brief',{redirect:'manual',signal:AbortSignal.timeout(20000)});assert.ok(!anonymous.ok,'private news must require access');checks++;
  const noVisitor=await fetcher(SITE+'/api/ask',{method:'POST',redirect:'error',signal:AbortSignal.timeout(20000),headers:{'OAI-Sites-Authorization':'Bearer '+token,'Content-Type':'application/json',Origin:SITE},body:'{}'});
  assert.equal(noVisitor.status,401,'service access must not impersonate a signed-in visitor');checks++;
  return {ok:true,checks,generated_at:latest.generated_at,articles:latest.articles.length};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  try{console.log(JSON.stringify(await verifySite(JSON.parse(await readFile('.news-state/state.json','utf8')),process.env.DAILY_NEWS_SITE_TOKEN)));}
  catch(error){console.error('Production verification failed:',error.code==='ERR_ASSERTION'?error.message.slice(0,500):error.name);process.exitCode=1;}
}
