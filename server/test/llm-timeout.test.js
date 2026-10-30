import {test} from 'node:test';
import assert from 'node:assert/strict';
import {chatJSON} from '../src/curate/llm.js';

test('Flash JSON extraction reserves its output budget for JSON without changing other providers',async()=>{
  const oldFetch=globalThis.fetch,oldBase=process.env.LLM_BASE_URL,oldKey=process.env.LLM_API_KEY;
  process.env.LLM_API_KEY='fixture-not-a-real-key';
  let request;
  globalThis.fetch=async(_url,options)=>{request=JSON.parse(options.body);return {ok:true,status:200,json:async()=>({choices:[{message:{content:'{"ok":true}'}}]})};};
  try{
    process.env.LLM_BASE_URL='https://api.deepseek.com';
    assert.equal((await chatJSON({system:'JSON',user:'JSON',model:'deepseek-flash'})).ok,true);
    assert.deepEqual(request.thinking,{type:'disabled'});
    process.env.LLM_BASE_URL='https://model.example/v1';
    await chatJSON({system:'JSON',user:'JSON',model:'test'});
    assert.equal(request.thinking,undefined);
  }finally{
    globalThis.fetch=oldFetch;if(oldBase===undefined)delete process.env.LLM_BASE_URL;else process.env.LLM_BASE_URL=oldBase;if(oldKey===undefined)delete process.env.LLM_API_KEY;else process.env.LLM_API_KEY=oldKey;
  }
});
test('model timeout covers a stalled response body, not only response headers',async()=>{
  const oldFetch=globalThis.fetch,oldBase=process.env.LLM_BASE_URL,oldKey=process.env.LLM_API_KEY;
  process.env.LLM_BASE_URL='https://model.example/v1';process.env.LLM_API_KEY='fixture-not-a-real-key';
  globalThis.fetch=async(_url,{signal})=>({ok:true,status:200,json:()=>new Promise((_,reject)=>signal.addEventListener('abort',()=>reject(new Error('aborted')),{once:true}))});
  try{
    const result=await Promise.race([chatJSON({system:'fixture',user:'fixture',model:'test',timeoutMs:20}),new Promise(r=>setTimeout(()=>r('still pending'),350))]);
    assert.notEqual(result,'still pending');assert.equal(result.ok,false);assert.match(result.error,/timeout/);
  }finally{
    globalThis.fetch=oldFetch;if(oldBase===undefined)delete process.env.LLM_BASE_URL;else process.env.LLM_BASE_URL=oldBase;if(oldKey===undefined)delete process.env.LLM_API_KEY;else process.env.LLM_API_KEY=oldKey;
  }
});
