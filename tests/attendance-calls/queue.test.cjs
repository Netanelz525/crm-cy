const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { PGlite } = require('@electric-sql/pglite');

test('attendance calls: SQL queue, leases, authorization, outcomes and atomic writes', async (t) => {
 const db = new PGlite();
 t.after(() => db.close());
 await db.exec(`CREATE TABLE app_users(clerk_user_id text primary key, linked_student_id text, access_status text, role text, display_name text);
 CREATE TABLE attendance_sessions(id text primary key,title text,session_type text,session_date date,created_at timestamptz default now(),updated_at timestamptz default '2026-09-08T00:00:00Z',is_locked boolean default false);
 CREATE TABLE attendance_records(session_id text,student_id text,student_name text,student_class text,status text,note_text text,marked_by_user_id text,marked_at timestamptz,updated_at timestamptz,primary key(session_id,student_id));
 CREATE TABLE student_contact_logs(id text primary key,student_id text,contact_date date,note_text text,created_by_user_id text,created_at timestamptz default now());
 INSERT INTO attendance_sessions(id,title) VALUES ('meeting','test');
 INSERT INTO app_users VALUES ('manager',null,'approved','admin','manager'),('a','caller-a','approved','viewer','A'),('b','caller-b','approved','viewer','B'),('a2','caller-a','approved','viewer','A2'),('outsider','caller-x','approved','viewer','X');`);
 function sql(strings,...values) {
   let text=''; strings.forEach((s,i)=>{text+=s; if(i<values.length)text+=`$${i+1}`;});
   return {text,values,then(resolve,reject){return db.query(text,values).then(r=>r.rows).then(resolve,reject);}};
 }
 sql.transaction=queries=>db.transaction(async tx=>{const results=[];for(const q of queries)results.push((await tx.query(q.text,q.values)).rows);return results;});
 let students=[1,2,3,4,5].map(n=>({id:`lead-${n}`,label:`Lead ${n}`,class:'A',classLabel:'A',phone:'0501234567',status:'missing'}));
 const roster=()=>({session:{id:'meeting',title:'test',updatedAt:'2026-09-08T00:00:00Z',statusOptions:[['found','נמצא'],['missing','לא נמצא']],isLocked:false},students});
 const source=fs.readFileSync(path.join(__dirname,'../../lib/attendance-calls.js'),'utf8').replace(/^import .*;\r?\n/gm,'').replace(/export /g,'');
 const api=new Function('sql','initDb','getAttendanceRoster','listAllNeonStudents','randomUUID',source+'\nreturn {claimAttendanceCall,finishAttendanceCall,saveCallTeam,listMyCallSessions};')(sql,async()=>{},async()=>roster(),async()=>[{id:'caller-a'},{id:'caller-b'}],randomUUID);
 const manager={clerk_user_id:'manager',is_manager:true,access_status:'approved'};
 const a={clerk_user_id:'a',linked_student_id:'caller-a',access_status:'approved'};
 const b={clerk_user_id:'b',linked_student_id:'caller-b',access_status:'approved'};
 await api.saveCallTeam('meeting',['caller-a','caller-b'],manager);
 await assert.rejects(api.saveCallTeam('meeting',[],a),e=>e.status===403);
 await assert.rejects(api.claimAttendanceCall('meeting',{...a,clerk_user_id:'outsider',linked_student_id:'caller-x'}),e=>e.status===403);
 await assert.rejects(api.claimAttendanceCall('meeting',{...a,access_status:'pending'}),e=>e.status===403);
 const claims=await Promise.all([api.claimAttendanceCall('meeting',a),api.claimAttendanceCall('meeting',b)]);
 assert.notEqual(claims[0].lead.studentId,claims[1].lead.studentId);
 const again=await api.claimAttendanceCall('meeting',a);
 assert.equal(again.lead.token,claims[0].lead.token);
 assert.equal(new Date(again.lead.expiresAt).getTime(),new Date(claims[0].lead.expiresAt).getTime());
 const linked=await api.claimAttendanceCall('meeting',{...a,clerk_user_id:'a2'});
 assert.equal(linked.lead.studentId,again.lead.studentId);
 assert.ok(new Date(again.lead.expiresAt)-Date.now()<=300000);
 assert.deepEqual(again.session.statusOptions,[{value:'found',label:'נמצא'},{value:'missing',label:'לא נמצא'}]);
 const payload={studentId:again.lead.studentId,token:again.lead.token,outcome:'completed',attendanceStatus:'found',note:'confirmed'};
 await assert.rejects(api.finishAttendanceCall('meeting',payload,b),e=>e.status===409);
 await assert.rejects(api.finishAttendanceCall('meeting',{...payload,attendanceStatus:'bogus'},a),e=>e.status===400);
 await api.finishAttendanceCall('meeting',payload,a);
 await api.finishAttendanceCall('meeting',payload,a); // retry is idempotent
 assert.equal((await db.query('SELECT * FROM student_contact_logs')).rows.length,1);
 assert.equal((await db.query('SELECT status FROM attendance_records')).rows[0].status,'found');
 const next=await api.claimAttendanceCall('meeting',a);
 assert.notEqual(next.lead.studentId,again.lead.studentId);
 await api.finishAttendanceCall('meeting',{studentId:next.lead.studentId,token:next.lead.token,outcome:'no_answer',attendanceStatus:'found'},a);
 let row=(await db.query('SELECT * FROM attendance_call_leads WHERE student_id=$1',[next.lead.studentId])).rows[0];
 assert.equal(row.caller_key,null); assert.equal(row.outcome,'no_answer'); assert.ok(new Date(row.available_at)-Date.now()>890000);
 assert.equal((await db.query('SELECT * FROM attendance_records')).rows.length,1);
 const deferred=await api.claimAttendanceCall('meeting',a);
 await api.finishAttendanceCall('meeting',{studentId:deferred.lead.studentId,token:deferred.lead.token,outcome:'deferred'},a);
 row=(await db.query('SELECT * FROM attendance_call_leads WHERE student_id=$1',[deferred.lead.studentId])).rows[0];
 assert.ok(new Date(row.available_at)-Date.now()>290000);
 await db.query("UPDATE attendance_call_leads SET lease_until=now()-interval '1 second' WHERE caller_key='student:caller-b'");
 await assert.rejects(api.finishAttendanceCall('meeting',{studentId:claims[1].lead.studentId,token:claims[1].lead.token,outcome:'completed'},b),e=>e.status===409);
 const reclaimed=await api.claimAttendanceCall('meeting',b);
 assert.notEqual(reclaimed.lead.token,claims[1].lead.token);
 await api.saveCallTeam('meeting',['caller-a'],manager);
 assert.equal((await db.query("SELECT count(*)::int n FROM attendance_call_leads WHERE caller_key='student:caller-b'")).rows[0].n,0);
 await assert.rejects(api.finishAttendanceCall('meeting',{studentId:reclaimed.lead.studentId,token:reclaimed.lead.token,outcome:'completed'},b),e=>e.status===403);
 await db.query("UPDATE attendance_sessions SET is_locked=true");
 await assert.rejects(api.claimAttendanceCall('meeting',a),e=>e.status===403);
 await db.query("UPDATE attendance_sessions SET is_locked=false");
 const active=await api.claimAttendanceCall('meeting',a);
 students=students.filter(s=>s.id!==active.lead.studentId);
 await assert.rejects(api.finishAttendanceCall('meeting',{studentId:active.lead.studentId,token:active.lead.token,outcome:'completed'},a),e=>e.status===409);
 const fresh=await api.claimAttendanceCall('meeting',a);
 if(fresh.lead)assert.notEqual(fresh.lead.studentId,active.lead.studentId);
 // A database failure in contact logging must roll back release and status update.
 if(fresh.lead){
   await db.exec("ALTER TABLE student_contact_logs ADD CONSTRAINT reject_test CHECK (note_text NOT LIKE '%ROLLBACK%')");
   await assert.rejects(api.finishAttendanceCall('meeting',{studentId:fresh.lead.studentId,token:fresh.lead.token,outcome:'completed',attendanceStatus:'found',note:'ROLLBACK'},a));
   assert.equal((await api.claimAttendanceCall('meeting',a)).lead.token,fresh.lead.token);
 }

});
