import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {createApp} from '../src/brief/http.js';
import {renderArticle,renderStatus} from '../../web/view.js';

test('article view escapes source text and exposes optional original evidence',()=>{
  const html=renderArticle({id:'a',title:'<script>alert(1)</script>',category:'科技',facts:[{id:'f1',text:'来源称一项计划已公布。',kind:'claim',attribution:'来源',citations:[{source_id:'s1',quote:'A public announcement was issued today.'}]}],sources:[{id:'s1',source_name:'Example',url:'https://example.org/a',published_at:1}],origins:{known:1,unknown:0}},0,'demo',true);
  assert.ok(!html.includes('<script>'));
  assert.ok(html.includes('https://example.org/a'));
  assert.ok(html.includes('A public announcement was issued today.'));
  assert.ok(html.includes('<details'));
});

test('minimal news list has title, category and source beneath, with content only on detail view',()=>{
  const html=renderArticle({id:'event-1',title:'一句话的主要新闻',category:'经济',facts:[{id:'f1',text:'这段具体内容仅在详情阅读。',citations:[]}],sources:[{id:'s1',source_name:'可信机构',url:'https://example.org/a'}]},0,123);
  assert.ok(html.includes('/story/123/event-1'));
  assert.ok(html.includes('经济'));
  assert.ok(html.includes('可信机构'));
  assert.ok(!html.includes('这段具体内容仅在详情阅读。'));
  assert.ok(!html.includes('<details'));
});

test('news feed uses a continuous title list and detail keeps analysis distinct with sources at the bottom',()=>{
  const article={id:'event-2',title:'主要事件已经发生',category:'时政',facts:[{id:'f1',text:'机构公布具体安排。',citations:[{source_id:'s1',quote:'The institution published the full arrangements.'}]}],analysis:{text:'这一安排的实际效果仍取决于后续执行。',basis_fact_ids:['f1']},sources:[{id:'s1',source_name:'原始机构',url:'https://example.org/a'}]};
  const list=renderArticle(article,1,1000);
  assert.ok(!list.includes('<h2'));
  assert.ok(!list.includes('这一安排的实际效果'));
  const detail=renderArticle(article,1,1000,true);
  assert.ok(detail.includes('这一安排的实际效果仍取决于后续执行。'));
  assert.ok(detail.indexOf('class="analysis"')<detail.indexOf('class="source-foot"'));
});
test('status view never calls a demonstration or retained old edition today news',()=>{
  const demo=renderStatus({mode:'demo',generated_at:1},{status:'unconfigured'});
  assert.match(demo,/非今日新闻/);
  assert.match(renderStatus({mode:'live',generated_at:1},{status:'failed',stale:true}),/保留上一版/);
});
test('read-only API exposes edition and safe source configuration without triggering generation',async()=>{
  const app=createApp({read:()=>({edition:null,last_run:null,health:null}),sources:[{id:'bbc',name:'BBC',domains:['bbc.com'],enabled:true}],isConfigured:false});
  const server=createServer(app);await new Promise(r=>server.listen(0,'127.0.0.1',r));
  const url=`http://127.0.0.1:${server.address().port}`;
  try{
    const r=await fetch(url+'/api/brief');const data=await r.json();
    assert.equal(data.state.status,'unconfigured');
    assert.equal(data.edition,null);
    assert.equal((await fetch(url+'/api/demo').then(r=>r.json())).mode,'demo');
    assert.equal((await fetch(url+'/api/brief',{method:'POST'})).status,405);
    assert.equal((await fetch(url+'/.env')).status,404);
  }finally{await new Promise(r=>server.close(r));}
});

test('permanent story links load archived editions inside the site',async()=>{
  const edition={mode:'live',generated_at:1000,articles:[{id:'event-1',title:'已存档的事实',facts:[],sources:[]}]};
  const app=createApp({read:()=>({edition:null,last_run:null,health:null}),findEdition:id=>id===1000?edition:null,sources:[],isConfigured:false});
  const server=createServer(app);await new Promise(r=>server.listen(0,'127.0.0.1',r));const url=`http://127.0.0.1:${server.address().port}`;
  try{
    assert.equal((await fetch(url+'/story/1000/event-1')).status,200);
    const detail=await fetch(url+'/api/edition/1000').then(r=>r.json());
    assert.equal(detail.articles[0].title,'已存档的事实');
    assert.equal((await fetch(url+'/api/edition/999')).status,404);
  }finally{await new Promise(r=>server.close(r));}
});
