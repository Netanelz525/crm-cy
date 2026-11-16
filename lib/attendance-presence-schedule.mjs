// Persist deadlines in PostgreSQL: scheduling must continue when no browser is open.
export async function setAutomaticPresence({ sql, sessionId, enabled }) {
  if (!enabled) {
    await sql`UPDATE attendance_sessions SET presence_auto_until = NULL, presence_auto_next_at = NULL WHERE id = ${sessionId}`;
    return;
  }
  const rows = await sql`UPDATE attendance_sessions
    SET presence_auto_until = NOW() + INTERVAL '4 hours', presence_auto_next_at = NOW() + INTERVAL '30 minutes'
    WHERE id = ${sessionId}
      AND (presence_auto_until IS NULL OR presence_auto_until <= NOW())
      AND attendance_session_is_open(is_locked, auto_lock_date, session_date)
      AND session_date = (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Jerusalem')::date
      AND communication_audience = 'student'
    RETURNING id`;
  if (!rows.length) throw new Error('לא ניתן להפעיל סנכרון למפגש זה. רענן את המסך.');
}

export async function runAutomaticPresence({ sql, sync }) {
  await sql`UPDATE attendance_sessions SET presence_auto_until = NULL, presence_auto_next_at = NULL
    WHERE presence_auto_until IS NOT NULL AND (presence_auto_until <= NOW()
      OR NOT attendance_session_is_open(is_locked, auto_lock_date, session_date)
      OR session_date <> (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Jerusalem')::date
      OR communication_audience <> 'student')`;
  // Claim one job at a time. Concurrent cron deliveries cannot claim the same interval.
  let processed = 0;
  for (let i = 0; i < 8; i++) {
    const rows = await sql`WITH due AS (
      SELECT id FROM attendance_sessions WHERE presence_auto_until > NOW() AND presence_auto_next_at <= NOW()
        AND attendance_session_is_open(is_locked, auto_lock_date, session_date)
        AND session_date = (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Jerusalem')::date
        AND communication_audience = 'student'
      ORDER BY presence_auto_next_at FOR UPDATE SKIP LOCKED LIMIT 1
    ) UPDATE attendance_sessions SET presence_auto_next_at = NOW() + INTERVAL '30 minutes'
      WHERE id IN (SELECT id FROM due) RETURNING id`;
    if (!rows.length) break;
    // Recheck the switch after claiming, so disabling cancels queued work.
    const active = await sql`SELECT id FROM attendance_sessions WHERE id = ${rows[0].id} AND presence_auto_until > NOW()`;
    if (!active.length) continue;
    await sync(rows[0].id);
    processed++;
  }
  return { ok: true, processed };
}
