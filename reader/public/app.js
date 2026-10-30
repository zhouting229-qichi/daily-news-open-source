import {dateTime,renderStatus,renderArticle} from './view.js?v=4';
import {renderFeed,sectionArticles,sections} from './feed.js?v=4';
import {apiPath} from './runtime.js';
const $=id=>document.getElementById(id);
let data;try{data=JSON.parse($('news-bootstrap').textContent);}catch{data={edition:null,state:{status:'failed'}};}
let section=sections.some(([key])=>key===data.section)?data.section:'all',busy=false,lastCheck=Date.now(),etag='',askModule;
const storyId=data.storyId;
function render(){
  $('status').innerHTML=renderStatus(data.edition,data.state);
  $('edition-date').textContent=data.edition?dateTime(data.edition.generated_at).slice(0,10):'';
  if(storyId){const article=data.edition?.articles.find(a=>a.id===storyId);if(article)$('articles').innerHTML=renderArticle(article,0,data.edition.generated_at,true);return;}
  $('articles').innerHTML=renderFeed(data.edition,section);
  $('edition-count').textContent=`${sectionArticles(data.edition?.articles,section).length} 条新闻`;
  for(const a of $('sections').querySelectorAll('[data-section]')){if(a.dataset.section===section)a.setAttribute('aria-current','page');else a.removeAttribute('aria-current');a.querySelector('span').textContent=sectionArticles(data.edition?.articles,a.dataset.section).length;}
}
async function load(force=false){
  if(busy||(!force&&document.hidden))return;busy=true;$('refresh').classList.add('refreshing');lastCheck=Date.now();
  try{
    const response=await fetch(apiPath(storyId?'edition/'+data.edition?.generated_at:'brief'),{cache:'no-store',headers:!force&&etag?{'If-None-Match':etag}:{},signal:AbortSignal.timeout(15000)});
    if(response.status===304)return;if(!response.ok)throw Error();
    etag=response.headers.get('etag')||'';const result=await response.json();
    const next=storyId?{edition:result,state:{status:'ready',stale:Date.now()-result.generated_at>26*3600000}}:result;
    if(JSON.stringify([next.edition,next.state])!==JSON.stringify([data.edition,data.state])||force){data={...data,...next};render();}
  }catch{$('status').innerHTML='<span class="status-line warning">暂时无法检查更新，保留当前日报。请稍后刷新。</span>';}
  finally{busy=false;$('refresh').classList.remove('refreshing');}
}
$('refresh').addEventListener('click',()=>load(true));
$('sections').addEventListener('click',event=>{const a=event.target.closest('[data-section]');if(!a)return;event.preventDefault();section=a.dataset.section;history.replaceState(null,'','/?section='+section);render();});
document.addEventListener('click',async event=>{const button=event.target.closest('[data-ask]');if(!button)return;const article=data.edition?.articles.find(a=>a.id===button.dataset.ask);if(!article)return;button.disabled=true;try{askModule??=import('./ask.js?v=4');const {openAsk}=await askModule;openAsk({edition:data.edition.generated_at,article,configured:data.aiConfigured});}catch{askModule=null;$('status').textContent='AI 面板加载失败，请重试。';}finally{button.disabled=false;}});
if(!data.edition&&!storyId)load();
if(!storyId){setInterval(()=>load(),300000);document.addEventListener('visibilitychange',()=>{if(!document.hidden&&Date.now()-lastCheck>60000)load();});}
