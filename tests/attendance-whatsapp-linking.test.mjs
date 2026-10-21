import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import {randomUUID,createHash,createHmac,timingSafeEqual} from 'node:crypto';

async function load(file, stubs, globals={}) {
 const context=vm.createContext({Buffer,Date,console:{info(){},error(){},warn(){}},...globals});
 const module=new vm.SourceTextModule(await fs.readFile(new URL(file,import.meta.url),'utf8'),{context});
 await module.link(async name=>{
  if(!stubs[name])throw Error('Unexpected import '+name);
  return new vm.SyntheticModule(Object.keys(stubs[name]),function(){for(const[k,v]of Object.entries(stubs[name]))this.setExport(k,v);},{context});
 });
 await module.evaluate();return module.namespace;
}
async function replyModule(messages=[]) {
 const queries=[];
 const sql=async(strings,...values)=>{
  const query=strings.join('?');queries.push({query,values});
  if(query.includes('FROM attendance_whatsapp_messages m')) {
   const [phone,context,,received]=values;
   return messages.filter(m=>m.recipient_phone===phone&&(!context||m.message_id===context)&&Math.floor(new Date(m.sent_at)/1000)<=Math.floor(received/1000)).sort((a,b)=>new Date(b.sent_at)-new Date(a.sent_at)).slice(0,1);
  }
  return[];
 };
 return {module:await load('../lib/attendance-whatsapp-replies.js',{'node:crypto':{randomUUID},'./db':{sql,initDb:async()=>{}}}),queries};
}

test('free text has an exact five-hour window, independent of the calendar day',async()=>{
 const {module}=await replyModule();
 const sent='2026-10-18T20:00:00Z';
 assert.equal(module.isAttendanceTextReplyWithinWindow(sent,'2026-10-19T00:59:59Z'),true);
 assert.equal(module.isAttendanceTextReplyWithinWindow(sent,'2026-10-19T01:00:00Z'),true);
 assert.equal(module.isAttendanceTextReplyWithinWindow(sent,'2026-10-19T01:00:01Z'),false);
 assert.equal(module.isAttendanceTextReplyWithinWindow(sent,'2026-10-18T19:59:59Z'),false);
});

test('quoted reply selects the original meeting; unquoted text selects the latest send to this phone',async()=>{
 const messages=[{message_id:'old',session_id:'meeting-A',student_id:'s1',recipient_phone:'972501234567',sent_at:'2026-10-18T10:00:00Z'},{message_id:'new',session_id:'meeting-B',student_id:'s2',recipient_phone:'972501234567',sent_at:'2026-10-18T11:00:00Z'}];
 const {module}=await replyModule(messages);
 assert.equal((await module.resolveAttendanceWhatsAppText('972501234567','old','2026-10-18T12:00:00Z')).session_id,'meeting-A');
 assert.equal((await module.resolveAttendanceWhatsAppText('972501234567','','2026-10-18T12:00:00Z')).session_id,'meeting-B');
 assert.equal(await module.resolveAttendanceWhatsAppText('972501234567','unknown','2026-10-18T12:00:00Z'),null);
 assert.equal(await module.resolveAttendanceWhatsAppText('972509999999','','2026-10-18T12:00:00Z'),null);
 assert.equal(await module.resolveAttendanceWhatsAppText('972501234567','old','2026-10-18T16:01:00Z'),null);
 assert.equal(await module.resolveAttendanceWhatsAppText('972501234567','','2026-10-18T16:01:00Z'),null);
 // A delayed webhook must not pick a message sent after the actual reply time.
 assert.equal((await module.resolveAttendanceWhatsAppText('972501234567','','2026-10-18T10:30:00Z')).session_id,'meeting-A');
});

