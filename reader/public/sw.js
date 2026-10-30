// Keep private news and sign-in responses on the network, never in shared caches.
self.addEventListener('install',()=>self.skipWaiting());
self.addEventListener('activate',event=>event.waitUntil(self.clients.claim()));
self.addEventListener('fetch',event=>{
  if(event.request.mode!=='navigate'||new URL(event.request.url).origin!==self.location.origin)return;
  event.respondWith(fetch(event.request).catch(()=>new Response('<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="theme-color" content="#101114"><title>每日新闻 · 暂时离线</title><style>body{background:#101114;color:#eceef2;font:16px/1.8 system-ui;margin:48px 24px}h1{font-size:26px}p{color:#a0a6b1}a{color:#ff7956}</style><h1>每日新闻</h1><p>当前没有网络连接。连接网络后即可查看最新一期。</p><a href="/">重新连接</a></html>',{status:503,headers:{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store'}})));
});
