import test from 'node:test';
import assert from 'node:assert/strict';
import { PGlite } from '@electric-sql/pglite';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import { normalizeMac, presenceCandidates, presenceConfig, checkMacPresence } from '../lib/mac-presence.mjs';
import { israelDate, validLockDate, defaultLockDate, migrateAttendancePresence } from '../lib/attendance-presence-policy.mjs';
import { syncNetworkPresence } from '../lib/attendance-network-presence.mjs';

const config = { endpoint: 'https://presence.example/check', key: 'synthetic-test-key' };
const mac = i => `02:00:00:${(i >> 16 & 255).toString(16).padStart(2,'0')}:${(i >> 8 & 255).toString(16).padStart(2,'0')}:${(i & 255).toString(16).padStart(2,'0')}`;
const response = (macs, connected = true) => Response.json({ ok: true, checkedAt: new Date().toISOString(), results: macs.map(mac => ({ mac, connected })) });

test('the actual base schema initializes a fresh database and upgrades again without touching locked records',async()=>{
  const db=new PGlite();
  const sql=async(strings,...values)=>{
    const query=typeof strings==='string'?strings:strings.reduce((text,part,i)=>text+(i?`$${i}`:'')+part,'');
    if(query.includes('pg_advisory_'))return [];
    return (await db.query(query,values)).rows;
  };
  async function initialize(){
    const context=vm.createContext({Date,console,process:{env:{DATABASE_URL:'postgresql://synthetic.invalid/test'}}});
    const stubs={
      './attendance-presence-policy.mjs':{migrateAttendancePresence},
      './db-feature-schema.js':{createFeatureSchemaGuard:()=>async()=>{}},
      '@neondatabase/serverless':{neon:()=>sql},
      './article-slug.js':{normalizeArticleSlug:()=> 'synthetic'}
    };
    const module=new vm.SourceTextModule(await fs.readFile(new URL('../lib/db.js',import.meta.url),'utf8'),{context});
    await module.link(name=>new vm.SyntheticModule(Object.keys(stubs[name]),function(){for(const[key,value]of Object.entries(stubs[name]))this.setExport(key,value);},{context}));
    await module.evaluate();await module.namespace.initDb();
  }
  try {
    await initialize();
    assert.equal((await db.query("SELECT version FROM crm_schema_meta WHERE key='schema'")).rows[0].version,'20261006_3');
    assert.equal((await db.query("SELECT version FROM crm_schema_meta WHERE key='attendance-presence-policy'")).rows[0].version,'20261117_1');
    await db.exec("INSERT INTO attendance_sessions(id,institution,session_date,auto_lock_date) VALUES ('old','ALL',CURRENT_DATE-20,CURRENT_DATE+1)");
    await db.exec("INSERT INTO attendance_records(session_id,student_id,student_name,status,note_text) VALUES ('old','s1','Synthetic','found','preserved')");
    await db.exec("UPDATE attendance_sessions SET auto_lock_date=NULL; UPDATE crm_schema_meta SET version='previous-schema'");
    await initialize();
    const row=(await db.query('SELECT status,note_text FROM attendance_records')).rows[0];
    assert.equal(row.status,'found');assert.equal(row.note_text,'preserved');
    await assert.rejects(db.exec("UPDATE attendance_records SET status='missing'"),/נעול/);
  } finally {await db.close();}
});

