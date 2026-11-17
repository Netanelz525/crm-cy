import { randomBytes, createHash } from 'node:crypto';
export function buildMeetingLaunchMessage(session, token, baseUrl) {
  const base = new URL(baseUrl);
  if (base.protocol !== 'https:') throw new Error('Invalid CRM URL');
  const callUrl = new URL(`/public-call/${token}`, base);
  callUrl.searchParams.set('status', 'missing');
  return [
    'מפגש חדש · חפ״ק פתוח',
    `שם: ${String(session.displayTitle || session.title || 'מפגש').slice(0,200)}`,
    `סוג: ${session.sessionTypeLabel || session.sessionType || '—'}`,
    `תאריך המפגש: ${session.sessionDate}`,
    `נוצר: ${new Date(session.createdAt).toLocaleString('he-IL', {timeZone:'Asia/Jerusalem', dateStyle:'short', timeStyle:'short'})}`,
    `מוסד: ${session.institutionLabel || '—'}`,
    `אחראים: ${String(session.responsibleDisplayName || 'לא הוגדר').slice(0,200)}`,
    session.isLocked ? 'המפגש נעול לפי מועד הנעילה; יש לפתוח אותו לפני הפעלת החפ״ק.' : 'הקישור נפתח בסינון ״לא נמצא״.',
    'קישור סודי למתקשרים — יש להפיץ רק לצוות המיועד:',
    callUrl.toString(),
    `ניהול המפגש: ${new URL(`/attendance/${session.id}`, base)}`
  ].join('\n');
}
export async function launchNewMeeting({ session, sql, ensureCalls, send, baseUrl }) {
  await ensureCalls();
  const token = randomBytes(32).toString('hex');
  const hash = createHash('sha256').update(token).digest('hex');
  // Never rotate an existing link, including a manager's manually replaced link.
  const rows = await sql`INSERT INTO attendance_call_public_links(session_id,token_hash,enabled)
    VALUES(${session.id},${hash},TRUE) ON CONFLICT(session_id) DO NOTHING RETURNING session_id`;
  await sql`INSERT INTO attendance_call_teams(session_id) VALUES(${session.id}) ON CONFLICT DO NOTHING`;
  if (!rows.length) return { status: 'already_initialized' };
  const recipients = await sql`SELECT DISTINCT t.telegram_chat_id FROM telegram_user_links t
    JOIN app_users u ON u.clerk_user_id=t.clerk_user_id
    WHERE t.is_active=TRUE AND u.access_status='approved' AND LOWER(COALESCE(u.role,''))='super_admin'
      AND COALESCE(t.telegram_chat_id,'')<>''`;
  let sent=0, failed=0;
  if (!recipients.length) return { status: 'no_recipients', sent, failed };
  const text = buildMeetingLaunchMessage(session, token, baseUrl);
  for (const recipient of recipients) {
    try { await send(recipient.telegram_chat_id, text); sent++; }
    catch { failed++; }
  }
  return { status: failed ? 'notification_failed' : 'complete', sent, failed };
}
