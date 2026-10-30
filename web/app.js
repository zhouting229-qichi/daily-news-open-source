import {dateTime,renderStatus,renderArticle} from './view.js?v=2';
import {apiPath,appPath,localPath} from './runtime.js';
let signature='',busy=false;
const $=id=>document.getElementById(id),route=localPath(location.pathname).match(/^\/story\/(demo|\d+)\/([a-z0-9-]+)\/?$/);
async function load(force=false){
  if(busy)return;busy=true;$('refresh').classList.add('refreshing');
  try{
    const response=await fetch(apiPath('brief'),{cache:'no-store'});if(!response.ok)throw Error();
    const data=await response.json();let edition=data.edition;
    if(route){const r=await fetch(apiPath(route[1]==='demo'?'demo':'edition/'+route[1]),{cache:'no-store'});edition=r.ok?await r.json():null;}
    else if(!edition){const r=await fetch(apiPath('demo'),{cache:'no-store'});if(!r.ok)throw Error();edition=await r.json();}
    const state=route?{status:'ready',stale:edition?.mode!=='demo'&&edition&&Date.now()-edition.generated_at>26*3600000}:data.state;
    const next=JSON.stringify([state,edition?.generated_at,edition?.articles.length]);
    if(signature===next&&!force)return;signature=next;
    $('status').innerHTML=renderStatus(edition,state);
    $('edition-date').textContent=edition?.mode==='demo'?'样刊预览':edition?.generated_at?dateTime(edition.generated_at).slice(0,10):'';
    $('edition-count').textContent=!route&&edition?.articles?.length?`${edition.articles.length} 条新闻`:'';
    if(route){
      const article=edition?.articles.find(a=>a.id===route[2]);
      document.body.classList.add('detail-page');
      $('articles').innerHTML=article?renderArticle(article,0,route[1],true):`<div class="empty">这篇新闻已不在本地档案中。<a href="${appPath()}">返回新闻列表</a></div>`;
      if(article)document.title=article.title+' · 每日新闻';
      $('feed-end').textContent='';
    }else{
      $('articles').innerHTML=edition?.articles?.length?edition.articles.map((a,i)=>renderArticle(a,i,edition.mode==='demo'?'demo':edition.generated_at)).join(''):'<div class="empty">暂无通过核对的新闻。</div>';
      $('feed-end').textContent='已显示全部新闻';
    }
  }catch{$('status').innerHTML='<span class="status-line warning">读取失败，请稍后刷新</span>';if(!signature)$('articles').innerHTML='';}
  finally{busy=false;$('refresh').classList.remove('refreshing');}
}
$('refresh').addEventListener('click',()=>load(true));load();if(!route)setInterval(()=>load(),30_000);
