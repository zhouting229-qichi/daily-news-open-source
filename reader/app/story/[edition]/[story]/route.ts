import {env} from 'cloudflare:workers';
import shell from '../../../../lib/news-shell';
import {readEdition} from '../../../../lib/news-data.mjs';
import {renderPage} from '../../../../lib/page.mjs';
export const dynamic='force-dynamic';
export async function GET(request:Request,context:{params:Promise<{edition:string,story:string}>}){
  const params=await context.params;
  let edition=null;try{edition=await readEdition(env.DB,params.edition);}catch{}
  const found=edition?.articles.some((a:any)=>a.id===params.story);
  return new Response(renderPage(shell,{edition,state:{status:'ready'}},{storyId:params.story,aiConfigured:!!(env as any).LLM_API_KEY}),{status:found?200:404,headers:{'Content-Type':'text/html; charset=utf-8','Cache-Control':'private, no-store'}});
}
