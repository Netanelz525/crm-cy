import {createHash,randomUUID} from 'node:crypto';
export async function saveMessagePreset(sql,sessionId,channel,payload) {
  if(!['email','whatsapp','legacy-whatsapp','invitation'].includes(channel))throw Error('Invalid message channel');
  const text=JSON.stringify(payload);
  if(Buffer.byteLength(text)>100000)throw Error('ההודעה גדולה מדי לשמירה.');
  const fingerprint=createHash('sha256').update(text).digest('hex');
  const rows=await sql`INSERT INTO attendance_message_presets(id,session_id,channel,payload,fingerprint)
    VALUES(${randomUUID()},${sessionId},${channel},${text}::jsonb,${fingerprint})
    ON CONFLICT(session_id,channel,fingerprint) DO UPDATE SET last_used_at=NOW() RETURNING id`;
  return rows[0]?.id;
}
export function meetingCloneInput(source,{id,title,sessionDate,createdByUserId}) {
  const fields=['institution','sessionType','sourceNote','communicationAudience','emailSubject','personalMessage','customStatuses','emailResponseStatuses','emailRecipientRoles','invitationEmailSubject','invitationEmailBody','invitationMessage','invitationWhatsAppMessage','invitationEmailRecipientRoles','invitationWhatsAppTemplateName','invitationWhatsAppTemplateLanguage','invitationWhatsAppRecipientRoles','institutionFilter','classFilter','registrationFilter','familyStatusFilter','tagFilter','manualStudentIds','excludedStudentIds','rosterMode','responsibleUserId','responsibleUserIds','visibleToStudents'];
  const copy=Object.fromEntries(fields.map(key=>[key,source[key]]));
  const attachment=source.invitationAttachment||{};
  const lockOffset=source.customLockDate ? new Date(`${source.customLockDate}T12:00:00Z`)-new Date(`${source.sessionDate}T12:00:00Z`) : null;
  const shiftedLock=lockOffset!==null ? new Date(new Date(`${sessionDate}T12:00:00Z`).getTime()+lockOffset) : null;
  const autoLockDate=shiftedLock && Number.isFinite(+shiftedLock) ? shiftedLock.toISOString().slice(0,10) : '';
  return {...copy,id,title,sessionDate,createdByUserId,autoLockDate,messagePresetSourceId:source.id,
    invitationAttachmentObjectKey:attachment.objectKey||'',invitationAttachmentFileName:attachment.fileName||'',
    invitationAttachmentContentType:attachment.contentType||'',invitationAttachmentSizeBytes:attachment.sizeBytes||0};
}
