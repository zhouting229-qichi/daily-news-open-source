import {test} from 'node:test';
import assert from 'node:assert/strict';
import {syncSite} from '../../scripts/sync-site.mjs';
const edition={mode:'live',generated_at:1000,articles:[{id:'event-1'}]};
const state={edition,editions:[edition]};
test('unconfigured optional site sync performs no requests and needs no token',async()=>{
  let calls=0;
  const result=await syncSite(state,'',async()=>{calls++;throw Error('must not fetch');},'');
  assert.equal(result.skipped,true);assert.equal(calls,0);
});
test('invalid site targets fail before sending a service token',async()=>{
  for(const url of ['http://example.test','https://user:pass@example.test','https://example.test/private','https://example.test/?key=secret','https://example.test/#fragment']){
    let calls=0;
    await assert.rejects(()=>syncSite(state,'release-test-token',async()=>{calls++;return Response.json({});},url),/Invalid DAILY_NEWS_SITE_URL/);
    assert.equal(calls,0);
  }
});
test('configured site sync writes and verifies the selected owner endpoint only',async()=>{
  let saved=null;const calls=[];
  const fetcher=async(url,options)=>{
    assert.ok(url.startsWith('https://reader.example.test/'));
    assert.equal(options.headers['OAI-Sites-Authorization'],'Bearer release-test-token');
    assert.equal(options.redirect,'error');calls.push(url);
    if(url.endsWith('/api/sync')){saved=JSON.parse(options.body).editions[0];return Response.json({ok:true});}
    return Response.json({edition:saved});
  };
  const result=await syncSite(state,'release-test-token',fetcher,'https://reader.example.test/');
  assert.deepEqual(result,{changed:true,generated_at:1000,articles:1});assert.equal(calls.length,3);
  const unchanged=await syncSite(state,'release-test-token',fetcher,'https://reader.example.test');
  assert.equal(unchanged.changed,false);assert.equal(calls.length,4);
});
