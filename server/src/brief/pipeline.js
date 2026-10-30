import {chatJSON, mapLimit} from '../curate/llm.js';
import {fetchArticle as defaultFetch, assessSource} from './evidence.js';
import {rankEvents,validateFacts,reportingOrigins,recentItem} from './policy.js';
import {SYSTEM,GROUP,DRAFT,VERIFY,MERGE,GROUP_RUBRIC} from './prompts.js';

export async function buildBrief({items,sources,chat=chatJSON,fetchArticle=defaultFetch,now=Date.now()}) {
  const excluded=[], source_status=[];
  const pool=items.filter(i=>recentItem(i,now)&&sources.some(s=>s.id===i.feed_id&&assessSource(i.link,[s])))
    .sort((a,b)=>b.published_at-a.published_at);
  // Round-robin feeds bounds input without prioritising whichever publishes fastest.
  const perSource=new Map();
  for(const i of pool){if(!perSource.has(i.feed_id))perSource.set(i.feed_id,[]);if(perSource.get(i.feed_id).length<10)perSource.get(i.feed_id).push(i);}
  const queues=[...perSource.values()],candidates=[];
  for(let n=0;n<10;n++)for(const queue of queues)if(queue[n]&&candidates.length<180)candidates.push(queue[n]);
  const diagnostics={pool:pool.length,candidates:candidates.length,group_batches:0,groups:0,ungrouped:0,important:0,published:0};
  if(!candidates.length)return {mode:'live',articles:[],excluded:[{reason:'no recent trusted items'}],source_status,cutoff_at:now};
  const invoke=async(stage,instruction,payload)=>{
    const r=await chat({stage,system:SYSTEM,user:instruction+'\n<data>\n'+JSON.stringify(payload)+'\n</data>',maxTokens:6000,timeoutMs:60_000});
    if(!r.ok){
      const reason=/^(missing-env|http-\d{3}|model-timeout|empty-content|invalid-json|non-json-response status=\d+)$/.test(r.error)?r.error:'model-request-failed';
      throw new Error(`${stage}:${reason}`);
    }
    return r.data;
  };
  const grouping={events:[]};
  for(let offset=0;offset<candidates.length;offset+=30){
    const batch=await invoke('group',GROUP+'\n'+GROUP_RUBRIC,candidates.slice(offset,offset+30).map(i=>({id:i.id,title:i.title,summary:i.summary?.slice(0,250),source:i.feed_id,published_at:i.published_at})));
    if(!Array.isArray(batch?.events))throw new Error('invalid-group-output');
    grouping.events.push(...batch.events);diagnostics.group_batches++;
  }
  if(!Array.isArray(grouping?.events))throw new Error('invalid-group-output');
  const byId=new Map(candidates.map(i=>[i.id,i])),used=new Set();
  let groups=[];
  for(const g of grouping.events){
    const ids=[...new Set(Array.isArray(g.item_ids)?g.item_ids:[])].filter(id=>byId.has(id)&&!used.has(id));
    if(!ids.length)continue;
    ids.forEach(id=>used.add(id));groups.push({...g,item_ids:ids.slice(0,5)});
  }
  diagnostics.ungrouped=candidates.filter(i=>!used.has(i.id)).length;
  if(diagnostics.group_batches>1&&groups.length>1){
    const merged=await invoke('merge',MERGE,groups.map((g,id)=>({id,category:g.category,reason:g.reason,titles:g.item_ids.slice(0,2).map(id=>byId.get(id).title)})));
    if(!Array.isArray(merged?.clusters))throw new Error('invalid-merge-output');
    const seen=new Set(),combined=[];
    for(const cluster of merged.clusters){
      const ids=[...new Set(Array.isArray(cluster)?cluster:[])].filter(id=>Number.isInteger(id)&&groups[id]&&!seen.has(id));
      if(!ids.length)continue;ids.forEach(id=>seen.add(id));
      const members=ids.map(id=>groups[id]);
      combined.push({...members[0],item_ids:[...new Set(members.flatMap(g=>g.item_ids))].slice(0,8),scores:Object.fromEntries(['impact','consequence','recency'].map(k=>[k,Math.max(...members.map(g=>Number(g.scores?.[k])||0))]))});
    }
    groups=[...combined,...groups.filter((_,i)=>!seen.has(i))];
  }
  diagnostics.groups=groups.length;
  const articles=[];
  // No article-count quota: every important group in the candidate set is reviewed.
  const important=rankEvents(groups.map((g,i)=>({...g,id:i,scores:{...g.scores,attention:0}})),{minimumScore:40});
  diagnostics.important=important.length;
  for(const [index,g] of important.entries()){
    const results=await mapLimit(g.item_ids,3,async id=>{
      const item=byId.get(id),source=sources.find(s=>s.id===item.feed_id);
      const r=await fetchArticle(item,source);
      if(!r.ok){excluded.push({item_id:id,source_id:source.id,reason:r.error});source_status.push({source_id:source.id,body_ok:false,error:r.error});return null;}
      if(!recentItem(r.evidence,now)){excluded.push({item_id:id,reason:'article date outside 24-hour window'});return null;}
      source_status.push({source_id:source.id,body_ok:true});return r.evidence;
    });
    const evidence=results.filter(r=>r.ok&&r.result).map(r=>r.result);
    if(!evidence.length)continue;
    const event={category:g.category,reason:g.reason,titles:g.item_ids.map(id=>byId.get(id).title)};
    let draft,review;
    try{
      draft=await invoke('draft',DRAFT,{now,event,evidence:evidence.map(({body,...e})=>({...e,body:body.slice(0,12000)}))});
      const valid=validateFacts(draft,evidence);
      excluded.push(...valid.rejected.map(r=>({...r,event:index})));
      if(!valid.facts.length)continue;
      review=await invoke('verify',VERIFY,{now,event,facts:valid.facts,evidence:evidence.map(e=>({id:e.id,title:e.title,body:e.body.slice(0,12000),kind:e.kind,published_at:e.published_at}))});
      const checks=Array.isArray(review?.checks)?review.checks:[];
      const accepted=valid.facts.flatMap(f=>{
        const matches=checks.filter(c=>c.fact_id===f.id);
        const check=matches.length===1?matches[0]:null;
        let reason='';
        if(!/[\u3400-\u9fff]/.test(f.text)||!check||check.supported!==true||check.attribution_ok!==true||check.time_ok!==true)reason='semantic-verification-rejected';
        else if(check.role==='unrelated')reason='unrelated-event-fact';
        else if(!['lead','detail','background'].includes(check.role))reason='missing-event-role';
        if(reason){excluded.push({event:index,id:f.id,reason});return [];}
        return [{...f,role:check.role}];
      });
      const leads=accepted.filter(f=>f.role==='lead');
      if(leads.length!==1){excluded.push({event:index,reason:leads.length?'ambiguous current-event lead':'no verified current-event lead'});continue;}
      // A removed lead must never promote a historical aside or unrelated update.
      const facts=[leads[0],...accepted.filter(f=>f.role==='detail'),...accepted.filter(f=>f.role==='background')];
      const citeIds=new Set(facts.flatMap(f=>f.citations.map(c=>c.source_id)));
      const retained=evidence.filter(e=>citeIds.has(e.id));
      const origins=reportingOrigins(retained);
      articles.push({id:`event-${index+1}`,title:facts[0].text,category:String(g.category||'要闻').slice(0,12),facts,
        digest:facts.map(f=>f.text).join(''),sources:retained.map(({body,...e})=>e),
        scores:{...g.scores,attention:Math.min(10,origins.known*2)},origins,
        reason:String(g.reason||'').slice(0,120),evidence_check:'automated',
        latest_at:Math.max(...retained.map(e=>e.published_at))});
    }catch(e){excluded.push({event:index,reason:e.message});}
  }
  const published=rankEvents(articles,{minimumScore:40});diagnostics.published=published.length;
  diagnostics.rejections=Object.fromEntries([...new Set(excluded.map(x=>x.reason))].map(reason=>[reason,excluded.filter(x=>x.reason===reason).length]));
  return {mode:'live',revision:3,articles:published,diagnostics,excluded,source_status,cutoff_at:now};
}