async function sendingModule(options = {}) {
 const sent=[],links=[],replies=[],saved=[],tokens=new Map();
 const student={id:'s1',label:'Student',phone:options.phone || '0501234567'};
 const roster={session:{id:'meeting-A',isLocked:false,customStatuses:[]},students:[{id:'s1',status:'missing'}]};
 const sql=async(strings,...values)=>{
  const query=strings.join('?');
  if(query.includes('FROM attendance_whatsapp_messages m')) return values[0] === 'wamid.out' && values[1] === '972501234567' ? [{session_id:'meeting-A',student_id:'s1',template_name:template.name,custom_statuses:[],record_updated_at:options.recordUpdatedAt}] : [];
  if(query.includes('FROM attendance_whatsapp_replies')) return replies.some(r=>r.messageId===values[0])?[{}]:[];
  if(query.includes('INSERT INTO attendance_whatsapp_response_tokens'))tokens.set(values[0],{id:values[0],session_id:values[1],student_id:values[2],recipient_phone:values[3],status:values[5],dispatch_id:values[7],is_locked:false});
  if(query.includes('SET message_id'))for(const token of tokens.values())if(token.dispatch_id===values[1] || token.id===values[1])token.message_id=values[0];
  if(query.includes('FROM attendance_whatsapp_response_tokens t'))return tokens.has(values[0])?[tokens.get(values[0])]:[];
  if(query.startsWith('SELECT 1 FROM attendance_whatsapp_response_tokens'))return tokens.get(values[0])?.message_id===values[1]?[{}]:[];
  if(query.includes('SET used_at')){tokens.get(values[0]).used_at=new Date();return[];}
  if(query.includes('RETURNING first_response_text'))return[{}];
  return[];
 };
 const module=await load('../lib/attendance-whatsapp.js',{
  'node:crypto':{randomUUID},'./db':{sql,initDb:async()=>{}},
  './attendance':{buildAttendanceStatusLabels:()=>({found:'נמצא',available:'זמין',unavailable:'לא זמין'}),getAttendanceRoster:async()=>roster,normalizeAttendanceStatus:v=>v,saveAttendanceRecord:async record=>saved.push(record)},
  './neon-students':{getNeonStudentById:async()=>student},
  './whatsapp-channel-config.mjs':{coexistenceWhatsAppConfig:()=>({templatesUrl:'https://example.invalid/templates',messagesUrl:'https://example.invalid/messages',accessToken:'test'})},
  './attendance-whatsapp-replies.js':{attendanceReplyDate:v=>new Date(Number(v)*1000),linkAttendanceWhatsAppMessage:async link=>links.push(link),resolveAttendanceWhatsAppText:async()=>({message_id:'new',session_id:'meeting-B',student_id:'s2',is_locked:true}),saveAttendanceWhatsAppReply:async reply=>replies.push(reply)}
 },{URL,fetch:async(url,options)=>{if(!options.body){sent.push(url);return{ok:true,json:async()=>({data:[{name:template.name,status:'APPROVED',language:'he',components:[{type:'BODY',text:template.bodyText},{type:'BUTTONS',buttons:template.buttons}]}]})};}sent.push(JSON.parse(options.body));return{ok:true,json:async()=>({messages:[{id:'wamid.out'}]})};}});
 return{module,sent,links,replies,saved,tokens};
}
const template={name:'fixed_buttons',language:'he',parameterCount:0,bodyText:'Fixed text without parameters',buttons:[{type:'QUICK_REPLY',index:0,text:'לא זמין'},{type:'QUICK_REPLY',index:1,text:'נמצא'},{type:'QUICK_REPLY',index:2,text:'זמין'}]};
async function sendFixture(fixture) {
 return fixture.module.sendAttendanceSessionWhatsAppApprovedTemplate({sessionId:'meeting-A',templateName:template.name,templates:[template],recipientRoles:['student'],responseStatuses:['unavailable','found','available']});
}

test('fixed-text template with three buttons links every choice and WhatsApp ID without any body parameters',async()=>{
 const f=await sendingModule();const result=await sendFixture(f);
 assert.equal(result.sentMessages,1);
 const components=f.sent[0].template.components;
 assert.equal(components.some(c=>c.type==='body'),false);
 assert.equal(components.length,3);
 assert.equal(new Set(components.map(c=>c.parameters[0].payload)).size,3);
 assert.equal(f.links[0].sessionId,'meeting-A');assert.equal(f.links[0].messageId,'wamid.out');
 for(const token of f.tokens.values()){assert.equal(token.session_id,'meeting-A');assert.equal(token.message_id,'wamid.out');}
 // Middle button is found even though status-option ordering is different.
 await f.module.applyAttendanceWhatsAppResponse(components[1].parameters[0].payload,'0501234567','נמצא','2026-10-18T11:00:00Z','wamid.out','inbound-1');
 assert.equal(f.saved[0].sessionId,'meeting-A');assert.equal(f.saved[0].record.status,'found');
 assert.equal(f.replies[0].sourceMessageId,'wamid.out');assert.equal(f.replies[0].messageId,'inbound-1');
});

