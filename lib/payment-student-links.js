import crypto from "node:crypto";
import { initDb, sql } from "./db.js";
import { getPaymentDashboard, getPaymentMandatesDashboard } from "./payment-systems.js";
import { ensurePaymentLinkTables } from "./payment-links.js";

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
  if (donorId && [...[student.student_tz, student.father_tz, student.mother_tz], ...(student.known_donor_ids || [])].map(digits).includes(donorId)) matched.push("identity");
  if (recordEmail && [...[student.student_email, student.father_email, student.mother_email], ...(student.known_emails || [])].map(email).includes(recordEmail)) matched.push("email");
  if (recordPhone && [...[student.student_phone, student.father_phone, student.mother_phone], ...(student.known_phones || [])].map(digits).includes(recordPhone)) matched.push("phone");
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
  const knownIdentityRows = await sql`
    SELECT psl.student_id, pr.donor_id, pr.email, pr.phone
    FROM payment_student_links psl
    JOIN payment_records pr ON pr.id = psl.payment_record_id
  `;
  const knownByStudent = new Map();
  for (const row of knownIdentityRows) {
    const current = knownByStudent.get(clean(row.student_id)) || { known_donor_ids: [], known_emails: [], known_phones: [] };
    if (digits(row.donor_id)) current.known_donor_ids.push(row.donor_id);
    if (email(row.email)) current.known_emails.push(row.email);
    if (digits(row.phone)) current.known_phones.push(row.phone);
    knownByStudent.set(clean(row.student_id), current);
  }
  const enrichedStudents = students.map((student) => ({ ...student, ...(knownByStudent.get(clean(student.student_id)) || {}) }));
  const ids = [];
  for (const item of transactionsDashboard.transactions || []) ids.push(await upsertRecord(item, "transaction", safeMonth));
  for (const item of mandatesDashboard.mandates || []) ids.push(await upsertRecord(item, "mandate", safeMonth));
  let linked = 0;
  for (const id of ids.filter(Boolean)) if (await autoLinkRecord(id, enrichedStudents)) linked += 1;
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
    linkSource: clean(row.link_source), matchedFields: Array.isArray(row.matched_fields) ? row.matched_fields : [],
    payload: row.payload_json && typeof row.payload_json === "object" ? row.payload_json : {}
  };
}

async function ensurePaymentScanTables() {
  await initDb();
  await sql`
    CREATE TABLE IF NOT EXISTS payment_connection_scanned_days (
      connection_id TEXT NOT NULL,
      scanned_date DATE NOT NULL,
      scanned_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (connection_id, scanned_date)
    )
  `;
}

function isoDay(value) {
  const text = clean(value);
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : "";
}

