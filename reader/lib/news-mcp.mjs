import {syncEditions,readBrief} from './news-data.mjs';
const tools=[
  {name:'sync_news',description:'同步已经生成的私人日报；不生成新闻。payload_json为JSON字符串，格式为{"editions":[完整日报对象]}，最多30期，按时间幂等保留最新30期。',inputSchema:{type:'object',properties:{payload_json:{type:'string',maxLength:8000000}},required:['payload_json'],additionalProperties:false},annotations:{readOnlyHint:false,destructiveHint:false,idempotentHint:true,openWorldHint:false}},
  {name:'news_status',description:'从生产数据库读回最新日报的生成时间、文章数及是否过期，用于核实同步。',inputSchema:{type:'object',properties:{},additionalProperties:false},annotations:{readOnlyHint:true,openWorldHint:false}},
];
export async function handleNewsMcp(request,db){
  let rpc;try{const body=await request.text();if(body.length>8100000)throw Error();rpc=JSON.parse(body);}catch{return Response.json({error:'invalid-request'},{status:400});}
  const reply=result=>Response.json({jsonrpc:'2.0',id:rpc.id??null,result},{headers:{'Cache-Control':'private, no-store'}});
  if(rpc.method==='server/discover')return reply({supportedVersions:['2026-07-28'],capabilities:{tools:{}}});
  if(rpc.method==='initialize')return reply({protocolVersion:'2025-03-26',capabilities:{tools:{}},serverInfo:{name:'daily-news',version:'1.0.0'}});
  if(rpc.method==='notifications/initialized')return new Response(null,{status:204});
  if(rpc.method==='tools/list')return reply({tools});
  if(rpc.method!=='tools/call')return Response.json({jsonrpc:'2.0',id:rpc.id??null,error:{code:-32601,message:'Method not found'}});
  if(!request.headers.get('oai-authenticated-user-id'))return Response.json({error:'identity-required'},{status:401});
  try{
    let result;
    if(rpc.params?.name==='sync_news'){
      const payload=rpc.params.arguments?.payload_json;
      if(typeof payload!=='string'||payload.length>8000000)throw Error();
      result=await syncEditions(db,JSON.parse(payload));
    }else if(rpc.params?.name==='news_status'){
      const data=await readBrief(db);result={generated_at:data.edition?.generated_at??null,articles:data.edition?.articles.length??0,stale:data.state.stale};
    }else throw Error();
    return reply({content:[{type:'text',text:JSON.stringify(result)}],structuredContent:result});
  }catch{return reply({isError:true,content:[{type:'text',text:'同步未完成：输入无效或存储不可用；既有日报保留。'}]});}
}
