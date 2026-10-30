import {mkdir,readFile,writeFile,copyFile} from 'node:fs/promises';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {editionState} from './policy.js';
import {demoEdition} from './demo.js';
const web=fileURLToPath(new URL('../../../web/',import.meta.url));
const pick=(value,keys)=>Object.fromEntries(keys.filter(k=>value?.[k]!==undefined).map(k=>[k,value[k]]));
export function publicEdition(edition){
  if(!edition)return null;
  return {...pick(edition,['mode','revision','generated_at','cutoff_at','notice']),articles:(edition.articles??[]).map(a=>({
    ...pick(a,['id','title','category','score','digest','origins','evidence_check','latest_at','analysis']),
    facts:(a.facts??[]).map(f=>({...pick(f,['id','text','kind','attribution']),citations:(f.citations??[]).map(c=>pick(c,['source_id','quote']))})),
    sources:(a.sources??[]).map(s=>pick(s,['id','source_id','source_name','url','retrieved_url','title','kind','published_at','fetched_at','origin','origin_verified'])),
  }))};
}
export async function exportSite({directory,edition=null,editions=[],lastRun=null,basePath='/'}){
  if(!/^\/(?:[A-Za-z0-9_-][A-Za-z0-9._-]*\/)*$/.test(basePath)||basePath.includes('..'))throw new Error('invalid base path');
  const write=async(path,text)=>{const full=join(directory,path);await mkdir(join(full,'..'),{recursive:true});await writeFile(full,text,'utf8');};
  let html=await readFile(join(web,'index.html'),'utf8');
  html=html.replace('<head>',`<head><base href="${basePath}"><meta name="app-base" content="${basePath}"><meta name="static-api" content="true">`)
    .replace('href="/"','href="'+basePath+'"').replace('href="/style.css','href="style.css').replace('src="/app.js','src="app.js');
  await mkdir(directory,{recursive:true});
  for(const asset of ['style.css','app.js','view.js','runtime.js'])await copyFile(join(web,asset),join(directory,asset));
  await write('index.html',html);await write('.nojekyll','');
  const safeRun=lastRun?pick(lastRun,['status','started_at','finished_at','error']):null;
  const data={edition:publicEdition(edition),last_run:safeRun,state:editionState(edition,safeRun),configured:!!edition};
  await write('api/brief.json',JSON.stringify(data));await write('api/demo.json',JSON.stringify(publicEdition(demoEdition)));
  const archive=new Map([...editions,...(edition?[edition]:[])].map(e=>[e.generated_at,e]));
  for(const e of archive.values()){
    if(!Number.isSafeInteger(e.generated_at)||e.generated_at<=0)continue;
    await write(`api/edition/${e.generated_at}.json`,JSON.stringify(publicEdition(e)));
    for(const a of e.articles??[])if(/^[a-z0-9-]+$/.test(a.id))await write(`story/${e.generated_at}/${a.id}/index.html`,html);
  }
  for(const a of demoEdition.articles)await write(`story/demo/${a.id}/index.html`,html);
  await write('build-ready.json',JSON.stringify({built_at:Date.now(),edition_at:edition?.generated_at??null}));
  return {articles:edition?.articles?.length??0,archives:archive.size,basePath};
}
