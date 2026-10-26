import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import * as crypto from 'node:crypto';
import * as net from 'node:net';
import * as dns from 'node:dns/promises';
import * as https from 'node:https';
import * as http from 'node:http';
import {EventEmitter} from 'node:events';
async function load(file,stubs){const context=vm.createContext({Buffer,URL,process:{env:{CLERK_SECRET_KEY:'synthetic-test-key'}},setTimeout,clearTimeout});const mod=new vm.SourceTextModule(await fs.readFile(new URL(file,import.meta.url),'utf8'),{context});await mod.link(async name=>{const values=stubs[name];if(!values)throw Error(name);return new vm.SyntheticModule(Object.keys(values),function(){for(const [key,value]of Object.entries(values))this.setExport(key,value);},{context});});await mod.evaluate();return mod.namespace;}
const input=await load('../lib/command-request-input.js',{});
const request=await load('../lib/command-request.js',{'node:crypto':crypto,'node:net':net,'node:dns/promises':dns,'node:https':https,'./command-request-input.js':input});
const config={url:'https://example.com/on?token=secret',method:'POST',headers:{Authorization:'Bearer hidden'},body:'{"on":true}'};
test('curl parses quoted tokens, JSON and line continuations without shell execution',()=>{
 const result=request.parseCommandCurl("curl -X POST 'https://example.com/on' \\\n -H 'Authorization: Bearer hidden' -H 'Content-Type: application/json' --data-raw '{\"on\":true}'");
 assert.equal(result.method,'POST');assert.equal(result.headers.authorization,'Bearer hidden');assert.equal(result.body,'{"on":true}');
 assert.equal(request.parseCommandCurl('curl https://example.com').method,'GET');
 for(const text of ['curl https://example.com; whoami','curl https://example.com -L','curl https://example.com -k','curl https://example.com --data @/etc/passwd','curl https://example.com https://other.com','curl "https://example.com'])assert.throws(()=>request.parseCommandCurl(text));
});
test('validation blocks unsafe schemes, local targets, credentials, reserved headers and oversized bodies',()=>{
 for(const url of ['http://example.com','https://localhost','https://10.0.0.1','https://[::1]','https://[::ffff:127.0.0.1]','https://user:pass@example.com','https://example.com:8443'])assert.throws(()=>request.validateCommandRequest({...config,url}));
 for(const headers of [{Host:'evil'},{'Content-Length':'2'},{Authorization:'a\r\nb'},[]])assert.throws(()=>request.validateCommandRequest({...config,headers}));
 assert.throws(()=>request.validateCommandRequest({...config,body:'x'.repeat(66000)}));
 assert.throws(()=>request.validateCommandRequest({...config,method:'GET'}));
});
test('ciphertext hides the entire URL, headers and body; tampering is rejected',()=>{
 const ciphertext=request.encryptCommand(config);assert(!ciphertext.includes('secret'));assert(!ciphertext.includes('example.com'));assert(!ciphertext.includes('hidden'));
 const decoded=request.decryptCommand(ciphertext);assert.equal(decoded.url,config.url);assert.equal(decoded.headers.authorization,'Bearer hidden');
 const parts=ciphertext.split(':');const bytes=Buffer.from(parts[3],'base64');bytes[0]^=1;parts[3]=bytes.toString('base64');assert.throws(()=>request.decryptCommand(parts.join(':')));
 assert.notEqual(request.encryptCommand(config),ciphertext);
});
test('address policy blocks metadata, private, mapped IPv6, multicast and documentation ranges',()=>{
 for(const ip of ['0.1.2.3','127.1.1.1','169.254.169.254','100.100.100.200','172.20.1.1','192.168.1.1','192.88.99.1','198.18.0.1','224.0.0.1','::ffff:8.8.8.8','fc00::1','fe80::1','2001:db8::1','2002:7f00:1::','3fff::1'])assert.equal(request.isPublicAddress(ip),false,ip);
 for(const ip of ['8.8.8.8','1.1.1.1','2606:4700:4700::1111'])assert.equal(request.isPublicAddress(ip),true,ip);
});
test('DNS is checked on every execution, mixed answers fail, and connection uses pinned address without redirects',async()=>{
 let connections=0;
 const transport=(url,options,callback)=>{connections++;assert.equal(options.agent,false);options.lookup('example.com',{},(err,ip,family)=>{assert.equal(ip,'8.8.8.8');assert.equal(family,4);});const req=new EventEmitter();req.destroy=()=>{};req.end=()=>{const response=new EventEmitter();response.statusCode=302;response.destroy=()=>{};response.headers={'content-type':'application/json'};queueMicrotask(()=>{callback(response);response.emit('data',Buffer.from('{}'));response.emit('end');});};return req;};
 const result=await request.sendCommand(config,{resolve:async()=>[{address:'8.8.8.8',family:4}],transport});assert.equal(result.ok,false);assert.equal(result.status,302);assert.equal(connections,1);
 await assert.rejects(request.sendCommand(config,{resolve:async()=>[{address:'8.8.8.8',family:4},{address:'127.0.0.1',family:4}],transport}));assert.equal(connections,1);
});
const admin={clerk_user_id:'admin',is_super_admin:true,access_status:'approved'},staff={clerk_user_id:'staff',access_status:'approved'};
async function serviceFixture({claim=true,sendError=false,keyValue=null}={}){
 const calls=[],sent=[];const sql=async(strings,...args)=>{const query=strings.join('?');calls.push({query,args});if(query.includes('WITH claimed'))return claim?[{encrypted_request:'encrypted',encrypted_value:keyValue,key_type:'bearer',key_parameter:''}]:[];if(query.includes('RETURNING id'))return [{id:'key1'}];if(query.includes('SELECT id FROM system_command_keys'))return [{id:'key1'}];if(query.includes('SELECT clerk_user_id'))return [{clerk_user_id:'staff'}];if(query.includes('SELECT id,name'))return [];return [];};
 const mod=await load('../lib/commands.js',{'node:crypto':crypto,'./db.js':{initDb:async()=>{},sql},'./command-request.js':{encryptCommand:()=> 'encrypted',decryptCommand:()=>config,sendCommand:async value=>{sent.push(value);if(sendError)throw Error('private token');return {ok:true,status:204};},CommandValidationError:request.CommandValidationError,encryptCommandKey:request.encryptCommandKey,decryptCommandKey:request.decryptCommandKey,applyCommandKey:request.applyCommandKey,validateKeyBinding:request.validateKeyBinding,prepareCommandRequest:request.prepareCommandRequest,commandResponseType:request.commandResponseType}});return {mod,calls,sent};
}
test('permissions require approved account, explicit grant, active command; only admin can manage',async()=>{
 const {mod,calls}=await serviceFixture();const command={enabled:true,allowed_user_ids:['staff']};assert(mod.canRunCommand(staff,command));assert(!mod.canRunCommand({...staff,access_status:'pending'},command));assert(!mod.canRunCommand({...staff,clerk_user_id:'other'},command));assert(!mod.canRunCommand(admin,{...command,enabled:false}));
 await assert.rejects(mod.saveCommand(staff,{name:'on'}));assert.equal(calls.length,0);
 assert.equal((await mod.runCommand(null,'cmd')).code,'denied');assert.equal(calls.length,0);
 await mod.listCommands(staff);const query=calls.find(call=>call.query.includes('SELECT id,name'));assert(!query.query.includes('encrypted_request'));assert(query.query.includes('ANY(allowed_user_ids)'));assert(query.query.includes('ELSE ARRAY['));assert(!query.query.includes('ELSE ARRAY[]'));assert(query.args.includes('staff'));
});
test('atomic run claim includes live permissions, cooldown and audit before dispatch; failed claims never send',async()=>{
 for(const claim of [false,true]){const {mod,calls,sent}=await serviceFixture({claim});const result=await mod.runCommand(staff,'cmd');assert.equal(sent.length,claim?1:0);assert.equal(result.code,claim?'sent':'unavailable');const query=calls.find(c=>c.query.includes('WITH claimed')).query;assert(query.includes('enabled'));assert(query.includes('ANY(allowed_user_ids)'));assert(query.includes("INTERVAL '30 seconds'"));assert(query.includes('INSERT INTO system_command_runs'));}
});
test('network errors produce generic audited failure without persisting response bodies or secrets',async()=>{
 const {mod,calls}=await serviceFixture({sendError:true});const result=await mod.runCommand(staff,'cmd');assert.equal(result.code,'failed');const audit=calls.find(c=>c.query.includes('UPDATE system_command_runs'));assert(audit.args.includes('failed'));assert(!JSON.stringify(audit).includes('private token'));
});

