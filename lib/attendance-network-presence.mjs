import { randomUUID } from 'node:crypto';
import { israelDate } from './attendance-presence-policy.mjs';
import { checkMacPresence, presenceCandidates, PRESENCE_MESSAGES, PresenceError } from './mac-presence.mjs';

export async function syncNetworkPresence({ sessionId, sql, loadRoster, markedByUserId = null, providerOptions, automatic = false }) {
  const roster = await loadRoster(sessionId);
  if (!roster) throw new Error('Attendance session not found.');
  if (roster.session.isLocked) return { status: 'locked' };
  if (roster.session.sessionDate !== israelDate()) return { status: 'different_date' };
  if (roster.session.communicationAudience !== 'student') return { status: 'wrong_audience' };
  const runId = randomUUID();
  const leases = await sql`UPDATE attendance_sessions
    SET presence_sync_started_at = NOW(), presence_sync_result = ${JSON.stringify({ status: 'running', runId })}::jsonb
    WHERE id = ${sessionId} AND (NOT ${automatic} OR presence_auto_until > NOW()) AND attendance_session_is_open(is_locked, auto_lock_date, session_date)
      AND (${roster.session.updatedAt || null}::timestamptz IS NULL OR date_trunc('milliseconds',updated_at) = date_trunc('milliseconds',${roster.session.updatedAt || null}::timestamptz))
      AND (presence_sync_started_at IS NULL OR
        (presence_sync_started_at < NOW() - INTERVAL '20 seconds' AND presence_sync_result->>'status' IS DISTINCT FROM 'running') OR
        presence_sync_started_at < NOW() - INTERVAL '2 minutes')
    RETURNING id, updated_at`;
  if (!leases.length) return { status: 'busy' };
  try {
    const { candidates, missingMac, invalidMac, duplicateStudents } = presenceCandidates(roster.students);
    // Fetch and validate every batch before committing any attendance changes.
    const result = await checkMacPresence(candidates.map(item => item.mac), providerOptions);
    const present = candidates.filter(item => result.connected.has(item.mac));
    const incoming = present.map(({ student }) => ({ student_id: student.id, student_name: student.label, student_class: student.class || '' }));
    const summary = { status: 'complete', checkedAt: result.checkedAt || new Date().toISOString(), checkedStudents: candidates.length,
      connected: present.length, missingMac, invalidMac, duplicateStudents, batches: result.batches };
    const rows = await sql`WITH target AS (
        SELECT id FROM attendance_sessions WHERE id = ${sessionId}
          AND presence_sync_result->>'runId' = ${runId}
          AND (NOT ${automatic} OR presence_auto_until > NOW())
          AND date_trunc('milliseconds',updated_at) = date_trunc('milliseconds',${leases[0].updated_at}::timestamptz)
          AND attendance_session_is_open(is_locked, auto_lock_date, session_date)
          AND session_date = (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Jerusalem')::date
          AND communication_audience = 'student' FOR UPDATE
      ), inserted AS (
        INSERT INTO attendance_records (session_id, student_id, student_name, student_class, status, note_text, marked_by_user_id, marked_at, created_at, updated_at, presence_source, network_marked_at)
        SELECT target.id, item.student_id, item.student_name, item.student_class, 'found', 'סומן אוטומטית כנמצא לפי חיבור ל־Wi-Fi.', ${markedByUserId}, NOW(), NOW(), NOW(), 'wifi', NOW()
        FROM target CROSS JOIN jsonb_to_recordset(${JSON.stringify(incoming)}::jsonb) AS item(student_id TEXT, student_name TEXT, student_class TEXT)
        ON CONFLICT (session_id, student_id) DO NOTHING RETURNING student_id
      ) UPDATE attendance_sessions SET presence_synced_at = NOW(), updated_at = NOW(),
        presence_sync_result = ${JSON.stringify(summary)}::jsonb || jsonb_build_object('updated', (SELECT COUNT(*)::int FROM inserted))
        WHERE id IN (SELECT id FROM target) RETURNING presence_sync_result`;
    if (!rows.length) throw new PresenceError('changed');
    return rows[0].presence_sync_result;
  } catch (error) {
    const status = Object.hasOwn(PRESENCE_MESSAGES, error?.code) ? error.code : 'failed';
    await sql`UPDATE attendance_sessions SET presence_sync_result = ${JSON.stringify({ status })}::jsonb
      WHERE id = ${sessionId} AND presence_sync_result->>'runId' = ${runId}`;
    return { status };
  }
}
