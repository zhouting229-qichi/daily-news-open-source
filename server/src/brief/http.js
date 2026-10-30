import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {extname} from 'node:path';
import {resolveWebPath} from '../safe-path.js';
import {editionState} from './policy.js';
import {demoEdition} from './demo.js';
const webDir=fileURLToPath(new URL('../../../web',import.meta.url));
const mime={'.html':'text/html','.css':'text/css','.js':'text/javascript','.svg':'image/svg+xml'};
export function createApp({read,sources,isConfigured,findEdition=()=>null}){
  return async(req,res)=>{
    res.setHeader('x-content-type-options','nosniff');res.setHeader('referrer-policy','no-referrer');
    res.setHeader('content-security-policy',"default-src 'self'; style-src 'self'; script-src 'self'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'");
    if(!['GET','HEAD'].includes(req.method)){res.writeHead(405,{'allow':'GET, HEAD'});res.end();return;}
    let path;try{path=new URL(req.url,'http://localhost').pathname;}catch{res.writeHead(400);res.end();return;}
    const json=(data)=>{res.writeHead(200,{'content-type':'application/json; charset=utf-8','cache-control':'no-store'});res.end(req.method==='HEAD'?undefined:JSON.stringify(data));};
    if(path==='/api/brief'){const data=read();json({...data,configured:isConfigured,state:editionState(data.edition,data.last_run)});return;}
    if(path==='/api/demo'){json(demoEdition);return;}
    const editionMatch=path.match(/^\/api\/edition\/(\d+)$/);
    if(editionMatch){const edition=findEdition(Number(editionMatch[1]));if(edition)json(edition);else{res.writeHead(404);res.end('edition not found');}return;}
    if(path==='/api/sources'){
      const data=read();json({checked_at:data.health?.checked_at??null,sources:sources.map(s=>({id:s.id,name:s.name,kind:s.kind,domains:s.domains,enabled:s.enabled,connected:!!(s.feed_url||s.api_url),note:s.note??'',upstream:s.upstream??null,health:data.health?.sources.find(h=>(h.source_id||h.feed)===s.id)??null}))});return;
    }
    const full=resolveWebPath(webDir,/^\/story\/(demo|\d+)\/[a-z0-9-]+$/.test(path)?'/index.html':req.url);if(!full){res.writeHead(403);res.end();return;}
    try{const bytes=await readFile(full);res.writeHead(200,{'content-type':(mime[extname(full)]||'application/octet-stream')+'; charset=utf-8','cache-control':'no-cache'});res.end(req.method==='HEAD'?undefined:bytes);}
    catch{res.writeHead(404);res.end('not found');}
  };
}