test('key vault values use authenticated encryption distinct from command configuration',()=>{
 const cipher=request.encryptCommandKey('synthetic-shared-secret');assert(!cipher.includes('synthetic'));assert.equal(request.decryptCommandKey(cipher),'synthetic-shared-secret');
 assert.throws(()=>request.decryptCommand(cipher));assert.throws(()=>request.decryptCommandKey(request.encryptCommand(config)));
 for(const value of ['', 'x'.repeat(8193),'key\r\nheader'])assert.throws(()=>request.encryptCommandKey(value));
});
test('stored keys are bound at execution as Bearer, custom header or encoded query without touching JSON',()=>{
 const secret='value&with=symbols"',base={...config,url:'https://example.com/on?device=1',headers:{},body:'{"device":1}'};
 assert.equal(request.applyCommandKey(base,secret,{type:'bearer'}).headers.authorization,'Bearer '+secret);
 assert.equal(request.applyCommandKey(base,secret,{type:'header',parameter:'X-API-Key'}).headers['x-api-key'],secret);
 const result=request.applyCommandKey(base,secret,{type:'query',parameter:'api_key'});assert.equal(new URL(result.url).searchParams.get('api_key'),secret);assert.equal(result.body,base.body);assert.equal(base.headers.authorization,undefined);
 for(const binding of [{type:'other'},{type:'header',parameter:'Host'},{type:'query',parameter:'x&other'}])assert.throws(()=>request.applyCommandKey(base,secret,binding));
});
test('curl import separates token and JSON; generated examples contain a placeholder and round-trip safely',()=>{
 for(const [curl,type] of [["curl https://example.com -H 'Authorization: Bearer PRIVATE' --data-raw '{\"on\":true}'",'bearer'],["curl https://example.com -H 'X-API-Key: PRIVATE'",'header'],["curl 'https://example.com?api_key=PRIVATE&device=1'",'query']]){
  const extracted=input.extractCurlKey(input.parseCurlInput(curl));assert.equal(extracted.type,type);assert.equal(extracted.value,'PRIVATE');assert(!JSON.stringify(extracted.config).includes('PRIVATE'));
  const example=input.commandCurlExample(extracted.config,{hasKey:true,type,parameter:extracted.parameter});assert(example.includes('{{COMMAND_KEY}}'));assert(!example.includes('PRIVATE'));assert(input.parseCurlInput(example).url.startsWith('https://example.com'));
 }
 const example=input.commandCurlExample({url:'https://example.com',method:'POST',headers:{},body:JSON.stringify({name:"O'Reilly"})});assert.equal(input.parseCurlInput(example).body,JSON.stringify({name:"O'Reilly"}));
});
test('only approved super admin manages vault; lists contain metadata only and replacing a key preserves its ID',async()=>{
 const {mod,calls}=await serviceFixture();await assert.rejects(mod.listCommandKeys(staff));await assert.rejects(mod.saveCommandKey(staff,{name:'bad',value:'secret'}));assert.equal(calls.length,0);
 await mod.listCommandKeys(admin);const list=calls.find(call=>call.query.includes('SELECT id,name,enabled,updated_at FROM system_command_keys'));assert(list);assert(!list.query.includes('encrypted_value'));
 const saved=await mod.saveCommandKey(admin,{id:'key1',name:'shared',value:'replacement',enabled:true});assert.equal(saved.id,'key1');assert.equal(saved.name,'shared');assert.equal(saved.value,undefined);
 const update=calls.find(call=>call.query.includes('UPDATE system_command_keys'));assert(!JSON.stringify(update.args).includes('replacement'));
});
test('multiple commands resolve the current shared key on each run and redacted lists never include key values',async()=>{
 for(const secret of ['first-secret','rotated-secret']){
  const {mod,calls,sent}=await serviceFixture({keyValue:request.encryptCommandKey(secret)});
  await mod.runCommand(staff,'command1');await mod.runCommand(staff,'command2');assert.equal(sent.length,2);assert(sent.every(config=>config.headers.authorization==='Bearer '+secret));
  const claim=calls.find(call=>call.query.includes('WITH claimed')).query;assert(claim.includes('k.enabled'));assert(claim.includes('LEFT JOIN system_command_keys'));
  assert(!mod.canRunCommand(staff,{enabled:true,key_available:false,allowed_user_ids:['staff']}));
 }
});
test('command save links a shared key while preserving an unchanged encrypted request',async()=>{
 const {mod,calls}=await serviceFixture();await mod.saveCommand(admin,{id:'cmd1',name:'AC',description:'',enabled:true,allowedUserIds:['staff'],responseType:'web',keyId:'key1',keyType:'header',keyParameter:'X-API-Key'});
 const update=calls.find(call=>call.query.includes('UPDATE system_commands SET name'));assert(update.query.includes('encrypted_request=COALESCE'));assert(update.args.includes('key1'));assert(update.args.includes('X-API-Key'));assert(update.args.includes('web'));assert(update.args.includes(null));
});
test('server actions reject malformed JSON and unauthorized vault access without leaking submitted secrets',async()=>{
 let saved;const actions=await load('../app/commands/actions.js',{'next/navigation':{redirect:()=>{throw Error('redirect');}},'next/cache':{revalidatePath:()=>{}},'../../lib/rbac':{getCurrentAppUser:async()=>admin},'../../lib/commands':{saveCommand:async(_user,value)=>{saved=value;},runCommand:async()=>({code:'sent'}),saveCommandKey:async()=>{throw Error('database error containing PRIVATE');}},'../../lib/command-request':request});
 const form=new FormData();form.set('name','AC');form.set('url','https://example.com');form.set('method','POST');form.set('headers','{}');form.set('bodyFormat','json');form.set('body','{"secret":"PRIVATE"');
 const error=await actions.saveCommandAction({},form);assert.equal(saved,undefined);assert(error.error.includes('JSON'));assert(!error.error.includes('PRIVATE'));
 form.set('body','{"on":true}');form.set('keyId','key1');await assert.rejects(actions.saveCommandAction({},form),/redirect/);assert.equal(saved.keyId,'key1');assert.equal(saved.requestConfig.headers['content-type'],'application/json');
 const keyError=await actions.saveCommandKeyAction({},new FormData());assert.equal(keyError.error,'שמירת המפתח נכשלה.');
});

