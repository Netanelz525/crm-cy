import {normalizeRequestedEvents} from '../lib/student-event-fields.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import * as crypto from 'node:crypto';
import {buildDetailRequestEmail} from '../lib/detail-request-email.js';
async function load(path,stubs={}){const context=vm.createContext({URL,URLSearchParams,Date,process:{env:{}}});const module=new vm.SourceTextModule(await fs.readFile(new URL(path,import.meta.url),'utf8'),{context});await module.link(async key=>{if(!stubs[key])throw Error(key);return new vm.SyntheticModule(Object.keys(stubs[key]),function(){for(const [name,value]of Object.entries(stubs[key]))this.setExport(name,value);},{context});});await module.evaluate();return module.namespace;}
const studentFields=await load('../lib/student-fields.js'),quick=await load('../lib/student-quick-edit.js',{'./student-fields':studentFields}),fields=await load('../lib/detail-request-fields.js',{'./student-fields':studentFields,'./student-quick-edit':quick});
const manager={clerk_user_id:'manager',access_status:'approved',is_manager:true,can_send_emails:true,can_email_parents:true};
const student={id:'student',label:'Synthetic Student',fullName:{firstName:'First',lastName:'Last'},phone:{primaryPhoneNumber:'0500000000',primaryPhoneCallingCode:'+972',additionalPhones:['extra']},email:{primaryEmail:'student@example.com'},fatherEmail:{primaryEmail:'parent@example.com'},motherEmail:{primaryEmail:'parent@example.com'},note:'Private unselected note'};
async function service({matched=true,status='pending',closed=false,claim=true,failMail=false,students=[student],deliveryRows=[]}={}){
 const calls=[],sent=[],writes=[];const request={id:'request',batch_id:'batch',student_id:'student',student_label:student.label,title:'Verify',instructions:'Check',mode:'update',field_keys:['phone.primaryPhoneNumber'],status,closed_at:closed?'date':null};
 const sql=(strings,...args)=>{const query=strings.join('?');calls.push({query,args});if(query.includes('SELECT r.*,b.title'))return Promise.resolve(matched?[request]:[]);if(query.includes('SELECT synced_at::TEXT AS synced_at,payload'))return Promise.resolve([{synced_at:'2026-10-29T00:00:00Z',payload:student}]);if(query.includes('WITH eligible'))return Promise.resolve(claim?[{id:'request'}]:[]);if(query.includes('WITH selected AS'))return Promise.resolve(deliveryRows);if(query.includes('SELECT r.student_label,b.title'))return Promise.resolve([request]);return Promise.resolve([]);};sql.transaction=async entries=>Promise.all(entries);
 const module=await load('../lib/detail-requests.js',{'./student-event-fields':{normalizeRequestedEvents},'./detail-request-email':{buildDetailRequestEmail},'./email-campaigns':{renderEmailHtml:({html})=>html},'node:crypto':crypto,'./db':{sql,ensureDbFeature:async(_key,_version,migrate)=>migrate()},'./neon-students':{listNeonStudentsByFilters:async()=>students,getNeonStudentById:async()=>student,buildStudentMirrorRecord:async value=>{writes.push(value);return {student_id:value.id,full_name:value.label,first_name:value.fullName.firstName,last_name:value.fullName.lastName,student_phone:value.phone.primaryPhoneNumber,payload:JSON.stringify(value)};}},'./resend':{getResendConfigStatus:()=>({configured:true}),sendResendEmail:async message=>{sent.push(message);if(failMail)throw Error('provider secret');}},'./detail-request-fields':fields});return {module,calls,sent,writes,request};
}
test('Google recipient identity requires both a Google account and a verified matching email',()=>{
 const identity={emailAddresses:[{emailAddress:'Parent@Example.com',verification:{status:'verified'}},{emailAddress:'unverified@example.com',verification:{status:'unverified'}}],externalAccounts:[{provider:'oauth_google',emailAddress:'parent@example.com'},{provider:'oauth_google',emailAddress:'unverified@example.com'},{provider:'oauth_github',emailAddress:'other@example.com'}]};
 assert.deepEqual([...fields.googleRecipientEmails(identity)],['parent@example.com']);assert.equal(fields.googleRecipientEmails({}).length,0);assert.equal(fields.googleRecipientEmails({...identity,externalAccounts:[]}).length,0);
});
test('only real requested fields can be read or patched; unselected values and nested siblings survive',()=>{
 assert.throws(()=>fields.validDetailFields(['role']));assert.throws(()=>fields.validDetailFields(['age']));assert.throws(()=>fields.validDetailFields(['name']));
 const selected=fields.detailValues(student,['phone.primaryPhoneNumber']);assert.deepEqual(Object.keys(selected),['phone.primaryPhoneNumber']);assert(!JSON.stringify(selected).includes('Private'));
 const next=fields.detailPatch(student,['phone.primaryPhoneNumber','fullName.firstName'],{'phone.primaryPhoneNumber':'0520000000','fullName.firstName':'New'});assert.equal(next.phone.primaryPhoneCallingCode,'+972');assert.equal(next.phone.additionalPhones[0],'extra');assert.equal(next.fullName.lastName,'Last');assert.equal(next.note,student.note);assert.equal(student.phone.primaryPhoneNumber,'0500000000');
 assert.throws(()=>fields.detailPatch(student,['phone.primaryPhoneNumber'],{'phone.primaryPhoneNumber':'0520000000',registration:'DATOT'}));
});
test('batch creation rejects unauthorized users, unauthorized parent sends and missing recipients before writing a batch',async()=>{
 const {module,calls}=await service();const input={title:'Verify',mode:'update',fieldKeys:['phone.primaryPhoneNumber'],studentIds:['student'],roles:['father']};
 await assert.rejects(module.createDetailBatch({...manager,access_status:'pending'},input));await assert.rejects(module.createDetailBatch({...manager,can_email_parents:false},input));await assert.rejects(module.createDetailBatch({...manager,can_send_emails:false},input));assert.equal(calls.length,0);
 const missing=await service({students:[{id:'student',label:'Missing'}]});await assert.rejects(missing.module.createDetailBatch(manager,input));assert(!missing.calls.some(call=>call.query.includes('INSERT INTO detail_request_batches')));
});
test('creation takes addresses from actual student records, deduplicates parents and creates all records in a transaction',async()=>{
 const {module,calls}=await service();await module.createDetailBatch(manager,{title:'Verify',mode:'verify',fieldKeys:['phone.primaryPhoneNumber'],studentIds:['student'],roles:['father','mother'],email:'attacker@example.com'});
 const insert=calls.find(call=>call.query.includes('INSERT INTO detail_request_deliveries'));const data=JSON.parse(insert.args[0]);assert.equal(data.length,1);assert.equal(data[0].email,'parent@example.com');assert(!JSON.stringify(calls).includes('attacker@example.com'));
});
test('unknown accounts and completed or closed requests reveal no student fields',async()=>{
 for(const options of [{matched:false},{status:'approved'},{closed:true}]){const {module,calls}=await service(options);const view=await module.recipientDetailView('request',['other@example.com']);assert.equal(view?.values,undefined);assert.equal(view?.student_id,undefined);assert(!calls.some(call=>call.query.includes('SELECT synced_at::TEXT AS synced_at,payload')));}
 const {module}=await service();const view=await module.recipientDetailView('request',['parent@example.com']);assert.deepEqual(Object.keys(view.values),['phone.primaryPhoneNumber']);assert.equal(view.student_id,undefined);assert.equal(view.responded_email,undefined);
});
test('changed replies update canonical student fields and audit together under recipient, state and concurrent-update guards',async()=>{
 const {module,calls,writes}=await service();const view=await module.recipientDetailView('request',['parent@example.com']);await module.respondDetailRequest({userId:'google-user',emails:['parent@example.com']},'request',{'phone.primaryPhoneNumber':'0520000000'},view.revision);
 assert.equal(writes[0].phone.primaryPhoneNumber,'0520000000');assert.equal(writes[0].phone.additionalPhones[0],'extra');
 const operation=calls.find(call=>call.query.includes('WITH eligible'));for(const guard of ["r.status='pending'",'b.closed_at IS NULL','n.synced_at=','n.payload=','d.email=ANY(','FOR UPDATE OF r,b,n','UPDATE neon_students','UPDATE detail_requests','EXISTS(SELECT 1 FROM updated)'])assert(operation.query.includes(guard));assert(operation.args.includes('updated'));assert(operation.args.includes('google-user'));
});
test('unchanged replies approve without student writes; stale forms, closed requests and double submissions fail',async()=>{
 const first=await service();const view=await first.module.recipientDetailView('request',['parent@example.com']);await first.module.respondDetailRequest({userId:'u',emails:['parent@example.com']},'request',view.values,view.revision);assert.equal(first.writes.length,0);assert(first.calls.find(call=>call.query.includes('WITH eligible')).args.includes('approved'));
 await assert.rejects(first.module.respondDetailRequest({userId:'u',emails:['parent@example.com']},'request',view.values,'stale'));
 for(const options of [{closed:true},{status:'updated'},{claim:false},{matched:false}]){const current=await service(options);await assert.rejects(current.module.respondDetailRequest({userId:'u',emails:['parent@example.com']},'request',view.values,view.revision));}
});
test('verify-only requests cannot change student data even with forged editable input',async()=>{
 const context=await service();context.request.mode='verify';const view=await context.module.recipientDetailView('request',['parent@example.com']);await context.module.respondDetailRequest({userId:'u',emails:['parent@example.com']},'request',{role:'admin','phone.primaryPhoneNumber':'forged'},view.revision);assert.equal(context.writes.length,0);
});
test('mail carries a Google-gated link but no field values; delivery errors remain separate from response status',async()=>{
 for(const failMail of [false,true]){const {module,calls,sent}=await service({failMail,deliveryRows:[{id:'delivery',request_id:'request',email:'parent@example.com',role:'father'}]});await module.sendDetailChunk(manager,'batch');assert.equal(sent[0].to,'parent@example.com');assert.equal(sent[0].idempotencyKey,'detail-request-delivery');assert(sent[0].text.includes('/verify-details/request'));assert(!sent[0].text.includes(student.phone.primaryPhoneNumber));assert(!sent[0].text.includes(student.note));assert(sent[0].html.includes('dir="rtl"'));assert(sent[0].html.includes('לפתיחת הבקשה ולאישור הפרטים'));assert(!sent[0].html.includes(student.note));assert(!sent[0].html.includes(student.phone.primaryPhoneNumber));const audit=calls.find(call=>call.query.includes('SET status=')&&!call.query.includes('WITH selected'));assert(audit.args.includes(failMail?'failed':'sent'));assert(!JSON.stringify(calls).includes('provider secret'));}
});

