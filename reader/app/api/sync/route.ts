import {env} from 'cloudflare:workers';
import {handleSync} from '../../../lib/sync-handler.mjs';
export const dynamic='force-dynamic';
export async function POST(request:Request){return handleSync(request,env.DB);}