test('wrong sender and wrong quoted-message ID cannot update attendance',async()=>{
 const f=await sendingModule();await sendFixture(f);const payload=f.sent[0].template.components[0].parameters[0].payload;
 assert.equal(await f.module.applyAttendanceWhatsAppResponse(payload,'0509999999','x','','wamid.out'),null);
 assert.equal(await f.module.applyAttendanceWhatsAppResponse(payload,'0501234567','x','','another-message'),null);
 assert.equal(f.saved.length,0);assert.equal(f.replies.length,0);
});

test('later button replies are logged without reapplying a used token; text is logged even when meeting is locked',async()=>{
 const f=await sendingModule();await sendFixture(f);const payload=f.sent[0].template.components[0].parameters[0].payload;
 await f.module.applyAttendanceWhatsAppResponse(payload,'0501234567','לא זמין','','wamid.out','inbound-1');
 await f.module.applyAttendanceWhatsAppResponse(payload,'0501234567','לא זמין','','wamid.out','inbound-2');
 assert.equal(f.saved.length,1);assert.equal(f.replies.length,2);
 await f.module.recordAttendanceWhatsAppTextResponse('0501234567','another response','','new','inbound-3');
 assert.equal(f.replies[2].sessionId,'meeting-B');assert.equal(f.replies[2].studentId,'s2');
 assert.equal(f.saved.length,1);
});

test('every incoming reply has an idempotent history entry and does not replace earlier replies',async()=>{
 const {module,queries}=await replyModule();
 for(const messageId of ['in-1','in-2','in-1'])await module.saveAttendanceWhatsAppReply({messageId,sessionId:'meeting-A',studentId:'s1',phone:'972501234567',text:'reply',occurredAt:'2026-10-18T12:00:00Z'});
 const inserts=queries.filter(q=>q.query.includes('INSERT INTO attendance_whatsapp_replies'));
 assert.equal(inserts.length,3);assert(inserts.every(q=>q.query.includes('ON CONFLICT (message_id) DO NOTHING')));
 assert.deepEqual(inserts.map(q=>q.values[0]),['in-1','in-2','in-1']);
});


test('template list explicitly requests components and retains fixed-label quick replies', async()=>{
 const f=await sendingModule(); const templates=await f.module.listWhatsAppCoexistenceApprovedTemplates();
 assert(new URL(f.sent[0]).searchParams.get('fields').split(',').includes('components'));
 assert.equal(templates[0].buttons.length,3); assert.equal(templates[0].bodyParameterCount,0);
 assert.equal(templates[0].buttons[0].text,'לא זמין');
 const variable=f.module.normalizeCoexistenceTemplate({name:'variable',components:[{type:'BODY',text:'{{1}} {{2}} {{3}} {{4}} {{5}}'}]});
 assert.equal(variable.bodyParameterCount,5);
});
const legacyMessage={id:'in-legacy',from:'972501234567',timestamp:'1792321200',context:{id:'wamid.out'},type:'button',button:{payload:'לא זמין',text:'לא זמין'}};
test('legacy fixed-label button updates canonical status using original message and recipient and is idempotent', async()=>{
 const f=await sendingModule(); const result=await f.module.applyAttendanceWhatsAppLegacyButton(legacyMessage,[template]);
 assert.equal(result.status,'unavailable'); assert.equal(f.saved[0].sessionId,'meeting-A'); assert.equal(f.saved[0].record.status,'unavailable');
 await f.module.applyAttendanceWhatsAppLegacyButton(legacyMessage,[template]); assert.equal(f.saved.length,1);
});
test('legacy buttons cannot use unknown contexts, senders, labels, or overwrite later manual changes',async()=>{
 const f=await sendingModule();
 for(const message of [{...legacyMessage,from:'972509999999'},{...legacyMessage,context:{id:'other'}},{...legacyMessage,context:{}},{...legacyMessage,button:{text:'מגיע'}},{...legacyMessage,button:{payload:'attendance:unknown',text:'לא זמין'}}]){
  assert.equal(await f.module.applyAttendanceWhatsAppLegacyButton(message,[template]),null);
 }
 assert.equal(f.saved.length,0);
 const corrected=await sendingModule({recordUpdatedAt:'2030-01-01T00:00:00Z'});
 await corrected.module.applyAttendanceWhatsAppLegacyButton(legacyMessage,[template]); assert.equal(corrected.saved.length,0);
});


