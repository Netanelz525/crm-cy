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
  return {url:url.href,method,headers,body};
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
  if(type==='bearer')config.headers.authorization=`Bearer ${secret}`;
  else if(type==='header')config.headers[parameter.toLowerCase()]=secret;
  else {const url=new URL(config.url);url.searchParams.set(parameter,secret);config.url=url.href;}
  return validateCommandRequest(config);
}
export async function sendCommand(config,{resolve=lookup,transport=request}={}) {
  config=validateCommandRequest(config); const url=new URL(config.url),host=url.hostname.replace(/^\[|\]$/g,'');
  let dnsTimer; let addresses;
  try { addresses=await Promise.race([resolve(host,{all:true,verbatim:true}),new Promise((_,reject)=>{dnsTimer=setTimeout(()=>reject(new Error('dns_timeout')),5000);})]); } finally {clearTimeout(dnsTimer);}
  if(!addresses.length || addresses.some(item=>!isPublicAddress(item.address)))throw new CommandValidationError('יעד הבקשה אינו ציבורי.');
  const address=addresses[0];
  return new Promise((resolveResult,reject)=>{
    const timer=setTimeout(()=>{req.destroy();reject(Error('timeout'));},15000);
    const req=transport(url,{method:config.method,headers:config.headers,agent:false,lookup:(_host,options,callback)=>callback(null,...(options?.all?[[address]]:[address.address,address.family]))},res=>{
      const status=Number(res.statusCode)||0;res.destroy();clearTimeout(timer);resolveResult({ok:status>=200&&status<300,status});
    });
    req.on('error',()=>{clearTimeout(timer);reject(Error('request_failed'));});req.end(config.body||undefined);
  });
}
