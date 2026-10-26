import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import * as crypto from 'node:crypto';
import * as net from 'node:net';
import * as dns from 'node:dns/promises';
import * as https from 'node:https';
import {EventEmitter} from 'node:events';
async function load(file,stubs){const context=vm.createContext({Buffer,URL,process:{env:{CLERK_SECRET_KEY:'synthetic-test-key'}},setTimeout,clearTimeout});const mod=new vm.SourceTextModule(await fs.readFile(new URL(file,import.meta.url),'utf8'),{context});await mod.link(async name=>{const values=stubs[name];if(!values)throw Error(name);return new vm.SyntheticModule(Object.keys(values),function(){for(const [key,value]of Object.entries(values))this.setExport(key,value);},{context});});await mod.evaluate();return mod.namespace;}
const request=await load('../lib/command-request.js',{'node:crypto':crypto,'node:net':net,'node:dns/promises':dns,'node:https':https});
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
 const transport=(url,options,callback)=>{connections++;assert.equal(options.agent,false);options.lookup('example.com',{},(err,ip,family)=>{assert.equal(ip,'8.8.8.8');assert.equal(family,4);});const req=new EventEmitter();req.destroy=()=>{};req.end=()=>{const response=new EventEmitter();response.statusCode=302;response.destroy=()=>{};queueMicrotask(()=>callback(response));};return req;};
 const result=await request.sendCommand(config,{resolve:async()=>[{address:'8.8.8.8',family:4}],transport});assert.equal(result.ok,false);assert.equal(result.status,302);assert.equal(connections,1);
 await assert.rejects(request.sendCommand(config,{resolve:async()=>[{address:'8.8.8.8',family:4},{address:'127.0.0.1',family:4}],transport}));assert.equal(connections,1);
});
const admin={clerk_user_id:'admin',is_super_admin:true,access_status:'approved'},staff={clerk_user_id:'staff',access_status:'approved'};
async function serviceFixture({claim=true,sendError=false}={}){
 const calls=[],sent=[];const sql=async(strings,...args)=>{const query=strings.join('?');calls.push({query,args});if(query.includes('WITH claimed'))return claim?[{encrypted_request:'encrypted'}]:[];if(query.includes('SELECT clerk_user_id'))return [{clerk_user_id:'staff'}];if(query.includes('SELECT id,name'))return [];return [];};
 const mod=await load('../lib/commands.js',{'node:crypto':crypto,'./db.js':{initDb:async()=>{},sql},'./command-request.js':{encryptCommand:()=> 'encrypted',decryptCommand:()=>config,sendCommand:async value=>{sent.push(value);if(sendError)throw Error('private token');return {ok:true,status:204};},CommandValidationError:request.CommandValidationError}});return {mod,calls,sent};
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
