const DAY=86400000;
const text=(value,max=500)=>typeof value==='string'?value.slice(0,max):'';
const timestamp=value=>Number.isSafeInteger(value)&&value>0;
const fail=()=>{throw new Error('invalid-news-edition');};
function link(value){try{const url=new URL(value);if(url.protocol!=='https:'&&url.protocol!=='http:')fail();return url.href;}catch{fail();}}
export function normalizeEdition(input,now=Date.now()){
  if(input?.mode!=='live'||!timestamp(input.generated_at)||input.generated_at>now+300000||!Array.isArray(input.articles)||!input.articles.length||input.articles.length>300)fail();
  const seen=new Set();
  const articles=input.articles.map(a=>{
    if(!/^[a-z0-9-]{1,80}$/.test(a.id)||seen.has(a.id)||!text(a.title)||!Array.isArray(a.sources)||!a.sources.length||a.sources.length>20||!Array.isArray(a.facts)||!a.facts.length||a.facts.length>12)fail();
    seen.add(a.id);
    const sources=a.sources.map(s=>({id:text(s.id,80),source_id:text(s.source_id,80),source_name:text(s.source_name,120),url:link(s.url),title:text(s.title),published_at:timestamp(s.published_at)?s.published_at:null}));
    const sourceIds=new Set(sources.map(s=>s.id));
    if(sourceIds.has('')||sourceIds.size!==sources.length)fail();
    const factIds=new Set();
    const facts=a.facts.map(f=>{
      if(!text(f.id,80)||factIds.has(f.id)||!text(f.text,1000)||!['fact','claim','disputed'].includes(f.kind)||!Array.isArray(f.citations)||!f.citations.length||f.citations.length>4)fail();
      factIds.add(f.id);
      const citations=f.citations.map(c=>{if(!sourceIds.has(c.source_id)||!text(c.quote,1000))fail();return {source_id:c.source_id,quote:text(c.quote,1000)};});
      return {id:text(f.id,80),text:text(f.text,1000),kind:f.kind,attribution:text(f.attribution,120),citations};
    });
    const analysis=a.analysis&&typeof a.analysis.text==='string'&&Array.isArray(a.analysis.basis_fact_ids)&&a.analysis.basis_fact_ids.length&&a.analysis.basis_fact_ids.every(id=>factIds.has(id))?{text:text(a.analysis.text,1500),basis_fact_ids:a.analysis.basis_fact_ids,caveat:text(a.analysis.caveat)}:undefined;
    return {id:a.id,title:text(a.title),category:text(a.category,24)||'要闻',facts,sources,digest:facts.map(f=>f.text).join(''),latest_at:timestamp(a.latest_at)?a.latest_at:null,evidence_check:'automated',...(analysis?{analysis}:{})};
  });
  return {mode:'live',generated_at:input.generated_at,revision:Number.isInteger(input.revision)?input.revision:0,articles};
}
export async function syncEditions(db,input,now=Date.now()){
  if(!Array.isArray(input?.editions)||!input.editions.length||input.editions.length>30)fail();
  const editions=input.editions.map(e=>normalizeEdition(e,now));
  const statements=editions.map(e=>db.prepare('INSERT INTO news_editions (generated_at,payload) VALUES (?,?) ON CONFLICT(generated_at) DO NOTHING').bind(e.generated_at,JSON.stringify(e)));
  statements.push(db.prepare('DELETE FROM news_editions WHERE generated_at NOT IN (SELECT generated_at FROM news_editions ORDER BY generated_at DESC LIMIT 30)'));
  await db.batch(statements);
  const {edition}=await readBrief(db,now);
  return {ok:true,generated_at:edition?.generated_at,articles:edition?.articles.length??0};
}
export async function readEdition(db,at){
  if(!timestamp(Number(at)))return null;
  const row=await db.prepare('SELECT payload FROM news_editions WHERE generated_at=?').bind(Number(at)).first();
  return row?JSON.parse(row.payload):null;
}
export async function readBrief(db,now=Date.now()){
  const row=await db.prepare('SELECT payload FROM news_editions ORDER BY generated_at DESC LIMIT 1').first();
  const edition=row?JSON.parse(row.payload):null;
  return {edition,configured:true,last_run:null,state:{status:edition?'ready':'unconfigured',generated_at:edition?.generated_at??null,stale:!!edition&&now-edition.generated_at>26*3600000,next_run_at:Math.floor(now/DAY)*DAY+DAY}};
}
