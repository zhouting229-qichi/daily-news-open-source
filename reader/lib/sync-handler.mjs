import {syncEditions} from './news-data.mjs';
const MAX_BYTES=8*1024*1024;
const json=(value,status=200)=>Response.json(value,{status,headers:{'Cache-Control':'no-store'}});
// Sites dispatch authenticates both owner sessions and service access before this
// handler runs. This endpoint is for an owner-private Site only; do not publish
// the Site publicly without introducing independent service authorization.
export async function handleSync(request,db){
  const origin=request.headers.get('origin');
  if((origin&&origin!==new URL(request.url).origin)||request.headers.get('sec-fetch-site')==='cross-site')return json({error:'forbidden'},403);
  if(!/^application\/json(?:\s*;|$)/i.test(request.headers.get('content-type')??''))return json({error:'json-required'},415);
  if(Number(request.headers.get('content-length'))>MAX_BYTES)return json({error:'too-large'},413);
  let input;
  try{
    const reader=request.body?.getReader();if(!reader)return json({error:'body-required'},400);
    let size=0;const chunks=[];
    for(;;){const {value,done}=await reader.read();if(done)break;size+=value.byteLength;if(size>MAX_BYTES){await reader.cancel();return json({error:'too-large'},413);}chunks.push(value);}
    const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength;}
    input=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));
  }catch{return json({error:'invalid-json'},400);}
  try{return json(await syncEditions(db,input));}
  catch(error){return json({error:error.message==='invalid-news-edition'?'invalid-edition':'storage-unavailable'},error.message==='invalid-news-edition'?400:503);}
}
