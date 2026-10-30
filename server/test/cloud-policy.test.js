import {test} from 'node:test';
import assert from 'node:assert/strict';
import {cloudDecision,runCloudCycle} from '../src/brief/cloud.js';
const now=Date.parse('2026-10-27T00:17:00Z');
test('a repaired pipeline can replace an old revision without resetting the daily attempt limit',()=>{
  const edition={generated_at:now,revision:1};
  assert.equal(cloudDecision({now,edition,requiredRevision:2,attempts:{day:'2026-10-27',count:2}}).generate,true);
  assert.equal(cloudDecision({now,edition,requiredRevision:2,attempts:{day:'2026-10-27',count:3}}).generate,false);
  assert.equal(cloudDecision({now,edition:{...edition,revision:2},requiredRevision:2}).generate,false);
});
test('cloud generation succeeds only once a Shanghai morning cycle and resets next day',()=>{
  assert.equal(cloudDecision({now,edition:{generated_at:now-1000},attempts:{day:'2026-10-27',count:1}}).generate,false);
  assert.equal(cloudDecision({now:now+86400000,edition:{generated_at:now-1000},attempts:{day:'2026-10-27',count:3}}).generate,true);
  assert.equal(cloudDecision({now,edition:null,attempts:{day:'2026-10-27',count:3}}).generate,false);
});
test('failed generation preserves old publication but persists attempt count and can retry',async()=>{
  const old={generated_at:now-86400000,articles:[{title:'旧版'}]};
  let saved;
  const r=await runCloudCycle({now,state:{edition:old,attempts:null},collect:async()=>[],generate:async()=>{throw Error('model unavailable');},save:async s=>{saved=s;}});
  assert.equal(r.ok,false);assert.equal(saved.edition.generated_at,old.generated_at);
  assert.equal(saved.attempts.count,1);assert.equal(saved.last_run.status,'failed');
  let calls=0;
  const next=await runCloudCycle({now:now+3600000,state:saved,collect:async()=>[],generate:async()=>{calls++;return {generated_at:now+3600000,articles:[{title:'新版'}]};},save:async()=>{}});
  assert.equal(next.ok,true);assert.equal(calls,1);
});

test('reserves the third daily attempt durably before requesting a model',async()=>{
  let durable,release;
  const started=new Promise(resolve=>{release=resolve;});
  let complete;
  const pending=new Promise(resolve=>{complete=resolve;});
  const running=runCloudCycle({now,state:{attempts:{day:'2026-10-27',count:2}},
    collect:async()=>[],
    generate:async()=>{release();await pending;return {generated_at:now,articles:[]};},
    save:async(s,options)=>{if(options?.reservation)durable=structuredClone(s);},
  });
  await started;
  try{
    assert.equal(durable?.attempts.count,3);
    assert.equal(durable?.last_run.status,'running');
    assert.equal(cloudDecision({now,attempts:durable?.attempts}).generate,false);
  }finally{complete();await running;}
});

test('failed reservation storage prevents model requests',async()=>{
  let calls=0;
  const result=await runCloudCycle({now,state:{},collect:async()=>[],
    generate:async()=>{calls++;return {generated_at:now,articles:[]};},
    save:async(s,options)=>{if(options?.reservation)throw Error('remote push rejected');},
  });
  assert.equal(calls,0);
  assert.equal(result.ok,false);
  assert.match(result.error,/remote push rejected/);
});

test('failed final storage leaves a consumed durable attempt for the next runner',async()=>{
  let durable;
  await assert.rejects(()=>runCloudCycle({now,state:{},collect:async()=>[],
    generate:async()=>({generated_at:now,articles:[]}),
    save:async(s,options)=>{if(options?.reservation)durable=structuredClone(s);else throw Error('disk full');},
  }),/disk full/);
  assert.equal(durable.attempts.count,1);
  assert.equal(durable.last_run.status,'running');
});
