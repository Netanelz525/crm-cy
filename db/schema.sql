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
