import { randomUUID } from "node:crypto";
import { initDb, sql } from "./db.js";

function clean(value) { return String(value || "").trim(); }

export const EXTERNAL_MANDATE_STATUSES = ["active", "ending_soon", "completed", "issues"];

export async function ensureExternalMandateTable() {
  await initDb();
  await sql`
    CREATE TABLE IF NOT EXISTS external_payment_mandates (
      id TEXT PRIMARY KEY,
      external_key TEXT NOT NULL UNIQUE,
      student_id TEXT,
      contact_name TEXT,
      contact_phone TEXT,
      contact_email TEXT,
      notes TEXT,
      status TEXT NOT NULL DEFAULT 'active',
      created_by_user_id TEXT REFERENCES app_users(clerk_user_id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;
  await sql`CREATE INDEX IF NOT EXISTS idx_external_payment_mandates_student ON external_payment_mandates(student_id)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_external_payment_mandates_status ON external_payment_mandates(status)`;
}

function mapRow(row) {
  return {
    id: clean(row.id), externalKey: clean(row.external_key), studentId: clean(row.student_id),
    contactName: clean(row.contact_name), contactPhone: clean(row.contact_phone),
    contactEmail: clean(row.contact_email), notes: clean(row.notes), status: clean(row.status) || "active",
    provider: "external", providerLabel: "מערכת חיצונית", connectionId: "external", connectionLabel: "מערכת חיצונית",
    mandateId: clean(row.external_key), customerName: clean(row.contact_name), phone: clean(row.contact_phone), email: clean(row.contact_email),
    comments: clean(row.notes), createdAt: row.created_at, statusLabel: { active: "פעילה ותקינה", ending_soon: "לקראת סיום", completed: "הסתיימה", issues: "תקלה בגבייה" }[clean(row.status)] || "מערכת חיצונית"
  };
}

export async function listExternalMandates({ studentId = "" } = {}) {
  await ensureExternalMandateTable();
  const rows = studentId
    ? await sql`SELECT * FROM external_payment_mandates WHERE student_id = ${clean(studentId)} ORDER BY updated_at DESC`
    : await sql`SELECT * FROM external_payment_mandates ORDER BY updated_at DESC`;
  return rows.map(mapRow);
}

// External mandates are an optional data source; a temporary schema or database
// failure must not prevent the main payments or student page from rendering.
export async function listExternalMandatesSafe(options = {}) {
  try {
    return await listExternalMandates(options);
  } catch (error) {
    console.error("Failed to load external payment mandates", error);
    return [];
  }
}

export async function upsertExternalMandate({ id = "", externalKey, studentId = "", contactName = "", contactPhone = "", contactEmail = "", notes = "", status = "active", userId = "" }) {
  await ensureExternalMandateTable();
  const safeStatus = EXTERNAL_MANDATE_STATUSES.includes(clean(status)) ? clean(status) : "active";
  const key = clean(externalKey);
  if (!key) throw new Error("יש להזין מזהה או שם להוראת הקבע החיצונית.");
  const rows = await sql`
    INSERT INTO external_payment_mandates (id, external_key, student_id, contact_name, contact_phone, contact_email, notes, status, created_by_user_id, updated_at)
    VALUES (${clean(id) || randomUUID()}, ${key}, ${clean(studentId) || null}, ${clean(contactName)}, ${clean(contactPhone)}, ${clean(contactEmail).toLowerCase()}, ${clean(notes)}, ${safeStatus}, ${clean(userId) || null}, NOW())
    ON CONFLICT (external_key) DO UPDATE SET student_id = EXCLUDED.student_id, contact_name = EXCLUDED.contact_name, contact_phone = EXCLUDED.contact_phone, contact_email = EXCLUDED.contact_email, notes = EXCLUDED.notes, status = EXCLUDED.status, updated_at = NOW()
    RETURNING *
  `;
  return mapRow(rows[0]);
}

export async function deleteExternalMandate(id) {
  await ensureExternalMandateTable();
  await sql`DELETE FROM external_payment_mandates WHERE id = ${clean(id)}`;
}
