CREATE TABLE IF NOT EXISTS app_users (
  clerk_user_id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'viewer',
  weekly_backup_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  weekly_backup_delivery TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS student_internal_notes (
  student_id TEXT PRIMARY KEY,
  note_text TEXT,
  note_status TEXT,
  direct_debit_active BOOLEAN,
  signed_by_user_id TEXT REFERENCES app_users(clerk_user_id),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS student_tags (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  normalized_name TEXT NOT NULL UNIQUE,
  created_by_user_id TEXT REFERENCES app_users(clerk_user_id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS student_tag_assignments (
  student_id TEXT NOT NULL,
  tag_id TEXT NOT NULL REFERENCES student_tags(id) ON DELETE CASCADE,
  assigned_by_user_id TEXT REFERENCES app_users(clerk_user_id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (student_id, tag_id)
);

CREATE TABLE IF NOT EXISTS student_contact_logs (
  id TEXT PRIMARY KEY,
  student_id TEXT NOT NULL,
  contact_date DATE NOT NULL,
  note_text TEXT,
  created_by_user_id TEXT REFERENCES app_users(clerk_user_id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS student_events (
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

CREATE TABLE IF NOT EXISTS neon_user_preferences (
  owner_user_id TEXT PRIMARY KEY REFERENCES app_users(clerk_user_id) ON DELETE CASCADE,
  query_string TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS scheduled_job_runs (
  job_name TEXT NOT NULL,
  job_key TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'started',
  details_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  PRIMARY KEY (job_name, job_key)
);

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
);

CREATE TABLE IF NOT EXISTS crm_person_roles (
  person_id TEXT NOT NULL REFERENCES crm_people(id) ON DELETE CASCADE,
  role_key TEXT NOT NULL,
  source_student_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (person_id, role_key)
);

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
);

CREATE TABLE IF NOT EXISTS crm_institutions (
  id TEXT PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  institution_type TEXT NOT NULL DEFAULT 'yeshiva',
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  metadata_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

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
);

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
);

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
);

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
);
