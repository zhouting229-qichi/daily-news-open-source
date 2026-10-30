import {esc,dateTime,renderStatus,renderArticle} from '../public/view.js';
import {renderFeed,sectionArticles,sections} from '../public/feed.js';
export function renderPage(shell,brief,{section='all',storyId=null,aiConfigured=false}={}){
  const edition=brief.edition,article=storyId?edition?.articles.find(a=>a.id===storyId):null;
  const state=storyId?{status:'ready',stale:!!edition&&Date.now()-edition.generated_at>26*3600000}:brief.state;
  const content=storyId?(article?renderArticle(article,0,edition.generated_at,true):'<div class="empty">这篇新闻已不在档案中。<a href="/">返回新闻列表</a></div>'):renderFeed(edition,section);
  const nav=storyId?'':sections.map(([key,label])=>`<a href="/?section=${key}" data-section="${key}" ${key===section?'aria-current="page"':''}>${label}<span>${sectionArticles(edition?.articles,key).length}</span></a>`).join('');
  const bootstrap=JSON.stringify({...brief,section,storyId,aiConfigured}).replace(/</g,'\\u003c').replace(/\u2028/g,'\\u2028').replace(/\u2029/g,'\\u2029');
  const values={CONTENT:content,STATUS:renderStatus(edition,state),DATE:edition?esc(dateTime(edition.generated_at).slice(0,10)):'',COUNT:storyId?'':`${sectionArticles(edition?.articles,section).length} 条新闻`,NAV:nav,FOOTER:storyId?'':'每天北京时间 08:00 后更新 · 云端调度可能延迟',BOOTSTRAP:`<script id="news-bootstrap" type="application/json">${bootstrap}</script>`};
  let html=shell.replace(/<!--(CONTENT|STATUS|DATE|COUNT|NAV|FOOTER|BOOTSTRAP)-->/g,(_,key)=>values[key]);
  if(storyId)html=html.replace('<body>','<body class="detail-page">');
  if(article)html=html.replace('<title>每日新闻</title>',`<title>${esc(article.title)} · 每日新闻</title>`);
  return html;
}
export async function briefResponse(request,data){
  const body=JSON.stringify(data),hash=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(body));
  const etag='"'+Array.from(new Uint8Array(hash),b=>b.toString(16).padStart(2,'0')).join('')+'"';
  const headers={'Content-Type':'application/json; charset=utf-8','Cache-Control':'private, no-store',ETag:etag};
  // Edge compression can turn a strong tag into W/"...". GET uses weak
  // comparison, including validators supplied as a comma-separated list.
  const validators=(request.headers.get('if-none-match')||'').split(',').map(value=>value.trim().replace(/^W\//,''));
  return validators.includes(etag)||validators.includes('*')?new Response(null,{status:304,headers}):new Response(body,{headers});
}
