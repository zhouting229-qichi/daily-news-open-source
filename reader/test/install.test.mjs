import {test} from 'node:test';
import assert from 'node:assert/strict';
import {attachInstall} from '../public/install.js';
function browser(standalone=false){
  const button=new EventTarget(),dialog={opened:false,showModal(){this.opened=true;},close(){this.opened=false;}},close=new EventTarget();
  button.hidden=false;button.disabled=false;button.textContent='安装';
  const window=new EventTarget();window.matchMedia=()=>({matches:standalone});window.location={protocol:'https:'};
  const document={getElementById:id=>({'install-app':button,'install-help':dialog,'close-install':close}[id])};
  return {window,document,navigator:{},button,dialog};
}
test('installation guidance is available when the browser has no native install prompt',()=>{
  const b=browser();attachInstall(b);b.button.dispatchEvent(new Event('click'));
  assert.equal(b.dialog.opened,true);
});
test('standalone apps hide the install action',()=>{
  const b=browser(true);attachInstall(b);assert.equal(b.button.hidden,true);
});
test('accepted native prompt hides installation, cancellation keeps it available',async()=>{
  for(const outcome of ['accepted','dismissed']){
    const b=browser();attachInstall(b);
    const event=new Event('beforeinstallprompt',{cancelable:true});let prompted=0;
    event.prompt=async()=>{prompted++;};event.userChoice=Promise.resolve({outcome});
    b.window.dispatchEvent(event);b.button.dispatchEvent(new Event('click'));
    await new Promise(resolve=>setImmediate(resolve));
    assert.equal(event.defaultPrevented,true);assert.equal(prompted,1);
    assert.equal(b.button.hidden,outcome==='accepted');assert.equal(b.button.disabled,false);
  }
});
test('failed installation offers guidance and does not leave the button disabled',async()=>{
  const b=browser();attachInstall(b);const event=new Event('beforeinstallprompt',{cancelable:true});
  event.prompt=async()=>{throw new Error('unavailable');};b.window.dispatchEvent(event);
  b.button.dispatchEvent(new Event('click'));await new Promise(resolve=>setImmediate(resolve));
  assert.equal(b.button.disabled,false);assert.equal(b.dialog.opened,true);
});