test('production coexistence webhook routes template payloads and legacy fixed-label buttons to attendance handlers',async()=>{
 const calls=[];
 const route=await load('../app/api/whatsapp/coexistence/webhook/route.js',{
  crypto:{createHash,createHmac,timingSafeEqual},
  'next/server':{NextResponse:{json:(body,options)=>({body,status:options?.status||200})}},
  '../../../../../lib/whatsapp-coexistence-events':{saveWhatsAppCoexistenceEvent:async()=>({duplicate:false})},
  '../../../../../lib/attendance-whatsapp':{
   applyAttendanceWhatsAppLegacyButton:async m=>calls.push(['legacy',m]),
   applyAttendanceWhatsAppResponse:async(...args)=>calls.push(['token',args]),
   recordAttendanceWhatsAppTextResponse:async(...args)=>calls.push(['text',args])
  }
 },{process:{env:{}}});
 for(const message of [legacyMessage,{...legacyMessage,id:'in-token',button:{payload:'attendance:unique',text:'לא זמין'}},{...legacyMessage,id:'in-text',type:'text',button:undefined,text:{body:'שלום'}}]){
  const body={entry:[{changes:[{field:'messages',value:{messages:[message]}}]}]};
  const response=await route.POST({text:async()=>JSON.stringify(body),headers:{get:()=>''}});
  assert.equal(response.status,200);
 }
 assert.equal(calls[0][0],'legacy'); assert.equal(calls[0][1].context.id,'wamid.out');
 assert.equal(calls[1][0],'token'); assert.equal(calls[1][1][4],'wamid.out');
 assert.equal(calls[2][0],'text');
});


test('attendance phones accept country codes, local Israeli zero and international prefixes',async()=>{
 const {module}=await sendingModule();
 const cases=[
  [{primaryPhoneCallingCode:'+972',primaryPhoneNumber:'0531234567'},'972531234567'],
  [{primaryPhoneCallingCode:'+972',primaryPhoneNumber:'541234567'},'972541234567'],
  [{primaryPhoneCallingCode:'+1',primaryPhoneNumber:'2025550123'},'12025550123'],
  [{primaryPhoneCallingCode:'+1',primaryPhoneNumber:'12025550123'},'12025550123'],
  [{primaryPhoneCallingCode:'+972',primaryPhoneNumber:'972531234567'},'972531234567'],
  [{callingCode:'00972',number:'02-555-1234'},'97225551234'],
  [{callingCode:'+1',number:'+44 7700 900123'},'447700900123'],
  [{callingCode:'+44',number:'0044 7700 900123'},'447700900123'],
  ['+972 (0)53-123-4567','972531234567'],
  ['0531234567','972531234567'],
  ['+1 (202) 555-0123','12025550123'],
  ['0012025550123','12025550123'],
  ['',null],['123',null],['+1234567890123456',null],
  [{callingCode:'+972',number:'000000000'},null]
 ];
 for(const [phone,expected] of cases){const recipients=module.recipientPhones({phone},['student']);assert.equal(recipients[0]?.value || null,expected);}
 const recipients=module.recipientPhones({phone:{callingCode:'+972',number:'0531234567'},dadPhone:'+972531234567',momPhone:{callingCode:'+1',number:'2025550123'}},['student','father','mother']);
 assert.equal(recipients.length,2);assert.equal(recipients[1].value,'12025550123');
});

test('foreign recipients get message links and can update attendance from international webhook IDs',async()=>{
 for(const phone of [{primaryPhoneCallingCode:'+1',primaryPhoneNumber:'2025550123'},{primaryPhoneCallingCode:'+43',primaryPhoneNumber:'1234567'},{primaryPhoneCallingCode:'+972',primaryPhoneNumber:'0501234567'}]){
  const f=await sendingModule({phone});const result=await sendFixture(f);assert.equal(result.sentMessages,1);
  const recipient=f.sent[0].to;assert.equal(f.links[0].phone,recipient);
  const payload=f.sent[0].template.components[0].parameters[0].payload;
  const response=await f.module.applyAttendanceWhatsAppResponse(payload,recipient,'לא זמין','2026-10-21T10:00:00Z','wamid.out','in-foreign');
  assert.equal(response.status,'unavailable');assert.equal(f.saved[0].record.status,'unavailable');assert.equal(f.replies[0].phone,recipient);
 }
});