test('MAC normalization, duplicated identities and Israel calendar lock dates', () => {
  assert.equal(normalizeMac('02-AA-BB-CC-DD-EE'), '02:aa:bb:cc:dd:ee');
  assert.equal(normalizeMac('02aa.bbcc.ddee'), '02:aa:bb:cc:dd:ee');
  for (const value of ['', 'not-mac', 'ff:ff:ff:ff:ff:ff', '00:00:00:00:00:00', '01:00:00:00:00:00']) assert.equal(normalizeMac(value), null);
  const result = presenceCandidates([{id:'1',macAddress:mac(1)},{id:'2',macAddress:mac(1)},{id:'3',macAddress:''},{id:'4',macAddress:'wrong'},{id:'5',macAddress:mac(2)}]);
  assert.equal(result.duplicateStudents,2); assert.equal(result.missingMac,1); assert.equal(result.invalidMac,1); assert.equal(result.candidates[0].student.id,'5');
  assert.equal(defaultLockDate('2028-02-27'),'2028-03-01');
  assert.equal(israelDate(new Date('2026-11-15T22:01:00Z')),'2026-11-16');
  assert.throws(()=>validLockDate('2026-02-30'));
  for (const endpoint of ['http://presence.example', 'https://user:password@presence.example', 'https://presence.example/?key=x']) assert.throws(()=>presenceConfig({MAC_PRESENCE_API_KEY:'test',MAC_PRESENCE_API_URL:endpoint}));
});

test('provider batches at 200, authenticates only in headers, validates identities and never follows redirects', async () => {
  const batches=[];
  const result=await checkMacPresence(Array.from({length:201},(_,i)=>mac(i)),{config,fetcher:async(url,options)=>{
    const body=JSON.parse(options.body); batches.push(body.macs.length);
    assert.equal(options.headers['X-API-Key'],config.key); assert.equal(options.redirect,'manual');
    assert(!url.includes(config.key)); assert(!options.body.includes(config.key));
    return response(body.macs);
  }});
  assert.deepEqual(batches,[200,1]); assert.equal(result.connected.size,201);
  for (const body of [null,{ok:true,checkedAt:new Date().toISOString(),results:[]},{ok:true,checkedAt:'2001-01-01',results:[{mac:mac(1),connected:true}]},{ok:true,checkedAt:new Date().toISOString(),results:[{mac:mac(2),connected:true}]}]) {
    await assert.rejects(checkMacPresence([mac(1)],{config,fetcher:async()=>Response.json(body)}),error=>error.code==='invalid_response');
  }
  await assert.rejects(checkMacPresence([mac(1)],{config,fetcher:async()=>new Response('',{status:429})}),error=>error.code==='rate_limited');
  await assert.rejects(checkMacPresence([mac(1)],{config,fetcher:async()=>{throw Error(config.key);}}),error=>error.code==='unavailable' && !error.message.includes(config.key));
});

test('Cloudflare login redirects and HTML pages are never accepted as a working presence API',async()=>{
  let requests=0;
  await assert.rejects(checkMacPresence([mac(1)],{config,fetcher:async()=>{
    requests++;return new Response('',{status:302,headers:{location:'https://example.cloudflareaccess.com/cdn-cgi/access/login/presence.example?token=never-log-this'}});
  }}),error=>error.code==='access_required' && !error.message.includes('never-log-this'));
  assert.equal(requests,1);
  await assert.rejects(checkMacPresence([mac(1)],{config,fetcher:async()=>new Response('<html>Login</html>',{status:200,headers:{'content-type':'text/html'}})}),error=>error.code==='invalid_response');
  await assert.rejects(checkMacPresence([mac(1)],{config,fetcher:async()=>new Response('',{status:307,headers:{location:'https://other.example/check'}})}),error=>error.code==='unexpected_redirect');
  await assert.rejects(checkMacPresence([mac(1)],{config,fetcher:async()=>Response.json({error:'Unauthorized'},{status:401})}),error=>error.code==='auth_failed');
});

