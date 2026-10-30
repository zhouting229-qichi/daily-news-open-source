import {env} from 'cloudflare:workers';
import shell from '../lib/news-shell';
import {readBrief} from '../lib/news-data.mjs';
import {renderPage} from '../lib/page.mjs';
export const dynamic='force-dynamic';
export async function GET(request:Request){
  let brief;try{brief=await readBrief(env.DB);}catch{brief={edition:null,state:{status:'failed'}};}
  const section=new URL(request.url).searchParams.get('section')||'all';
  return new Response(renderPage(shell,brief,{section,aiConfigured:!!(env as any).LLM_API_KEY}),{headers:{'Content-Type':'text/html; charset=utf-8','Cache-Control':'private, no-store'}});
}
