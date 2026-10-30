import {env} from 'cloudflare:workers';
import {handleNewsMcp} from '../../lib/news-mcp.mjs';
export const dynamic='force-dynamic';
export async function POST(request:Request){return handleNewsMcp(request,env.DB);}
