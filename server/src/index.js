import {createServer} from 'node:http';
import {createApp} from './brief/http.js';
import {store,configured,startScheduler} from './brief/runner.js';
import {loadSources} from './brief/sources.js';
const port=Number(process.env.PORT)||8787,host=process.env.HOST||'127.0.0.1';
const server=createServer(createApp({read:()=>store.read(),sources:loadSources(),isConfigured:configured(),findEdition:t=>store.findEdition(t)}));
server.listen(port,host,()=>console.log(`知要 · http://${host}:${port} · ${configured()?'模型已配置':'演示可用，真实日报等待模型配置'}`));
server.on('error',e=>{console.error(e.message);process.exitCode=1;});
const stop=startScheduler();
function shutdown(){stop();server.close(()=>process.exit(0));}
process.on('SIGTERM',shutdown);process.on('SIGINT',shutdown);
