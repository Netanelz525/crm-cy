import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { BlockList, isIP } from 'node:net';
import { lookup } from 'node:dns/promises';
import { request } from 'node:https';

import { CommandValidationError, parseCurlInput } from './command-request-input.js';
export { CommandValidationError } from './command-request-input.js';
const denied = new BlockList();
for (const [ip,bits] of [['0.0.0.0',8],['10.0.0.0',8],['100.64.0.0',10],['127.0.0.0',8],['169.254.0.0',16],['172.16.0.0',12],['192.0.0.0',24],['192.0.2.0',24],['192.88.99.0',24],['192.168.0.0',16],['198.18.0.0',15],['198.51.100.0',24],['203.0.113.0',24],['224.0.0.0',3]]) denied.addSubnet(ip,bits,'ipv4');
const global6 = new BlockList(); global6.addSubnet('2000::',3,'ipv6');
for (const [ip,bits] of [['2001::',23],['2001:db8::',32],['2002::',16],['3fff::',20]]) denied.addSubnet(ip,bits,'ipv6');
export function isPublicAddress(ip) {
  const family=isIP(ip);
  return family===4 ? !denied.check(ip,'ipv4') : family===6 && global6.check(ip,'ipv6') && !denied.check(ip,'ipv6');
}
export function validateCommandRequest(input) {
  let url; try { url=new URL(String(input.url||'')); } catch { throw new CommandValidationError('כתובת היעד אינה תקינה.'); }
  if(url.protocol!=='https:' || url.username || url.password || url.hash || (url.port && url.port!=='443') || url.href.length>8192) throw new CommandValidationError('יש להזין כתובת HTTPS ללא שם משתמש וסיסמה, בפורט 443.');
  const host=url.hostname.replace(/^\[|\]$/g,'');
  if(host==='localhost' || host.endsWith('.localhost') || host.endsWith('.local') || (isIP(host)&&!isPublicAddress(host))) throw new CommandValidationError('נדרשת כתובת אינטרנט ציבורית.');
  const method=String(input.method||'GET').toUpperCase();
  if(!['GET','POST','PUT','PATCH','DELETE'].includes(method)) throw new CommandValidationError('שיטת הבקשה אינה נתמכת.');
  const headers={};
  if(!input.headers || typeof input.headers!=='object' || Array.isArray(input.headers)) throw new CommandValidationError('כותרות הבקשה צריכות להיות אובייקט JSON.');
  for(const [name,value] of Object.entries(input.headers)) {
    if(!/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(name) || /^(host|connection|content-length|transfer-encoding|upgrade|proxy-.*|te|trailer|expect)$/i.test(name) || typeof value!=='string' || /[\r\n\0]/.test(value)) throw new CommandValidationError('כותרת בקשה אינה נתמכת.');
    headers[name.toLowerCase()]=value;
  }
  const body=String(input.body||'');
  if(method==='GET' && body) throw new CommandValidationError('בקשת GET אינה יכולה להכיל גוף.');
  if(Buffer.byteLength(JSON.stringify(headers))+Buffer.byteLength(body)>65536) throw new CommandValidationError('תוכן הבקשה גדול מדי (עד 64KB).');
  if(input.responseType!==undefined&&!['auto','api','web'].includes(input.responseType))throw new CommandValidationError('סוג התשובה אינו נתמך.');
  if(input.bodyFormat!==undefined && !['json','text'].includes(input.bodyFormat))throw new CommandValidationError('סוג גוף הבקשה אינו נתמך.');
  return {url:url.href,method,headers,body,...(input.bodyFormat?{bodyFormat:input.bodyFormat}:{}),...(input.responseType?{responseType:input.responseType}:{})};
}
export function parseCommandCurl(source) { return validateCommandRequest(parseCurlInput(source)); }
function encryptionKey() {
  const secret=process.env.COMMANDS_ENCRYPTION_KEY || process.env.CLERK_SECRET_KEY;
  if(!secret)throw new CommandValidationError('מפתח הצפנת הפקודות אינו מוגדר.');
  return createHash('sha256').update('crm-commands-v1\0'+secret).digest();
}
function encryptValue(config,domain) {
  const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',encryptionKey(),iv);cipher.setAAD(Buffer.from(domain));
  const bytes=Buffer.concat([cipher.update(JSON.stringify(config),'utf8'),cipher.final()]);
  return ['v1',iv.toString('base64'),cipher.getAuthTag().toString('base64'),bytes.toString('base64')].join(':');
}
function decryptValue(value,domain) {
  const [version,iv,tag,data]=value.split(':');if(version!=='v1')throw new CommandValidationError('הגדרת הפקודה אינה זמינה.');
  const cipher=createDecipheriv('aes-256-gcm',encryptionKey(),Buffer.from(iv,'base64'));cipher.setAAD(Buffer.from(domain));cipher.setAuthTag(Buffer.from(tag,'base64'));
  return JSON.parse(Buffer.concat([cipher.update(Buffer.from(data,'base64')),cipher.final()]).toString('utf8'));
}
export function encryptCommand(config) { return encryptValue(config,'crm-command-v1'); }
export function decryptCommand(value) { return validateCommandRequest(decryptValue(value,'crm-command-v1')); }
export function encryptCommandKey(value) {
  if(typeof value!=='string' || !value.trim() || value.length>8192 || /[\r\n\0]/.test(value))throw new CommandValidationError('יש להזין מפתח עד 8192 תווים ללא ירידת שורה.');
  return encryptValue(value.trim(),'crm-command-key-v1');
}
export function decryptCommandKey(value) { return decryptValue(value,'crm-command-key-v1'); }
export function validateKeyBinding(type,parameter='') {
  if(!['bearer','header','query'].includes(type))throw new CommandValidationError('מיקום המפתח אינו נתמך.');
  if(type!=='bearer' && !/^[A-Za-z0-9_.-]{1,80}$/.test(parameter))throw new CommandValidationError('יש להזין שם תקין לכותרת או לפרמטר של המפתח.');
  if(type==='header')validateCommandRequest({url:'https://example.com',headers:{[parameter]:'key'}});
  return {type,parameter:type==='bearer'?'':parameter};
}
export function applyCommandKey(config,secret,binding) {
  const {type,parameter}=validateKeyBinding(binding.type,binding.parameter);
  config=validateCommandRequest(config);config.headers={...config.headers};
  if(type==='bearer'){const token=secret.trim().replace(/^(?:Bearer\s+)+/i,'');if(!token || /^Bearer$/i.test(token))throw new CommandValidationError('חסר ערך המפתח אחרי Bearer.');config.headers.authorization=`Bearer ${token}`;}
  else if(type==='header')config.headers[parameter.toLowerCase()]=secret;
  else {const url=new URL(config.url);url.searchParams.set(parameter,secret);config.url=url.href;}
  return validateCommandRequest(config);
}
export function prepareCommandRequest(input) {
  const config=validateCommandRequest(input),url=new URL(config.url);
  // Older forms did not persist their JSON selection. Preserve Shortcuts' empty JSON semantics for MDM API calls.
  const legacyMdmJson=!config.bodyFormat && !config.body.trim() && config.method==='POST' && /^\/api\/mdm\//.test(url.pathname) && (!config.headers['content-type'] || /json/i.test(config.headers['content-type']));
  if((config.bodyFormat==='json'||legacyMdmJson) && config.method!=='GET') {
    config.body=config.body.trim()?config.body:'{}';
    if(!config.headers['content-type'])config.headers['content-type']='application/json';
  }
  return config;
}
export function commandResponseType(config) {
  if(config.responseType&&config.responseType!=='auto')return config.responseType;
  return config.bodyFormat==='json'||/json/i.test(config.headers['content-type']||'')||Boolean(config.headers.authorization)||/^\/api(?:\/|$)/i.test(new URL(config.url).pathname)?'api':'web';
}
export function classifyCommandResponse(status,contentType,body,expectedType='api') {
  if(status<200||status>=300)return {ok:false,status,outcome:status>=300&&status<400?'redirect_blocked':'http_error'};
  const text=body.trim();
  if(expectedType==='api'&&(/text\/html/i.test(contentType)||/^<(?:!doctype|html)\b/i.test(text)))return {ok:false,status,outcome:'unexpected_html'};
  let parsed;
  try {if(text)parsed=JSON.parse(text);}catch{if(expectedType==='api'||/json/i.test(contentType))return {ok:false,status,outcome:'invalid_json'};}
  let visited=0;
  function rejected(value,depth=0) {
    if(!value || typeof value!=='object' || depth>5 || ++visited>2000)return false;
    if(Array.isArray(value))return value.some(item=>rejected(item,depth+1));
    for(const [name,item] of Object.entries(value)) {
      const key=name.toLowerCase();
      if(['success','ok','issuccess'].includes(key) && (item===false||item===0||item==='false'))return true;
      if(['error','errors'].includes(key) && item && (typeof item!=='object'||Object.keys(item).length>0))return true;
      if(['status','statuscode'].includes(key) && ((typeof item==='number'&&item>=400) || /^(error|failed|failure|rejected|denied|unauthorized|forbidden)$/i.test(String(item))))return true;
      if(rejected(item,depth+1))return true;
    }
    return false;
  }
  if(parsed===false||rejected(parsed))return {ok:false,status,outcome:'api_error'};
  return {ok:true,status,outcome:status===202?'accepted':'http_received'};
}
export async function sendCommand(config,{resolve=lookup,transport=request,requestId}={}) {
  config=prepareCommandRequest(config);const url=new URL(config.url),host=url.hostname.replace(/^\[|\]$/g,'');
  let dnsTimer;let addresses;
  try {addresses=await Promise.race([resolve(host,{all:true,verbatim:true}),new Promise((_,reject)=>{dnsTimer=setTimeout(()=>reject(new Error('dns_timeout')),5000);})]);}finally{clearTimeout(dnsTimer);}
  if(!addresses.length||addresses.some(item=>!isPublicAddress(item.address)))throw new CommandValidationError('יעד הבקשה אינו ציבורי.');
  const address=addresses[0],headers={...config.headers};
  if(config.body||config.method!=='GET')headers['content-length']=Buffer.byteLength(config.body);
  if(requestId)headers['x-crm-command-run-id']=requestId;
  return new Promise((resolveResult)=>{
    let req,timer,settled=false;
    const finish=result=>{if(settled)return;settled=true;clearTimeout(timer);resolveResult(result);};
    try {
      req=transport(url,{method:config.method,headers,agent:false,lookup:(_host,options,callback)=>callback(null,...(options?.all?[[address]]:[address.address,address.family]))},res=>{
        const status=Number(res.statusCode)||0,chunks=[];let bytes=0;
        res.on('data',chunk=>{bytes+=Buffer.byteLength(chunk);if(bytes>262144){finish({ok:false,status,outcome:'response_too_large'});res.destroy();return;}chunks.push(Buffer.from(chunk));});
        res.on('end',()=>finish(classifyCommandResponse(status,String(res.headers?.['content-type']||''),Buffer.concat(chunks).toString('utf8'),commandResponseType(config))));
        res.on('aborted',()=>finish({ok:false,status,outcome:'response_incomplete'}));
        res.on('error',()=>finish({ok:false,status,outcome:'response_incomplete'}));
      });
      timer=setTimeout(()=>{finish({ok:false,status:null,outcome:'timeout'});req.destroy();},15000);
      req.on('error',()=>finish({ok:false,status:null,outcome:'network_error'}));req.end(config.body||undefined);
    }catch{finish({ok:false,status:null,outcome:'network_error'});req?.destroy();}
  });
}
