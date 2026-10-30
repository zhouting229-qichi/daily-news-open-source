import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createBriefStore,runGeneration} from '../src/brief/store.js';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
test('failed generation keeps previous edition and actual dates, never publishes an empty edition',async()=>{
  const store=createBriefStore(':memory:');
  try {
    await runGeneration({store,now:()=>1000,build:async()=>({articles:[{title:'真实已存档事件'}],source_status:[],cutoff_at:1000})});
    await assert.rejects(runGeneration({store,now:()=>2000,build:async()=>({articles:[],source_status:[]})}),/no eligible/);
    const data=store.read();
    assert.equal(data.edition.generated_at,1000);
    assert.equal(data.last_run.status,'failed');
    assert.equal(data.edition.articles[0].title,'真实已存档事件');
    assert.equal(data.last_run.finished_at,2000);
  } finally {store.close();}
});
test('run state survives reopening a persisted database',async()=>{
  const store=createBriefStore(':memory:');
  try {
    const id=store.start(3000);
    assert.equal(store.read().last_run.status,'running');
    store.fail(id,'missing-env',4000);
    assert.equal(store.read().last_run.error,'missing-env');
  } finally{store.close();}
});

test('opening another connection does not cancel a real running generation and prevents duplicate writers',()=>{
  const dir=mkdtempSync(join(tmpdir(),'brief-store-')),path=join(dir,'brief.db');
  const first=createBriefStore(path);let second;
  try{
    first.start(Date.now());second=createBriefStore(path);
    assert.equal(second.read().last_run.status,'running');
    assert.throws(()=>second.start(Date.now()),/already running/);
  }finally{first.close();second?.close();rmSync(dir,{recursive:true,force:true});}
});

test('cloud archive restore preserves real publication times and exports newest editions chronologically',()=>{
  const store=createBriefStore(':memory:');
  try{
    store.restoreArchive([{mode:'live',generated_at:2000,cutoff_at:1900,articles:[{id:'event-1',title:'新版'}]},{mode:'live',generated_at:1000,cutoff_at:900,articles:[{id:'event-1',title:'旧版'}]}]);
    assert.equal(store.read().edition.generated_at,2000);
    assert.deepEqual(store.archive().map(e=>e.generated_at),[1000,2000]);
    assert.equal(store.findEdition(1000).articles[0].title,'旧版');
  }finally{store.close();}
});
