import {resolve} from 'node:path';
import {store} from '../server/src/brief/runner.js';
import {db} from '../server/src/db.js';
import {exportSite} from '../server/src/brief/export.js';
try{
  const data=store.read();
  const result=await exportSite({directory:resolve(process.env.SITE_DIR||'public-site'),edition:data.edition,editions:store.archive(),lastRun:data.last_run,basePath:process.env.PUBLIC_BASE_PATH||'/'});
  console.log(JSON.stringify(result));
}finally{store.close();db.close();}
