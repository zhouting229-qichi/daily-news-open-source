import {test} from 'node:test';
import assert from 'node:assert/strict';
import {handleSync} from '../lib/sync-handler.mjs';
test('cross-origin writes and non-JSON submissions are rejected before database access',async()=>{
  const db={batch(){throw Error('must not access DB');}};
  for(const headers of [{'origin':'https://other.example','content-type':'application/json'},{'content-type':'text/plain'},{'sec-fetch-site':'cross-site','content-type':'application/json'}]){
    const response=await handleSync(new Request('https://site.example/api/sync',{method:'POST',headers,body:'{}'}),db);
    assert.ok([403,415].includes(response.status));
  }
});
test('oversized and malformed payloads cannot reach the database',async()=>{
  const db={batch(){throw Error('must not access DB');}};
  const large=await handleSync(new Request('https://site.example/api/sync',{method:'POST',headers:{'content-type':'application/json','content-length':'10000000'},body:'{}'}),db);
  assert.equal(large.status,413);
  const broken=await handleSync(new Request('https://site.example/api/sync',{method:'POST',headers:{'content-type':'application/json'},body:'not json'}),db);
  assert.equal(broken.status,400);
});
