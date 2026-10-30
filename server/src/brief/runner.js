import {fileURLToPath} from 'node:url';
import {db} from '../db.js';
import {collectAll} from '../collect.js';
import {createBriefStore,runGeneration} from './store.js';
import {loadSources,sourceFeeds} from './sources.js';
import {buildBrief} from './pipeline.js';
import {nextRunAt} from './policy.js';

export const store=createBriefStore(fileURLToPath(new URL('../../data/brief.db',import.meta.url)));
export function configured(){return !!(process.env.LLM_BASE_URL||process.env.DEEPSEEK_BASE)&&!!(process.env.LLM_API_KEY||process.env.DEEPSEEK_KEY)&&!!(process.env.LLM_MODEL||process.env.DEEPSEEK_MODEL);}
let active=null;
export function runBrief({skipCollect=false}={}){
  if(active)return active;
  active=runGeneration({store,build:async()=>{
    if(!configured())throw new Error('missing-env: 请配置模型接口、密钥和模型名称');
    const sources=loadSources();
    const health=skipCollect?store.read().health?.sources??[]:await collectAll(sourceFeeds(sources));
    if(!skipCollect)store.health(health);
    const now=Date.now();
    const items=db.prepare('SELECT id,guid,feed_id,title,link,summary,published_at FROM items WHERE published_at>=? ORDER BY published_at DESC').all(now-86400000);
    const result=await buildBrief({items,sources,now});
    result.collection_status=health;
    return result;
  }}).finally(()=>{active=null;});
  return active;
}

export function startScheduler({read=()=>store.read()}={}){
  let timer=null,collectionTimer=null,collecting=false,stopped=false;
  function schedule(){
    if(stopped)return;
    timer=setTimeout(async()=>{try{await runBrief();}catch(e){console.error('[brief]',e.message);}schedule();},nextRunAt()-Date.now());
    timer.unref();
  }
  if(configured()&&process.env.AUTO_GENERATE==='true'){
    const {edition}=read();
    const utcMidnight=Math.floor(Date.now()/86400000)*86400000;
    if(!edition||edition.generated_at<utcMidnight)runBrief().catch(e=>console.error('[brief]',e.message));
    schedule();
    collectionTimer=setInterval(async()=>{
      if(active||collecting)return;collecting=true;
      try{store.health(await collectAll(sourceFeeds()));}catch(e){console.error('[collect]',e.message);}finally{collecting=false;}
    },30*60_000);collectionTimer.unref();
  }
  return ()=>{stopped=true;clearTimeout(timer);clearInterval(collectionTimer);};
}

if(process.argv.includes('--generate')){
  try{const edition=await runBrief();console.log(`已生成 ${edition.articles.length} 条新闻，${new Date(edition.generated_at).toISOString()}`);}
  catch(e){console.error(e.message);process.exitCode=1;}
  finally{store.close();db.close();}
}
