import { neon } from "@neondatabase/serverless";

const DATABASE_URL = process.env.DATABASE_URL;

if (!DATABASE_URL) {
  throw new Error("Missing DATABASE_URL env variable.");
}

export const sql = neon(DATABASE_URL);

let initialized = false;
let initializationPromise = null;

export async function initDb() {
  if (initialized) return;
  if (initializationPromise) {
    await initializationPromise;
    return;
  }

  initializationPromise = (async () => {
    await sql`SELECT pg_advisory_lock(84732651)`;
    try {
    await sql`
    CREATE TABLE IF NOT EXISTS app_users (
      clerk_user_id TEXT PRIMARY KEY,
      email TEXT NOT NULL UNIQUE,
      display_name TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'viewer',
      access_status TEXT NOT NULL DEFAULT 'pending',
      linked_student_id TEXT,
      linked_student_class TEXT,
      can_edit_own_card BOOLEAN NOT NULL DEFAULT FALSE,
      approved_by_user_id TEXT REFERENCES app_users(clerk_user_id),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;

  await sql`ALTER TABLE app_users ADD COLUMN IF NOT EXISTS access_status TEXT`;
  await sql`ALTER TABLE app_users ADD COLUMN IF NOT EXISTS linked_student_id TEXT`;
  await sql`ALTER TABLE app_users ADD COLUMN IF NOT EXISTS linked_student_class TEXT`;
  await sql`ALTER TABLE app_users ADD COLUMN IF NOT EXISTS can_edit_own_card BOOLEAN`;
  await sql`ALTER TABLE app_users ADD COLUMN IF NOT EXISTS approved_by_user_id TEXT`;
  await sql`ALTER TABLE app_users ADD COLUMN IF NOT EXISTS weekly_backup_enabled BOOLEAN`;
  await sql`ALTER TABLE app_users ADD COLUMN IF NOT EXISTS weekly_backup_delivery TEXT`;
  await sql`ALTER TABLE app_users ADD COLUMN IF NOT EXISTS can_send_emails BOOLEAN`;
  await sql`ALTER TABLE app_users ADD COLUMN IF NOT EXISTS can_edit_email_sender BOOLEAN`;
  await sql`ALTER TABLE app_users ADD COLUMN IF NOT EXISTS can_email_parents BOOLEAN`;
  await sql`ALTER TABLE app_users ADD COLUMN IF NOT EXISTS can_view_email_reports BOOLEAN`;
  await sql`ALTER TABLE app_users ALTER COLUMN access_status SET DEFAULT 'pending'`;
  await sql`ALTER TABLE app_users ALTER COLUMN can_edit_own_card SET DEFAULT FALSE`;
  await sql`ALTER TABLE app_users ALTER COLUMN weekly_backup_enabled SET DEFAULT FALSE`;
  await sql`ALTER TABLE app_users ALTER COLUMN can_send_emails SET DEFAULT FALSE`;
  await sql`ALTER TABLE app_users ALTER COLUMN can_edit_email_sender SET DEFAULT FALSE`;
  await sql`ALTER TABLE app_users ALTER COLUMN can_email_parents SET DEFAULT FALSE`;
  await sql`ALTER TABLE app_users ALTER COLUMN can_view_email_reports SET DEFAULT FALSE`;
  await sql`UPDATE app_users SET access_status = COALESCE(NULLIF(access_status, ''), 'pending')`;
  await sql`UPDATE app_users SET can_edit_own_card = COALESCE(can_edit_own_card, FALSE)`;
  await sql`UPDATE app_users SET weekly_backup_enabled = COALESCE(weekly_backup_enabled, FALSE)`;
  await sql`
    UPDATE app_users
    SET
      can_send_emails = COALESCE(can_send_emails, FALSE),
      can_edit_email_sender = COALESCE(can_edit_email_sender, FALSE),
      can_email_parents = COALESCE(can_email_parents, FALSE),
      can_view_email_reports = COALESCE(can_view_email_reports, FALSE)
  `;
  await sql`
    UPDATE app_users
    SET
      weekly_backup_enabled = TRUE,
      weekly_backup_delivery = COALESCE(NULLIF(weekly_backup_delivery, ''), 'email'),
      can_send_emails = TRUE,
      can_edit_email_sender = TRUE,
      can_email_parents = TRUE,
      can_view_email_reports = TRUE,
      updated_at = NOW()
    WHERE LOWER(COALESCE(role, '')) = 'super_admin'
  `;
  await sql`
    UPDATE app_users
    SET
      can_send_emails = TRUE,
      can_email_parents = TRUE,
      can_view_email_reports = TRUE,
      updated_at = NOW()
    WHERE LOWER(COALESCE(role, '')) IN ('admin', 'editor')
       OR UPPER(COALESCE(linked_student_class, '')) = 'TEAM'
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS student_internal_notes (
      student_id TEXT PRIMARY KEY,
      note_text TEXT,
      note_status TEXT,
      direct_debit_active BOOLEAN,
      signed_by_user_id TEXT REFERENCES app_users(clerk_user_id),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS student_tags (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      normalized_name TEXT NOT NULL UNIQUE,
      created_by_user_id TEXT REFERENCES app_users(clerk_user_id),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;

  await sql`ALTER TABLE student_tags ADD COLUMN IF NOT EXISTS normalized_name TEXT`;
  await sql`ALTER TABLE student_tags ADD COLUMN IF NOT EXISTS created_by_user_id TEXT`;
  await sql`ALTER TABLE student_tags ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ`;
  await sql`ALTER TABLE student_tags ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ`;
  await sql`UPDATE student_tags SET created_at = COALESCE(created_at, NOW())`;
  await sql`UPDATE student_tags SET updated_at = COALESCE(updated_at, created_at, NOW())`;
  await sql`UPDATE student_tags SET normalized_name = LOWER(BTRIM(COALESCE(name, ''))) WHERE normalized_name IS NULL OR BTRIM(normalized_name) = ''`;
  await sql`CREATE UNIQUE INDEX IF NOT EXISTS idx_student_tags_normalized_name ON student_tags (normalized_name)`;

  await sql`
    CREATE TABLE IF NOT EXISTS student_tag_assignments (
      student_id TEXT NOT NULL,
      tag_id TEXT NOT NULL REFERENCES student_tags(id) ON DELETE CASCADE,
      assigned_by_user_id TEXT REFERENCES app_users(clerk_user_id),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (student_id, tag_id)
    )
  `;

  await sql`ALTER TABLE student_tag_assignments ADD COLUMN IF NOT EXISTS assigned_by_user_id TEXT`;
  await sql`ALTER TABLE student_tag_assignments ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ`;
  await sql`UPDATE student_tag_assignments SET created_at = COALESCE(created_at, NOW())`;
  await sql`CREATE INDEX IF NOT EXISTS idx_student_tag_assignments_student_id ON student_tag_assignments (student_id)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_student_tag_assignments_tag_id ON student_tag_assignments (tag_id)`;

  await sql(`
    DO $$
    BEGIN
      CREATE TABLE student_contact_logs (
        id TEXT PRIMARY KEY,
        student_id TEXT NOT NULL,
        contact_date DATE NOT NULL,
        note_text TEXT,
        created_by_user_id TEXT REFERENCES app_users(clerk_user_id),
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    EXCEPTION
      WHEN duplicate_table THEN NULL;
      WHEN duplicate_object THEN NULL;
    END $$;
  `);

  await sql`ALTER TABLE student_contact_logs ADD COLUMN IF NOT EXISTS created_by_user_id TEXT`;
  await sql`ALTER TABLE student_contact_logs ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ`;
  await sql`UPDATE student_contact_logs SET created_at = COALESCE(created_at, NOW())`;
  await sql(`
    DO $$
    BEGIN
      CREATE INDEX idx_student_contact_logs_student_date
      ON student_contact_logs (student_id, contact_date DESC, created_at DESC);
    EXCEPTION
      WHEN duplicate_table THEN NULL;
      WHEN duplicate_object THEN NULL;
    END $$;
  `);
  await sql(`
    DO $$
    BEGIN
      CREATE INDEX idx_student_contact_logs_created_at
      ON student_contact_logs (created_at DESC);
    EXCEPTION
      WHEN duplicate_table THEN NULL;
      WHEN duplicate_object THEN NULL;
    END $$;
  `);

  await sql(`
    DO $$
    BEGIN
      CREATE TABLE student_events (
        id TEXT PRIMARY KEY,
        student_id TEXT NOT NULL,
        event_type TEXT NOT NULL,
        custom_event_label TEXT,
        note_text TEXT,
        hebrew_day INTEGER NOT NULL,
        hebrew_month_code TEXT NOT NULL,
        created_by_user_id TEXT REFERENCES app_users(clerk_user_id),
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    EXCEPTION
      WHEN duplicate_table THEN NULL;
      WHEN duplicate_object THEN NULL;
    END $$;
  `);

  await sql`ALTER TABLE student_events ADD COLUMN IF NOT EXISTS custom_event_label TEXT`;
  await sql`ALTER TABLE student_events ADD COLUMN IF NOT EXISTS note_text TEXT`;
  await sql`ALTER TABLE student_events ADD COLUMN IF NOT EXISTS created_by_user_id TEXT`;
  await sql`ALTER TABLE student_events ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ`;
  await sql`ALTER TABLE student_events ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ`;
  await sql`UPDATE student_events SET created_at = COALESCE(created_at, NOW())`;
  await sql`UPDATE student_events SET updated_at = COALESCE(updated_at, created_at, NOW())`;
  await sql(`
    DO $$
    BEGIN
      CREATE INDEX idx_student_events_student_id
      ON student_events (student_id, created_at DESC);
    EXCEPTION
      WHEN duplicate_table THEN NULL;
      WHEN duplicate_object THEN NULL;
    END $$;
  `);
  await sql(`
    DO $$
    BEGIN
      CREATE INDEX idx_student_events_hebrew_date
      ON student_events (hebrew_month_code, hebrew_day);
    EXCEPTION
      WHEN duplicate_table THEN NULL;
      WHEN duplicate_object THEN NULL;
    END $$;
  `);

  await sql`
    CREATE TABLE IF NOT EXISTS saved_student_views (
      id TEXT PRIMARY KEY,
      owner_user_id TEXT NOT NULL,
      name TEXT NOT NULL,
      folder_name TEXT,
      query_string TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;

  await sql`ALTER TABLE saved_student_views ADD COLUMN IF NOT EXISTS folder_name TEXT`;

  await sql`
    CREATE TABLE IF NOT EXISTS neon_user_preferences (
      owner_user_id TEXT PRIMARY KEY REFERENCES app_users(clerk_user_id) ON DELETE CASCADE,
      query_string TEXT NOT NULL DEFAULT '',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS neon_students (
      student_id TEXT PRIMARY KEY,
      full_name TEXT NOT NULL,
      first_name TEXT,
      last_name TEXT,
      tznum TEXT,
      class TEXT,
      current_institution TEXT,
      registration TEXT,
      primary_email TEXT,
      father_email TEXT,
      mother_email TEXT,
      student_phone TEXT,
      father_phone TEXT,
      mother_phone TEXT,
      age_years INTEGER,
      children_count INTEGER,
      payload JSONB NOT NULL,
      synced_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;

  await sql`ALTER TABLE neon_students ADD COLUMN IF NOT EXISTS age_years INTEGER`;
  await sql`ALTER TABLE neon_students ADD COLUMN IF NOT EXISTS children_count INTEGER`;
  await sql`CREATE INDEX IF NOT EXISTS idx_neon_students_full_name ON neon_students (full_name)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_neon_students_tznum ON neon_students (tznum)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_neon_students_institution ON neon_students (current_institution)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_neon_students_class ON neon_students (class)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_neon_students_primary_email ON neon_students (primary_email)`;

  await sql`
    CREATE TABLE IF NOT EXISTS api_tokens (
      id TEXT PRIMARY KEY,
      label TEXT NOT NULL,
      token_prefix TEXT NOT NULL,
      token_hash TEXT NOT NULL UNIQUE,
      scopes TEXT[] NOT NULL DEFAULT ARRAY['students:read'],
      created_by_user_id TEXT REFERENCES app_users(clerk_user_id),
      last_used_at TIMESTAMPTZ,
      revoked_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;

  await sql`CREATE INDEX IF NOT EXISTS idx_api_tokens_prefix ON api_tokens (token_prefix)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_api_tokens_revoked_at ON api_tokens (revoked_at)`;

  await sql`
    CREATE TABLE IF NOT EXISTS print_jobs (
      id TEXT PRIMARY KEY,
      file_name TEXT NOT NULL,
      content_type TEXT NOT NULL,
      file_size_bytes INTEGER NOT NULL,
      copies INTEGER NOT NULL DEFAULT 1,
      file_base64 TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      uploaded_by_user_id TEXT REFERENCES app_users(clerk_user_id),
      claimed_by_token_id TEXT REFERENCES api_tokens(id),
      claimed_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;
  await sql`ALTER TABLE print_jobs ADD COLUMN IF NOT EXISTS file_name TEXT`;
  await sql`ALTER TABLE print_jobs ADD COLUMN IF NOT EXISTS content_type TEXT`;
  await sql`ALTER TABLE print_jobs ADD COLUMN IF NOT EXISTS file_size_bytes INTEGER`;
  await sql`ALTER TABLE print_jobs ADD COLUMN IF NOT EXISTS copies INTEGER NOT NULL DEFAULT 1`;
  await sql`ALTER TABLE print_jobs ADD COLUMN IF NOT EXISTS file_base64 TEXT`;
  await sql`ALTER TABLE print_jobs ADD COLUMN IF NOT EXISTS status TEXT`;
  await sql`ALTER TABLE print_jobs ADD COLUMN IF NOT EXISTS uploaded_by_user_id TEXT`;
  await sql`ALTER TABLE print_jobs ADD COLUMN IF NOT EXISTS claimed_by_token_id TEXT`;
  await sql`ALTER TABLE print_jobs ADD COLUMN IF NOT EXISTS claimed_at TIMESTAMPTZ`;
  await sql`ALTER TABLE print_jobs ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ`;
  await sql`UPDATE print_jobs SET status = COALESCE(NULLIF(status, ''), 'pending')`;
  await sql`UPDATE print_jobs SET copies = GREATEST(1, LEAST(99, COALESCE(copies, 1)))`;
  await sql`UPDATE print_jobs SET content_type = COALESCE(NULLIF(content_type, ''), 'application/octet-stream')`;
  await sql`UPDATE print_jobs SET created_at = COALESCE(created_at, NOW())`;
  await sql`CREATE INDEX IF NOT EXISTS idx_print_jobs_status_created ON print_jobs (status, created_at)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_print_jobs_uploaded_by ON print_jobs (uploaded_by_user_id)`;

  await sql`
    CREATE TABLE IF NOT EXISTS attendance_sessions (
      id TEXT PRIMARY KEY,
      institution TEXT NOT NULL,
      session_type TEXT,
      title TEXT,
      session_date DATE NOT NULL,
      source_note TEXT,
      institution_filter TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
      class_filter TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
      registration_filter TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
      family_status_filter TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
      is_locked BOOLEAN NOT NULL DEFAULT FALSE,
      locked_at TIMESTAMPTZ,
      locked_by_user_id TEXT REFERENCES app_users(clerk_user_id),
      created_by_user_id TEXT REFERENCES app_users(clerk_user_id),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;
  await sql`ALTER TABLE attendance_sessions ADD COLUMN IF NOT EXISTS session_type TEXT`;
  await sql`ALTER TABLE attendance_sessions ADD COLUMN IF NOT EXISTS title TEXT`;
  await sql`ALTER TABLE attendance_sessions ADD COLUMN IF NOT EXISTS source_note TEXT`;
  await sql`ALTER TABLE attendance_sessions ADD COLUMN IF NOT EXISTS email_subject TEXT`;
  await sql`ALTER TABLE attendance_sessions ADD COLUMN IF NOT EXISTS personal_message TEXT`;
  await sql`ALTER TABLE attendance_sessions ADD COLUMN IF NOT EXISTS custom_statuses JSONB NOT NULL DEFAULT '[]'::jsonb`;
  await sql`ALTER TABLE attendance_sessions ADD COLUMN IF NOT EXISTS email_response_statuses TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[]`;
  await sql`ALTER TABLE attendance_sessions ADD COLUMN IF NOT EXISTS email_recipient_roles TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[]`;
  await sql`ALTER TABLE attendance_sessions ADD COLUMN IF NOT EXISTS institution_filter TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[]`;
  await sql`ALTER TABLE attendance_sessions ADD COLUMN IF NOT EXISTS class_filter TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[]`;
  await sql`ALTER TABLE attendance_sessions ADD COLUMN IF NOT EXISTS registration_filter TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[]`;
  await sql`ALTER TABLE attendance_sessions ADD COLUMN IF NOT EXISTS family_status_filter TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[]`;
  await sql`ALTER TABLE attendance_sessions ADD COLUMN IF NOT EXISTS is_locked BOOLEAN NOT NULL DEFAULT FALSE`;
  await sql`ALTER TABLE attendance_sessions ADD COLUMN IF NOT EXISTS locked_at TIMESTAMPTZ`;
  await sql`ALTER TABLE attendance_sessions ADD COLUMN IF NOT EXISTS locked_by_user_id TEXT`;
  await sql`ALTER TABLE attendance_sessions ADD COLUMN IF NOT EXISTS created_by_user_id TEXT`;
  await sql`ALTER TABLE attendance_sessions ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ`;
  await sql`ALTER TABLE attendance_sessions ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ`;
  await sql`
    UPDATE attendance_sessions
    SET session_type = CASE
      WHEN session_type = 'seder_b' THEN 'seder_b_part_a'
      WHEN session_type IS NOT NULL AND session_type <> '' THEN session_type
      WHEN title = 'שחרית' THEN 'shacharit'
      WHEN title = 'סדר א' THEN 'seder_a'
      WHEN title = 'מנחה' THEN 'mincha'
      WHEN title = 'סדר ב' THEN 'seder_b_part_a'
      WHEN title = 'סדר ב חלק א' THEN 'seder_b_part_a'
      WHEN title = 'סדר ב חלק ב' THEN 'seder_b_part_b'
      WHEN title = 'סדר ג' THEN 'seder_g'
      WHEN title = 'מעריב' THEN 'maariv'
      WHEN title = 'מפגש מנהל' THEN 'manager_default'
      ELSE NULL
    END
  `;
  await sql`UPDATE attendance_sessions SET institution_filter = COALESCE(institution_filter, ARRAY[]::TEXT[])`;
  await sql`UPDATE attendance_sessions SET personal_message = COALESCE(personal_message, '')`;
  await sql`UPDATE attendance_sessions SET email_subject = COALESCE(email_subject, '')`;
  await sql`UPDATE attendance_sessions SET custom_statuses = COALESCE(custom_statuses, '[]'::jsonb)`;
  await sql`UPDATE attendance_sessions SET email_response_statuses = COALESCE(email_response_statuses, ARRAY[]::TEXT[])`;
  await sql`UPDATE attendance_sessions SET email_recipient_roles = COALESCE(email_recipient_roles, ARRAY['father','mother','student']::TEXT[])`;
  await sql`UPDATE attendance_sessions SET class_filter = COALESCE(class_filter, ARRAY[]::TEXT[])`;
  await sql`UPDATE attendance_sessions SET registration_filter = COALESCE(registration_filter, ARRAY[]::TEXT[])`;
  await sql`UPDATE attendance_sessions SET family_status_filter = COALESCE(family_status_filter, ARRAY[]::TEXT[])`;
  await sql`UPDATE attendance_sessions SET is_locked = COALESCE(is_locked, FALSE)`;
  await sql`UPDATE attendance_sessions SET created_at = COALESCE(created_at, NOW())`;
  await sql`UPDATE attendance_sessions SET updated_at = COALESCE(updated_at, created_at, NOW())`;
  await sql`CREATE INDEX IF NOT EXISTS idx_attendance_sessions_institution_date ON attendance_sessions (institution, session_date DESC)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_attendance_sessions_created_at ON attendance_sessions (created_at DESC)`;

  await sql`
    CREATE TABLE IF NOT EXISTS attendance_email_response_tokens (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL REFERENCES attendance_sessions(id) ON DELETE CASCADE,
      student_id TEXT NOT NULL,
      recipient_email TEXT NOT NULL,
      recipient_name TEXT,
      recipient_role TEXT,
      status TEXT NOT NULL,
      created_by_user_id TEXT REFERENCES app_users(clerk_user_id),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      used_at TIMESTAMPTZ
    )
  `;
  await sql`ALTER TABLE attendance_email_response_tokens ADD COLUMN IF NOT EXISTS recipient_name TEXT`;
  await sql`ALTER TABLE attendance_email_response_tokens ADD COLUMN IF NOT EXISTS recipient_role TEXT`;
  await sql`ALTER TABLE attendance_email_response_tokens ADD COLUMN IF NOT EXISTS created_by_user_id TEXT`;
  await sql`ALTER TABLE attendance_email_response_tokens ADD COLUMN IF NOT EXISTS used_at TIMESTAMPTZ`;
  await sql`CREATE INDEX IF NOT EXISTS idx_attendance_email_tokens_session ON attendance_email_response_tokens (session_id, student_id)`;

  await sql`
    CREATE TABLE IF NOT EXISTS attendance_records (
      session_id TEXT NOT NULL REFERENCES attendance_sessions(id) ON DELETE CASCADE,
      student_id TEXT NOT NULL,
      student_name TEXT NOT NULL,
      student_class TEXT,
      status TEXT NOT NULL DEFAULT 'missing',
      note_text TEXT,
      marked_by_user_id TEXT REFERENCES app_users(clerk_user_id),
      marked_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (session_id, student_id)
    )
  `;
  await sql`ALTER TABLE attendance_records ADD COLUMN IF NOT EXISTS student_name TEXT`;
  await sql`ALTER TABLE attendance_records ADD COLUMN IF NOT EXISTS student_class TEXT`;
  await sql`ALTER TABLE attendance_records ADD COLUMN IF NOT EXISTS status TEXT`;
  await sql`ALTER TABLE attendance_records ADD COLUMN IF NOT EXISTS note_text TEXT`;
  await sql`ALTER TABLE attendance_records ADD COLUMN IF NOT EXISTS marked_by_user_id TEXT`;
  await sql`ALTER TABLE attendance_records ADD COLUMN IF NOT EXISTS marked_at TIMESTAMPTZ`;
  await sql`ALTER TABLE attendance_records ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ`;
  await sql`ALTER TABLE attendance_records ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ`;
  await sql`ALTER TABLE attendance_records ALTER COLUMN status SET DEFAULT 'missing'`;
  await sql`
    UPDATE attendance_records
    SET status = CASE
      WHEN status IS NULL OR status = '' THEN 'missing'
      WHEN status = 'present' THEN 'found'
      WHEN status = 'absent' THEN 'missing'
      WHEN status = 'excused' THEN 'missing'
      WHEN status = 'left_early' THEN 'available'
      WHEN status = 'late' THEN 'on_the_way'
      WHEN status = 'sent_home' THEN 'available'
      ELSE status
    END
  `;
  await sql`UPDATE attendance_records SET created_at = COALESCE(created_at, NOW())`;
  await sql`UPDATE attendance_records SET updated_at = COALESCE(updated_at, created_at, NOW())`;
  await sql`UPDATE attendance_records SET marked_at = COALESCE(marked_at, updated_at, created_at, NOW())`;
  await sql`CREATE INDEX IF NOT EXISTS idx_attendance_records_session ON attendance_records (session_id)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_attendance_records_student ON attendance_records (student_id)`;

  await sql`
    CREATE TABLE IF NOT EXISTS email_campaigns (
      id TEXT PRIMARY KEY,
      subject TEXT NOT NULL,
      body_text TEXT,
      body_html TEXT,
      sender_name TEXT,
      institution TEXT,
      class_filter TEXT,
      recipient_mode TEXT NOT NULL,
      send_scope TEXT NOT NULL DEFAULT 'selected',
      include_greeting BOOLEAN NOT NULL DEFAULT TRUE,
      status TEXT NOT NULL DEFAULT 'draft',
      total_recipients INTEGER NOT NULL DEFAULT 0,
      sent_count INTEGER NOT NULL DEFAULT 0,
      failed_count INTEGER NOT NULL DEFAULT 0,
      opened_count INTEGER NOT NULL DEFAULT 0,
      filter_json JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_by_user_id TEXT REFERENCES app_users(clerk_user_id),
      locked_at TIMESTAMPTZ,
      sent_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;
  await sql`ALTER TABLE email_campaigns ADD COLUMN IF NOT EXISTS body_text TEXT`;
  await sql`ALTER TABLE email_campaigns ADD COLUMN IF NOT EXISTS body_html TEXT`;
  await sql`ALTER TABLE email_campaigns ADD COLUMN IF NOT EXISTS institution TEXT`;
  await sql`ALTER TABLE email_campaigns ADD COLUMN IF NOT EXISTS class_filter TEXT`;
  await sql`ALTER TABLE email_campaigns ADD COLUMN IF NOT EXISTS send_scope TEXT`;
  await sql`ALTER TABLE email_campaigns ADD COLUMN IF NOT EXISTS include_greeting BOOLEAN`;
  await sql`ALTER TABLE email_campaigns ADD COLUMN IF NOT EXISTS status TEXT`;
  await sql`ALTER TABLE email_campaigns ADD COLUMN IF NOT EXISTS total_recipients INTEGER`;
  await sql`ALTER TABLE email_campaigns ADD COLUMN IF NOT EXISTS sent_count INTEGER`;
  await sql`ALTER TABLE email_campaigns ADD COLUMN IF NOT EXISTS failed_count INTEGER`;
  await sql`ALTER TABLE email_campaigns ADD COLUMN IF NOT EXISTS opened_count INTEGER`;
  await sql`ALTER TABLE email_campaigns ADD COLUMN IF NOT EXISTS locked_at TIMESTAMPTZ`;
  await sql`ALTER TABLE email_campaigns ADD COLUMN IF NOT EXISTS sent_at TIMESTAMPTZ`;
  await sql`ALTER TABLE email_campaigns ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ`;
  await sql`UPDATE email_campaigns SET send_scope = COALESCE(NULLIF(send_scope, ''), 'selected')`;
  await sql`UPDATE email_campaigns SET include_greeting = COALESCE(include_greeting, TRUE)`;
  await sql`UPDATE email_campaigns SET status = COALESCE(NULLIF(status, ''), 'draft')`;
  await sql`UPDATE email_campaigns SET total_recipients = COALESCE(total_recipients, 0)`;
  await sql`UPDATE email_campaigns SET sent_count = COALESCE(sent_count, 0)`;
  await sql`UPDATE email_campaigns SET failed_count = COALESCE(failed_count, 0)`;
  await sql`UPDATE email_campaigns SET opened_count = COALESCE(opened_count, 0)`;

  await sql`CREATE INDEX IF NOT EXISTS idx_email_campaigns_created_at ON email_campaigns (created_at DESC)`;

  await sql`
    CREATE TABLE IF NOT EXISTS email_campaign_drafts (
      id TEXT PRIMARY KEY,
      created_by_user_id TEXT REFERENCES app_users(clerk_user_id),
      draft_json JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;
  await sql`ALTER TABLE email_campaign_drafts ADD COLUMN IF NOT EXISTS draft_json JSONB NOT NULL DEFAULT '{}'::jsonb`;
  await sql`ALTER TABLE email_campaign_drafts ADD COLUMN IF NOT EXISTS created_by_user_id TEXT`;
  await sql`ALTER TABLE email_campaign_drafts ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ`;
  await sql`ALTER TABLE email_campaign_drafts ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ`;
  await sql`ALTER TABLE email_campaign_drafts ADD COLUMN IF NOT EXISTS final_send_started_at TIMESTAMPTZ`;
  await sql`ALTER TABLE email_campaign_drafts ADD COLUMN IF NOT EXISTS final_send_completed_at TIMESTAMPTZ`;
  await sql`ALTER TABLE email_campaign_drafts ADD COLUMN IF NOT EXISTS sent_campaign_id TEXT`;
  await sql`UPDATE email_campaign_drafts SET created_at = COALESCE(created_at, NOW())`;
  await sql`UPDATE email_campaign_drafts SET updated_at = COALESCE(updated_at, created_at, NOW())`;
  await sql`CREATE INDEX IF NOT EXISTS idx_email_campaign_drafts_created_at ON email_campaign_drafts (created_at DESC)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_email_campaign_drafts_user_created_at ON email_campaign_drafts (created_by_user_id, created_at DESC)`;

  await sql`
    CREATE TABLE IF NOT EXISTS email_campaign_favorites (
      clerk_user_id TEXT NOT NULL REFERENCES app_users(clerk_user_id) ON DELETE CASCADE,
      campaign_id TEXT NOT NULL REFERENCES email_campaigns(id) ON DELETE CASCADE,
      label TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (clerk_user_id, campaign_id)
    )
  `;
  await sql`ALTER TABLE email_campaign_favorites ADD COLUMN IF NOT EXISTS label TEXT`;
  await sql`ALTER TABLE email_campaign_favorites ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ`;
  await sql`ALTER TABLE email_campaign_favorites ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ`;
  await sql`UPDATE email_campaign_favorites SET created_at = COALESCE(created_at, NOW())`;
  await sql`UPDATE email_campaign_favorites SET updated_at = COALESCE(updated_at, created_at, NOW())`;
  await sql`CREATE INDEX IF NOT EXISTS idx_email_campaign_favorites_user_created_at ON email_campaign_favorites (clerk_user_id, created_at DESC)`;

  await sql`
    CREATE TABLE IF NOT EXISTS email_unsubscribes (
      recipient_email TEXT PRIMARY KEY,
      source_delivery_id TEXT,
      source_campaign_id TEXT,
      recipient_name TEXT,
      reason_text TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;
  await sql`ALTER TABLE email_unsubscribes ADD COLUMN IF NOT EXISTS source_delivery_id TEXT`;
  await sql`ALTER TABLE email_unsubscribes ADD COLUMN IF NOT EXISTS source_campaign_id TEXT`;
  await sql`ALTER TABLE email_unsubscribes ADD COLUMN IF NOT EXISTS recipient_name TEXT`;
  await sql`ALTER TABLE email_unsubscribes ADD COLUMN IF NOT EXISTS reason_text TEXT`;
  await sql`ALTER TABLE email_unsubscribes ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ`;
  await sql`ALTER TABLE email_unsubscribes ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ`;
  await sql`UPDATE email_unsubscribes SET created_at = COALESCE(created_at, NOW())`;
  await sql`UPDATE email_unsubscribes SET updated_at = COALESCE(updated_at, created_at, NOW())`;
  await sql`CREATE INDEX IF NOT EXISTS idx_email_unsubscribes_created_at ON email_unsubscribes (created_at DESC)`;

  await sql`
    CREATE TABLE IF NOT EXISTS email_deliveries (
      id TEXT PRIMARY KEY,
      campaign_id TEXT REFERENCES email_campaigns(id) ON DELETE CASCADE,
      student_id TEXT,
      student_name TEXT,
      recipient_role TEXT NOT NULL,
      recipient_email TEXT NOT NULL,
      subject TEXT NOT NULL,
      sender_name TEXT,
      related_student_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
      related_student_names JSONB NOT NULL DEFAULT '[]'::jsonb,
      recipient_name TEXT,
      personalized_greeting TEXT,
      idempotency_key TEXT,
      certainty_level INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'queued',
      provider_message_id TEXT,
      error_message TEXT,
      open_count INTEGER NOT NULL DEFAULT 0,
      opened_at TIMESTAMPTZ,
      clicked_at TIMESTAMPTZ,
      sent_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;
  await sql`ALTER TABLE email_deliveries ADD COLUMN IF NOT EXISTS sender_name TEXT`;
  await sql`ALTER TABLE email_deliveries ADD COLUMN IF NOT EXISTS related_student_ids JSONB NOT NULL DEFAULT '[]'::jsonb`;
  await sql`ALTER TABLE email_deliveries ADD COLUMN IF NOT EXISTS related_student_names JSONB NOT NULL DEFAULT '[]'::jsonb`;
  await sql`ALTER TABLE email_deliveries ADD COLUMN IF NOT EXISTS recipient_name TEXT`;
  await sql`ALTER TABLE email_deliveries ADD COLUMN IF NOT EXISTS personalized_greeting TEXT`;
  await sql`ALTER TABLE email_deliveries ADD COLUMN IF NOT EXISTS body_text TEXT`;
  await sql`ALTER TABLE email_deliveries ADD COLUMN IF NOT EXISTS body_html TEXT`;
  await sql`ALTER TABLE email_deliveries ADD COLUMN IF NOT EXISTS idempotency_key TEXT`;
  await sql`ALTER TABLE email_deliveries ADD COLUMN IF NOT EXISTS open_count INTEGER`;
  await sql`UPDATE email_deliveries SET open_count = COALESCE(open_count, 0)`;

  await sql`CREATE INDEX IF NOT EXISTS idx_email_deliveries_campaign_id ON email_deliveries (campaign_id)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_email_deliveries_student_id ON email_deliveries (student_id)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_email_deliveries_recipient_email ON email_deliveries (recipient_email)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_email_deliveries_created_at ON email_deliveries (created_at DESC)`;
  await sql`CREATE UNIQUE INDEX IF NOT EXISTS idx_email_deliveries_campaign_email_unique ON email_deliveries (campaign_id, recipient_email)`;
  await sql`CREATE UNIQUE INDEX IF NOT EXISTS idx_email_deliveries_idempotency_key_unique ON email_deliveries (idempotency_key) WHERE idempotency_key IS NOT NULL`;

  await sql`
    CREATE TABLE IF NOT EXISTS deleted_students (
      student_id TEXT PRIMARY KEY,
      student_name TEXT NOT NULL,
      deleted_by_user_id TEXT REFERENCES app_users(clerk_user_id),
      snapshot_json JSONB NOT NULL DEFAULT '{}'::jsonb,
      deleted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      delete_after_at TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '30 days')
    )
  `;
  await sql`ALTER TABLE deleted_students ADD COLUMN IF NOT EXISTS student_name TEXT`;
  await sql`ALTER TABLE deleted_students ADD COLUMN IF NOT EXISTS deleted_by_user_id TEXT`;
  await sql`ALTER TABLE deleted_students ADD COLUMN IF NOT EXISTS snapshot_json JSONB NOT NULL DEFAULT '{}'::jsonb`;
  await sql`ALTER TABLE deleted_students ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ`;
  await sql`ALTER TABLE deleted_students ADD COLUMN IF NOT EXISTS delete_after_at TIMESTAMPTZ`;
  await sql`UPDATE deleted_students SET deleted_at = COALESCE(deleted_at, NOW())`;
  await sql`UPDATE deleted_students SET delete_after_at = COALESCE(delete_after_at, deleted_at + INTERVAL '30 days', NOW() + INTERVAL '30 days')`;
  await sql`CREATE INDEX IF NOT EXISTS idx_deleted_students_delete_after_at ON deleted_students (delete_after_at)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_deleted_students_deleted_at ON deleted_students (deleted_at DESC)`;

  await sql`
    CREATE TABLE IF NOT EXISTS ai_chat_messages (
      id TEXT PRIMARY KEY,
      clerk_user_id TEXT NOT NULL REFERENCES app_users(clerk_user_id) ON DELETE CASCADE,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;

  await sql`CREATE INDEX IF NOT EXISTS idx_ai_chat_messages_user_created_at ON ai_chat_messages (clerk_user_id, created_at DESC)`;

  await sql`
    CREATE TABLE IF NOT EXISTS ai_chat_message_feedback (
      message_id TEXT PRIMARY KEY REFERENCES ai_chat_messages(id) ON DELETE CASCADE,
      clerk_user_id TEXT NOT NULL REFERENCES app_users(clerk_user_id) ON DELETE CASCADE,
      feedback TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;

  await sql`CREATE INDEX IF NOT EXISTS idx_ai_chat_feedback_user_updated_at ON ai_chat_message_feedback (clerk_user_id, updated_at DESC)`;

  await sql`
    CREATE TABLE IF NOT EXISTS telegram_user_links (
      clerk_user_id TEXT PRIMARY KEY REFERENCES app_users(clerk_user_id) ON DELETE CASCADE,
      telegram_chat_id TEXT NOT NULL UNIQUE,
      telegram_user_id TEXT,
      telegram_username TEXT,
      is_active BOOLEAN NOT NULL DEFAULT TRUE,
      linked_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;

  await sql`CREATE INDEX IF NOT EXISTS idx_telegram_user_links_chat_id ON telegram_user_links (telegram_chat_id)`;

  await sql`
    CREATE TABLE IF NOT EXISTS telegram_link_codes (
      code TEXT PRIMARY KEY,
      clerk_user_id TEXT NOT NULL REFERENCES app_users(clerk_user_id) ON DELETE CASCADE,
      expires_at TIMESTAMPTZ NOT NULL,
      used_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;

  await sql`CREATE INDEX IF NOT EXISTS idx_telegram_link_codes_user_created_at ON telegram_link_codes (clerk_user_id, created_at DESC)`;

  await sql`
    CREATE TABLE IF NOT EXISTS scheduled_job_runs (
      job_name TEXT NOT NULL,
      job_key TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'started',
      details_json JSONB NOT NULL DEFAULT '{}'::jsonb,
      started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      completed_at TIMESTAMPTZ,
      PRIMARY KEY (job_name, job_key)
    )
  `;

  await sql`CREATE INDEX IF NOT EXISTS idx_scheduled_job_runs_started_at ON scheduled_job_runs (started_at DESC)`;

  await sql`
    CREATE TABLE IF NOT EXISTS whatsapp_user_links (
      clerk_user_id TEXT PRIMARY KEY REFERENCES app_users(clerk_user_id) ON DELETE CASCADE,
      whatsapp_wa_id TEXT NOT NULL UNIQUE,
      phone_number TEXT,
      profile_name TEXT,
      is_active BOOLEAN NOT NULL DEFAULT TRUE,
      linked_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;

  await sql`CREATE INDEX IF NOT EXISTS idx_whatsapp_user_links_wa_id ON whatsapp_user_links (whatsapp_wa_id)`;

  await sql`
    CREATE TABLE IF NOT EXISTS whatsapp_link_codes (
      code TEXT PRIMARY KEY,
      clerk_user_id TEXT NOT NULL REFERENCES app_users(clerk_user_id) ON DELETE CASCADE,
      expires_at TIMESTAMPTZ NOT NULL,
      used_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;

  await sql`CREATE INDEX IF NOT EXISTS idx_whatsapp_link_codes_user_created_at ON whatsapp_link_codes (clerk_user_id, created_at DESC)`;

  await sql`
    CREATE TABLE IF NOT EXISTS whatsapp_inbound_events (
      id TEXT PRIMARY KEY,
      message_id TEXT,
      whatsapp_wa_id TEXT,
      phone_number_id TEXT,
      display_phone_number TEXT,
      profile_name TEXT,
      message_type TEXT,
      text_preview TEXT,
      processing_status TEXT NOT NULL DEFAULT 'received',
      clerk_user_id TEXT REFERENCES app_users(clerk_user_id) ON DELETE SET NULL,
      payload JSONB NOT NULL DEFAULT '{}'::jsonb,
      response_text TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;

  await sql`CREATE INDEX IF NOT EXISTS idx_whatsapp_inbound_events_created_at ON whatsapp_inbound_events (created_at DESC)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_whatsapp_inbound_events_wa_id ON whatsapp_inbound_events (whatsapp_wa_id)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_whatsapp_inbound_events_message_id ON whatsapp_inbound_events (message_id)`;

  await sql`
    CREATE TABLE IF NOT EXISTS student_documents (
      id TEXT PRIMARY KEY,
      student_id TEXT NOT NULL,
      display_name TEXT NOT NULL,
      file_name TEXT NOT NULL,
      note_text TEXT,
      content_type TEXT NOT NULL,
      object_key TEXT NOT NULL UNIQUE,
      size_bytes INTEGER,
      document_kind TEXT NOT NULL DEFAULT 'general',
      uploaded_by_user_id TEXT REFERENCES app_users(clerk_user_id),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;

  await sql`ALTER TABLE student_documents ADD COLUMN IF NOT EXISTS display_name TEXT`;
  await sql`ALTER TABLE student_documents ADD COLUMN IF NOT EXISTS note_text TEXT`;
  await sql`UPDATE student_documents SET display_name = COALESCE(NULLIF(display_name, ''), file_name)`;

  await sql`CREATE INDEX IF NOT EXISTS idx_student_documents_student_id_created_at ON student_documents (student_id, created_at DESC)`;

  await sql`
    CREATE TABLE IF NOT EXISTS import_sessions (
      id TEXT PRIMARY KEY,
      created_by_user_id TEXT REFERENCES app_users(clerk_user_id),
      file_name TEXT NOT NULL,
      headers JSONB NOT NULL,
      rows JSONB NOT NULL,
      status TEXT NOT NULL DEFAULT 'draft',
      match_mapping_json JSONB,
      field_mapping_json JSONB,
      progress_json JSONB,
      started_at TIMESTAMPTZ,
      result_json JSONB,
      completed_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;
  await sql`ALTER TABLE import_sessions ADD COLUMN IF NOT EXISTS status TEXT`;
  await sql`ALTER TABLE import_sessions ADD COLUMN IF NOT EXISTS match_mapping_json JSONB`;
  await sql`ALTER TABLE import_sessions ADD COLUMN IF NOT EXISTS field_mapping_json JSONB`;
  await sql`ALTER TABLE import_sessions ADD COLUMN IF NOT EXISTS progress_json JSONB`;
  await sql`ALTER TABLE import_sessions ADD COLUMN IF NOT EXISTS started_at TIMESTAMPTZ`;
  await sql`ALTER TABLE import_sessions ADD COLUMN IF NOT EXISTS result_json JSONB`;
  await sql`ALTER TABLE import_sessions ADD COLUMN IF NOT EXISTS completed_at TIMESTAMPTZ`;
  await sql`UPDATE import_sessions SET status = COALESCE(NULLIF(status, ''), 'draft')`;

  await sql`CREATE INDEX IF NOT EXISTS idx_import_sessions_created_by ON import_sessions (created_by_user_id)`;

  await sql`
    CREATE TABLE IF NOT EXISTS announcement_templates (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      header_text TEXT,
      footer_text TEXT,
      blank_object_key TEXT,
      blank_content_type TEXT,
      layout_json JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_by_user_id TEXT REFERENCES app_users(clerk_user_id),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;

  await sql`CREATE INDEX IF NOT EXISTS idx_announcement_templates_name ON announcement_templates (name)`;

  await sql`
    CREATE TABLE IF NOT EXISTS announcements (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      announcement_date DATE,
      body_text TEXT NOT NULL,
      body_html TEXT,
      layout_override_json JSONB NOT NULL DEFAULT '{}'::jsonb,
      template_id TEXT NOT NULL REFERENCES announcement_templates(id) ON DELETE RESTRICT,
      created_by_user_id TEXT REFERENCES app_users(clerk_user_id),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;

  await sql`ALTER TABLE announcements ADD COLUMN IF NOT EXISTS body_html TEXT`;
  await sql`ALTER TABLE announcements ADD COLUMN IF NOT EXISTS layout_override_json JSONB NOT NULL DEFAULT '{}'::jsonb`;
  await sql`CREATE INDEX IF NOT EXISTS idx_announcements_template_id ON announcements (template_id)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_announcements_title ON announcements (title)`;

    initialized = true;
    } finally {
      await sql`SELECT pg_advisory_unlock(84732651)`;
    }
  })();

  try {
    await initializationPromise;
  } finally {
    initializationPromise = null;
  }
}
