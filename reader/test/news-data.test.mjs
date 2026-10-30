import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {normalizeEdition,syncEditions,readBrief,readEdition} from '../lib/news-data.mjs';

const now=Date.parse('2026-10-28T12:00:00Z');
function edition(at=now){return {mode:'live',generated_at:at,revision:3,articles:[{id:'event-1',title:'有关部门发布最新消息',category:'社会',facts:[{id:'f1',text:'有关部门发布最新消息',kind:'claim',attribution:'有关部门',citations:[{source_id:'s1',quote:'有关部门发布最新消息，相关情况已经正式公开。'}]}],sources:[{id:'s1',source_name:'来源',url:'https://example.com/news',body:'MUST NOT LEAK'}]}],items:[{secret:'not a reading field'}]};}
function db(){
  const sqlite=new DatabaseSync(':memory:');
  sqlite.exec('CREATE TABLE news_editions (generated_at INTEGER PRIMARY KEY, payload TEXT NOT NULL)');
  return {prepare(sql){let args=[];return {bind(...values){args=values;return this;},async first(){return sqlite.prepare(sql).get(...args)??null;},async all(){return {results:sqlite.prepare(sql).all(...args)};},async run(){return sqlite.prepare(sql).run(...args);}};},async batch(statements){sqlite.exec('BEGIN');try{const r=[];for(const s of statements)r.push(await s.run());sqlite.exec('COMMIT');return r;}catch(e){sqlite.exec('ROLLBACK');throw e;}},close(){sqlite.close();}};
}
test('only reading fields and safe source URLs are accepted',()=>{
  const clean=normalizeEdition(edition(),now);
  assert.equal(clean.articles.length,1);
  assert.equal(clean.items,undefined);
  assert.equal(clean.articles[0].sources[0].body,undefined);
  const bad=edition();bad.articles[0].sources[0].url='javascript:alert(1)';
  assert.throws(()=>normalizeEdition(bad,now));
});
test('invalid batches are rejected before writing any edition',async()=>{
  const store=db();
  try{
    await assert.rejects(syncEditions(store,{editions:[edition(),{...edition(now+1),articles:[]}]},now));
    assert.equal((await readBrief(store,now)).edition,null);
  }finally{store.close();}
});
test('out-of-order retries cannot replace a newer edition and duplicates are idempotent',async()=>{
  const store=db();try{
    await syncEditions(store,{editions:[edition()]},now);
    await syncEditions(store,{editions:[edition(now-86400000),edition()]},now);
    assert.equal((await readBrief(store,now)).edition.generated_at,now);
    assert.equal((await store.prepare('SELECT count(*) AS n FROM news_editions').first()).n,2);
    const changed=edition();changed.articles[0].title='不能用同一期时间戳悄悄改写';
    await syncEditions(store,{editions:[changed]},now);
    assert.equal((await readBrief(store,now)).edition.articles[0].title,'有关部门发布最新消息');
  }finally{store.close();}
});
test('archives retain the newest 30 editions and stale data keeps its original date',async()=>{
  const store=db();try{
    for(let i=31;i>=0;i--)await syncEditions(store,{editions:[edition(now-i*86400000)]},now);
    assert.equal((await store.prepare('SELECT count(*) AS n FROM news_editions').first()).n,30);
    assert.equal(await readEdition(store,now-31*86400000),null);
    const brief=await readBrief(store,now+27*3600000);
    assert.equal(brief.state.stale,true);
    assert.equal(brief.edition.generated_at,now);
  }finally{store.close();}
});
test('future timestamps, demo data and broken citation references cannot be synchronized',()=>{
  assert.throws(()=>normalizeEdition(edition(now+3600000),now));
  assert.throws(()=>normalizeEdition({...edition(),mode:'demo'},now));
  const bad=edition();bad.articles[0].facts[0].citations[0].source_id='missing';
  assert.throws(()=>normalizeEdition(bad,now));
});