test('the documented endpoint is the default; optional Cloudflare credentials require both server values',async()=>{
  assert.equal(presenceConfig({MAC_PRESENCE_API_KEY:'synthetic'}).endpoint,'https://unifi.kfilter.net/attendance/public/mac-presence');
  assert.throws(()=>presenceConfig({MAC_PRESENCE_API_KEY:'synthetic',MAC_PRESENCE_CF_ACCESS_CLIENT_ID:'client-id'}),error=>error.code==='not_configured');
  const accessConfig=presenceConfig({MAC_PRESENCE_API_KEY:'synthetic',MAC_PRESENCE_API_URL:config.endpoint,MAC_PRESENCE_CF_ACCESS_CLIENT_ID:'synthetic-client',MAC_PRESENCE_CF_ACCESS_CLIENT_SECRET:'synthetic-secret'});
  await checkMacPresence([mac(1)],{config:accessConfig,fetcher:async(url,options)=>{
    assert.equal(url,config.endpoint);assert.equal(options.redirect,'manual');
    assert.equal(options.headers['CF-Access-Client-Id'],'synthetic-client');assert.equal(options.headers['CF-Access-Client-Secret'],'synthetic-secret');
    assert(!options.body.includes('synthetic-secret'));return response([mac(1)]);
  }});
});

async function fixture(students = [{id:'s1',label:'Synthetic',class:'A',macAddress:mac(1)}]) {
  const db = new PGlite();
  await db.exec(`CREATE TABLE attendance_sessions(id TEXT PRIMARY KEY, session_date DATE NOT NULL, is_locked BOOLEAN DEFAULT FALSE, communication_audience TEXT DEFAULT 'student', updated_at TIMESTAMPTZ DEFAULT NOW());
    CREATE TABLE attendance_records(session_id TEXT REFERENCES attendance_sessions(id) ON DELETE CASCADE, student_id TEXT, student_name TEXT, student_class TEXT, status TEXT, note_text TEXT, marked_by_user_id TEXT, marked_at TIMESTAMPTZ, created_at TIMESTAMPTZ, updated_at TIMESTAMPTZ, PRIMARY KEY(session_id,student_id));`);
  const sql = async (strings,...values) => (await db.query(strings.reduce((text,part,i)=>text+(i?`$${i}`:'')+part,''),values)).rows;
  await migrateAttendancePresence(sql);
  await migrateAttendancePresence(sql);
  await db.query('INSERT INTO attendance_sessions(id,session_date) VALUES ($1,$2)',['meeting',israelDate()]);
  const loadRoster=async()=>{
    const row=(await db.query(`SELECT *, NOT attendance_session_is_open(is_locked,auto_lock_date,session_date) AS locked FROM attendance_sessions WHERE id='meeting'`)).rows[0];
    return {session:{isLocked:row.locked,sessionDate:new Date(row.session_date).toISOString().slice(0,10),communicationAudience:row.communication_audience,updatedAt:row.updated_at},students};
  };
  const sync=fetcher=>syncNetworkPresence({sessionId:'meeting',sql,loadRoster,providerOptions:{config,fetcher}});
  return {db,sync,sql,async records(){return (await db.query('SELECT * FROM attendance_records ORDER BY student_id')).rows;}};
}

test('real Postgres sync preserves manual records and notes, marks connected students once, and never marks absence', async()=>{
  const f=await fixture([{id:'s1',label:'Manual',class:'A',macAddress:mac(1)},{id:'s2',label:'Connected',macAddress:mac(2)},{id:'s3',label:'Disconnected',macAddress:mac(3)}]);
  try {
    await f.db.exec("INSERT INTO attendance_records(session_id,student_id,status,note_text) VALUES ('meeting','s1','unavailable','keep my note')");
    const provider=async()=>response([mac(1),mac(2),mac(3)]).json().then(body=>Response.json({...body,results:body.results.map(r=>({...r,connected:r.mac!==mac(3)}))}));
    const result=await f.sync(provider);assert.equal(result.status,'complete');assert.equal(result.updated,1);assert.equal(result.connected,2);
    const rows=await f.records();assert.equal(rows.length,2);assert.equal(rows[0].status,'unavailable');assert.equal(rows[0].note_text,'keep my note');assert.equal(rows[1].status,'found');
    assert.equal(rows[1].presence_source,'wifi');assert.ok(rows[1].network_marked_at);
    assert.match(rows[1].note_text,/Wi-Fi/);assert.equal(rows[0].presence_source,null);assert.equal(rows[0].network_marked_at,null);
    assert.equal((await f.sync(provider)).status,'busy');
    await f.db.exec("UPDATE attendance_sessions SET presence_sync_started_at=NOW()-INTERVAL '1 minute'");
    assert.equal((await f.sync(provider)).updated,0);
  } finally {await f.db.close();}
});

