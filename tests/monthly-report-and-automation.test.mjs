import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const XLSX = require('xlsx');
const JSZip = require('jszip');
const {reviewEmailAddress} = await import('../lib/email-address-review.js');
const {styleEmailReport} = await import('../lib/email-report-styles.js');
async function load(file, stubs) {
  const context = vm.createContext({Buffer,Date,console,process:{env:{}}});
  const module = new vm.SourceTextModule(await fs.readFile(new URL(file,import.meta.url),'utf8'),{context});
  await module.link(async name => {
    const values=stubs[name];
    if(!values) throw Error(`Unexpected import ${name}`);
    return new vm.SyntheticModule(Object.keys(values),function(){for(const [key,value] of Object.entries(values))this.setExport(key,value);},{context});
  });
  await module.evaluate();
  return module.namespace;
}

test('monthly report uses student_id and counts shared family addresses only once',async()=>{
  const sent=[],saved=[],queries=[];
  const sql=async(strings,...values)=>{
    const query=strings.join('?');queries.push(query);
    if(query.includes('INSERT INTO scheduled_job_runs'))return [{job_name:'monthly-email-error-report'}];
    if(query.includes('FROM app_users'))return [{display_name:'Admin',email:'netanel.zevin@gmail.com'}];
    if(query.includes('FROM email_deliveries'))return [1,2].map(i=>({email:'family@example.com',failure_count:5,campaign_count:2,reasons:'Mailbox unavailable',last_seen:new Date(),student_id:`s${i}`,student_name:`Student ${i}`,matched_role:'אב'}));
    if(query.includes('UPDATE scheduled_job_runs'))saved.push(values);
    return [];
  };
  const report=await load('../lib/monthly-email-error-report.js',{'xlsx':XLSX,'./email-address-review.js':{reviewEmailAddress},'./email-report-styles.js':{styleEmailReport},'./db.js':{sql,initDb:async()=>{}},'./resend.js':{buildResendFromAddress:()=> 'CRM <crm@example.com>',sendResendEmail:async mail=>{sent.push(mail);return{id:'1'};}}});
  const result=await report.runMonthlyEmailErrorReportJob({force:true});
  assert.equal(result.ok,true);assert.equal(result.errorAddressCount,1);assert.equal(sent.length,1);
  const query=queries.find(q=>q.includes('FROM email_deliveries'));
  assert(query.includes('s.student_id'));assert(!/s\.id\b/.test(query));
  assert(query.includes('GROUP BY LOWER(TRIM(d.recipient_email))'));
  const workbook=XLSX.read(Buffer.from(sent[0].attachments[0].content,'base64'));
  const rows=XLSX.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]]);
  assert.equal(rows[0]['מספר שגיאות'],5);
  assert(rows[0]['תלמידים משויכים'].includes('Student 1'));
  assert(rows[0]['תלמידים משויכים'].includes('Student 2'));
  assert(saved.some(values=>values.includes('completed')));
});

for(const ok of [true,false])test(`manual monthly report is wired and exposes ${ok?'success':'failure'}`,async()=>{
  const source=await fs.readFile(new URL('../app/admin/actions.js',import.meta.url),'utf8');
  const calls=[],stubs={};
  for(const match of source.matchAll(/import\s*\{([^}]+)\}\s*from\s*["']([^"']+)["']/g)){
    stubs[match[2]]=Object.fromEntries(match[1].split(',').map(x=>x.trim()).filter(Boolean).map(name=>[name,async()=>{}]));
  }
  stubs['../../lib/rbac'].requireSuperAdmin=async()=>calls.push('authorized');
  stubs['../../lib/monthly-email-error-report.js'].runMonthlyEmailErrorReportJob=async options=>{assert.equal(options.force,true);calls.push('report');return{ok};};
  stubs['next/navigation'].redirect=url=>calls.push(url);
  const actions=await load('../app/admin/actions.js',stubs);
  await actions.runSystemAutomationAction({get:()=> 'monthly-email-error-report'});
  assert.equal(calls[0],'authorized');assert(calls.includes('report'));
  assert(calls.includes(`/admin/automations?runStatus=${ok?'completed':'failed'}`));
});


test('address review distinguishes typos and missing mailboxes from delivery problems',()=>{
  assert.equal(reviewEmailAddress('a@gmial.com').suggestedDomain,'gmail.com');
  assert.equal(reviewEmailAddress('a@@gmail.com').priority,0);
  assert.equal(reviewEmailAddress('a@gmail.com','550 5.1.1 User unknown').priority,1);
  assert.equal(reviewEmailAddress('a@gmail.com','Mailbox full 5.2.2').priority,2);
  assert.equal(reviewEmailAddress('a@gmail.com','Suppressed due to complaint').priority,2);
  assert.equal(reviewEmailAddress('a@organization.example','Unspecified bounce').priority,3);
});

test('exported Excel contains real row highlights, review columns and suggested domain',async()=>{
  const rows=[{email:'a@gmial.com',...reviewEmailAddress('a@gmial.com')},{email:'bad@@email',...reviewEmailAddress('bad@@email')}];
  const book=XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book,XLSX.utils.json_to_sheet(rows),'review');
  const buffer=await styleEmailReport(XLSX.write(book,{type:'buffer',bookType:'xlsx'}),rows);
  const zip=await JSZip.loadAsync(buffer);
  const styles=await zip.file('xl/styles.xml').async('string');
  const sheet=await zip.file('xl/worksheets/sheet1.xml').async('string');
  assert(styles.includes('FFFFD6D6'));assert(styles.includes('FFFFE8A3'));
  assert(sheet.includes('rightToLeft="1"'));assert(sheet.includes('state="frozen"'));
  const first=sheet.match(/<c[^>]*r="A2"[^>]*s="(\d+)"/)[1];
  const second=sheet.match(/<c[^>]*r="A3"[^>]*s="(\d+)"/)[1];
  assert.notEqual(first,second);
  const read=XLSX.read(buffer);const exported=XLSX.utils.sheet_to_json(read.Sheets.review);
  assert.equal(exported[0].suggestedDomain,'gmail.com');
});
