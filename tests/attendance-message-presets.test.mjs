import test from 'node:test';
import assert from 'node:assert/strict';
import {PGlite} from '@electric-sql/pglite';
import {saveMessagePreset,meetingCloneInput} from '../lib/attendance-message-presets.mjs';
import {migrateAttendancePresence} from '../lib/attendance-presence-policy.mjs';

test('duplicate meeting copies message, attachment, audience and custom-status settings with a fresh deadline',()=>{
 const source={id:'old',sessionDate:'2026-11-01',customLockDate:'2026-11-06',institution:'CY',sessionType:'seder_a',personalMessage:'hello',emailSubject:'subject',customStatuses:[{value:'custom_a',label:'בישיבה'}],emailResponseStatuses:['custom_a'],emailRecipientRoles:['father'],invitationWhatsAppMessage:'invite',invitationWhatsAppTemplateName:'approved',invitationWhatsAppTemplateLanguage:'he',invitationAttachment:{objectKey:'stored/synthetic.png',fileName:'synthetic.png',contentType:'image/png',sizeBytes:100},manualStudentIds:['one'],excludedStudentIds:['two'],responsibleUserIds:['admin'],isLocked:true,presenceAutoUntil:'old',launchResult:{status:'complete'}};
 const result=meetingCloneInput(source,{id:'new',title:'new name',sessionDate:'2026-11-17',createdByUserId:'creator'});
 assert.equal(result.id,'new');assert.equal(result.autoLockDate,'2026-11-22');assert.equal(result.messagePresetSourceId,'old');
 for(const key of ['personalMessage','emailSubject','customStatuses','emailResponseStatuses','emailRecipientRoles','invitationWhatsAppMessage','invitationWhatsAppTemplateName','invitationWhatsAppTemplateLanguage','manualStudentIds','excludedStudentIds','responsibleUserIds'])assert.deepEqual(result[key],source[key]);
 assert.equal(result.invitationAttachmentObjectKey,'stored/synthetic.png');
 assert.equal(Object.hasOwn(result,'isLocked'),false);assert.equal(Object.hasOwn(result,'presenceAutoUntil'),false);assert.equal(Object.hasOwn(result,'launchResult'),false);
});
test('message history keeps distinct drafts, deduplicates repeats, persists media and copies history to a new meeting',async()=>{
 const db=new PGlite();
 try{
  await db.exec('CREATE TABLE attendance_sessions(id TEXT PRIMARY KEY); CREATE TABLE attendance_records(session_id TEXT);');
  const sql=async(parts,...values)=>(await db.query(parts.reduce((s,p,i)=>s+(i?`$${i}`:'')+p,''),values)).rows;
  await migrateAttendancePresence(sql);
  await sql`INSERT INTO attendance_sessions(id) VALUES('source'),('copy')`;
  const payload={templateName:'approved',templateValues:{1:'hello'},responseStatuses:['missing','found'],recipientRoles:['student'],attachment:{objectKey:'synthetic/photo.png'}};
  const first=await saveMessagePreset(sql,'source','whatsapp',payload);
  assert.equal(await saveMessagePreset(sql,'source','whatsapp',payload),first);
  await saveMessagePreset(sql,'source','whatsapp',{...payload,templateValues:{1:'second'}});
  await saveMessagePreset(sql,'source','email',{emailSubject:'subject',personalMessage:'body'});
  assert.equal((await db.query('SELECT * FROM attendance_message_presets')).rows.length,3);
  const rows=await sql`SELECT payload FROM attendance_message_presets WHERE id=${first}`;assert.equal(rows[0].payload.attachment.objectKey,'synthetic/photo.png');
  await sql`INSERT INTO attendance_message_presets(id,session_id,channel,payload,fingerprint,created_at,last_used_at)
    SELECT gen_random_uuid()::text,'copy',channel,payload,fingerprint,created_at,last_used_at FROM attendance_message_presets WHERE session_id='source' ON CONFLICT DO NOTHING`;
  assert.equal((await db.query("SELECT * FROM attendance_message_presets WHERE session_id='copy'")).rows.length,3);
  await assert.rejects(saveMessagePreset(sql,'source','invalid',{}));
  await assert.rejects(saveMessagePreset(sql,'source','email',{body:'x'.repeat(100001)}));
 }finally{await db.close();}
});
