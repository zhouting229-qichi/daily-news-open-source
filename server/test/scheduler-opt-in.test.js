import {test} from 'node:test';
import assert from 'node:assert/strict';
import {store,startScheduler} from '../src/brief/runner.js';
import {db} from '../src/db.js';

test('a configured local preview schedules nothing until AUTO_GENERATE is explicitly true',()=>{
  const names=['LLM_BASE_URL','LLM_API_KEY','LLM_MODEL','AUTO_GENERATE'];
  const original=Object.fromEntries(names.map(name=>[name,process.env[name]]));
  const timers={setTimeout:globalThis.setTimeout,setInterval:globalThis.setInterval};
  // A current synthetic edition avoids a real generation even in the enabled
  // branch. Observe the scheduler's actual timers without running callbacks.
  const read=()=>({edition:{mode:'live',generated_at:Date.now(),articles:[]}});
  try{
    process.env.LLM_BASE_URL='https://example.invalid';process.env.LLM_API_KEY='scheduler-test-key';process.env.LLM_MODEL='test-model';
    for(const value of [undefined,'false','1','yes','true']){
      if(value===undefined)delete process.env.AUTO_GENERATE;else process.env.AUTO_GENERATE=value;
      let scheduled=0;
      globalThis.setTimeout=globalThis.setInterval=()=>{scheduled++;return {unref(){}};};
      const stop=startScheduler({read});stop();
      assert.equal(scheduled,value==='true'?2:0,'AUTO_GENERATE='+value);
    }
  }finally{
    Object.assign(globalThis,timers);
    for(const name of names){if(original[name]===undefined)delete process.env[name];else process.env[name]=original[name];}
    store.close();db.close();
  }
});
