import {env} from 'cloudflare:workers';
import {readEdition} from '../../../../lib/news-data.mjs';
export const dynamic='force-dynamic';
export async function GET(request:Request,{params}:{params:Promise<{id:string}>}){
  const {id}=await params;const edition=await readEdition(env.DB,id);
  return Response.json(edition??{error:'not-found'},{status:edition?200:404,headers:{'Cache-Control':'private, no-store'}});
}
