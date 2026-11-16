import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { attendanceListState, attendanceListHref } from '../lib/attendance-list-view.mjs';
import { migrateAttendancePresence } from '../lib/attendance-presence-policy.mjs';

test('meeting list defaults to everyone and only filters responsibilities explicitly', () => {
  assert.deepEqual(attendanceListState({},'user-a'), {archived:false,selectedResponsibleIds:[]});
  assert.deepEqual(attendanceListState({responsible:'all'},'user-a').selectedResponsibleIds,[]);
  assert.deepEqual(attendanceListState({responsible:'mine'},'user-a').selectedResponsibleIds,['user-a']);
  assert.deepEqual(attendanceListState({responsible:['user-b','user-c']},'user-a').selectedResponsibleIds,['user-b','user-c']);
  assert.equal(attendanceListState({view:'archive'}).archived,true);
});
test('switching tabs preserves search criteria and clearing a responsibility removes it', () => {
  const current={sessionQuery:'סדר א',sessionClassFilter:['A','B'],responsible:'mine',lockSaved:'locked'};
  const all=new URL(attendanceListHref(current,{responsible:null,view:null}),'https://crm.test');
  assert.equal(all.searchParams.has('responsible'),false);
  assert.equal(all.searchParams.get('sessionQuery'),'סדר א');
  assert.deepEqual(all.searchParams.getAll('sessionClassFilter'),['A','B']);
  assert.equal(all.searchParams.has('lockSaved'),false);
  assert.equal(new URL(attendanceListHref(current,{view:'archive',responsible:null}),'https://crm.test').searchParams.get('view'),'archive');
});
test('actual meeting list SQL separates manual and automatic locks before applying the list limit', async () => {
  const db=new PGlite();
  try {
    await db.exec(`CREATE TABLE attendance_sessions (id TEXT, is_locked BOOLEAN, auto_lock_date DATE, session_date DATE);
      CREATE TABLE attendance_records (session_id TEXT);`);
    const sql=async(parts,...values)=>(await db.query(parts.reduce((s,p,i)=>s+(i?`$${i}`:'')+p,''),values)).rows;
    await migrateAttendancePresence(sql);
    await db.exec(`INSERT INTO attendance_sessions VALUES
      ('open',false,NULL,CURRENT_DATE),('manual',true,NULL,CURRENT_DATE),
      ('expired',false,NULL,CURRENT_DATE-5),('extended',false,CURRENT_DATE+2,CURRENT_DATE-5);`);
    const source=await readFile(new URL('../lib/attendance.js',import.meta.url),'utf8');
    const clause=source.match(/AND \(\$11 = '' OR \(\$11 = 'active'[\s\S]*?\n      ORDER BY/)[0].replace(/\n      ORDER BY$/,'').replaceAll('$11','$1');
    const read=async state=>(await db.query(`SELECT id FROM attendance_sessions s WHERE TRUE ${clause} ORDER BY id`,[state])).rows.map(x=>x.id);
    assert.deepEqual(await read('active'),['extended','open']);
    assert.deepEqual(await read('archived'),['expired','manual']);
    assert.equal((await read('')).length,4);
  } finally {await db.close();}
});
