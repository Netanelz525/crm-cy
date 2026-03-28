import { neon } from "@neondatabase/serverless";

const DATABASE_URL = process.env.DATABASE_URL;

if (!DATABASE_URL) {
  throw new Error("Missing DATABASE_URL env variable.");
}

export const sql = neon(DATABASE_URL);

let initialized = false;

export async function initDb() {
  if (initialized) return;

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
  await sql`ALTER TABLE app_users ALTER COLUMN access_status SET DEFAULT 'pending'`;
  await sql`ALTER TABLE app_users ALTER COLUMN can_edit_own_card SET DEFAULT FALSE`;
  await sql`UPDATE app_users SET access_status = COALESCE(NULLIF(access_status, ''), 'pending')`;
  await sql`UPDATE app_users SET can_edit_own_card = COALESCE(can_edit_own_card, FALSE)`;

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
      children_count INTEGER,
      payload JSONB NOT NULL,
      synced_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;

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
    CREATE TABLE IF NOT EXISTS import_sessions (
      id TEXT PRIMARY KEY,
      created_by_user_id TEXT REFERENCES app_users(clerk_user_id),
      file_name TEXT NOT NULL,
      headers JSONB NOT NULL,
      rows JSONB NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;

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
      template_id TEXT NOT NULL REFERENCES announcement_templates(id) ON DELETE RESTRICT,
      created_by_user_id TEXT REFERENCES app_users(clerk_user_id),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;

  await sql`CREATE INDEX IF NOT EXISTS idx_announcements_template_id ON announcements (template_id)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_announcements_title ON announcements (title)`;

  initialized = true;
}
