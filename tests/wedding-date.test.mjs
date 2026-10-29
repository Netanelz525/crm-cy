import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import * as crypto from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {PGlite} from '@electric-sql/pglite';
import {weddingFromGregorian,weddingFromHebrew,weddingMonths} from '../lib/wedding-date.js';
async function load(path,stubs={}){const context=vm.createContext({Date,console});const module=new vm.SourceTextModule(await fs.readFile(new URL(path,import.meta.url),'utf8'),{context});await module.link(async key=>{if(!stubs[key])throw Error(key);return new vm.SyntheticModule(Object.keys(stubs[key]),function(){for(const [name,value]of Object.entries(stubs[key]))this.setExport(name,value);},{context});});await module.evaluate();return module.namespace;}
const fields=await load('../lib/student-fields.js'),quick=await load('../lib/student-quick-edit.js',{'./student-fields':fields}),details=await load('../lib/detail-request-fields.js',{'./student-fields':fields,'./student-quick-edit':quick});
test('Gregorian and Hebrew wedding dates agree, including leap Adar months and invalid dates',()=>{
 const pesach=weddingFromGregorian('2024-04-23');assert.equal(pesach.day,15);assert.equal(pesach.month,1);assert.equal(pesach.year,5784);assert.equal(weddingFromHebrew(15,1,5784).gregorian,'2024-04-23');
 assert(weddingMonths(5784).some(month=>month.value===13));assert(!weddingMonths(5785).some(month=>month.value===13));
 for(const args of [[30,13,5784],[1,13,5785],[0,7,5784],[15,7,0],[31,1,5784]])assert.throws(()=>weddingFromHebrew(...args));
 for(const date of ['2023-02-29','2024-04-31','0000-01-01','bad'])assert.throws(()=>weddingFromGregorian(date));
 for(let time=Date.UTC(1940,0,1);time<Date.UTC(2040,0,1);time+=67*86400000){const date=new Date(time).toISOString().slice(0,10),converted=weddingFromGregorian(date);assert.equal(weddingFromHebrew(converted.day,converted.month,converted.year).gregorian,date);}
});
test('calendar conversion is independent of the browser/server timezone',()=>{
 const file=new URL('../lib/wedding-date.js',import.meta.url).href;
 for(const timezone of ['Asia/Jerusalem','America/Los_Angeles','Pacific/Auckland']){const result=spawnSync(process.execPath,['--input-type=module','-e',`import {weddingFromGregorian,weddingFromHebrew} from ${JSON.stringify(file)}; const d=weddingFromGregorian('2024-04-23'); console.log(JSON.stringify([d.day,d.month,d.year,weddingFromHebrew(d.day,d.month,d.year).gregorian]));`],{env:{...process.env,TZ:timezone},encoding:'utf8'});assert.equal(result.status,0,result.stderr);assert.deepEqual(JSON.parse(result.stdout),[15,1,5784,'2024-04-23']);}
});
test('marriage fields appear and are editable only when married, with zero children preserved',()=>{
 const keys=['phone.primaryPhoneNumber','childrenCount','weddingDate'];
 const single={famliystatus:'SINGLE',childrenCount:4,weddingDate:'2024-04-23',phone:{primaryPhoneNumber:'0500000000'}};
 assert.deepEqual(Object.keys(details.detailValues(single,keys)),['phone.primaryPhoneNumber']);assert.throws(()=>quick.studentQuickPatch(single,'field:weddingDate',{weddingDate:'2024-04-23'}));assert.throws(()=>quick.studentQuickPatch(single,'field:childrenCount',{childrenCount:'0'}));
 const married={...single,famliystatus:'MARRIED'};assert.equal(details.detailValues({...married,childrenCount:0},keys).childrenCount,'0');assert.equal(quick.studentQuickPatch(married,'field:weddingDate',{weddingDate:'2024-04-23'}).weddingDate,'2024-04-23T00:00:00.000Z');
 assert.equal(fields.normalizeStudentInput({famliystatus:'MARRIED',childrenCount:'0',weddingDate:'2024-04-23'}).weddingDate,'2024-04-23T00:00:00.000Z');assert.equal(fields.normalizeStudentInput({famliystatus:'SINGLE',weddingDate:'bad',childrenCount:'9'}).weddingDate,undefined);assert.equal(fields.normalizeStudentInput({weddingDate:''}).weddingDate,null);
 assert.throws(()=>fields.normalizeStudentInput({weddingDate:'2023-02-29'}));
});
test('detail requests can change family status and then capture marriage fields without allowing hidden fields for singles',()=>{
 const selected=['childrenCount','weddingDate','famliystatus'];
 const single={id:'s',famliystatus:'SINGLE'};
 const married=details.detailPatch(single,selected,{famliystatus:'MARRIED',childrenCount:'0',weddingDate:'2024-04-23'});assert.equal(married.childrenCount,0);assert.equal(married.weddingDate,'2024-04-23T00:00:00.000Z');
 assert.throws(()=>details.detailPatch(single,selected,{famliystatus:'SINGLE',childrenCount:'2',weddingDate:'2024-04-23'}));
 assert.equal(details.detailPatch(single,selected,{famliystatus:'SINGLE'}).famliystatus,'SINGLE');
});
test('real Postgres upserts preserve a saved wedding date across imports that omit it, allow clearing, and hide it for unmarried students',async t=>{
 const db=new PGlite();t.after(()=>db.close());await db.exec(`CREATE TABLE neon_students(student_id TEXT PRIMARY KEY,full_name TEXT,first_name TEXT,last_name TEXT,tznum TEXT,class TEXT,current_institution TEXT,registration TEXT,primary_email TEXT,father_email TEXT,mother_email TEXT,student_phone TEXT,father_phone TEXT,mother_phone TEXT,age_years INTEGER,children_count INTEGER,payload JSONB,synced_at TIMESTAMPTZ);`);
 const sql=async(strings,...values)=>{let query='';strings.forEach((text,index)=>{query+=text;if(index<values.length)query+='$'+(index+1);});return (await db.query(query,values)).rows;};
 const model=await load('../lib/neon-students.js',{'./student-fields':fields,'node:crypto':crypto,'./db':{sql,initDb:async()=>{}},'./deleted-students-store':{getSoftDeletedStudentIdSet:async()=>new Set(),isSoftDeletedStudentId:async()=>false}});
 const student={id:'student',fullName:{firstName:'Synthetic',lastName:'Test'},famliystatus:'MARRIED',childrenCount:0,weddingDate:'2024-04-23'};
 await model.upsertNeonStudent(student);assert.equal((await model.getNeonStudentById('student')).weddingDate,'2024-04-23T00:00:00.000Z');
 const {weddingDate,...withoutWedding}=student;await model.upsertNeonStudent(withoutWedding);assert.equal((await model.getNeonStudentById('student')).weddingDate,'2024-04-23T00:00:00.000Z');assert.equal((await model.getNeonStudentById('student')).childrenCount,0);
 await model.upsertNeonStudent({...withoutWedding,famliystatus:'SINGLE'});assert.equal((await model.getNeonStudentById('student')).weddingDate,undefined);assert.equal((await db.query("SELECT payload->>'weddingDate' AS value FROM neon_students")).rows[0].value,'2024-04-23T00:00:00.000Z');
 await model.upsertNeonStudent({...withoutWedding,weddingDate:null});assert.equal((await model.getNeonStudentById('student')).weddingDate,null);
});

