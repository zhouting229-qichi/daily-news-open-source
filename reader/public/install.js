export function attachInstall({window,document,navigator}){
  const button=document.getElementById('install-app'),help=document.getElementById('install-help');
  if(!button||!help)return;
  let prompt=null;
  button.hidden=window.matchMedia('(display-mode: standalone)').matches||navigator.standalone===true;
  const showHelp=()=>help.showModal();
  window.addEventListener('beforeinstallprompt',event=>{event.preventDefault();prompt=event;});
  window.addEventListener('appinstalled',()=>{prompt=null;button.hidden=true;});
  button.addEventListener('click',async()=>{
    if(!prompt){showHelp();return;}
    const pending=prompt;prompt=null;button.disabled=true;
    try{await pending.prompt();const choice=await pending.userChoice;if(choice?.outcome==='accepted')button.hidden=true;}
    catch{showHelp();}finally{button.disabled=false;}
  });
  document.getElementById('close-install')?.addEventListener('click',()=>help.close());
  if('serviceWorker' in navigator)navigator.serviceWorker.register('/sw.js').catch(()=>{});
}
if(typeof window!=='undefined')attachInstall({window,document,navigator});
