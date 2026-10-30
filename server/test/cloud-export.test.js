import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {exportSite} from '../src/brief/export.js';
import {appPath,apiPath,localPath} from '../../web/runtime.js';
test('Pages project paths preserve assets, JSON API and archive detail links',async()=>{
  assert.equal(appPath('story/1000/event-1','/daily-news/'),'/daily-news/story/1000/event-1');
  assert.equal(apiPath('brief','/daily-news/',true),'/daily-news/api/brief.json');
  assert.equal(localPath('/daily-news/story/1000/event-1','/daily-news/'),'/story/1000/event-1');
  const dir=await mkdtemp(join(tmpdir(),'brief-export-'));
  try{
    const edition={mode:'live',generated_at:1000,cutoff_at:900,private_key:'MUST-NOT-PUBLISH',articles:[{id:'event-1',title:'可核对新闻',facts:[],sources:[]}]};
    await exportSite({directory:dir,edition,editions:[edition],lastRun:{status:'ready'},basePath:'/daily-news/'});
    const html=await readFile(join(dir,'index.html'),'utf8');
    assert.ok(html.includes('href="/daily-news/"'));
    assert.ok(html.includes('name="static-api"'));
    assert.ok(!html.includes('src="/app.js'));
    assert.ok((await readFile(join(dir,'story/1000/event-1/index.html'),'utf8')).includes('每日新闻'));
    const data=await readFile(join(dir,'api/brief.json'),'utf8');
    assert.ok(!data.includes('MUST-NOT-PUBLISH'));
    assert.equal(JSON.parse(data).edition.generated_at,1000);
    await assert.rejects(exportSite({directory:dir,edition,basePath:'/../bad/'}),/invalid base/);
  }finally{await rm(dir,{recursive:true,force:true});}
});