test('real Postgres request response updates wedding date and children count atomically and preserves hidden wedding data on other edits',async t=>{
 const db=new PGlite();t.after(()=>db.close());await db.exec(`CREATE TABLE neon_students(student_id TEXT PRIMARY KEY,full_name TEXT,first_name TEXT,last_name TEXT,tznum TEXT,class TEXT,current_institution TEXT,registration TEXT,primary_email TEXT,father_email TEXT,mother_email TEXT,student_phone TEXT,father_phone TEXT,mother_phone TEXT,age_years INTEGER,children_count INTEGER,payload JSONB,synced_at TIMESTAMPTZ);`);
 const sql=(strings,...args)=>{let text='',values;if(typeof strings==='string'){text=strings;values=args[0];}else{values=args;strings.forEach((part,index)=>{text+=part;if(index<args.length)text+='$'+(index+1);});}return {text,values,then(resolve,reject){return db.query(text,values).then(result=>result.rows).then(resolve,reject);}};};sql.transaction=queries=>db.transaction(async tx=>{const rows=[];for(const query of queries)rows.push((await tx.query(query.text,query.values)).rows);return rows;});
 const model=await load('../lib/neon-students.js',{'./student-fields':fields,'node:crypto':crypto,'./db':{sql,initDb:async()=>{}},'./deleted-students-store':{getSoftDeletedStudentIdSet:async()=>new Set(),isSoftDeletedStudentId:async()=>false}});
 const service=await load('../lib/detail-requests.js',{'node:crypto':crypto,'./db':{sql,ensureDbFeature:async(_key,_version,migrate)=>migrate()},'./neon-students':model,'./detail-request-fields':details,'./resend':{getResendConfigStatus:()=>({configured:true}),sendResendEmail:async()=>{throw Error('No real email allowed');}}});
 const user={clerk_user_id:'staff',access_status:'approved',is_manager:true,can_send_emails:true,can_email_parents:true};
 const student={id:'student',fullName:{firstName:'Synthetic',lastName:'Test'},famliystatus:'MARRIED',childrenCount:2,email:{primaryEmail:'student@example.com'},phone:{primaryPhoneNumber:'0500000000',primaryPhoneCallingCode:'+972'}};await model.upsertNeonStudent(student);
 const id=await service.createDetailBatch(user,{title:'Family',mode:'update',fieldKeys:['childrenCount','weddingDate'],studentIds:['student'],roles:['student']});let batch=await service.getDetailBatch(user,id),requestId=batch.requests[0].id;
 assert.equal(await service.recipientDetailView(requestId,['other@example.com']),null);
 let view=await service.recipientDetailView(requestId,['student@example.com']);await service.respondDetailRequest({userId:'google',emails:['student@example.com']},requestId,{childrenCount:'0',weddingDate:'2024-04-23'},view.revision);
 assert.equal((await model.getNeonStudentById('student')).childrenCount,0);assert.equal((await model.getNeonStudentById('student')).weddingDate,'2024-04-23T00:00:00.000Z');batch=await service.getDetailBatch(user,id);assert.equal(batch.requests[0].status,'updated');assert.equal(batch.requests[0].after_values.childrenCount,'0');
 await assert.rejects(service.respondDetailRequest({userId:'google',emails:['student@example.com']},requestId,{childrenCount:'1',weddingDate:'2024-04-23'},view.revision));
 await model.upsertNeonStudent({...student,famliystatus:'SINGLE'});
 const phoneBatch=await service.createDetailBatch(user,{title:'Phone',mode:'update',fieldKeys:['phone.primaryPhoneNumber','weddingDate'],studentIds:['student'],roles:['student']});batch=await service.getDetailBatch(user,phoneBatch);requestId=batch.requests[0].id;view=await service.recipientDetailView(requestId,['student@example.com']);assert.deepEqual(Object.keys(view.values),['phone.primaryPhoneNumber']);
 await service.respondDetailRequest({userId:'google',emails:['student@example.com']},requestId,{'phone.primaryPhoneNumber':'0520000000'},view.revision);
 assert.equal((await model.getNeonStudentById('student')).phone.primaryPhoneNumber,'0520000000');assert.equal((await db.query("SELECT payload->>'weddingDate' AS value FROM neon_students")).rows[0].value,'2024-04-23T00:00:00.000Z');
});
