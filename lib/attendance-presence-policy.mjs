export function israelDate(now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jerusalem', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}

export function validLockDate(value) {
  const text = String(value || '').trim();
  if (!text) return null;
  const date = new Date(`${text}T12:00:00Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text) || !Number.isFinite(+date) || date.toISOString().slice(0, 10) !== text) {
    throw new Error('בחר תאריך נעילה תקין.');
  }
  return text;
}

export function defaultLockDate(sessionDate) {
  const date = new Date(`${validLockDate(sessionDate)}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + 3);
  return date.toISOString().slice(0, 10);
}

// This runs as part of the versioned base migration, before any attendance writer.
export async function migrateAttendancePresence(sql) {
  await sql`ALTER TABLE attendance_records ADD COLUMN IF NOT EXISTS presence_source TEXT`;
  await sql`ALTER TABLE attendance_records ADD COLUMN IF NOT EXISTS network_marked_at TIMESTAMPTZ`;
  await sql`ALTER TABLE attendance_sessions ADD COLUMN IF NOT EXISTS presence_auto_until TIMESTAMPTZ`;
  await sql`ALTER TABLE attendance_sessions ADD COLUMN IF NOT EXISTS presence_auto_next_at TIMESTAMPTZ`;
  await sql`ALTER TABLE attendance_sessions ADD COLUMN IF NOT EXISTS auto_lock_date DATE`;
  await sql`ALTER TABLE attendance_sessions ADD COLUMN IF NOT EXISTS presence_sync_started_at TIMESTAMPTZ`;
  await sql`ALTER TABLE attendance_sessions ADD COLUMN IF NOT EXISTS presence_synced_at TIMESTAMPTZ`;
  await sql`ALTER TABLE attendance_sessions ADD COLUMN IF NOT EXISTS presence_sync_result JSONB`;
  await sql`CREATE OR REPLACE FUNCTION attendance_session_is_open(manually_locked BOOLEAN, lock_date DATE, meeting_date DATE)
    RETURNS BOOLEAN LANGUAGE SQL STABLE AS $$
      SELECT NOT COALESCE(manually_locked, FALSE)
        AND (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Jerusalem')::date < COALESCE(lock_date, meeting_date + 3)
    $$`;
  await sql`CREATE OR REPLACE FUNCTION protect_locked_attendance_records() RETURNS TRIGGER LANGUAGE plpgsql AS $$
    DECLARE allowed BOOLEAN;
    BEGIN
      IF TG_OP = 'DELETE' THEN
        SELECT attendance_session_is_open(s.is_locked, s.auto_lock_date, s.session_date) INTO allowed
          FROM attendance_sessions s WHERE s.id = OLD.session_id FOR SHARE;
        IF NOT FOUND THEN RETURN OLD; END IF;
      ELSE
        SELECT attendance_session_is_open(s.is_locked, s.auto_lock_date, s.session_date) INTO allowed
          FROM attendance_sessions s WHERE s.id = NEW.session_id FOR SHARE;
      END IF;
      IF allowed IS NOT TRUE THEN
        RAISE EXCEPTION 'המפגש נעול לעדכונים. יש לפנות למנהל להארכת מועד הנעילה.' USING ERRCODE = '23514';
      END IF;
      IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
      RETURN NEW;
    END $$`;
  await sql`CREATE OR REPLACE TRIGGER protect_locked_attendance_records BEFORE INSERT OR UPDATE OR DELETE ON attendance_records
    FOR EACH ROW EXECUTE FUNCTION protect_locked_attendance_records()`;
}
