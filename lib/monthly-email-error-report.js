import * as XLSX from "xlsx";
import { initDb, sql } from "./db.js";
import { buildResendFromAddress, sendResendEmail } from "./resend.js";

function clean(value) {
  return String(value || "").trim();
}

function normalizeEmail(value) {
  return clean(value).toLowerCase();
}

function escapeHtml(value) {
  return clean(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function monthWindow(date = new Date()) {
  const current = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
  const start = new Date(Date.UTC(current.getUTCFullYear(), current.getUTCMonth() - 1, 1));
  const end = current;
  const monthKey = `${start.getUTCFullYear()}-${String(start.getUTCMonth() + 1).padStart(2, "0")}`;
  return { start, end, monthKey };
}

function configuredSuperAdminEmails() {
  return ["netanel.zevin@gmail.com", ...clean(process.env.SUPER_ADMIN_EMAILS).split(",")]
    .map(normalizeEmail)
    .filter(Boolean);
}

async function listRecipients() {
  await initDb();
  const rows = await sql`
    SELECT display_name, email
    FROM app_users
    WHERE LOWER(COALESCE(role, '')) = 'super_admin'
      AND COALESCE(email, '') <> ''
    ORDER BY created_at ASC
  `;
  const recipients = rows.map((row) => ({ displayName: clean(row.display_name), email: normalizeEmail(row.email) }));
  const existing = new Set(recipients.map((row) => row.email));
  for (const email of configuredSuperAdminEmails()) {
    if (!existing.has(email)) recipients.push({ displayName: "", email });
  }
  return recipients;
}

async function listFailures(start, end) {
  await initDb();
  const rows = await sql`
    SELECT
      LOWER(TRIM(d.recipient_email)) AS email,
      COUNT(*)::int AS failure_count,
      COUNT(DISTINCT d.campaign_id)::int AS campaign_count,
      STRING_AGG(DISTINCT COALESCE(NULLIF(d.provider_error, ''), NULLIF(d.error_message, ''), d.provider_status, d.status), ' | ') AS reasons,
      MAX(COALESCE(d.provider_last_event_at, d.updated_at, d.created_at)) AS last_seen,
      s.id AS student_id,
      s.full_name AS student_name,
      s.current_institution,
      s.class,
      CASE
        WHEN LOWER(TRIM(s.primary_email)) = LOWER(TRIM(d.recipient_email)) THEN 'תלמיד'
        WHEN LOWER(TRIM(s.father_email)) = LOWER(TRIM(d.recipient_email)) THEN 'אב'
        WHEN LOWER(TRIM(s.mother_email)) = LOWER(TRIM(d.recipient_email)) THEN 'אם'
        ELSE ''
      END AS matched_role
    FROM email_deliveries d
    LEFT JOIN neon_students s ON
      LOWER(TRIM(s.primary_email)) = LOWER(TRIM(d.recipient_email))
      OR LOWER(TRIM(s.father_email)) = LOWER(TRIM(d.recipient_email))
      OR LOWER(TRIM(s.mother_email)) = LOWER(TRIM(d.recipient_email))
    WHERE d.created_at >= ${start}
      AND d.created_at < ${end}
      AND d.status IN ('failed', 'bounced', 'complained', 'suppressed')
      AND COALESCE(TRIM(d.recipient_email), '') <> ''
    GROUP BY email, s.id, s.full_name, s.current_institution, s.class, matched_role
    ORDER BY failure_count DESC, email ASC, student_name ASC
  `;

  const grouped = new Map();
  for (const row of rows) {
    const email = normalizeEmail(row.email);
    if (!grouped.has(email)) {
      grouped.set(email, {
        email,
        failureCount: 0,
        campaignCount: 0,
        reasons: new Set(),
        lastSeen: row.last_seen,
        students: []
      });
    }
    const item = grouped.get(email);
    item.failureCount += Number(row.failure_count || 0);
    item.campaignCount = Math.max(item.campaignCount, Number(row.campaign_count || 0));
    if (clean(row.reasons)) clean(row.reasons).split(" | ").forEach((reason) => item.reasons.add(reason));
    if (row.last_seen && (!item.lastSeen || new Date(row.last_seen) > new Date(item.lastSeen))) item.lastSeen = row.last_seen;
    if (row.student_id && !item.students.some((student) => student.id === clean(row.student_id))) {
      item.students.push({
        id: clean(row.student_id),
        name: clean(row.student_name) || "ללא שם",
        institution: clean(row.current_institution),
        className: clean(row.class),
        role: clean(row.matched_role)
      });
    }
  }
  return [...grouped.values()]
    .map((item) => ({ ...item, reasons: [...item.reasons].join(" | ") || "שגיאת שליחה" }))
    .sort((a, b) => b.failureCount - a.failureCount || a.email.localeCompare(b.email));
}

function formatDate(value) {
  if (!value) return "-";
  return new Intl.DateTimeFormat("he-IL", { dateStyle: "short", timeStyle: "short", timeZone: "Asia/Jerusalem" }).format(new Date(value));
}

function buildWorkbook(items, monthKey) {
  const rows = items.map((item) => ({
    "כתובת מייל": item.email,
    "מספר שגיאות": item.failureCount,
    "מספר קמפיינים": item.campaignCount,
    "סיבות": item.reasons,
    "נראה לאחרונה": formatDate(item.lastSeen),
    "תלמידים משויכים": item.students.map((student) => [student.name, student.role, student.institution, student.className].filter(Boolean).join(" · ")).join(" | ") || "לא נמצא שיוך"
  }));
  if (!rows.length) rows.push({ "כתובת מייל": "אין כתובות עם שגיאות חריגות", "מספר שגיאות": 0 });
  const sheet = XLSX.utils.json_to_sheet(rows);
  sheet["!cols"] = [{ wch: 32 }, { wch: 14 }, { wch: 15 }, { wch: 42 }, { wch: 22 }, { wch: 70 }];
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, `שגיאות ${monthKey}`.slice(0, 31));
  return XLSX.write(workbook, { type: "buffer", bookType: "xlsx" });
}

function buildHtml(items, monthKey) {
  const rows = items.map((item) => `<tr><td>${escapeHtml(item.email)}</td><td>${item.failureCount}</td><td>${item.campaignCount}</td><td>${escapeHtml(item.reasons)}</td><td>${escapeHtml(formatDate(item.lastSeen))}</td><td>${escapeHtml(item.students.map((student) => [student.name, student.role, student.institution, student.className].filter(Boolean).join(" · ")).join(" | ") || "לא נמצא שיוך")}</td></tr>`).join("");
  return `<div dir="rtl" lang="he" style="font-family:Arial,sans-serif;line-height:1.6;color:#142642"><h2>דוח שגיאות מייל חריגות - ${escapeHtml(monthKey)}</h2><p>${items.length ? `נמצאו ${items.length} כתובות שדורשות בדיקה.` : "לא נמצאו כתובות עם שגיאות חריגות בחודש זה."}</p>${items.length ? `<table style="border-collapse:collapse;width:100%;font-size:13px"><thead><tr>${["כתובת מייל", "שגיאות", "קמפיינים", "סיבות", "נראה לאחרונה", "תלמידים משויכים"].map((title) => `<th style="border:1px solid #ccd7e6;padding:7px;background:#eef4fb;text-align:right">${title}</th>`).join("")}</tr></thead><tbody>${rows}</tbody></table>` : ""}<p style="margin-top:20px;color:#5d718e">הדוח כולל failed, bounced, complained ו-suppressed שנקלטו ב-Resend.</p></div>`;
}

async function claimJob(jobName, jobKey) {
  await initDb();
  const rows = await sql`
    INSERT INTO scheduled_job_runs (job_name, job_key, status)
    VALUES (${jobName}, ${jobKey}, 'started')
    ON CONFLICT (job_name, job_key) DO UPDATE SET status = 'started', started_at = NOW(), completed_at = NULL, details_json = '{}'::jsonb
    WHERE scheduled_job_runs.status = 'failed' OR (scheduled_job_runs.status = 'started' AND scheduled_job_runs.started_at < NOW() - INTERVAL '10 minutes')
    RETURNING job_name
  `;
  return rows.length > 0;
}

async function finishJob(jobName, jobKey, status, details) {
  await sql`UPDATE scheduled_job_runs SET status = ${status}, details_json = ${JSON.stringify(details)}::jsonb, completed_at = NOW() WHERE job_name = ${jobName} AND job_key = ${jobKey}`;
}

export function assertMonthlyEmailErrorCronAuthorized(request) {
  const secret = clean(process.env.CRON_SECRET);
  return Boolean(secret) && clean(request.headers.get("authorization")) === `Bearer ${secret}`;
}

export async function runMonthlyEmailErrorReportJob({ force = false, jobKey = "" } = {}) {
  const window = monthWindow();
  const resolvedJobKey = clean(jobKey) || (force ? `manual-${Date.now()}` : window.monthKey);
  const jobName = "monthly-email-error-report";
  if (!force && !(await claimJob(jobName, resolvedJobKey))) return { ok: true, skipped: true, jobName, jobKey: resolvedJobKey };
  if (force) await claimJob(jobName, resolvedJobKey);
  try {
    const [items, recipients] = await Promise.all([listFailures(window.start, window.end), listRecipients()]);
    const workbook = buildWorkbook(items, window.monthKey);
    const html = buildHtml(items, window.monthKey);
    const sent = [];
    const errors = [];
    for (const recipient of recipients) {
      try {
        await sendResendEmail({
          to: recipient.email,
          from: buildResendFromAddress("מערכת CRM"),
          subject: `דוח שגיאות מייל חריגות - ${window.monthKey}`,
          text: `דוח שגיאות מייל חריגות לחודש ${window.monthKey}. נמצאו ${items.length} כתובות לבדיקה.`,
          html,
          attachments: [{ filename: `monthly-email-errors-${window.monthKey}.xlsx`, content: workbook.toString("base64") }],
          idempotencyKey: `${jobName}-${resolvedJobKey}-${recipient.email}`
        });
        sent.push(recipient.email);
      } catch (error) {
        errors.push({ email: recipient.email, message: clean(error?.message) || "שליחת הדוח נכשלה" });
      }
    }
    const details = { recipients: recipients.length, sentCount: sent.length, errorAddressCount: items.length, errors, month: window.monthKey };
    await finishJob(jobName, resolvedJobKey, errors.length ? "failed" : "completed", details);
    return { ok: errors.length === 0, jobName, jobKey: resolvedJobKey, ...details };
  } catch (error) {
    await finishJob(jobName, resolvedJobKey, "failed", { error: clean(error?.message) || "Monthly email error report failed" });
    throw error;
  }
}
