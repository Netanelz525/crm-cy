import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';

async function loadModule(file, stubs = {}) {
  const context = vm.createContext({ Buffer, Date, console });
  const module = new vm.SourceTextModule(await fs.readFile(new URL(file, import.meta.url), 'utf8'), { context });
  await module.link(async (specifier) => {
    const values = stubs[specifier];
    if (!values) throw new Error(`Unexpected dependency: ${specifier}`);
    return new vm.SyntheticModule(Object.keys(values), function () {
      for (const [name, value] of Object.entries(values)) this.setExport(name, value);
    }, { context });
  });
  await module.evaluate();
  return module.namespace;
}

const policy = await loadModule('../lib/backup-policy.js');

test('records-only policy strips file bodies, preserves text, permissions and R2 references', () => {
  const input = { student_id: 's1', role: 'super_admin', payload: { name: 'תלמיד', permissions: ['edit'], photo: 'data:image/png;base64,aGVsbG8=' }, draft_json: { body_text: 'message', attachments: [{ filename: 'a.pdf', content: 'c2VjcmV0', sizeBytes: 6 }] }, file_base64: 'secret', object_key: 'students/s1/a.pdf' };
  const result = policy.stripBackupFileContent(input);
  assert.equal(result.file_base64, undefined);
  assert.equal(result.draft_json.attachments[0].content, undefined);
  assert.equal(result.draft_json.attachments[0].filename, 'a.pdf');
  assert.equal(result.payload.photo, '[file content excluded]');
  assert.equal(result.payload.name, 'תלמיד');
  assert.equal(result.payload.permissions[0], 'edit');
  assert.equal(result.role, 'super_admin');
  assert.equal(result.object_key, input.object_key);
  assert.equal(input.file_base64, 'secret');
  assert.equal(policy.isBackupFileColumn('file_base64'), true);
  assert.equal(policy.isBackupFileColumn('body', 'bytea'), true);
});

test('export excludes temporary uploads and selects no binary columns from the database', async () => {
  const queries = [];
  const sql = async (query) => {
    const text = typeof query === 'string' ? query : query.join('?');
    queries.push(text);
    if (text.includes('information_schema.tables')) return [{table_name:'neon_students'}, {table_name:'print_job_upload_chunks'}];
    if (text.includes('information_schema.columns')) return [{column_name:'student_id',data_type:'text'}, {column_name:'file_base64',data_type:'text'}, {column_name:'payload',data_type:'jsonb'}];
    return [{student_id:'s1',payload:{name:'Name',attachments:[{filename:'a',content:'secret'}]}}];
  };
  const exporter = await loadModule('../lib/crm-export.js', { './db.js': {initDb:async()=>{},sql}, './backup-policy.js': {BACKUP_EXCLUDED_TABLES:policy.BACKUP_EXCLUDED_TABLES,isBackupFileColumn:policy.isBackupFileColumn,stripBackupFileContent:policy.stripBackupFileContent} });
  const result = await exporter.exportCrmData('all');
  assert.equal(result.data.print_job_upload_chunks, undefined);
  assert.equal(result.data.neon_students[0].payload.attachments[0].content, undefined);
  const select = queries.find(q=>q.includes('FROM "neon_students"'));
  assert(!select.includes('file_base64'));
  assert(!select.includes('SELECT *'));
  assert.equal(result.counts.neon_students, 1);
});

async function printFixture({ storage='neon', status='claimed', deleteError=false }={}) {
  const events=[];
  const row={id:'job1',file_name:'test.pdf',file_storage:storage,r2_object_key:storage==='r2'?'print-jobs/job1/test.pdf':null,status,uploaded_by_email:'user@example.com'};
  const sql=async(strings)=>{
    const query=strings.join('?'); events.push({type:'sql',query});
    if(query.includes('SELECT')) return [row];
    return [{id:'job1'}];
  };
  const noop=async()=>{};
  const module=await loadModule('../lib/print-jobs.js',{
    'node:crypto':{default:{}}, 'pdf-lib':{PDFDocument:{}},
    './cloudflare-queue':{ackPrintQueueMessage:async()=>events.push({type:'ack'}),isPrintQueueConfigured:()=>false,publishPrintJobToQueue:noop,pullPrintJobFromQueue:noop,retryPrintQueueMessage:noop},
    './announcement-signature-links':{revokeAnnouncementSignatureLinksForPrintJob:async()=>events.push({type:'revoke'})},
    './db':{initDb:noop,sql},
    './r2':{deleteObjectFromR2:async()=>{events.push({type:'delete-r2'});if(deleteError)throw Error('R2 unavailable');return true;},getObjectBytesFromR2:noop,isR2Configured:()=>true,uploadBufferToR2:noop},
    './resend':{buildResendFromAddress:()=> 'Print <print@example.com>',sendResendEmail:async(message)=>{events.push({type:'email',message});return {id:'mail1'};}}
  });
  return {module,events};
}

for(const storage of ['neon','r2']) test(`failed ${storage} job erases file and tells user to upload again`,async()=>{
  const {module,events}=await printFixture({storage});
  await module.failPrintJob('job1',{errorMessage:'printer failed'});
  assert(events.some(e=>e.type==='sql'&&e.query.includes("file_base64 = ''")&&e.query.includes("status = 'failed'")));
  assert.equal(events.some(e=>e.type==='delete-r2'),storage==='r2');
  const mail=events.find(e=>e.type==='email').message;
  assert(mail.text.includes('להעלות את הקובץ מחדש'));
  assert.equal(mail.attachments,undefined);
  assert.equal(mail.idempotencyKey,'print-job-failed-job1');
  assert(events.some(e=>e.type==='revoke'));
});

test('failed R2 deletion stays retryable and is not silently acknowledged',async()=>{
  const {module,events}=await printFixture({storage:'r2',deleteError:true});
  await assert.rejects(module.failPrintJob('job1'),/R2 unavailable/);
  assert(!events.some(e=>e.type==='sql'&&e.query.includes('r2_object_key = NULL')));
  assert(!events.some(e=>e.type==='email'||e.type==='ack'));
});

test('failure reported after completion does not change or notify completed job',async()=>{
  const {module,events}=await printFixture({status:'completed'});
  await module.failPrintJob('job1');
  assert(!events.some(e=>e.type==='email'||e.type==='delete-r2'));
  assert(!events.some(e=>e.type==='sql'&&e.query.includes('UPDATE')));
});
