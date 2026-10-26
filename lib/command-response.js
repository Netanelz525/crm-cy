const HIDDEN='[מוסתר]';
const sensitive=/authorization|password|passwd|secret|token|api[-_]?key|access.?key|private.?key|session|cookie|credential/i;
export function sanitizeCommandResponse(body,contentType,config) {
  const secrets=new Set();
  function remember(value){if(typeof value==='string'&&value.length>=3){secrets.add(value);try{secrets.add(decodeURIComponent(value));}catch{}}}
  for(const [name,value] of Object.entries(config.headers||{}))if(!/^(content-type|accept|user-agent)$/i.test(name)){remember(value);remember(value.replace(/^Bearer\s+/i,''));}
  const url=new URL(config.url);for(const value of url.searchParams.values())remember(value);
  const parts=url.pathname.split('/');parts.forEach((part,index)=>{if(part.length>=24||/token|key|secret|webhook|process/i.test(parts[index-1]||''))remember(part);});
  function collect(value,depth=0){if(depth>30||!value||typeof value!=='object')return;for(const [key,item]of Object.entries(value)){if(sensitive.test(key))remember(item);else collect(item,depth+1);}}
  try{collect(JSON.parse(config.body||'{}'));}catch{}
  function scrub(text){let out=text;for(const secret of [...secrets].sort((a,b)=>b.length-a.length)){for(const variant of new Set([secret,encodeURIComponent(secret),JSON.stringify(secret).slice(1,-1)]))if(variant.length>=3)out=out.split(variant).join(HIDDEN);}return out;}
  function clean(value,depth=0){if(depth>30)return '[מבנה עמוק הוסתר]';if(typeof value==='string')return scrub(value);if(Array.isArray(value))return value.map(item=>clean(item,depth+1));if(!value||typeof value!=='object')return value;const fileLike=Boolean(value.filename||value.fileName||value.file_name);return Object.fromEntries(Object.entries(value).map(([key,item])=>[scrub(key),/base64|^(file|attachment|chunk)_(data|content|bytes)$/i.test(key)||(fileLike&&/^(content|data|bytes|buffer)$/i.test(key))?'[תוכן קובץ הוסר]':sensitive.test(key)?HIDDEN:clean(item,depth+1)]));}
  if(contentType&&!/text\/|json|xml|javascript|x-www-form-urlencoded/i.test(contentType))return {body:'התקבלה תשובה שאינה טקסט. תוכן הקובץ אינו נשמר.',contentType:contentType.slice(0,120)};
  let text=String(body||'').replace(/data:[^\s"'<>]*;base64,[A-Za-z0-9+/=_-]+/gi,'[תוכן קובץ הוסר]');try{text=JSON.stringify(clean(JSON.parse(text)),null,2);}catch{text=scrub(text).replace(/(Bearer\s+)[A-Za-z0-9._~+\/-]+/gi,'$1'+HIDDEN).replace(/((?:password|secret|token|api[-_]?key)["']?\s*[=:]\s*["']?)[^\s"'<>;&]+/gi,'$1'+HIDDEN);}
  return {body:text.slice(0,262144),contentType:contentType.slice(0,120),truncated:text.length>262144};
}
