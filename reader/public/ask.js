import {apiPath} from './runtime.js';
import {questionPayload} from './ask-context.js?v=4';
const $=id=>document.getElementById(id),dialog=$('ask-dialog');
let active=null,history=[],controller=null;
function message(role,text){const entry=document.createElement('div');entry.className='ask-message '+role;const label=document.createElement('strong');label.textContent=role==='user'?'你':'DeepSeek';const body=document.createElement('p');body.textContent=text;entry.append(label,body);$('ask-messages').append(entry);entry.scrollIntoView({block:'nearest'});}
function finish(){controller=null;$('ask-submit').disabled=false;$('ask-submit').textContent='发送';for(const b of dialog.querySelectorAll('[data-question]'))b.disabled=false;}
export function openAsk({edition,article,configured}){
  if(active?.edition!==edition||active?.article.id!==article.id){controller?.abort();finish();history=[];$('ask-messages').replaceChildren();$('ask-question').value='';active={edition,article};$('ask-title').textContent=article.title;$('ask-status').textContent=configured?'':'AI 尚未完成服务端密钥配置，当前可以阅读新闻。';}
  if(!dialog.open)dialog.showModal();$('ask-question').focus();
}
$('close-ask').addEventListener('click',()=>dialog.close());
dialog.addEventListener('close',()=>{controller?.abort();});
for(const b of dialog.querySelectorAll('[data-question]'))b.addEventListener('click',()=>{$('ask-question').value=b.dataset.question;$('ask-form').requestSubmit();});
$('ask-form').addEventListener('submit',async event=>{
  event.preventDefault();if(controller||!active)return;
  const question=$('ask-question').value.trim();if(!question)return;
  const selected=active,abort=new AbortController();controller=abort;
  $('ask-submit').disabled=true;$('ask-submit').textContent='回答中…';for(const b of dialog.querySelectorAll('[data-question]'))b.disabled=true;
  $('ask-status').textContent='正在根据这篇新闻思考…';message('user',question);
  const timeout=setTimeout(()=>abort.abort(),50000);
  try{
    const response=await fetch(apiPath('ask'),{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(questionPayload({edition:selected.edition,articleId:selected.article.id,question,history})),signal:abort.signal});
    const result=await response.json();if(active!==selected)return;
    if(!response.ok)throw Error(result.error||'AI 暂时不可用，请稍后再试。');
    message('assistant',result.answer);history.push({role:'user',content:question},{role:'assistant',content:result.answer.slice(0,4000)});history=history.slice(-8);
    $('ask-question').value='';$('ask-status').textContent=result.truncated?'回答达到长度限制，可以继续追问。':'AI 解释供参考，请结合原文核对。';
    const sources=document.createElement('div');sources.className='ask-sources';
    for(const s of result.sources||[]){const url=new URL(s.url);if(!['https:','http:'].includes(url.protocol))continue;const a=document.createElement('a');a.href=url.href;a.target='_blank';a.rel='noopener noreferrer';a.textContent=`[${s.number}] ${s.name}`;sources.append(a);}
    $('ask-messages').append(sources);
  }catch(error){if(active===selected)$('ask-status').textContent=abort.signal.aborted?'已取消或等待超时，可以重试。':error.message;}
  finally{clearTimeout(timeout);if(controller===abort)finish();}
});
