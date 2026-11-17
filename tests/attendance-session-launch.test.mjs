import test from 'node:test';
import assert from 'node:assert/strict';
import {PGlite} from '@electric-sql/pglite';
import {launchNewMeeting,buildMeetingLaunchMessage} from '../lib/attendance-session-launch.mjs';
const session={id:'meeting',title:'Synthetic meeting',sessionTypeLabel:'סדר א',sessionDate:'2026-11-17',createdAt:'2026-11-17T08:00:00Z'};
test('new meeting opens one desk and notifies only approved linked super admins; retry cannot rotate the link',async()=>{
 const db=new PGlite();
 try{
  await db.exec(`CREATE TABLE attendance_call_public_links(session_id TEXT PRIMARY KEY,token_hash TEXT,enabled BOOLEAN);
   CREATE TABLE attendance_call_teams(session_id TEXT PRIMARY KEY);
   CREATE TABLE app_users(clerk_user_id TEXT,role TEXT,access_status TEXT);
   CREATE TABLE telegram_user_links(clerk_user_id TEXT,telegram_chat_id TEXT,is_active BOOLEAN);
   INSERT INTO app_users VALUES ('admin','super_admin','approved'),('editor','editor','approved'),('blocked','super_admin','pending'),('inactive','super_admin','approved');
   INSERT INTO telegram_user_links VALUES ('admin','synthetic-admin',TRUE),('editor','synthetic-editor',TRUE),('blocked','synthetic-blocked',TRUE),('inactive','synthetic-inactive',FALSE);`);
  const sql=async(parts,...values)=>(await db.query(parts.reduce((s,p,i)=>s+(i?`$${i}`:'')+p,''),values)).rows;
  const sends=[];const args={session,sql,ensureCalls:async()=>{},send:async(chat,text)=>sends.push({chat,text}),baseUrl:'https://crm.example'};
  assert.deepEqual(await launchNewMeeting(args),{status:'complete',sent:1,failed:0});
  assert.equal(sends[0].chat,'synthetic-admin');assert.match(sends[0].text,/status=missing/);assert.match(sends[0].text,/סדר א/);
  const first=(await db.query('SELECT * FROM attendance_call_public_links')).rows[0];
  assert.equal(first.enabled,true);assert.match(first.token_hash,/^[a-f0-9]{64}$/);
  assert.ok(!JSON.stringify(first).includes(sends[0].text.match(/public-call\/([a-f0-9]+)/)[1]));
  assert.equal((await db.query('SELECT * FROM attendance_call_teams')).rows.length,1);
  assert.equal((await launchNewMeeting(args)).status,'already_initialized');assert.equal(sends.length,1);
  assert.equal((await db.query('SELECT token_hash FROM attendance_call_public_links')).rows[0].token_hash,first.token_hash);
  await db.exec("DELETE FROM attendance_call_public_links;DELETE FROM telegram_user_links;");
  assert.equal((await launchNewMeeting(args)).status,'no_recipients');
  await db.exec("DELETE FROM attendance_call_public_links;INSERT INTO telegram_user_links VALUES ('admin','synthetic-admin',TRUE);");
  assert.equal((await launchNewMeeting({...args,send:async()=>{throw Error('synthetic failure')}})).status,'notification_failed');
 }finally{await db.close();}
});
test('notification URLs are HTTPS and unsafe base URLs are rejected',()=>{
 assert.throws(()=>buildMeetingLaunchMessage(session,'synthetic','http://crm.example'));
 assert.match(buildMeetingLaunchMessage({...session,isLocked:true},'synthetic','https://crm.example'),/נעול/);
});
