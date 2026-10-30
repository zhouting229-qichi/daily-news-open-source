import {test} from 'node:test';
import assert from 'node:assert/strict';
import {parseAdapter,collectAdapter} from '../src/brief/adapters.js';
test('thepaper preserves publisher dates and links from the existing open-source endpoint',()=>{
  const rows=parseAdapter('thepaper',{data:{hotNews:[{contId:'123',name:'主要新闻',pubTimeLong:1793059200000}]}});
  assert.equal(rows[0].link,'https://www.thepaper.cn/newsDetail_forward_123');
  assert.equal(rows[0].published_at,1793059200000);
});
test('wallstreet information flow discards ads and does not invent timestamps',()=>{
  const rows=parseAdapter('wallstreetcn-news',{data:{items:[{resource_type:'ad',resource:{id:1}},{resource:{id:2,title:'经济消息',uri:'https://wallstreetcn.com/articles/2',display_time:1793059200,content_short:'简短内容'}},{resource:{id:3,title:'无日期消息',uri:'https://wallstreetcn.com/articles/3'}}]}});
  assert.equal(rows.length,2);
  assert.equal(rows[0].published_at,1793059200000);
  assert.equal(rows[1].published_at,null);
});
test('collector refuses links outside the declared publisher even if API supplies them',async()=>{
  const source={adapter:'wallstreetcn-news',api_url:'https://api-one.wallstcn.com/apiv1/content/information-flow',domains:['wallstreetcn.com','wallstcn.com'],enabled:true};
  const result=await collectAdapter(source,{request:async()=>new Response(JSON.stringify({data:{items:[{resource:{id:1,title:'Bad',uri:'http://127.0.0.1/private',display_time:1793059200}}]}}))});
  assert.equal(result.length,0);
});

test('NHK Chinese keeps original public_at rather than an updated old story date',()=>{
  const rows=parseAdapter('nhk-zh',{data:[{id:'20261027_ML04',title:'主要事件',description:'简介',page_url:'/nhkworld/zh/news/20261027_ML04/',public_at:1793097417000,updated_at:1793099999000}]});
  assert.equal(rows[0].link,'https://www3.nhk.or.jp/nhkworld/zh/news/20261027_ML04/');
  assert.equal(rows[0].published_at,1793097417000);
});

test('CCTV public JSONP is parsed as data and its timestamp is explicitly Shanghai time',()=>{
  const rows=parseAdapter('cctv',{data:{list:[{id:'ARTI123',title:'公共事件',brief:'简介',url:'https://news.cctv.com/2026/10/27/ARTI123.shtml',focus_date:'2026-10-27 21:44:31'}]}});
  assert.equal(rows[0].published_at,Date.parse('2026-10-27T13:44:31Z'));
});
