import {readFile,writeFile,mkdir,rename} from 'node:fs/promises';
import {resolve,dirname} from 'node:path';
import {db,insertItems,syncFeeds,pruneOldItems} from '../server/src/db.js';
import {collectAll} from '../server/src/collect.js';
import {loadSources,sourceFeeds} from '../server/src/brief/sources.js';
import {assessSource} from '../server/src/brief/evidence.js';
import {store,runBrief} from '../server/src/brief/runner.js';
import {runCloudCycle} from '../server/src/brief/cloud.js';
import {exportSite,publicEdition} from '../server/src/brief/export.js';
import {persistState} from './persist-state.js';
const stateFile=resolve('.news-state/state.json'),directory=resolve('public-site');
const sources=loadSources(),feeds=sourceFeeds(sources);
let state={version:1,items:[],editions:[],edition:null,attempts:null,last_run:null};
try{
  try{state=JSON.parse(await readFile(stateFile,'utf8'));}catch(e){if(e.code!=='ENOENT')throw e;}
  if(state.version!==1||!Array.isArray(state.items)||!Array.isArray(state.editions))throw new Error('invalid persisted news state');
  syncFeeds(feeds);
  for(const source of sources){
    const items=state.items.filter(i=>i.feed_id===source.id&&typeof i.guid==='string'&&typeof i.title==='string'&&assessSource(i.link,[source])&&Number.isFinite(i.published_at)).slice(0,1000);
    if(items.length)insertItems(source,items);
  }
  store.restoreArchive(state.editions);
  state.edition=store.read().edition;
  const result=await runCloudCycle({state,requiredRevision:2,
    collect:async()=>{const health=await collectAll(feeds);store.health(health);return health;},
    generate:()=>runBrief({skipCollect:true}),
    save:async(next,options)=>{
      pruneOldItems({days:2,keepPerFeed:30});
      const items=db.prepare('SELECT feed_id,guid,title,link,summary,published_at FROM items WHERE published_at>=? ORDER BY published_at DESC LIMIT 20000').all(Date.now()-2*86400000);
      const checkpoint={version:1,items,edition:publicEdition(next.edition),editions:store.archive().map(publicEdition),attempts:next.attempts,last_run:next.last_run,health:next.health,diagnostics:next.edition?.diagnostics??state.diagnostics,exclusions:next.edition?.excluded??state.exclusions};
      await mkdir(dirname(stateFile),{recursive:true});await writeFile(stateFile+'.tmp',JSON.stringify(checkpoint),'utf8');await rename(stateFile+'.tmp',stateFile);
      if(options?.reservation){
        if(process.env.GITHUB_ACTIONS==='true')persistState({message:'data: reserve daily news generation attempt'});
        return;
      }
      await exportSite({directory,edition:next.edition,editions:checkpoint.editions,lastRun:next.last_run,basePath:process.env.PUBLIC_BASE_PATH||'/'});
    },
  });
  console.log(JSON.stringify({ok:result.ok,generated:result.generated,reason:result.reason,attempts:result.state.attempts,articles:result.state.edition?.articles.length??0,diagnostics:result.state.edition?.diagnostics}));
  if(!result.ok)process.exitCode=1;
}catch(e){console.error('Cloud cycle failed:',e.message);process.exitCode=1;}
finally{store.close();db.close();}
