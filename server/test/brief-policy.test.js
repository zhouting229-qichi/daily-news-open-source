import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rankEvents, validateFacts, editionState, nextRunAt, reportingOrigins } from '../src/brief/policy.js';

test('importance beats region quotas and duplicate publisher counts', () => {
  const events = Array.from({ length: 13 }, (_, i) => ({ id: i, region: i < 11 ? 'domestic' : 'world', scores: { impact: 10 - i / 2, consequence: 8, recency: 8, attention: 5 } }));
  const result = rankEvents(events);
  assert.equal(result.length, 13);
  assert.deepEqual(result.map(e => e.id), [0,1,2,3,4,5,6,7,8,9,10,11,12]);
  assert.equal(rankEvents([{ id: 'bad', scores: { impact: 'NaN' } }]).length,0);
});

test('facts need exact evidence, valid source IDs and supported numbers', () => {
  const evidence = [{ id: 's1', body: 'The ministry confirmed 120 schools reopened on Monday. This was announced in an official statement.' }];
  const draft = { facts: [
    { id:'f1', text:'该部门确认120所学校重新开放。', kind:'fact', citations:[{source_id:'s1', quote:'The ministry confirmed 120 schools reopened on Monday.'}] },
    { id:'f2', text:'1200所学校重新开放。', kind:'fact', citations:[{source_id:'s1', quote:'The ministry confirmed 120 schools reopened on Monday.'}] },
    { id:'f3', text:'消息已获证实。', kind:'fact', citations:[{source_id:'invented', quote:'This quote does not exist in any source.'}] },
    { id:'f4', text:'消息已获证实。', kind:'fact', citations:[{source_id:'s1', quote:'The ministry confirmed 999 schools reopened.'}] },
  ] };
  const result = validateFacts(draft, evidence);
  assert.deepEqual(result.facts.map(f=>f.id), ['f1']);
  assert.equal(result.rejected.length, 3);
});

test('attributed and disputed claims must retain explicit attribution', () => {
  const evidence = [{id:'s1',body:'The company says its new battery lasts longer. Independent tests have not been published.'}];
  const fact = {id:'f1',text:'新电池续航更长。',kind:'claim',citations:[{source_id:'s1',quote:'The company says its new battery lasts longer.'}]};
  assert.equal(validateFacts({facts:[fact]}, evidence).facts.length, 0);
  assert.equal(validateFacts({facts:[{...fact,text:'该公司称，新电池续航更长。',attribution:'该公司'}]}, evidence).facts.length, 1);
});

test('syndicated wire stories count once and unknown origins are not called independent', () => {
  const result = reportingOrigins([{origin:'wire:reuters',origin_verified:true},{origin:'wire:reuters',origin_verified:true},{origin:'unknown:bbc',origin_verified:false}]);
  assert.deepEqual(result, { known:1, unknown:1, total:2 });
});

test('failure retains original edition date and explicit stale status', () => {
  const now = Date.parse('2026-10-27T02:00:00Z');
  const batch = {generated_at: Date.parse('2026-10-25T00:00:00Z')};
  const state = editionState(batch, {status:'failed',error:'model unavailable'}, now);
  assert.equal(state.status, 'failed');
  assert.equal(state.stale, true);
  assert.equal(state.generated_at, batch.generated_at);
  assert.equal(editionState(null, null, now).status, 'unconfigured');
});

test('schedule is 08:00 Shanghai with no host timezone dependence', () => {
  assert.equal(nextRunAt(Date.parse('2026-10-27T00:01:00Z')), Date.parse('2026-10-28T00:00:00Z'));
  assert.equal(nextRunAt(Date.parse('2026-10-26T23:59:00Z')), Date.parse('2026-10-27T00:00:00Z'));
});

test('numeric evidence rejects added Chinese magnitudes, changed Chinese numerals, signs and percentages',()=>{
  const evidence=[{id:'s1',body:'The ministry confirmed 120 schools reopened. The rate declined by 5 percent. Revenue was -10 million dollars.'}];
  const fact=text=>({id:'f1',kind:'fact',text,citations:[{source_id:'s1',quote:evidence[0].body}]});
  for(const text of ['该部门确认120万所学校重新开放。','该部门确认一千二百所学校重新开放。','该部门确认负120所学校重新开放。','比率下降5个百分点。','收入为10百万美元。']){
    assert.equal(validateFacts({facts:[fact(text)]},evidence).facts.length,0,text);
  }
  assert.equal(validateFacts({facts:[fact('该部门确认一百二十所学校重新开放。')]},evidence).facts.length,1);
});
