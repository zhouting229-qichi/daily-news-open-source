import {test} from 'node:test';
import assert from 'node:assert/strict';
import {buildBrief} from '../src/brief/pipeline.js';
const now=Date.parse('2026-10-27T02:00:00Z');
const source={id:'wire',name:'Example Wire',kind:'wire',enabled:true,domains:['wire.example']};
const items=[{id:1,feed_id:'wire',link:'https://wire.example/a',title:'Schools reopen',published_at:now-1000}];
const body='The ministry confirmed 120 schools reopened on Monday. The inspection is complete. '.repeat(8);
const fact={id:'f1',text:'该部门确认120所学校重新开放。',kind:'fact',citations:[{source_id:'s1',quote:'The ministry confirmed 120 schools reopened on Monday.'}]};
const fetchArticle=async()=>({ok:true,evidence:{id:'s1',source_id:'wire',source_name:'Example Wire',kind:'wire',url:'https://wire.example/a',body,published_at:now-1000,origin:'wire:wire',origin_verified:true}});
function model({checks=[{fact_id:'f1',supported:true,attribution_ok:true,time_ok:true,role:'lead'}],facts=[fact],ids=[1]}={}) {
  return async ({stage,user})=>{
    if(stage==='group')return {ok:true,data:{events:[{item_ids:ids,scores:{impact:8,consequence:8,recency:8},reason:'公共教育服务恢复'}]}};
    if(stage==='draft'){
      assert.ok(user.includes('The inspection is complete.'));
      return {ok:true,data:{facts}};
    }
    return {ok:true,data:{checks}};
  };
}
test('generation uses full bodies and publishes only source-supported facts',async()=>{
  const r=await buildBrief({items,sources:[source],chat:model(),fetchArticle,now});
  assert.equal(r.articles.length,1);
  assert.equal(r.articles[0].facts[0].text,'该部门确认120所学校重新开放。');
  assert.equal(r.articles[0].sources[0].url,'https://wire.example/a');
  assert.equal(r.mode,'live');
});

const background={id:'background',text:'这些学校在2018年开始建设。',kind:'fact',citations:[{source_id:'s1',quote:'Construction of these schools began in 2018.'}]};
const unrelated={id:'unrelated',text:'警方已完成议会大厦搜查。',kind:'fact',citations:[{source_id:'s1',quote:'Police completed a search of the parliament building.'}]};
const reviewCheck=(id,role)=>({fact_id:id,supported:true,attribution_ok:true,time_ok:true,role});
const mixedArticle=async()=>{const r=await fetchArticle();r.evidence.body+=' Construction of these schools began in 2018. Police completed a search of the parliament building.';return r;};

test('a surviving background fact cannot replace a rejected current-news headline',async()=>{
  const r=await buildBrief({items,sources:[source],now,fetchArticle:mixedArticle,chat:model({facts:[fact,background],checks:[{...reviewCheck('f1','lead'),supported:false},reviewCheck('background','background')]})});
  assert.equal(r.articles.length,0);
  assert.ok(r.excluded.some(e=>e.reason==='no verified current-event lead'));
});

test('current event leads the title, digest and detail even when background was drafted first',async()=>{
  const r=await buildBrief({items,sources:[source],now,fetchArticle:mixedArticle,chat:model({facts:[background,fact],checks:[reviewCheck('background','background'),reviewCheck('f1','lead')]})});
  assert.equal(r.articles[0].title,'该部门确认120所学校重新开放。');
  assert.deepEqual(r.articles[0].facts.map(f=>f.id),['f1','background']);
  assert.ok(r.articles[0].digest.startsWith('该部门确认120所学校重新开放。'));
});

test('unrelated live-blog entries are removed even when each sentence has valid evidence',async()=>{
  const r=await buildBrief({items,sources:[source],now,fetchArticle:mixedArticle,chat:model({facts:[fact,unrelated],checks:[reviewCheck('f1','lead'),reviewCheck('unrelated','unrelated')]})});
  assert.deepEqual(r.articles[0].facts.map(f=>f.id),['f1']);
  assert.ok(r.excluded.some(e=>e.id==='unrelated'&&e.reason==='unrelated-event-fact'));
});

test('missing, ambiguous or duplicated lead review cannot publish an arbitrary title',async()=>{
  for(const checks of [
    [{fact_id:'f1',supported:true,attribution_ok:true,time_ok:true}],
    [reviewCheck('f1','lead'),reviewCheck('background','lead')],
    [reviewCheck('f1','lead'),reviewCheck('f1','lead')],
  ]){
    const r=await buildBrief({items,sources:[source],now,fetchArticle:mixedArticle,chat:model({facts:[fact,background],checks})});
    assert.equal(r.articles.length,0);
  }
});

test('draft and independent review receive the event focus and edition clock',async()=>{
  const base=model();const payloads={};
  await buildBrief({items,sources:[source],now,fetchArticle,chat:async opts=>{
    if(opts.stage==='draft'||opts.stage==='verify')payloads[opts.stage]=JSON.parse(opts.user.split('<data>\n')[1].split('\n</data>')[0]);
    return base(opts);
  }});
  for(const stage of ['draft','verify']){
    assert.equal(payloads[stage].now,now);
    assert.deepEqual(payloads[stage].event.titles,['Schools reopen']);
  }
});
test('independent review rejection excludes plausible but unsupported assertions',async()=>{
  const r=await buildBrief({items,sources:[source],chat:model({checks:[{fact_id:'f1',supported:false,attribution_ok:true,time_ok:true}]}),fetchArticle,now});
  assert.equal(r.articles.length,0);
});
test('fabricated IDs, undated items and stale article bodies never become current facts',async()=>{
  const r=await buildBrief({items:[...items,{...items[0],id:2,published_at:null}],sources:[source],chat:model({ids:[999]}),fetchArticle,now});
  assert.equal(r.articles.length,0);
  const stale=await buildBrief({items,sources:[source],chat:model(),fetchArticle:async()=>{const r=await fetchArticle();r.evidence.published_at=now-3*86400000;return r;},now});
  assert.equal(stale.articles.length,0);
});
test('unsupported numbers fail even when the model review claims success',async()=>{
  const r=await buildBrief({items,sources:[source],chat:model({facts:[{...fact,text:'该部门确认1200所学校重新开放。'}]}),fetchArticle,now});
  assert.equal(r.articles.length,0);
});

test('a verified eligible event is not silently removed by a second higher importance threshold',async()=>{
  const base=model();
  const r=await buildBrief({items,sources:[source],now,chat:async opts=>opts.stage==='group'?{ok:true,data:{events:[{item_ids:[1],category:'经济',scores:{impact:7,consequence:6,recency:8}}]}}:base(opts),fetchArticle:async()=>{const r=await fetchArticle();r.evidence.origin_verified=false;return r;}});
  assert.equal(r.articles.length,1);
});
test('model errors and no article bodies fail closed',async()=>{
  const r=await buildBrief({items,sources:[source],chat:model(),fetchArticle:async()=>({ok:false,error:'403'}),now});
  assert.equal(r.articles.length,0);
  assert.equal(r.excluded[0].reason,'403');
  await assert.rejects(buildBrief({items,sources:[source],chat:async()=>({ok:false,error:'missing-env'}),fetchArticle,now}),/missing-env/);
  await assert.rejects(buildBrief({items,sources:[source],chat:async()=>({ok:false,error:'http-402'}),fetchArticle,now}),/group:http-402/);
  await assert.rejects(buildBrief({items,sources:[source],chat:async()=>({ok:false,error:'sk-private-test'}),fetchArticle,now}),/^Error: group:model-request-failed$/);
});