test('all batches validate before committing; provider failure never clears or partially writes records',async()=>{
  const f=await fixture(Array.from({length:201},(_,i)=>({id:`s${i}`,label:'Synthetic',macAddress:mac(i)})));
  try {
    let calls=0;const result=await f.sync(async(_url,options)=>++calls===1?response(JSON.parse(options.body).macs):new Response('',{status:502}));
    assert.equal(result.status,'unavailable');assert.equal((await f.records()).length,0);
    const summary=(await f.db.query('SELECT presence_sync_result FROM attendance_sessions')).rows[0].presence_sync_result;
    assert.equal(summary.status,'unavailable');assert(!JSON.stringify(summary).includes(config.key));
  } finally {await f.db.close();}
});

test('lock date is enforced in Postgres for direct inserts and updates, with custom dates and manual locks',async()=>{
  const f=await fixture();
  try {
    await f.db.exec("INSERT INTO attendance_records(session_id,student_id,status) VALUES ('meeting','s1','available')");
    await f.db.exec("UPDATE attendance_sessions SET session_date=(CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Jerusalem')::date-3");
    await assert.rejects(f.db.exec("UPDATE attendance_records SET status='found'"),/נעול/);
    await assert.rejects(f.db.exec("DELETE FROM attendance_records"),/נעול/);
    await assert.rejects(f.db.exec("INSERT INTO attendance_records(session_id,student_id,status) VALUES ('meeting','s2','found')"),/נעול/);
    assert.equal((await f.sync(()=>{throw Error('must not fetch');})).status,'locked');
    await f.db.exec("UPDATE attendance_sessions SET auto_lock_date=(CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Jerusalem')::date+1");
    await f.db.exec("UPDATE attendance_records SET status='found'");
    await f.db.exec("UPDATE attendance_sessions SET is_locked=TRUE");
    await assert.rejects(f.db.exec("UPDATE attendance_records SET status='missing'"),/נעול/);
    // Cascading meeting deletion remains possible; locking is not data retention.
    await f.db.exec("DELETE FROM attendance_sessions WHERE id='meeting'");
    assert.equal((await f.records()).length,0);
  } finally {await f.db.close();}
});

test('current network observations are never applied to other dates or parent meetings',async()=>{
  const f=await fixture();
  try {
    const neverFetch=()=>{throw Error('must not contact the provider');};
    await f.db.exec("UPDATE attendance_sessions SET session_date=(CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Jerusalem')::date+1");
    assert.equal((await f.sync(neverFetch)).status,'different_date');
    await f.db.query("UPDATE attendance_sessions SET session_date=$1,communication_audience='parents'",[israelDate()]);
    assert.equal((await f.sync(neverFetch)).status,'wrong_audience');
    assert.equal((await f.records()).length,0);
  } finally {await f.db.close();}
});

test('a manual change or lock made during provider IO wins the synchronization race',async()=>{
  for(const locked of [false,true]) {
    const f=await fixture();
    try {
      const result=await f.sync(async()=>{
        if(locked) await f.db.exec('UPDATE attendance_sessions SET is_locked=TRUE');
        else await f.db.exec("INSERT INTO attendance_records(session_id,student_id,status,note_text) VALUES ('meeting','s1','missing','manual race')");
        return response([mac(1)]);
      });
      const rows=await f.records();
      if(locked){assert.equal(rows.length,0);assert.equal(result.status,'changed');}
      else {assert.equal(result.updated,0);assert.equal(rows[0].status,'missing');assert.equal(rows[0].note_text,'manual race');}
    } finally {await f.db.close();}
  }
});
