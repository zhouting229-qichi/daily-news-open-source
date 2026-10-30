import {env} from 'cloudflare:workers';
import {handleAsk} from '../../../lib/ask-handler.mjs';
export const dynamic='force-dynamic';
export async function POST(request:Request){
  return handleAsk(request,{db:env.DB,apiKey:(env as any).LLM_API_KEY,model:(env as any).LLM_MODEL||'deepseek-flash'});
}
