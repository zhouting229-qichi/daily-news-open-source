export const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function dateTime(t){return t?new Intl.DateTimeFormat('zh-CN',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false}).format(t):'尚未生成';}
const safeLink=s=>{try{const u=new URL(s);return ['https:','http:'].includes(u.protocol)?esc(u.href):'#';}catch{return '#';}};
export function renderStatus(edition,state={}){
  let text='',type='';
  if(edition?.mode==='demo'){text='历史新闻样刊 · 非今日新闻';type='demo';}
  else if(state.status==='failed'){text='更新未完成'+(edition?' · 保留上一版 '+dateTime(edition.generated_at):' · 暂无日报');type='warning';}
  else if(state.status==='running')text='正在更新';
  else if(!edition)text='真实日报尚未生成';
  else if(state.stale){text='较早简报 · '+dateTime(edition.generated_at);type='warning';}
  else text='按重要性与热度排序 · '+dateTime(edition.generated_at)+' 更新';
  return `<span class="status-line ${type}"><i></i>${esc(text)}</span>`;
}
export function renderArticle(a,index,editionKey='demo',detail=false){
  const sources=a.sources??[],facts=a.facts??[],citeMap=new Map(sources.map((s,i)=>[s.id,i+1]));
  const href=appPath(`story/${encodeURIComponent(editionKey)}/${encodeURIComponent(a.id)}`);
  const links=sources.map(s=>`<a href="${safeLink(s.url)}" target="_blank" rel="noopener noreferrer">${esc(s.source_name)}</a>`).join('<span class="separator">·</span>');
  const published=a.latest_at?`<time>${dateTime(a.latest_at).slice(0,10)}</time>`:'';
  if(!detail)return `<article class="news-row story"><span class="rank ${index<3?'rank-top':''}">${index+1}</span><div class="row-content"><a class="story-title" href="${href}">${esc(a.title)}</a><div class="row-meta">${index===0?'<span class="priority">重点</span>':''}<span class="category">${esc(a.category||'要闻')}</span><span class="meta-divider"></span><span class="story-sources">${links}</span>${published}</div></div><a class="row-open" href="${href}" aria-label="查看${esc(a.title)}的详情">›</a></article>`;
  const citations=f=>(f.citations??[]).map(c=>`<sup>[${citeMap.get(c.source_id)||'?'}]</sup>`).join('');
  const paragraphs=facts.map(f=>`<p>${f.kind==='disputed'?'<span class="disputed">争议信息</span>':''}${esc(f.text)}${citations(f)}</p>`).join('');
  const quotes=facts.flatMap(f=>(f.citations??[]).map(c=>({c,f}))),first=quotes[0];
  const extract=first?`<blockquote class="original-quote"><span class="quote-label">原文摘录 · ${esc(sources.find(s=>s.id===first.c.source_id)?.source_name||'原始报道')}</span><p>${esc(first.c.quote.length>220?first.c.quote.slice(0,220)+'…':first.c.quote)}</p></blockquote>`:'';
  const analysis=a.analysis&&typeof a.analysis.text==='string'&&a.analysis.basis_fact_ids?.length&&a.analysis.basis_fact_ids.every(id=>facts.some(f=>f.id===id))?`<div class="analysis"><span class="analysis-label">分析</span><p>${esc(a.analysis.text)}</p>${a.analysis.caveat?`<p class="analysis-caveat">${esc(a.analysis.caveat)}</p>`:''}</div>`:'';
  return `<article class="story-detail"><a class="back-link" href="${appPath()}">‹ 返回新闻列表</a><h2>${esc(a.title)}</h2><div class="detail-meta"><span class="category">${esc(a.category||'要闻')}</span>${published}<span>${editionKey==='demo'?'历史资料':'编辑整理'}</span></div><div class="detail-body">${paragraphs}</div>${extract}${analysis}<div class="source-foot"><span>来源</span><div>${links}</div><small>${a.evidence_check==='manual-demo'?'历史样刊，人工整理；分析与原文事实分开标注。':'内容经自动核对，分析不等于已确认事实。'}</small></div><details class="evidence"><summary>查看逐句原文依据 <span>＋</span></summary><div class="evidence-inner">${quotes.map(({c,f})=>`<div class="quote-item"><p>[${citeMap.get(c.source_id)||'?'}] ${esc(f.text)}</p><blockquote>${esc(c.quote)}</blockquote></div>`).join('')}</div></details></article>`;
}
import {appPath} from './runtime.js';
