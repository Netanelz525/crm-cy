import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';

const labels={found:'נמצא',missing:'לא נמצא',available:'זמין',unavailable:'לא זמין',custom_ok:'אושר'};
const template={name:'fixed',language:'he',bodyText:'תוכן',buttons:[{type:'QUICK_REPLY',text:'לא זמין',index:0},{type:'QUICK_REPLY',text:'נמצא',index:1},{type:'QUICK_REPLY',text:'זמין',index:2}],parameterDefinitions:[]};
async function fixture(options={}) {
 const sent=[];let lookups=0;
 const stubs={
  'next/server':{NextResponse:{json:(body,options)=>({body,status:options?.status||200})}},
  '../../../../../../lib/api-tokens':{readBearerToken:r=>r.token,authenticateApiToken:async token=>token==='valid'?{id:'api-1',scopes:options.scopes||['attendance:read','attendance:write']}:null},
  '../../../../../../lib/attendance':{buildAttendanceStatusLabels:()=>labels,normalizeAttendanceStatus:v=>v,getAttendanceSessionById:async id=>id==='session-1'?{id,isLocked:!!options.locked,customStatuses:[]}:null},
  '../../../../../../lib/attendance-whatsapp':{
   listWhatsAppCoexistenceApprovedTemplates:async()=>{lookups++;if(options.providerError)throw Error('provider');return options.templates||[template];},
   sendAttendanceSessionWhatsAppApprovedTemplate:async args=>{sent.push(args);return options.result||{sentMessages:1,failedMessages:0,missingRecipients:0,matchedStudents:1,errors:[]};}
  }
 };
 const context=vm.createContext({console});
 const route=new vm.SourceTextModule(await fs.readFile(new URL('../app/api/attendance/sessions/[sessionId]/whatsapp/route.js',import.meta.url),'utf8'),{context});
 await route.link(async name=>new vm.SyntheticModule(Object.keys(stubs[name]),function(){for(const [k,v]of Object.entries(stubs[name]))this.setExport(k,v);},{context}));
 await route.evaluate();
 const request=(body={},token='valid')=>({token,json:async()=>body});
 const call=(body,token='valid',sessionId='session-1')=>route.namespace.POST(request(body,token),{params:Promise.resolve({sessionId})});
 return{route:route.namespace,request,call,sent,get lookups(){return lookups;}};
}

test('API authorizes before loading templates or sending, for both methods',async()=>{
 for(const token of ['', 'wrong']){const f=await fixture();assert.equal((await f.call({templateName:'fixed'},token)).status,401);assert.equal((await f.route.GET(f.request({},token),{params:{sessionId:'session-1'}})).status,401);assert.equal(f.lookups,0);}
 const read=await fixture({scopes:['attendance:read']});assert.equal((await read.call({templateName:'fixed'})).status,403);assert.equal(read.sent.length,0);
 const write=await fixture({scopes:['attendance:write']});assert.equal((await write.route.GET(write.request(),{params:{sessionId:'session-1'}})).status,403);
});
test('GET returns provider button order and suggested canonical status IDs',async()=>{
 const f=await fixture();const r=await f.route.GET(f.request(),{params:{sessionId:'session-1'}});
 assert.equal(r.status,200);assert.equal(r.body.item.templates[0].suggestedResponseStatuses.join(','),'unavailable,found,available');assert.equal(r.body.item.statusLabels.custom_ok,'אושר');
});
test('POST shares UI sender and auto-maps fixed buttons without visible parameters',async()=>{
 const f=await fixture();const r=await f.call({templateName:'fixed',createdByUserId:'spoof'});
 assert.equal(r.status,200);assert.equal(r.body.item.completed,true);assert.equal(r.body.item.sentMessages,1);
 const args=f.sent[0];assert.equal(args.sessionId,'session-1');assert.equal(args.responseStatuses.join(','),'unavailable,found,available');assert.equal(args.recipientRoles.join(','),'student');assert.equal(args.targetStatuses.join(','),'missing');assert.equal(args.createdByUserId,'');
});
test('explicit mappings, custom statuses, recipient filters and media pass to the same sender',async()=>{
 const f=await fixture({templates:[{...template,buttons:[{type:'QUICK_REPLY',text:'אישור',index:0}]}]});
 const r=await f.call({templateName:'fixed',recipientRoles:['father','mother'],targetStatuses:[],studentId:'s1',responseStatuses:['custom_ok'],parameterOverrides:{3:'שלום'},imageId:'media-1'});
 assert.equal(r.status,200);assert.equal(f.sent[0].responseStatuses[0],'custom_ok');assert.equal(f.sent[0].studentId,'s1');assert.equal(f.sent[0].targetStatuses.length,0);assert.equal(f.sent[0].parameterOverrides[3],'שלום');assert.equal(f.sent[0].imageId,'media-1');
});
test('bad input, unknown or duplicate statuses and ambiguous button labels never send',async()=>{
 for(const body of [null,[],{}, {templateName:'fixed',targetStatuses:['unknown']},{templateName:'fixed',targetStatuses:['']},{templateName:'fixed',recipientRoles:['other']},{templateName:'fixed',recipientRoles:[]},{templateName:'fixed',responseStatuses:['found','found','available']},{templateName:'fixed',responseStatuses:['found']},{templateName:'fixed',parameterOverrides:[]},{templateName:'fixed',templateLanguage:'en'}]){
  const f=await fixture();assert.equal((await f.call(body)).status,400);assert.equal(f.sent.length,0);
 }
 const f=await fixture({templates:[{...template,buttons:[{type:'QUICK_REPLY',text:'תשובה',index:0}]}]});assert.equal((await f.call({templateName:'fixed'})).status,400);assert.equal(f.sent.length,0);
});
test('missing or locked sessions are rejected before provider calls',async()=>{
 const f=await fixture();assert.equal((await f.call({templateName:'fixed'},'valid','missing')).status,404);assert.equal(f.lookups,0);
 const locked=await fixture({locked:true});assert.equal((await locked.call({templateName:'fixed'})).status,409);assert.equal(locked.sent.length,0);assert.equal(locked.lookups,0);
});
test('provider failures and partial results are returned honestly without queueing or retrying',async()=>{
 const unavailable=await fixture({providerError:true});assert.equal((await unavailable.call({templateName:'fixed'})).status,502);assert.equal(unavailable.sent.length,0);
 for(const sentMessages of [0,1]){const f=await fixture({result:{sentMessages,failedMessages:1,missingRecipients:2,matchedStudents:3,errors:['failed']}});const r=await f.call({templateName:'fixed'});assert.equal(r.status,sentMessages?200:502);assert.equal(r.body.item.failedMessages,1);assert.equal(f.sent.length,1);}
});
