CREATE TABLE IF NOT EXISTS app_users (
  clerk_user_id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'viewer',
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

