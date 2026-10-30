import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {Miniflare} from 'miniflare';

// Exercise real Worker fetch validation; a plain Node fetch double accepts
// redirect options that production Workers reject before contacting DeepSeek.
async function worker(providerResponse){
  const files=['lib/ask-handler.mjs','lib/news-data.mjs'];
  const modules=await Promise.all(files.map(async path=>({type:'ESModule',path,contents:await readFile(new URL('../'+path,import.meta.url),'utf8')})));
  let calls=0;
  const mf=new Miniflare({compatibilityDate:'2026-05-15',compatibilityFlags:['nodejs_compat'],d1Databases:['DB'],
    modules:[{type:'ESModule',path:'entry.mjs',contents:`import {handleAsk} from './lib/ask-handler.mjs';export default{fetch(request,env){return handleAsk(request,{db:env.DB,apiKey:'runtime-test-key'});}}`},...modules],
    outboundService:async request=>{calls++;assert.equal(new URL(request.url).hostname,'api.deepseek.com');return providerResponse();}});
  const db=await mf.getD1Database('DB');
  await db.exec('CREATE TABLE news_editions (generated_at INTEGER PRIMARY KEY,payload TEXT NOT NULL)');
  await db.prepare('INSERT INTO news_editions VALUES (?,?)').bind(1793236728203,JSON.stringify({mode:'live',generated_at:1793236728203,articles:[{id:'event-1',title:'政策公布',facts:[{id:'f1',text:'政策公布',kind:'fact',citations:[{source_id:'s1',quote:'政策公布'}]}],sources:[{id:'s1',source_name:'官方',url:'https://example.com/policy'}]}]})).run();
  return {mf,calls:()=>calls,request:()=>mf.dispatchFetch('https://news.test/api/ask',{method:'POST',headers:{'Content-Type':'application/json',Origin:'https://news.test','oai-authenticated-user-id':'owner','oai-authenticated-user-email':'owner@example.com'},body:JSON.stringify({edition:1793236728203,articleId:'event-1',question:'主要内容是什么？'})})};
}
test('AI answers reach the provider and return through the actual Workers fetch runtime',async()=>{
  const w=await worker(()=>Response.json({choices:[{message:{content:'报道事实：政策已公布。[1]'},finish_reason:'stop'}]}));
  try{const response=await w.request();assert.equal(response.status,200);assert.equal((await response.json()).answer,'报道事实：政策已公布。[1]');assert.equal(w.calls(),1);}finally{await w.mf.dispose();}
});
test('Workers never follow a provider redirect or send the key to another host',async()=>{
  const w=await worker(()=>new Response(null,{status:302,headers:{Location:'https://evil.test/capture'}}));
  try{const response=await w.request();assert.equal(response.status,502);assert.equal(w.calls(),1);assert.ok(!(await response.text()).includes('runtime-test-key'));}finally{await w.mf.dispose();}
});
