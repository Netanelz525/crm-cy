import crypto from "node:crypto";
import { initDb, sql } from "./db.js";
import { getPaymentDashboard, getPaymentMandatesDashboard } from "./payment-systems.js";

function clean(value) { return String(value || "").trim(); }
function digits(value) { return clean(value).replace(/\D/g, "").replace(/^972/, "0"); }
function email(value) { return clean(value).toLowerCase(); }
function monthKey(value) { return /^\d{4}-\d{2}$/.test(clean(value)) ? clean(value) : ""; }
function safeDate(value) {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export function previousPaymentMonth(date = new Date()) {
  const value = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() - 1, 1));
  return `${value.getUTCFullYear()}-${String(value.getUTCMonth() + 1).padStart(2, "0")}`;
}

function monthRange(periodMonth) {
  const [year, month] = monthKey(periodMonth).split("-").map(Number);
  if (!year || !month) throw new Error("חודש התשלומים אינו תקין.");
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return { dateFrom: `${year}-${String(month).padStart(2, "0")}-01`, dateTo: `${year}-${String(month).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}` };
}

function recordExternalId(item, type) {
  return clean(type === "mandate" ? item.mandateId || item.id : item.transactionNumber || item.reference || item.id);
}

function recordId(item, type, periodMonth) {
  return crypto.createHash("sha256").update([type, item.provider, item.connectionId, recordExternalId(item, type), periodMonth].join("|")).digest("hex");
}

async function upsertRecord(item, type, periodMonth) {
  const id = recordId(item, type, periodMonth);
  const externalId = recordExternalId(item, type);
  if (!externalId) return "";
  await sql`
    INSERT INTO payment_records (
      id, record_type, provider, connection_id, external_record_id, period_month,
      customer_name, donor_id, email, phone, amount, currency, status, occurred_at, payload_json
    ) VALUES (
      ${id}, ${type}, ${clean(item.provider)}, ${clean(item.connectionId)}, ${externalId}, ${periodMonth},
      ${clean(item.customerName)}, ${digits(item.donorId)}, ${email(item.email)}, ${digits(item.phone)},
      ${Number(item.amountIls ?? item.amount) || 0}, ${clean(item.currency || "ILS")}, ${clean(item.status)},
      ${safeDate(item.createdAt)}, ${JSON.stringify(item)}::jsonb
    )
    ON CONFLICT (id) DO UPDATE SET
      customer_name = EXCLUDED.customer_name, donor_id = EXCLUDED.donor_id,
      email = EXCLUDED.email, phone = EXCLUDED.phone, amount = EXCLUDED.amount,
      currency = EXCLUDED.currency, status = EXCLUDED.status, occurred_at = EXCLUDED.occurred_at,
      payload_json = EXCLUDED.payload_json, last_seen_at = NOW()
  `;
  return id;
}

async function studentIdentityRows() {
  return sql`
    SELECT student_id, full_name,
      COALESCE(tznum, '') AS student_tz,
      COALESCE(payload->>'tzaba', '') AS father_tz,
      COALESCE(payload->>'tzMotherNum', '') AS mother_tz,
      COALESCE(primary_email, '') AS student_email,
      COALESCE(father_email, '') AS father_email,
      COALESCE(mother_email, '') AS mother_email,
      COALESCE(student_phone, '') AS student_phone,
      COALESCE(father_phone, '') AS father_phone,
      COALESCE(mother_phone, '') AS mother_phone
    FROM neon_students
  `;
}

function matchStudent(record, student) {
  const matched = [];
  const donorId = digits(record.donor_id);
  const recordEmail = email(record.email);
  const recordPhone = digits(record.phone);
  if (donorId && [student.student_tz, student.father_tz, student.mother_tz].map(digits).includes(donorId)) matched.push("identity");
  if (recordEmail && [student.student_email, student.father_email, student.mother_email].map(email).includes(recordEmail)) matched.push("email");
  if (recordPhone && [student.student_phone, student.father_phone, student.mother_phone].map(digits).includes(recordPhone)) matched.push("phone");
  return matched;
}

