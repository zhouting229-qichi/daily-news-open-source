const DAY = 86_400_000;
const compact = (s) => String(s ?? '').normalize('NFKC').replace(/\s+/g, ' ').trim();
function chineseNumber(s){
  const digits={'零':0,'〇':0,'一':1,'二':2,'两':2,'三':3,'四':4,'五':5,'六':6,'七':7,'八':8,'九':9},units={'十':10,'百':100,'千':1000,'万':10000,'亿':100000000};
  if([...s].every(c=>c in digits))return Number([...s].map(c=>digits[c]).join(''));
  let total=0,section=0,num=0;
  for(const c of s){if(c in digits)num=digits[c];else if(units[c]<10000){section+=(num||1)*units[c];num=0;}else if(units[c]){total+=(section+num||1)*units[c];section=0;num=0;}else return NaN;}
  return total+section+num;
}
function numericTokens(s){
  let text=compact(s).replace(/百分之([零〇一二两三四五六七八九十百千万亿\d.]+)/g,'$1%');
  const regex=/[-+负]?(?:\d[\d,]*(?:\.\d+)?(?:[十百千万亿]+)?|[零〇一二两三四五六七八九十百千万亿]+)(?:\s*(?:percentage points?|percent(?:age)?|billion|million|thousand|%|个百分点|百分比))?/gi;
  const result=[];
  for(const m of text.matchAll(regex)){
    let token=m[0].replaceAll(',',''),sign=1;
    if(token[0]==='-'||token[0]==='负'){sign=-1;token=token.slice(1);}else if(token[0]==='+')token=token.slice(1);
    const kind=/percentage points?|个百分点/i.test(token)?'points':/percent|%|百分比/i.test(token)?'percent':'number';
    token=token.replace(/percentage points?|percent(?:age)?|%|个百分点|百分比/gi,'').trim();
    let multiplier=1;
    token=token.replace(/\s*(billion|million|thousand)$/i,(_,u)=>{multiplier={billion:1e9,million:1e6,thousand:1e3}[u.toLowerCase()];return '';});
    // Indefinite articles such as “一项计划” aren't numerical claims.
    if(token==='一'&&/[个项次份条种方面]/.test(text[m.index+m[0].length]??''))continue;
    const arabic=token.match(/^(\d+(?:\.\d+)?)([十百千万亿]*)$/);
    let value;
    if(arabic){value=Number(arabic[1]);for(const c of arabic[2])value*=({'十':10,'百':100,'千':1000,'万':1e4,'亿':1e8})[c];}
    else value=chineseNumber(token);
    result.push(Number.isFinite(value)?`${kind}:${Number((sign*value*multiplier).toPrecision(12))}`:'unparsed');
  }
  return result;
}

export function rankEvents(events, {minimumScore=60}={}) {
  const weights = { impact:4, consequence:2.5, recency:2, attention:1.5 };
  const bounded = (v) => Number.isFinite(Number(v)) ? Math.min(10, Math.max(0, Number(v))) : 0;
  return events.map((e, index) => ({...e, score: Math.round(Object.entries(weights).reduce((n,[k,w])=>n+bounded(e.scores?.[k])*w,0)), _index:index}))
    .filter(e=>e.score>=minimumScore).sort((a,b)=>b.score-a.score || a._index-b._index)
    .map(({_index,...e})=>e);
}

// Mechanical evidence checks are intentionally stricter than a model's self-report.
// They do not prove semantic entailment; the pipeline separately reviews each fact.
export function validateFacts(draft, evidence) {
  const byId = new Map(evidence.map(e=>[e.id,e]));
  const facts = [], rejected = [], seen = new Set();
  for (const f of (Array.isArray(draft?.facts) ? draft.facts : []).slice(0,8)) {
    let reason = '';
    const text = compact(f.text), citations = Array.isArray(f.citations) ? f.citations : [];
    if (!f.id || seen.has(f.id) || text.length<5 || text.length>240 || !['fact','claim','disputed'].includes(f.kind)) reason='invalid-fact';
    if (f.kind !== 'fact' && (!f.attribution || !text.includes(f.attribution))) reason='missing-attribution';
    if (!citations.length || citations.length>4) reason='missing-evidence';
    let quoteText = '';
    for (const c of citations) {
      const e = byId.get(c.source_id), quote = compact(c.quote);
      if (!e || quote.length<12 || quote.length>900 || !compact(e.body).includes(quote)) reason='invalid-evidence';
      quoteText += ' '+quote;
    }
    const numbers = new Set(numericTokens(quoteText));
    if (numericTokens(text).some(n=>!numbers.has(n))) reason='unsupported-number';
    if (reason) rejected.push({id:f.id,reason});
    else { seen.add(f.id); facts.push({...f,text,citations:citations.map(c=>({source_id:c.source_id,quote:compact(c.quote)}))}); }
  }
  return {facts,rejected};
}

export function reportingOrigins(evidence) {
  const known = new Set(), unknown = new Set();
  for (const e of evidence) (e.origin_verified ? known : unknown).add(e.origin || `unknown:${e.source_id || e.id}`);
  return {known:known.size, unknown:unknown.size, total:known.size+unknown.size};
}

export function editionState(batch, run, now=Date.now()) {
  return {status:run?.status || (batch?'ready':'unconfigured'), generated_at:batch?.generated_at ?? null,
    stale:!!batch && now-batch.generated_at>26*3_600_000, error:run?.error ?? null,
    last_run:run ?? null, next_run_at:nextRunAt(now)};
}

// 08:00 Asia/Shanghai = 00:00 UTC, independently of the execution host's zone.
export function nextRunAt(now=Date.now()) { return Math.floor(now/DAY)*DAY+DAY; }

export function recentItem(item, now=Date.now()) {
  const t = item.published_at;
  return typeof t==='number' && Number.isFinite(t) && t<=now+5*60_000 && t>=now-DAY;
}
