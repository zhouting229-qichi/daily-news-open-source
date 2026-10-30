import {writeFileSync} from 'node:fs';
import {loadSources,sourceFeeds} from './sources.js';
import {collectFeed} from '../feed.js';
import {fetchArticle} from './evidence.js';
import {mapLimit} from '../curate/llm.js';

const sources=loadSources();
const results=await mapLimit(sourceFeeds(sources),3,async feed=>{
  try{
    const items=await collectFeed(feed);
    if(!items.length)return {source_id:feed.id,ok:false,error:'empty or invalid RSS',items:0};
    const article=await fetchArticle({...items[0],id:feed.id},feed);
    return {source_id:feed.id,ok:true,items:items.length,latest_at:items[0].published_at,
      sample_url:items[0].link,body_ok:article.ok,body_error:article.error??null,
      body_characters:article.evidence?.body.length??0};
  }catch(e){return {source_id:feed.id,ok:false,error:e.message,items:0};}
});
const report={checked_at:Date.now(),sources:results.map(r=>r.ok?r.result:{ok:false,error:r.error})};
for(const s of sources.filter(s=>!s.feed_url&&!s.api_url))report.sources.push({source_id:s.id,ok:false,unconfigured:true,error:s.note||'未配置采集入口'});
const output=process.argv.find(a=>a.startsWith('--output='))?.slice(9);
if(output)writeFileSync(output,JSON.stringify(report,null,2));
if(process.argv.includes('--save')){
  const {store}=await import('./runner.js');store.health(report.sources,report.checked_at);store.close();
}
console.log(JSON.stringify(report,null,2));
