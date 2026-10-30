import {test} from 'node:test';
import assert from 'node:assert/strict';
import {sectionArticles,renderFeed} from '../public/feed.js';
import {renderPage,briefResponse} from '../lib/page.mjs';
const article={id:'event-1',title:'央行公布新政策',category:'经济',facts:[{text:'央行公布新政策',kind:'claim'},{text:'政策于明日起实施。',kind:'claim'}],sources:[]};
const edition={mode:'live',generated_at:1793236728203,articles:[article]};
test('finance includes economy and clearly identified market news without unrelated international news',()=>{
  const all=[article,{id:'rates',category:'国际',title:'美联储宣布降息'},{id:'war',category:'国际',title:'双方继续边境谈判'},{id:'ai',category:'科技',title:'新模型发布'}];
  assert.deepEqual(sectionArticles(all,'finance').map(a=>a.id),['event-1','rates']);
  assert.equal(sectionArticles(all,'all').length,4);
  assert.deepEqual(sectionArticles(all,'technology').map(a=>a.id),['ai']);
});
test('feed shows factual summaries, escaped titles and an article-specific ask action',()=>{
  const html=renderFeed({...edition,articles:[{...article,title:'<script>bad</script>'}]},'all');
  assert.ok(html.includes('政策于明日起实施'));
  assert.ok(!html.includes('<script>bad'));
  assert.match(html,/data-ask="event-1"/);
  assert.match(renderFeed(edition,'technology'),/暂无/);
});
test('server first paint contains news and script-safe bootstrap including retained timestamp',()=>{
  const dangerous={...edition,articles:[{...article,title:'</script><img src=x onerror=alert(1)>'}]};
  const shell='<body><!--CONTENT--><!--BOOTSTRAP--></body>';
  const html=renderPage(shell,{edition:dangerous,state:{status:'ready'}},{section:'all'});
  assert.ok(html.includes('&lt;/script&gt;'));
  assert.ok(!html.includes('</script><img'));
  assert.ok(html.includes('1793236728203'));
});
test('conditional API returns no content only for a matching complete response including stale state',async()=>{
  const request=new Request('https://news.test/api/brief');
  const data={edition,state:{status:'ready',stale:false}};
  const first=await briefResponse(request,data);
  assert.equal(first.status,200);
  const headers={'if-none-match':first.headers.get('etag')};
  const same=await briefResponse(new Request(request,{headers}),data);
  assert.equal(same.status,304);
  assert.equal(await same.text(),'');
  const changed=await briefResponse(new Request(request,{headers}),{...data,state:{...data.state,stale:true}});
  assert.equal(changed.status,200);
  assert.match(first.headers.get('cache-control'),/private.*no-store/);
});

test('conditional refresh accepts the weak ETag added by Cloudflare compression',async()=>{
  const data={edition,state:{status:'ready',stale:false}},request=new Request('https://news.test/api/brief');
  const first=await briefResponse(request,data),tag=first.headers.get('etag');
  for(const header of ['W/'+tag,'"unrelated", W/'+tag]){
    const response=await briefResponse(new Request(request,{headers:{'if-none-match':header}}),data);
    assert.equal(response.status,304);assert.equal(await response.text(),'');
    assert.equal((await briefResponse(new Request(request,{headers:{'if-none-match':header}}),{...data,state:{status:'ready',stale:true}})).status,200);
  }
});

test('long Chinese conversations keep recent complete turns within the request byte budget',async()=>{
  const {questionPayload}=await import('../public/ask-context.js');
  const history=Array.from({length:4},(_,i)=>[{role:'user',content:'问题'+i},{role:'assistant',content:'答'.repeat(1800)}]).flat();
  const body=questionPayload({edition:1793236728203,articleId:'event-1',question:'新的问题',history});
  assert.ok(new TextEncoder().encode(JSON.stringify(body)).length<=18000);
  assert.equal(body.history.length%2,0);
  assert.equal(body.history.at(-2).content,'问题3');
  assert.ok(body.history.length<8);
});