test('recipient server action derives identity from Clerk, never submitted email, and hides infrastructure errors',async()=>{
 let userId='session-user',profile={emailAddresses:[{emailAddress:'parent@example.com',verification:{status:'verified'}}],externalAccounts:[{provider:'oauth_google',emailAddress:'parent@example.com'}]},captured,fail=false;
 const actions=await load('../app/verify-details/[requestId]/actions.js',{'@clerk/nextjs/server':{auth:async()=>({userId}),currentUser:async()=>profile},'next/cache':{revalidatePath:()=>{}},'../../../lib/detail-request-fields':fields,'../../../lib/detail-requests':{respondDetailRequest:async(...args)=>{captured=args;if(fail)throw Error('PRIVATE SQL VALUES');}}});
 const result=await actions.respondToDetailRequestAction('request',{email:'forged@example.com'},'revision');assert.equal(result.ok,true);assert.deepEqual([...captured[0].emails],['parent@example.com']);assert.equal(captured[0].userId,'session-user');
 captured=null;userId=null;assert.equal((await actions.respondToDetailRequestAction('request',{},'r')).ok,false);assert.equal(captured,null);
 userId='u';profile={emailAddresses:[],externalAccounts:[]};assert.equal((await actions.respondToDetailRequestAction('request',{},'r')).ok,false);assert.equal(captured,null);
 profile={emailAddresses:[{emailAddress:'parent@example.com',verification:{status:'verified'}}],externalAccounts:[{provider:'oauth_google',emailAddress:'parent@example.com'}]};fail=true;const failed=await actions.respondToDetailRequestAction('request',{},'r');assert.equal(failed.ok,false);assert(!failed.error.includes('PRIVATE'));
});