function nextDay(value) {
  const date = new Date(`${value}T12:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString().slice(0, 10);
}

function missingRanges(dateFrom, dateTo, scannedDays) {
  const ranges = [];
  let rangeStart = "";
  let previous = "";
  for (let day = dateFrom; day <= dateTo; day = nextDay(day)) {
    if (!scannedDays.has(day)) {
      if (!rangeStart) rangeStart = day;
      previous = day;
    } else if (rangeStart) {
      ranges.push({ dateFrom: rangeStart, dateTo: previous });
      rangeStart = "";
    }
  }
  if (rangeStart) ranges.push({ dateFrom: rangeStart, dateTo: previous });
  return ranges;
}

export async function getCachedPaymentTransactions({ connections = [], dateFrom, dateTo, refresh = false }) {
  await ensurePaymentScanTables();
  const from = isoDay(dateFrom);
  const to = isoDay(dateTo);
  if (!from || !to || from > to) throw new Error("טווח התאריכים אינו תקין.");
  if ((new Date(`${to}T12:00:00Z`) - new Date(`${from}T12:00:00Z`)) / 86400000 > 730) throw new Error("טווח התאריכים מוגבל לשנתיים.");

  const errors = [];
  for (const connection of connections) {
    const connectionId = clean(connection.id);
    const scanned = refresh ? [] : await sql`
      SELECT scanned_date::text AS scanned_date
      FROM payment_connection_scanned_days
      WHERE connection_id = ${connectionId}
        AND scanned_date >= ${from}::date AND scanned_date <= ${to}::date
    `;
    const ranges = refresh ? [{ dateFrom: from, dateTo: to }] : missingRanges(from, to, new Set(scanned.map((row) => row.scanned_date)));

    for (const range of ranges) {
      const dashboard = await getPaymentDashboard({ connectionIds: [connectionId], ...range });
      if (dashboard.errors?.length) {
        errors.push(...dashboard.errors);
        continue;
      }
      for (const item of dashboard.transactions || []) {
        await upsertRecord(item, "transaction", periodMonthForItem(item));
      }
      await sql`
        INSERT INTO payment_connection_scanned_days (connection_id, scanned_date, scanned_at)
        SELECT ${connectionId}, day::date, NOW()
        FROM generate_series(${range.dateFrom}::date, ${range.dateTo}::date, '1 day'::interval) AS day
        ON CONFLICT (connection_id, scanned_date) DO UPDATE SET scanned_at = NOW()
      `;
    }
  }

  const activeConnectionIds = connections.map((connection) => clean(connection.id));
  if (!activeConnectionIds.length) return { transactions: [], errors, lastSyncedAt: null };
  const rows = await sql`
    SELECT payload_json, last_seen_at
    FROM payment_records
    WHERE record_type = 'transaction'
      AND connection_id = ANY(${activeConnectionIds})
      AND occurred_at >= ${from}::date
      AND occurred_at < (${to}::date + INTERVAL '1 day')
    ORDER BY occurred_at DESC NULLS LAST, last_seen_at DESC
  `;
  const metadata = await sql`
    SELECT MAX(scanned_at) AS last_synced_at
    FROM payment_connection_scanned_days
    WHERE connection_id = ANY(${activeConnectionIds})
      AND scanned_date >= ${from}::date AND scanned_date <= ${to}::date
  `;
  return {
    transactions: rows.map((row) => row.payload_json && typeof row.payload_json === "object" ? row.payload_json : {}).filter((item) => item.id || item.transactionNumber),
    errors,
    lastSyncedAt: metadata[0]?.last_synced_at || null
  };
}

export async function listStudentPayments(studentId, { limit = 100 } = {}) {
  await initDb();
  await ensurePaymentLinkTables();
  const modernLinks = await sql`
    SELECT * FROM payment_record_links
    WHERE student_id = ${clean(studentId)}
    ORDER BY updated_at DESC
  `;
  for (const link of modernLinks) {
    const snapshot = link.record_snapshot && typeof link.record_snapshot === "object" ? link.record_snapshot : {};
    await upsertAndLinkPaymentRecord({
      item: {
        ...snapshot,
        provider: link.provider,
        connectionId: link.connection_id,
        externalRecordId: link.external_record_id,
        id: link.external_record_id,
        customerName: link.payer_name || snapshot.customerName,
        email: link.payer_email || snapshot.email,
        phone: link.payer_phone || snapshot.phone
      },
      recordType: link.record_type,
      studentId,
      userId: link.linked_by_user_id || ""
    });
  }
  const rows = await sql`
    SELECT pr.*, psl.link_source, psl.matched_fields
    FROM payment_student_links psl JOIN payment_records pr ON pr.id = psl.payment_record_id
    WHERE psl.student_id = ${clean(studentId)}
    ORDER BY pr.occurred_at DESC NULLS LAST, pr.last_seen_at DESC LIMIT ${Math.max(1, Number(limit) || 100)}
  `;
  const payments = rows.map(mapPaymentRow);
  const seenMandates = new Set();
  return payments.filter((payment) => {
    if (payment.type !== "mandate") return true;
    const mandateKey = `${payment.provider}:${payment.connectionId}:${payment.externalId}`;
    if (seenMandates.has(mandateKey)) return false;
    seenMandates.add(mandateKey);
    return true;
  });
}

export async function getStudentPaymentRecord(studentId, paymentRecordId) {
  await initDb();
  const rows = await sql`
    SELECT pr.*, psl.link_source, psl.matched_fields
    FROM payment_student_links psl JOIN payment_records pr ON pr.id = psl.payment_record_id
    WHERE psl.student_id = ${clean(studentId)} AND pr.id = ${clean(paymentRecordId)}
    LIMIT 1
  `;
  return rows[0] ? mapPaymentRow(rows[0]) : null;
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

function periodMonthForItem(item) {
  const value = safeDate(item?.createdAt || item?.occurredAt);
  return value
    ? `${value.getUTCFullYear()}-${String(value.getUTCMonth() + 1).padStart(2, "0")}`
    : previousPaymentMonth();
}

export async function upsertAndLinkPaymentRecord({ item, recordType, studentId, userId = "" }) {
  await initDb();
  const safeType = clean(recordType) === "mandate" ? "mandate" : "transaction";
  const periodMonth = monthKey(item?.periodMonth) || periodMonthForItem(item);
  const recordIdValue = await upsertRecord({
    ...item,
    provider: clean(item?.provider),
    connectionId: clean(item?.connectionId),
    transactionNumber: clean(item?.transactionNumber || item?.externalRecordId || item?.id),
    mandateId: clean(item?.mandateId || item?.externalRecordId || item?.id)
  }, safeType, periodMonth);
  if (!recordIdValue) throw new Error("לא נמצא מזהה רשומת תשלום.");
  await linkPaymentToStudent({ paymentRecordId: recordIdValue, studentId, userId });
  return recordIdValue;
}

export async function unlinkPaymentFromStudent({ paymentRecordId, studentId }) {
  await initDb();
  await sql`DELETE FROM payment_student_links WHERE payment_record_id = ${clean(paymentRecordId)} AND student_id = ${clean(studentId)}`;
}
