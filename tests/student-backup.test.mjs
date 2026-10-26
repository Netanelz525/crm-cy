import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import * as XLSX from 'xlsx';
async function load(file,stubs={}){const context=vm.createContext({Buffer,Date,console});const mod=new vm.SourceTextModule(await fs.readFile(new URL(file,import.meta.url),'utf8'),{context});await mod.link(async name=>{const values=stubs[name];if(!values)throw Error(name);return new vm.SyntheticModule(Object.keys(values),function(){for(const [key,value]of Object.entries(values))this.setExport(key,value);},{context});});await mod.evaluate();return mod.namespace;}
const fields=await load('../lib/student-fields.js'),policy=await load('../lib/backup-policy.js');
const backup=await load('../lib/student-backup.js',{'xlsx':XLSX,'./student-fields.js':fields,'./backup-policy.js':policy});
const payload={exportedAt:'2026-10-26T18:00:00.000Z',counts:{neon_students:2},data:{neon_students:[
 {id:'s1',created_at:'2026-01-01',payload:{fullName:{firstName:'תלמיד',lastName:'לדוגמה'},phone:{primaryPhoneNumber:'0501234567'},tznum:'001234567',class:'A',childrenCount:0,note:'=SUM(1,2)',custom:{active:false},extraArray:['a','b'],file_base64:'hidden'}},
 {id:'s2',payload:{fullName:{firstName:'דוגמה',lastName:'נוספת'},email:{primaryEmail:'demo@example.com'},note:'x'.repeat(29940)+'😀'.repeat(20000)}}
]}};
test('standalone Excel has every student, readable fields, original identifiers and complete extra properties',async()=>{
 const result=backup.buildStudentBackupFile(payload);assert.equal(result.count,2);assert(result.filename.startsWith('crm-students-'));
 const book=XLSX.read(result.buffer);assert.deepEqual(book.SheetNames,['תלמידים','נתוני מקור']);
 const rows=XLSX.utils.sheet_to_json(book.Sheets['תלמידים'],{range:3});assert.equal(rows.length,2);assert.equal(rows[0]['שם פרטי'],'תלמיד');assert.equal(rows[0]['טלפון תלמיד - מספר'],'0501234567');assert.equal(rows[0]['ת"ז'],'001234567');assert.equal(rows[0]['מספר ילדים'],0);assert.equal(rows[0]['כיתה'],'שיעור א (A)');assert.equal(rows[0]['custom.active'],false);assert.equal(rows[0]['extraArray'],'["a","b"]');assert.equal(rows[0]['הערה חופשית'],'=SUM(1,2)');
 assert(!JSON.stringify(rows).includes('hidden'));assert(book.Sheets['תלמידים']['!autofilter']);
 for(const cell of Object.values(book.Sheets['תלמידים']))assert(!cell?.f);
 if(process.env.STUDENT_BACKUP_QA_PATH)await fs.writeFile(process.env.STUDENT_BACKUP_QA_PATH,result.buffer);
});
test('raw records reassemble exactly, including large notes and Unicode across Excel cell boundaries',()=>{
 const result=backup.buildStudentBackupFile(payload),book=XLSX.read(result.buffer),parts=XLSX.utils.sheet_to_json(book.Sheets['נתוני מקור']);
 for(let i=0;i<2;i++){
  const record=parts.filter(row=>row['מספר רשומה']===i+1).sort((a,b)=>a['חלק']-b['חלק']);assert(record.every(row=>row['נתוני מקור JSON'].length<=30000));
  const original=JSON.parse(record.map(row=>row['נתוני מקור JSON']).join(''));
  assert.deepEqual(original,JSON.parse(JSON.stringify(policy.stripBackupFileContent(payload.data.neon_students[i]))));
 }
 assert(parts.filter(row=>row['מספר רשומה']===2).length>1);
});
test('missing or inconsistent student exports fail instead of falsely claiming a complete backup; empty table is explicit',()=>{
 assert.throws(()=>backup.buildStudentBackupFile({data:{},counts:{}}),/neon_students/);
 assert.throws(()=>backup.buildStudentBackupFile({...payload,counts:{neon_students:3}}),/מספר/);
 const empty=backup.buildStudentBackupFile({...payload,data:{neon_students:[]},counts:{neon_students:0}});assert.equal(empty.count,0);const book=XLSX.read(empty.buffer);assert.equal(book.Sheets['תלמידים'].D2.v,0);
});
async function jobFixture({exportError=false}={}){
 const deliveries=[],queries=[];
 const sql=async(strings,...args)=>{const query=strings.join('?');queries.push({query,args});if(query.includes('INSERT INTO scheduled_job_runs'))return [{job_name:'weekly_backup_delivery'}];if(query.includes('FROM app_users'))return [{clerk_user_id:'u1',email:'backup@example.com',display_name:'test',weekly_backup_delivery:'both',telegram_chat_id:'test-chat'}];return [];};
 const mod=await load('../lib/weekly-backup.js',{'./student-backup.js':backup,'./crm-export.js':{exportCrmData:async()=>{if(exportError)throw Error('export unavailable');return payload;}},'./db.js':{initDb:async()=>{},sql},'./resend.js':{sendResendEmail:async message=>deliveries.push({channel:'email',message})},'./student-fields.js':fields,'./telegram.js':{sendTelegramDocumentFile:async(chat,file,options)=>deliveries.push({channel:'telegram',file,options})},'xlsx':XLSX});
 return {mod,deliveries,queries};
}
test('weekly delivery sends a separate students file first to Telegram and attaches it alongside both existing backups in email',async()=>{
 const {mod,deliveries,queries}=await jobFixture();const result=await mod.runWeeklyBackupJob({force:true});assert(result.ok);
 const mail=deliveries.find(item=>item.channel==='email').message;assert.equal(mail.attachments.length,3);assert(mail.attachments[0].filename.startsWith('crm-students-'));assert(mail.text.includes('2 תלמידים'));
 const telegram=deliveries.filter(item=>item.channel==='telegram');assert.equal(telegram.length,3);assert(telegram[0].file.filename.startsWith('crm-students-'));assert(telegram[1].file.filename.endsWith('.json'));
 const book=XLSX.read(telegram[0].file.content);assert.equal(XLSX.utils.sheet_to_json(book.Sheets['תלמידים'],{range:3}).length,2);
 assert(queries.some(item=>item.query.includes('UPDATE scheduled_job_runs')&&item.args.includes('completed')));
});
test('export failures now finalize the scheduled run as failed and send no partial/empty backup',async()=>{
 const {mod,deliveries,queries}=await jobFixture({exportError:true});await assert.rejects(mod.runWeeklyBackupJob({force:true}));assert.equal(deliveries.length,0);assert(queries.some(item=>item.query.includes('UPDATE scheduled_job_runs')&&item.args.includes('failed')));
});
