import { randomUUID } from "node:crypto";
import { initDb, sql } from "./db.js";

function clean(value) {
  return String(value || "").trim();
}

function parseJson(value, fallback = {}) {
  if (value && typeof value === "object") return value;
  try { return value ? JSON.parse(value) : fallback; } catch { return fallback; }
}

export async function ensurePaymentLinkTables() {
  await initDb();
  await sql`
    CREATE TABLE IF NOT EXISTS payment_record_links (
      id TEXT PRIMARY KEY,
      record_type TEXT NOT NULL CHECK (record_type IN ('transaction', 'mandate')),
      provider TEXT NOT NULL,
      connection_id TEXT NOT NULL,
      external_record_id TEXT NOT NULL,
      student_id TEXT NOT NULL,
      payer_type TEXT NOT NULL DEFAULT 'student' CHECK (payer_type IN ('student', 'father', 'mother', 'other')),
      payer_name TEXT,
      payer_email TEXT,
      payer_phone TEXT,
      notes TEXT,
      record_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,
      linked_by_user_id TEXT REFERENCES app_users(clerk_user_id),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (record_type, provider, connection_id, external_record_id)
    )
  `;
  await sql`
    DO $$
    DECLARE old_constraint TEXT;
    BEGIN
      SELECT conname INTO old_constraint
      FROM pg_constraint
      WHERE conrelid = 'payment_record_links'::regclass
        AND contype = 'c'
        AND pg_get_constraintdef(oid) LIKE '%payer_type%'
        AND pg_get_constraintdef(oid) NOT LIKE '%''other''%'
      LIMIT 1;

      IF old_constraint IS NOT NULL THEN
        EXECUTE format('ALTER TABLE payment_record_links DROP CONSTRAINT %I', old_constraint);
      END IF;

      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conrelid = 'payment_record_links'::regclass
          AND contype = 'c'
          AND pg_get_constraintdef(oid) LIKE '%payer_type%'
          AND pg_get_constraintdef(oid) LIKE '%''other''%'
      ) THEN
        ALTER TABLE payment_record_links
          ADD CONSTRAINT payment_record_links_payer_type_check
          CHECK (payer_type IN ('student', 'father', 'mother', 'other'));
      END IF;
    END $$
  `;
  await sql`CREATE INDEX IF NOT EXISTS idx_payment_record_links_student ON payment_record_links (student_id, record_type)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_payment_record_links_record ON payment_record_links (record_type, provider, connection_id, external_record_id)`;
  await sql`
    CREATE TABLE IF NOT EXISTS payment_contact_recommendations (
      student_id TEXT PRIMARY KEY,
      recommended_by_user_id TEXT REFERENCES app_users(clerk_user_id),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;
}

function mapLink(row) {
  if (!row) return null;
  return {
    id: clean(row.id),
    recordType: clean(row.record_type),
    provider: clean(row.provider),
    connectionId: clean(row.connection_id),
    externalRecordId: clean(row.external_record_id),
    studentId: clean(row.student_id),
    payerType: clean(row.payer_type) || "student",
    payerName: clean(row.payer_name),
    payerEmail: clean(row.payer_email),
    payerPhone: clean(row.payer_phone),
    notes: clean(row.notes),
    recordSnapshot: parseJson(row.record_snapshot),
    linkedByUserId: clean(row.linked_by_user_id),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

export async function listPaymentRecordLinks() {
  await ensurePaymentLinkTables();
  const rows = await sql`SELECT * FROM payment_record_links ORDER BY updated_at DESC`;
  return rows.map(mapLink);
}

export async function upsertPaymentRecordLink({
  recordType,
  provider,
  connectionId,
  externalRecordId,
  studentId,
  payerType = "student",
  payerName = "",
  payerEmail = "",
  payerPhone = "",
  notes = "",
  recordSnapshot = {},
  linkedByUserId
}) {
  await ensurePaymentLinkTables();
  const safeType = clean(recordType);
  const safePayerType = ["student", "father", "mother", "other"].includes(clean(payerType)) ? clean(payerType) : "student";
  if (!['transaction', 'mandate'].includes(safeType)) throw new Error("סוג רשומת תשלום לא תקין.");
  if (!clean(provider) || !clean(connectionId) || !clean(externalRecordId) || !clean(studentId)) {
    throw new Error("יש להשלים מקור תשלום, מזהה רשומה ותלמיד.");
  }
  const rows = await sql`
    INSERT INTO payment_record_links (
      id, record_type, provider, connection_id, external_record_id, student_id,
      payer_type, payer_name, payer_email, payer_phone, notes, record_snapshot,
      linked_by_user_id, updated_at
    ) VALUES (
      ${randomUUID()}, ${safeType}, ${clean(provider)}, ${clean(connectionId)}, ${clean(externalRecordId)}, ${clean(studentId)},
      ${safePayerType}, ${clean(payerName)}, ${clean(payerEmail).toLowerCase()}, ${clean(payerPhone)}, ${clean(notes)}, ${JSON.stringify(recordSnapshot)},
      ${clean(linkedByUserId) || null}, NOW()
    )
    ON CONFLICT (record_type, provider, connection_id, external_record_id)
    DO UPDATE SET
      student_id = EXCLUDED.student_id,
      payer_type = EXCLUDED.payer_type,
      payer_name = EXCLUDED.payer_name,
      payer_email = EXCLUDED.payer_email,
      payer_phone = EXCLUDED.payer_phone,
      notes = EXCLUDED.notes,
      record_snapshot = EXCLUDED.record_snapshot,
      linked_by_user_id = EXCLUDED.linked_by_user_id,
      updated_at = NOW()
    RETURNING *
  `;
  return mapLink(rows[0]);
}

export async function deletePaymentRecordLink({ id }) {
  await ensurePaymentLinkTables();
  await sql`DELETE FROM payment_record_links WHERE id = ${clean(id)}`;
}

export async function listPaymentContactRecommendations() {
  await ensurePaymentLinkTables();
  const rows = await sql`SELECT student_id FROM payment_contact_recommendations ORDER BY updated_at DESC`;
  return rows.map((row) => clean(row.student_id)).filter(Boolean);
}

export async function setPaymentContactRecommendation({ studentId, recommended, userId = "" }) {
  await ensurePaymentLinkTables();
  const id = clean(studentId);
  if (!id) throw new Error("חסר תלמיד לסימון.");
  if (recommended) {
    await sql`
      INSERT INTO payment_contact_recommendations (student_id, recommended_by_user_id, updated_at)
      VALUES (${id}, ${clean(userId) || null}, NOW())
      ON CONFLICT (student_id) DO UPDATE SET recommended_by_user_id = EXCLUDED.recommended_by_user_id, updated_at = NOW()
    `;
  } else {
    await sql`DELETE FROM payment_contact_recommendations WHERE student_id = ${id}`;
  }
  return { studentId: id, recommended: Boolean(recommended) };
}
