const meta=name=>typeof document==='undefined'?null:document.querySelector(`meta[name="${name}"]`)?.content;
export function appPath(path='',base=meta('app-base')||'/'){return base+String(path).replace(/^\/+/, '');}
export function apiPath(path,base=meta('app-base')||'/',isStatic=meta('static-api')==='true'){return appPath('api/'+path+(isStatic?'.json':''),base);}
export function localPath(path,base=meta('app-base')||'/'){return base!=='/'&&path.startsWith(base)?'/'+path.slice(base.length):path;}