test('manual student lookup requires approved staff and searches independently of request filters with bounded results',async()=>{
 let user=manager,calls=[];
 const actions=await load('../app/detail-requests/actions.js',{'next/cache':{revalidatePath:()=>{}},'../../lib/rbac':{requireAuthenticatedUser:async()=>user},'../../lib/detail-request-fields':fields,'../../lib/detail-requests':{requireDetailManager:value=>{if(value?.access_status!=='approved'||(!value.is_manager&&!value.is_team_member))throw Error('denied');},createDetailBatch:()=>{},appendDetailStudents:()=>{},sendDetailChunk:()=>{},closeDetailBatch:()=>{},reopenDetailBatch:()=>{}},'../../lib/neon-students':{listNeonStudentsByFilters:async options=>{calls.push(options);return Array.from({length:21},(_,i)=>({...student,id:String(i),note:'PRIVATE'}));}}});
 user={access_status:'pending',is_manager:true};assert.equal((await actions.searchDetailStudentsAction('Student')).ok,false);assert.equal(calls.length,0);
 user=manager;assert.equal((await actions.searchDetailStudentsAction(' ')).ok,false);assert.equal((await actions.searchDetailStudentsAction('x'.repeat(151))).ok,false);assert.equal(calls.length,0);
 const result=await actions.searchDetailStudentsAction(' Student ');assert.equal(result.ok,true);assert.equal(result.students.length,20);assert.equal(result.hasMore,true);assert.equal(calls[0].q,'Student');assert.equal(calls[0].limit,21);assert.deepEqual(Object.keys(calls[0]).sort(),['limit','q']);assert(!JSON.stringify(result).includes('PRIVATE'));
});