test('JSON forms save an empty dictionary and content type instead of an empty request; GET remains bodyless',async()=>{
 let saved;const actions=await load('../app/commands/actions.js',{'next/navigation':{redirect:()=>{throw Error('redirect');}},'next/cache':{revalidatePath:()=>{}},'../../lib/rbac':{getCurrentAppUser:async()=>admin},'../../lib/commands':{saveCommand:async(_user,value)=>{saved=value;},runCommand:async()=>({code:'sent'}),saveCommandKey:async()=>{}},'../../lib/command-request':request});
 const form=new FormData();form.set('url','https://example.com/api/mdm/abm/sync');form.set('method','POST');form.set('bodyFormat','json');
 await assert.rejects(actions.saveCommandAction({},form),/redirect/);assert.equal(saved.requestConfig.body,'{}');assert.equal(saved.requestConfig.headers['content-type'],'application/json');assert.equal(saved.requestConfig.bodyFormat,'json');
 form.set('method','GET');await assert.rejects(actions.saveCommandAction({},form),/redirect/);assert.equal(saved.requestConfig.body,'');
});
test('existing empty MDM POSTs match Shortcuts JSON semantics and Bearer prefix is not doubled',()=>{
 const config=request.prepareCommandRequest({url:'https://example.com/api/mdm/abm/sync',method:'POST',headers:{},body:''});assert.equal(config.body,'{}');assert.equal(config.headers['content-type'],'application/json');
 assert.equal(request.prepareCommandRequest({url:'https://example.com/api/mdm/abm/sync',method:'POST',headers:{},body:'',bodyFormat:'text'}).body,'');
 assert.equal(request.prepareCommandRequest({url:'https://example.com/other',method:'POST',headers:{},body:''}).body,'');
 assert.equal(request.applyCommandKey(config,'Bearer actual-key',{type:'bearer'}).headers.authorization,'Bearer actual-key');
});
test('HTTP 200 cannot hide API failure, HTML login page, malformed JSON, or a redirect',()=>{
 for(const [status,type,body,outcome] of [[200,'application/json','{"success":false,"message":"PRIVATE"}','api_error'],[200,'application/json','{"response":{"Status":"Error"}}','api_error'],[200,'text/html','<html>login</html>','unexpected_html'],[200,'application/json','broken','invalid_json'],[302,'text/html','redirect','redirect_blocked'],[401,'application/json','{}','http_error']]){
  const result=request.classifyCommandResponse(status,type,body);assert.equal(result.ok,false);assert.equal(result.outcome,outcome);assert(!JSON.stringify(result).includes('PRIVATE'));
 }
 assert(request.classifyCommandResponse(200,'application/json','{"ok":true,"errors":[]}').ok);
 assert.equal(request.classifyCommandResponse(202,'application/json','{}').outcome,'accepted');
});
test('real Node HTTP transport sends UTF-8 content length, trace ID and complete JSON, and reads the whole response before classifying',async(t)=>{
 const received=[];const server=http.createServer((req,res)=>{const chunks=[];req.on('data',chunk=>chunks.push(chunk));req.on('end',()=>{received.push({headers:req.headers,body:Buffer.concat(chunks).toString('utf8'),method:req.method});res.setHeader('content-type','application/json');res.write('{"success":');setTimeout(()=>res.end('false,"message":"PRIVATE"}'),15);});});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>server.close(resolve)));
 const transport=(_url,options,callback)=>http.request({hostname:'127.0.0.1',port:server.address().port,path:'/api/mdm/abm/sync',method:options.method,headers:options.headers,agent:false},callback);
 for(const body of ['',JSON.stringify({name:'ישראל'})]){
  const result=await request.sendCommand({url:'https://example.com/api/mdm/abm/sync',method:'POST',headers:{},body},{resolve:async()=>[{address:'8.8.8.8',family:4}],transport,requestId:'synthetic-run-id'});
  assert.equal(result.outcome,'api_error');assert.equal(result.ok,false);assert(!JSON.stringify(result).includes('PRIVATE'));
  const sent=received.at(-1);assert.equal(sent.body,body||'{}');assert.equal(Number(sent.headers['content-length']),Buffer.byteLength(sent.body));assert.equal(sent.headers['x-crm-command-run-id'],'synthetic-run-id');
 }
});
test('single command lookup never reveals an ungranted command',async()=>{
 const {mod}=await serviceFixture();assert.equal(await mod.getCommand(staff,'unknown'),null);assert.equal(await mod.getCommand(null,'known'),null);
});