async function autoLinkRecord(recordId, students) {
  const rows = await sql`SELECT * FROM payment_records WHERE id = ${recordId}`;
  const record = rows[0];
  if (!record) return false;
  const candidates = students.map((student) => ({ student, fields: matchStudent(record, student) })).filter((item) => item.fields.length >= 2);
  if (candidates.length !== 1) return false;
  const candidate = candidates[0];
  await sql`
    INSERT INTO payment_student_links (payment_record_id, student_id, link_source, matched_fields, confidence)
    VALUES (${recordId}, ${clean(candidate.student.student_id)}, 'automatic', ${JSON.stringify(candidate.fields)}::jsonb, ${candidate.fields.length})
    ON CONFLICT (payment_record_id, student_id) DO NOTHING
  `;
  return true;
}

export async function syncAndLinkPayments({ periodMonth = previousPaymentMonth() } = {}) {
  await initDb();
  const safeMonth = monthKey(periodMonth);
  if (!safeMonth) throw new Error("חודש התשלומים אינו תקין.");
  const range = monthRange(safeMonth);
  const [transactionsDashboard, mandatesDashboard, students] = await Promise.all([
    getPaymentDashboard(range), getPaymentMandatesDashboard({}), studentIdentityRows()
  ]);
  const ids = [];
  for (const item of transactionsDashboard.transactions || []) ids.push(await upsertRecord(item, "transaction", safeMonth));
  for (const item of mandatesDashboard.mandates || []) ids.push(await upsertRecord(item, "mandate", safeMonth));
  let linked = 0;
  for (const id of ids.filter(Boolean)) if (await autoLinkRecord(id, students)) linked += 1;
  return {
    ok: true, periodMonth: safeMonth, transactions: transactionsDashboard.transactions?.length || 0,
    mandates: mandatesDashboard.mandates?.length || 0, autoLinked: linked,
    errors: [...(transactionsDashboard.errors || []), ...(mandatesDashboard.errors || [])]
  };
}

function mapPaymentRow(row) {
  return {
    id: clean(row.id), type: clean(row.record_type), provider: clean(row.provider), connectionId: clean(row.connection_id),
    externalId: clean(row.external_record_id), periodMonth: clean(row.period_month), customerName: clean(row.customer_name),
    donorId: clean(row.donor_id), email: clean(row.email), phone: clean(row.phone), amount: Number(row.amount || 0),
    currency: clean(row.currency), status: clean(row.status), occurredAt: row.occurred_at,
    linkSource: clean(row.link_source), matchedFields: Array.isArray(row.matched_fields) ? row.matched_fields : []
  };
}

export async function listStudentPayments(studentId, { limit = 100 } = {}) {
  await initDb();
  const rows = await sql`
    SELECT pr.*, psl.link_source, psl.matched_fields
    FROM payment_student_links psl JOIN payment_records pr ON pr.id = psl.payment_record_id
    WHERE psl.student_id = ${clean(studentId)}
    ORDER BY pr.occurred_at DESC NULLS LAST, pr.last_seen_at DESC LIMIT ${Math.max(1, Number(limit) || 100)}
  `;
  return rows.map(mapPaymentRow);
}

export async function listUnlinkedPayments({ limit = 100 } = {}) {
  await initDb();
  const rows = await sql`
    SELECT pr.* FROM payment_records pr
    WHERE NOT EXISTS (SELECT 1 FROM payment_student_links psl WHERE psl.payment_record_id = pr.id)
    ORDER BY pr.period_month DESC, pr.occurred_at DESC NULLS LAST LIMIT ${Math.max(1, Number(limit) || 100)}
  `;
  return rows.map(mapPaymentRow);
}

export async function linkPaymentToStudent({ paymentRecordId, studentId, userId = "" }) {
  await initDb();
  await sql`
    INSERT INTO payment_student_links (payment_record_id, student_id, link_source, matched_fields, confidence, created_by_user_id)
    VALUES (${clean(paymentRecordId)}, ${clean(studentId)}, 'manual', '[]'::jsonb, 0, ${clean(userId) || null})
    ON CONFLICT (payment_record_id, student_id) DO UPDATE SET link_source = 'manual', created_by_user_id = EXCLUDED.created_by_user_id, updated_at = NOW()
  `;
}

export async function unlinkPaymentFromStudent({ paymentRecordId, studentId }) {
  await initDb();
  await sql`DELETE FROM payment_student_links WHERE payment_record_id = ${clean(paymentRecordId)} AND student_id = ${clean(studentId)}`;
}