test('detail mail escapes user text, preserves Hebrew paragraphs and provides a button plus plain-text fallback',()=>{
 const mail=buildDetailRequestEmail({title:'בקשה',student_label:'<img src=x onerror=alert(1)>',instructions:'לקראת החגים\nנא לאמת <script>alert(1)</script>'},'https://crm.example/verify-details/demo');
 assert(!mail.html.includes('<script>'));assert(!mail.html.includes('<img'));assert(mail.html.includes('&lt;script&gt;'));assert(mail.html.includes('לקראת החגים<br />'));assert(mail.html.includes('href="https://crm.example/verify-details/demo"'));assert(mail.text.includes('https://crm.example/verify-details/demo'));assert(mail.html.includes('חשבון'));
});

test('closing the whole group requires explicit confirmation while reopening targets only the chosen group',async()=>{
 const changed=[];const actions=await load('../app/detail-requests/actions.js',{'next/cache':{revalidatePath:()=>{}},'../../lib/rbac':{requireAuthenticatedUser:async()=>manager},'../../lib/detail-request-fields':fields,'../../lib/detail-requests':{requireDetailManager:()=>{},createDetailBatch:()=>{},appendDetailStudents:()=>{},sendDetailChunk:()=>{},closeDetailBatch:async(_user,id)=>changed.push(['close',id]),reopenDetailBatch:async(_user,id)=>changed.push(['reopen',id])},'../../lib/neon-students':{listNeonStudentsByFilters:async()=>[]}});
 const form={get:key=>key==='id'?'group':null};await assert.rejects(actions.closeDetailRequestAction(form));assert.equal(changed.length,0);await actions.closeDetailRequestAction({get:key=>key==='id'?'group':key==='confirmCloseAll'?'yes':null});await actions.reopenDetailRequestAction(form);assert.deepEqual(changed,[['close','group'],['reopen','group']]);
});

test('event submissions are bounded and validate real event types, month codes and complete integer days',()=>{
 const event={eventType:'other',customEventLabel:'אירוע משפחתי',noteText:'הערה',hebrewDay:'30',hebrewMonthCode:'ADAR_II'};
 assert.equal(normalizeRequestedEvents([event])[0].hebrewDay,30);
 for(const bad of [{...event,hebrewDay:'3oops'},{...event,hebrewDay:'31'},{...event,eventType:'admin'},{...event,hebrewMonthCode:'invalid'},{...event,customEventLabel:''},{...event,noteText:'x'.repeat(2001)},{...event,studentId:'another'}])assert.throws(()=>normalizeRequestedEvents([bad]));assert.throws(()=>normalizeRequestedEvents(Array(21).fill(event)));
});
