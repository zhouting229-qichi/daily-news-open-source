import {test} from 'node:test';
import assert from 'node:assert/strict';
import {handleNewsMcp} from '../lib/news-mcp.mjs';
const req=(method,params={},auth=true)=>new Request('https://example.com/mcp',{method:'POST',headers:{'content-type':'application/json',...(auth?{'oai-authenticated-user-id':'owner'}:{})},body:JSON.stringify({jsonrpc:'2.0',id:1,method,params})});
test('tool discovery exposes bounded sync and database status tools',async()=>{
  const r=await (await handleNewsMcp(req('tools/list'),{})).json();
  assert.deepEqual(r.result.tools.map(t=>t.name),['sync_news','news_status']);
});
test('unauthenticated tool calls never access private data',async()=>{
  const r=await handleNewsMcp(req('tools/call',{name:'sync_news',arguments:{payload_json:'{}'}},false),{});
  assert.equal(r.status,401);
});
test('invalid sync payload cannot reach storage and tool errors remain explicit',async()=>{
  const db={batch(){throw Error('unexpected write');}};
  for(const payload of ['not-json','{}','{"editions":[]}']){
    const r=await (await handleNewsMcp(req('tools/call',{name:'sync_news',arguments:{payload_json:payload}}),db)).json();
    assert.equal(r.result.isError,true);
  }
});
