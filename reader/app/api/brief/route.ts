import {env} from 'cloudflare:workers';
import {readBrief} from '../../../lib/news-data.mjs';
import {briefResponse} from '../../../lib/page.mjs';
export const dynamic='force-dynamic';
export async function GET(request:Request){
  try{return briefResponse(request,await readBrief(env.DB));}
  catch{return Response.json({error:'读取失败，请稍后重试'},{status:503,headers:{'Cache-Control':'private, no-store'}});}
}
