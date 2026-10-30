import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assessSource, extractArticle, fetchArticle, fetchPublic } from '../src/brief/evidence.js';
import {gzipSync,deflateSync,brotliCompressSync} from 'node:zlib';

test('compressed publisher RSS and article bodies are decoded before parsing',async()=>{
  const body='<rss><channel><item><title>联合国新闻</title><link>https://news.un.org/zh/story/1</link></item></channel></rss>';
  for(const [encoding,compress] of [['gzip',gzipSync],['deflate',deflateSync],['br',brotliCompressSync]]){
    const result=await fetchPublic('https://news.un.org/feed/subscribe/zh/news/all/rss.xml',{domains:['un.org'],request:async()=>new Response(compress(body),{headers:{'content-encoding':encoding,'content-type':'application/rss+xml'}})});
    assert.equal(result.text,body);
  }
});
test('compressed oversized documents are rejected after bounded decompression',async()=>{
  await assert.rejects(fetchPublic('https://news.un.org/rss',{domains:['un.org'],request:async()=>new Response(gzipSync('a'.repeat(2_000_001)),{headers:{'content-encoding':'gzip'}})}),/large|length|size|buffer/i);
});

const source = {id:'bbc',name:'BBC',domains:['bbc.com'],enabled:true};
const story = 'The ministry announced a public education programme. Schools will reopen after an inspection. The statement includes the schedule and safety requirements. ';
const html = `<html><head><title>School programme</title><meta property="article:published_time" content="2026-10-27T00:00:00Z"></head><body><nav>Subscribe now</nav><article><h1>School programme</h1>${Array.from({length:5},()=>`<p>${story}</p>`).join('')}</article></body></html>`;

test('trusted domains match subdomains but reject lookalikes and private URLs', () => {
  assert.equal(assessSource('https://www.bbc.com/news/a',[source])?.id,'bbc');
  for (const url of ['https://bbc.com.attacker.org/a','http://127.0.0.1/','http://[::1]/','file:///etc/passwd','https://user:pass@bbc.com/a','https://bbc.com:1234/a']) assert.equal(assessSource(url,[source]),null);
});

test('extraction uses article body and real publication metadata', () => {
  const result = extractArticle(html,'https://bbc.com/news/a');
  assert.ok(result.body.includes('Schools will reopen'));
  assert.ok(!result.body.includes('Subscribe now'));
  assert.equal(result.published_at,Date.parse('2026-10-27T00:00:00Z'));
});

test('thin or paywall article is ineligible and does not expand RSS title', async () => {
  const result = await fetchArticle({id:1,link:'https://bbc.com/news/a',title:'Important news'}, source, {request:async()=>new Response('<html><body>Subscribe to read</body></html>')});
  assert.equal(result.ok,false);
  assert.match(result.error,/insufficient|paywall/);
});

test('redirects cannot leave trusted domains or reach loopback', async () => {
  await assert.rejects(fetchPublic('https://bbc.com/news/a',{domains:['bbc.com'],request:async()=>new Response(null,{status:302,headers:{location:'http://127.0.0.1/private'}})}),/blocked/);
});

test('article evidence records final URL and retrieval time', async () => {
  const result = await fetchArticle({id:7,link:'https://bbc.com/news/a',published_at:Date.parse('2026-10-27T00:00:00Z')}, source, {request:async()=>new Response(html,{headers:{'content-type':'text/html'}})});
  assert.equal(result.ok,true);
  assert.equal(result.evidence.id,'s7');
  assert.equal(result.evidence.url,'https://bbc.com/news/a');
  assert.ok(result.evidence.body.length>300);
});

test('original publication date wins over a newly updated RSS timestamp',()=>{
  const withDate=html.replace('<meta property="article:published_time" content="2026-10-27T00:00:00Z">','<script type="application/ld+json">{"@type":"NewsArticle","datePublished":"2020-08-27T00:00:00Z","dateModified":"2026-10-27T00:00:00Z"}</script>');
  assert.equal(extractArticle(withDate,'https://bbc.com/news/a').published_at,Date.parse('2020-08-27T00:00:00Z'));
});