test('admin request summary exposes structure but never saved tokens, body values or query values',async()=>{
 let targetURL='https://example.com/api/mdm/abm/sync?token=PRIVATE-QUERY';
 const secret='PRIVATE-KEY',sql=async(strings)=>strings.join('?').includes('SELECT c.encrypted_request')?[{encrypted_request:'stored',key_type:'bearer',encrypted_value:request.encryptCommandKey('Bearer '+secret)}]:[];
 const mod=await load('../lib/commands.js',{'node:crypto':crypto,'./db.js':{initDb:async()=>{},sql},'./command-request.js':{...request,decryptCommand:()=>({url:targetURL,method:'POST',headers:{Authorization:'Bearer PRIVATE-OLD'},body:''})}});
 await assert.rejects(mod.getCommandRequestSummary(staff,'cmd'));
 const summary=await mod.getCommandRequestSummary(admin,'cmd');assert.equal(summary.bodyBytes,2);assert.equal(summary.contentType,'application/json');assert.equal(summary.prefixedBearer,true);assert.equal(summary.target,'https://example.com/api/mdm/abm/sync');assert(!JSON.stringify(summary).includes('PRIVATE'));
 targetURL='https://example.com/public/home-assistant/process/PRIVATE-TOKEN-IN-PATH-1234567890?v=PRIVATE';const hidden=await mod.getCommandRequestSummary(admin,'cmd');assert(!JSON.stringify(hidden).includes('PRIVATE'));assert(hidden.target.includes('[מוסתר]'));
});

test('normal webpages accept HTML while API commands reject it, with an explicit per-command override',()=>{
 const website={url:'https://example.com/switch',method:'GET',headers:{},body:''};
 assert.equal(request.commandResponseType(website),'web');assert.equal(request.commandResponseType({...website,headers:{authorization:'Bearer test'}}),'api');assert.equal(request.commandResponseType({...website,url:'https://example.com/api/sync'}),'api');
 assert.equal(request.commandResponseType({...website,headers:{authorization:'Bearer test'},responseType:'web'}),'web');
 assert(request.classifyCommandResponse(200,'text/html','<html>done</html>','web').ok);assert(!request.classifyCommandResponse(200,'text/html','<html>login</html>','api').ok);
 assert(!request.classifyCommandResponse(200,'text/plain','plain page','api').ok);assert(request.classifyCommandResponse(200,'text/plain','plain page','web').ok);
 assert(!request.classifyCommandResponse(500,'text/html','<html>error</html>','web').ok);
});
