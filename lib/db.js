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
    CREATE TABLE IF NOT EXISTS crm_people (
      id TEXT PRIMARY KEY,
      source_key TEXT UNIQUE,
      canonical_name TEXT NOT NULL DEFAULT '',
      first_name TEXT,
      last_name TEXT,
      hebrew_name TEXT,
      government_id TEXT,
      birth_date DATE,
      primary_email TEXT,
      primary_phone TEXT,
      source_student_id TEXT,
      raw_data JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;
  await sql`ALTER TABLE crm_people ADD COLUMN IF NOT EXISTS source_key TEXT`;
  await sql`ALTER TABLE crm_people ADD COLUMN IF NOT EXISTS canonical_name TEXT`;
  await sql`ALTER TABLE crm_people ADD COLUMN IF NOT EXISTS first_name TEXT`;
  await sql`ALTER TABLE crm_people ADD COLUMN IF NOT EXISTS last_name TEXT`;
  await sql`ALTER TABLE crm_people ADD COLUMN IF NOT EXISTS hebrew_name TEXT`;
  await sql`ALTER TABLE crm_people ADD COLUMN IF NOT EXISTS government_id TEXT`;
  await sql`ALTER TABLE crm_people ADD COLUMN IF NOT EXISTS birth_date DATE`;
  await sql`ALTER TABLE crm_people ADD COLUMN IF NOT EXISTS primary_email TEXT`;
  await sql`ALTER TABLE crm_people ADD COLUMN IF NOT EXISTS primary_phone TEXT`;
  await sql`ALTER TABLE crm_people ADD COLUMN IF NOT EXISTS source_student_id TEXT`;
  await sql`ALTER TABLE crm_people ADD COLUMN IF NOT EXISTS raw_data JSONB`;
  await sql`ALTER TABLE crm_people ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ`;
  await sql`ALTER TABLE crm_people ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ`;
  await sql`UPDATE crm_people SET canonical_name = COALESCE(NULLIF(canonical_name, ''), '')`;
  await sql`UPDATE crm_people SET raw_data = COALESCE(raw_data, '{}'::jsonb)`;
  await sql`UPDATE crm_people SET created_at = COALESCE(created_at, NOW())`;
  await sql`UPDATE crm_people SET updated_at = COALESCE(updated_at, created_at, NOW())`;
  await sql`CREATE UNIQUE INDEX IF NOT EXISTS idx_crm_people_source_key ON crm_people (source_key)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_crm_people_government_id ON crm_people (government_id)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_crm_people_primary_email ON crm_people (primary_email)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_crm_people_primary_phone ON crm_people (primary_phone)`;

  await sql`
    CREATE TABLE IF NOT EXISTS crm_person_roles (
      person_id TEXT NOT NULL REFERENCES crm_people(id) ON DELETE CASCADE,
      role_key TEXT NOT NULL,
      source_student_id TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (person_id, role_key)
    )
  `;
  await sql`ALTER TABLE crm_person_roles ADD COLUMN IF NOT EXISTS source_student_id TEXT`;
  await sql`ALTER TABLE crm_person_roles ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ`;
  await sql`UPDATE crm_person_roles SET created_at = COALESCE(created_at, NOW())`;
  await sql`CREATE INDEX IF NOT EXISTS idx_crm_person_roles_role_key ON crm_person_roles (role_key)`;

  await sql`
    CREATE TABLE IF NOT EXISTS crm_person_contacts (
      id TEXT PRIMARY KEY,
      person_id TEXT NOT NULL REFERENCES crm_people(id) ON DELETE CASCADE,
      contact_type TEXT NOT NULL,
      contact_label TEXT,
      contact_value TEXT NOT NULL,
      normalized_value TEXT NOT NULL,
      is_primary BOOLEAN NOT NULL DEFAULT FALSE,
      source_kind TEXT NOT NULL DEFAULT 'manual',
      source_student_id TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (person_id, contact_type, normalized_value)
    )
  `;
  await sql`ALTER TABLE crm_person_contacts ADD COLUMN IF NOT EXISTS contact_label TEXT`;
  await sql`ALTER TABLE crm_person_contacts ADD COLUMN IF NOT EXISTS normalized_value TEXT`;
  await sql`ALTER TABLE crm_person_contacts ADD COLUMN IF NOT EXISTS is_primary BOOLEAN`;
  await sql`ALTER TABLE crm_person_contacts ADD COLUMN IF NOT EXISTS source_kind TEXT`;
  await sql`ALTER TABLE crm_person_contacts ADD COLUMN IF NOT EXISTS source_student_id TEXT`;
  await sql`ALTER TABLE crm_person_contacts ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ`;
  await sql`ALTER TABLE crm_person_contacts ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ`;
  await sql`UPDATE crm_person_contacts SET is_primary = COALESCE(is_primary, FALSE)`;
  await sql`UPDATE crm_person_contacts SET source_kind = COALESCE(NULLIF(source_kind, ''), 'manual')`;
  await sql`UPDATE crm_person_contacts SET created_at = COALESCE(created_at, NOW())`;
  await sql`UPDATE crm_person_contacts SET updated_at = COALESCE(updated_at, created_at, NOW())`;
  await sql`CREATE INDEX IF NOT EXISTS idx_crm_person_contacts_person_id ON crm_person_contacts (person_id)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_crm_person_contacts_type_value ON crm_person_contacts (contact_type, normalized_value)`;

  await sql`
    CREATE TABLE IF NOT EXISTS crm_institutions (
      id TEXT PRIMARY KEY,
      code TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      institution_type TEXT NOT NULL DEFAULT 'yeshiva',
      is_active BOOLEAN NOT NULL DEFAULT TRUE,
      metadata_json JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;
  await sql`ALTER TABLE crm_institutions ADD COLUMN IF NOT EXISTS institution_type TEXT`;
  await sql`ALTER TABLE crm_institutions ADD COLUMN IF NOT EXISTS is_active BOOLEAN`;
  await sql`ALTER TABLE crm_institutions ADD COLUMN IF NOT EXISTS metadata_json JSONB`;
  await sql`ALTER TABLE crm_institutions ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ`;
  await sql`ALTER TABLE crm_institutions ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ`;
  await sql`UPDATE crm_institutions SET institution_type = COALESCE(NULLIF(institution_type, ''), 'yeshiva')`;
  await sql`UPDATE crm_institutions SET is_active = COALESCE(is_active, TRUE)`;
  await sql`UPDATE crm_institutions SET metadata_json = COALESCE(metadata_json, '{}'::jsonb)`;
  await sql`UPDATE crm_institutions SET created_at = COALESCE(created_at, NOW())`;
  await sql`UPDATE crm_institutions SET updated_at = COALESCE(updated_at, created_at, NOW())`;

  await sql`
    CREATE TABLE IF NOT EXISTS crm_student_profiles (
      student_id TEXT PRIMARY KEY,
      person_id TEXT NOT NULL REFERENCES crm_people(id) ON DELETE CASCADE,
      class_code TEXT,
      registration_status TEXT,
      family_status TEXT,
      current_institution_code TEXT,
      source_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
      synced_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;
  await sql`ALTER TABLE crm_student_profiles ADD COLUMN IF NOT EXISTS class_code TEXT`;
  await sql`ALTER TABLE crm_student_profiles ADD COLUMN IF NOT EXISTS registration_status TEXT`;
  await sql`ALTER TABLE crm_student_profiles ADD COLUMN IF NOT EXISTS family_status TEXT`;
  await sql`ALTER TABLE crm_student_profiles ADD COLUMN IF NOT EXISTS current_institution_code TEXT`;
  await sql`ALTER TABLE crm_student_profiles ADD COLUMN IF NOT EXISTS source_payload JSONB`;
  await sql`ALTER TABLE crm_student_profiles ADD COLUMN IF NOT EXISTS synced_at TIMESTAMPTZ`;
  await sql`ALTER TABLE crm_student_profiles ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ`;
  await sql`UPDATE crm_student_profiles SET source_payload = COALESCE(source_payload, '{}'::jsonb)`;
  await sql`UPDATE crm_student_profiles SET synced_at = COALESCE(synced_at, NOW())`;
  await sql`UPDATE crm_student_profiles SET updated_at = COALESCE(updated_at, synced_at, NOW())`;
  await sql`CREATE UNIQUE INDEX IF NOT EXISTS idx_crm_student_profiles_person_id ON crm_student_profiles (person_id)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_crm_student_profiles_institution ON crm_student_profiles (current_institution_code)`;

  await sql`
    CREATE TABLE IF NOT EXISTS crm_person_relationships (
      id TEXT PRIMARY KEY,
      from_person_id TEXT NOT NULL REFERENCES crm_people(id) ON DELETE CASCADE,
      to_person_id TEXT NOT NULL REFERENCES crm_people(id) ON DELETE CASCADE,
      relation_type TEXT NOT NULL,
      confidence_score DOUBLE PRECISION NOT NULL DEFAULT 1,
      match_basis TEXT,
      source_kind TEXT NOT NULL DEFAULT 'manual',
      source_student_id TEXT,
      is_primary BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (from_person_id, to_person_id, relation_type, source_student_id)
    )
  `;
  await sql`ALTER TABLE crm_person_relationships ADD COLUMN IF NOT EXISTS confidence_score DOUBLE PRECISION`;
  await sql`ALTER TABLE crm_person_relationships ADD COLUMN IF NOT EXISTS match_basis TEXT`;
  await sql`ALTER TABLE crm_person_relationships ADD COLUMN IF NOT EXISTS source_kind TEXT`;
  await sql`ALTER TABLE crm_person_relationships ADD COLUMN IF NOT EXISTS source_student_id TEXT`;
  await sql`ALTER TABLE crm_person_relationships ADD COLUMN IF NOT EXISTS is_primary BOOLEAN`;
  await sql`ALTER TABLE crm_person_relationships ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ`;
  await sql`ALTER TABLE crm_person_relationships ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ`;
  await sql`UPDATE crm_person_relationships SET confidence_score = COALESCE(confidence_score, 1)`;
  await sql`UPDATE crm_person_relationships SET source_kind = COALESCE(NULLIF(source_kind, ''), 'manual')`;
  await sql`UPDATE crm_person_relationships SET is_primary = COALESCE(is_primary, TRUE)`;
  await sql`UPDATE crm_person_relationships SET created_at = COALESCE(created_at, NOW())`;
  await sql`UPDATE crm_person_relationships SET updated_at = COALESCE(updated_at, created_at, NOW())`;
  await sql`CREATE INDEX IF NOT EXISTS idx_crm_person_relationships_to_person ON crm_person_relationships (to_person_id, relation_type)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_crm_person_relationships_from_person ON crm_person_relationships (from_person_id, relation_type)`;

  await sql`
    CREATE TABLE IF NOT EXISTS crm_student_institutions (
      id TEXT PRIMARY KEY,
      student_id TEXT NOT NULL REFERENCES crm_student_profiles(student_id) ON DELETE CASCADE,
      institution_id TEXT NOT NULL REFERENCES crm_institutions(id) ON DELETE CASCADE,
      relation_type TEXT NOT NULL DEFAULT 'current',
      is_primary BOOLEAN NOT NULL DEFAULT FALSE,
      source_kind TEXT NOT NULL DEFAULT 'manual',
      source_value TEXT,
      confidence_score DOUBLE PRECISION NOT NULL DEFAULT 1,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (student_id, institution_id, relation_type)
    )
  `;
  await sql`ALTER TABLE crm_student_institutions ADD COLUMN IF NOT EXISTS is_primary BOOLEAN`;
  await sql`ALTER TABLE crm_student_institutions ADD COLUMN IF NOT EXISTS source_kind TEXT`;
  await sql`ALTER TABLE crm_student_institutions ADD COLUMN IF NOT EXISTS source_value TEXT`;
  await sql`ALTER TABLE crm_student_institutions ADD COLUMN IF NOT EXISTS confidence_score DOUBLE PRECISION`;
  await sql`ALTER TABLE crm_student_institutions ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ`;
  await sql`ALTER TABLE crm_student_institutions ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ`;
  await sql`UPDATE crm_student_institutions SET is_primary = COALESCE(is_primary, FALSE)`;
  await sql`UPDATE crm_student_institutions SET source_kind = COALESCE(NULLIF(source_kind, ''), 'manual')`;
  await sql`UPDATE crm_student_institutions SET confidence_score = COALESCE(confidence_score, 1)`;
  await sql`UPDATE crm_student_institutions SET created_at = COALESCE(created_at, NOW())`;
  await sql`UPDATE crm_student_institutions SET updated_at = COALESCE(updated_at, created_at, NOW())`;
  await sql`CREATE INDEX IF NOT EXISTS idx_crm_student_institutions_student_id ON crm_student_institutions (student_id)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_crm_student_institutions_institution_id ON crm_student_institutions (institution_id)`;

  await sql`
    CREATE TABLE IF NOT EXISTS crm_match_alerts (
      id TEXT PRIMARY KEY,
      entity_type TEXT NOT NULL,
      entity_id TEXT NOT NULL,
      alert_type TEXT NOT NULL,
      severity TEXT NOT NULL DEFAULT 'info',
      status TEXT NOT NULL DEFAULT 'open',
      confidence_score DOUBLE PRECISION,
      title TEXT NOT NULL,
      details_json JSONB NOT NULL DEFAULT '{}'::jsonb,
      source_kind TEXT NOT NULL DEFAULT 'manual',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;
  await sql`ALTER TABLE crm_match_alerts ADD COLUMN IF NOT EXISTS confidence_score DOUBLE PRECISION`;
  await sql`ALTER TABLE crm_match_alerts ADD COLUMN IF NOT EXISTS details_json JSONB`;
  await sql`ALTER TABLE crm_match_alerts ADD COLUMN IF NOT EXISTS source_kind TEXT`;
  await sql`ALTER TABLE crm_match_alerts ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ`;
  await sql`ALTER TABLE crm_match_alerts ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ`;
  await sql`UPDATE crm_match_alerts SET severity = COALESCE(NULLIF(severity, ''), 'info')`;
  await sql`UPDATE crm_match_alerts SET status = COALESCE(NULLIF(status, ''), 'open')`;
  await sql`UPDATE crm_match_alerts SET source_kind = COALESCE(NULLIF(source_kind, ''), 'manual')`;
  await sql`UPDATE crm_match_alerts SET details_json = COALESCE(details_json, '{}'::jsonb)`;
  await sql`UPDATE crm_match_alerts SET created_at = COALESCE(created_at, NOW())`;
  await sql`UPDATE crm_match_alerts SET updated_at = COALESCE(updated_at, created_at, NOW())`;
  await sql`CREATE INDEX IF NOT EXISTS idx_crm_match_alerts_entity ON crm_match_alerts (entity_type, entity_id)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_crm_match_alerts_status ON crm_match_alerts (status, severity)`;

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
    CREATE TABLE IF NOT EXISTS attendance_sessions (
      id TEXT PRIMARY KEY,
      institution TEXT NOT NULL,
      session_type TEXT,
      title TEXT,
      session_date DATE NOT NULL,
      source_note TEXT,
      created_by_user_id TEXT REFERENCES app_users(clerk_user_id),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;
  await sql`ALTER TABLE attendance_sessions ADD COLUMN IF NOT EXISTS session_type TEXT`;
  await sql`ALTER TABLE attendance_sessions ADD COLUMN IF NOT EXISTS title TEXT`;
  await sql`ALTER TABLE attendance_sessions ADD COLUMN IF NOT EXISTS source_note TEXT`;
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
      WHEN title = 'מעריב' THEN 'maariv'
      ELSE NULL
    END
  `;
  await sql`UPDATE attendance_sessions SET created_at = COALESCE(created_at, NOW())`;
  await sql`UPDATE attendance_sessions SET updated_at = COALESCE(updated_at, created_at, NOW())`;
  await sql`CREATE INDEX IF NOT EXISTS idx_attendance_sessions_institution_date ON attendance_sessions (institution, session_date DESC)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_attendance_sessions_created_at ON attendance_sessions (created_at DESC)`;

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
      WHEN status = 'left_early' THEN 'sent_home'
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