test('wire attribution on a republished story takes precedence over the host publisher',async()=>{
  const wire={...source,id:'chinanews',kind:'wire'};
  const result=await fetchArticle({id:8,link:'https://bbc.com/news/a'},wire,{request:async()=>new Response(html.replace(story,'来源：新华社。新华社北京10月27日电。'+story))});
  assert.equal(result.evidence.origin,'wire:xinhua');
});

test('public publisher article content can support a short complete report without using its teaser',async()=>{
  const content='这是一条公开发布的完整新闻正文。部门公布新的公共服务安排，具体实施日期和适用对象已在公告中列明。有关负责人表示，将继续通过官方网站发布实施进展，公众可以查询完整文件和原始说明。';
  const page=`<html><head><title>公告</title></head><body><p>Subscribe teaser</p><script id="__NEXT_DATA__" type="application/json">${JSON.stringify({props:{pageProps:{detailData:{contentDetail:{content:'<p>'+content+'</p>',publishTime:1793059200000}}}}})}</script></body></html>`;
  const result=await fetchArticle({id:9,link:'https://www.thepaper.cn/newsDetail_forward_9'}, {...source,id:'thepaper',domains:['thepaper.cn']},{request:async()=>new Response(page)});
  assert.equal(result.ok,true);
  assert.equal(result.evidence.body,content);
  assert.equal(result.evidence.published_at,1793059200000);
});

test('NHK public Chinese detail JSON provides full text and original publication time',async()=>{
  const s={id:'nhk-zh',name:'NHK WORLD 中文',kind:'newsroom',enabled:true,domains:['nhk.or.jp','nhkworld.jp'],body_adapter:'nhk-zh'};
  const content='这是一篇来自官方接口的完整中文新闻。'.repeat(8);
  const r=await fetchArticle({id:10,guid:'20261027_ML04',link:'https://www3.nhk.or.jp/nhkworld/zh/news/20261027_ML04/'},s,{request:async()=>new Response(JSON.stringify({data:{detail:'<p>'+content+'</p>',public_at:'1793097417000'}}))});
  assert.equal(r.ok,true);assert.equal(r.evidence.body,content);
  assert.equal(r.evidence.published_at,1793097417000);
});

test('NHK current nd and compact identifiers retrieve the matching official full article',async()=>{
  const source={id:'nhk-zh',name:'NHK WORLD 中文',kind:'newsroom',enabled:true,domains:['nhk.or.jp','nhkworld.jp'],body_adapter:'nhk-zh'};
  for(const id of ['nd-20261029de67553','20261028de67332']){
    const body='官方公开报道的完整新闻正文，保留来源、发布日期和具体事件，不能用列表摘要替代。'.repeat(3);
    let requested='';
    const result=await fetchArticle({id:10,guid:id,link:'https://www3.nhk.or.jp/nhkworld/zh/news/'+id+'/'},source,{request:async url=>{requested=url;return Response.json({data:{detail:'<p>'+body+'</p>',public_at:'1793268939000'}});}});
    assert.equal(result.ok,true);assert.equal(result.evidence.body,body);assert.equal(result.evidence.published_at,1793268939000);
    assert.equal(requested,'https://api.nhkworld.jp/nwapi/rdnewsweb/v6b/zh/detail/'+id+'.json');
  }
});

test('two wires relaying the same Reuters report do not become independent origins',async()=>{
  const page=html.replace(story,'据路透社报道，'+story);
  const results=await Promise.all(['xinhua','chinanews'].map(id=>fetchArticle({id,link:'https://bbc.com/news/a'},{...source,id,kind:'wire'},{request:async()=>new Response(page)})));
  assert.equal(results[0].evidence.origin,results[1].evidence.origin);
});
