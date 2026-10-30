import {test} from 'node:test';
import assert from 'node:assert/strict';
import {buildBrief} from '../src/brief/pipeline.js';
const now=Date.parse('2026-10-28T09:00:00Z');
test('bounded grouping includes every source, batches model input and accounts for missing candidates',async()=>{
  const sources=Array.from({length:15},(_,n)=>({id:'source'+n,enabled:true,domains:['source'+n+'.example']}));
  const items=sources.flatMap((s,n)=>Array.from({length:15},(_,j)=>({id:n*15+j+1,feed_id:s.id,title:'事件'+n+'-'+j,link:'https://'+s.domains[0]+'/'+j,published_at:now-n*1000-j})));
  const calls=[];
  const result=await buildBrief({items,sources,now,fetchArticle:async()=>({ok:false,error:'fixture-body-unavailable'}),chat:async opts=>{
    assert.equal(opts.stage,'group');
    const payload=JSON.parse(opts.user.split('<data>\n')[1].split('\n</data>')[0]);calls.push(payload);
    return {ok:true,data:{events:[]}};
  }});
  assert.ok(calls.every(c=>c.length<=30),'each request fits a bounded JSON output');
  assert.equal(new Set(calls.flat().map(i=>i.source)).size,15,'late sources must not starve');
  assert.equal(result.diagnostics.candidates,150);
  assert.equal(result.diagnostics.ungrouped,150,'omissions must be measurable');
});

test('reports of the same event from different batches are merged before article extraction',async()=>{
  const sources=Array.from({length:4},(_,n)=>({id:'s'+n,enabled:true,domains:['s'+n+'.example']}));
  const items=sources.flatMap((s,n)=>Array.from({length:10},(_,j)=>({id:n*10+j+1,feed_id:s.id,title:'同一事件的报道',link:'https://'+s.domains[0]+'/'+j,published_at:now-j})));
  let merges=0;
  const result=await buildBrief({items,sources,now,fetchArticle:async()=>({ok:false,error:'fixture-body-unavailable'}),chat:async opts=>{
    const payload=JSON.parse(opts.user.split('<data>\n')[1].split('\n</data>')[0]);
    if(opts.stage==='merge'){merges++;return {ok:true,data:{clusters:[payload.map(g=>g.id)]}};}
    return {ok:true,data:{events:[{item_ids:payload.map(i=>i.id),scores:{impact:8,consequence:8,recency:8}}]}};
  }});
  assert.equal(merges,1);assert.equal(result.diagnostics.groups,1);
});
