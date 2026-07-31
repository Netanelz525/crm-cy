import { initDb, sql } from "./db.js";
import { buildPaymentReportExcelExport, buildPaymentReportPdfExport } from "./payment-report-exports.js";
import { buildResendFromAddress, sendResendEmail } from "./resend.js";

function clean(value) {
  return String(value || "").trim();
}

function escapeHtml(value) {
  return clean(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function normalizeEmail(value) {
  return clean(value).toLowerCase();
}

function configuredSuperAdminEmails() {
  return [
    "netanel.zevin@gmail.com",
    ...clean(process.env.SUPER_ADMIN_EMAILS).split(",")
  ].map(normalizeEmail).filter(Boolean);
}

function formatDate(date) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Jerusalem",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(date);
}

function monthlyJobKey(date = new Date()) {
  return formatDate(date).slice(0, 7);
}

async function claimJobRun(jobName, jobKey) {
  await initDb();
  const rows = await sql`
    INSERT INTO scheduled_job_runs (job_name, job_key, status)
    VALUES (${jobName}, ${jobKey}, 'started')
    ON CONFLICT (job_name, job_key) DO UPDATE
    SET
      status = 'started',
      details_json = '{}'::jsonb,
      started_at = NOW(),
      completed_at = NULL
    WHERE scheduled_job_runs.status = 'failed'
      OR (
        scheduled_job_runs.status = 'started'
        AND scheduled_job_runs.started_at < NOW() - INTERVAL '10 minutes'
      )
    RETURNING job_name
  `;
  return rows.length > 0;
}

async function finalizeJobRun(jobName, jobKey, status, details = {}) {
  await sql`
    UPDATE scheduled_job_runs
    SET
      status = ${status},
      details_json = ${JSON.stringify(details)}::jsonb,
      completed_at = NOW()
    WHERE job_name = ${jobName}
      AND job_key = ${jobKey}
  `;
}

export function assertMonthlyPaymentMandateCronAuthorized(request) {
  const secret = clean(process.env.CRON_SECRET);
  if (!secret) throw new Error("Missing CRON_SECRET env variable.");
  return clean(request.headers.get("authorization")) === `Bearer ${secret}`;
}

async function listSuperAdminRecipients() {
  await initDb();
  const rows = await sql`
    SELECT clerk_user_id, display_name, email
    FROM app_users
    WHERE LOWER(COALESCE(role, '')) = 'super_admin'
      AND COALESCE(email, '') <> ''
    ORDER BY created_at ASC
  `;
  const recipients = rows.map((row) => ({
    clerkUserId: clean(row.clerk_user_id),
    displayName: clean(row.display_name),
    email: normalizeEmail(row.email)
  }));
  const existingEmails = new Set(recipients.map((recipient) => recipient.email));
  for (const email of configuredSuperAdminEmails()) {
    if (!existingEmails.has(email)) {
      recipients.push({ clerkUserId: "", displayName: "", email });
      existingEmails.add(email);
    }
  }
  return recipients.filter((recipient) => recipient.email);
}

function buildReportSearchParams() {
  const params = new URLSearchParams();
  params.set("reportType", "mandates");
  params.set("mandateStatus", "issues");
  params.set("sortBy", "source");
  params.set("sortDir", "asc");
  return params;
}

function reportUrl() {
  const baseUrl = clean(process.env.CRM_BASE_URL || process.env.VERCEL_PROJECT_PRODUCTION_URL || process.env.VERCEL_URL);
  const origin = baseUrl ? `https://${baseUrl.replace(/^https?:\/\//, "").replace(/\/$/, "")}` : "";
  const params = buildReportSearchParams();
  return `${origin}/payments?run=1&${params.toString()}`;
}

function buildSummaryText({ jobKey, xlsxFile, pdfFile }) {
  return [
    `דוח הוראות קבע כושלות - ${jobKey}`,
    "",
    "מצורפים דוחות מכל מערכות התשלום הפעילות:",
    `- ${xlsxFile.filename}`,
    `- ${pdfFile.filename}`,
    "",
    `פתיחה במערכת: ${reportUrl()}`,
    "",
    "הדוח מופק אוטומטית ב-27 לחודש כדי לתת תמונת מצב מדויקת לקראת סוף החודש."
  ].join("\n");
}

async function sendReportToRecipient({ recipient, jobKey, xlsxFile, pdfFile }) {
  const summaryText = buildSummaryText({ jobKey, xlsxFile, pdfFile });
  await sendResendEmail({
    to: recipient.email,
    from: buildResendFromAddress("מערכת CRM"),
    subject: `דוח הוראות קבע כושלות - ${jobKey}`,
    text: summaryText,
    html: `<div dir="rtl" lang="he" style="font-family:Arial,sans-serif;line-height:1.7"><pre style="white-space:pre-wrap;font-family:Arial,sans-serif">${escapeHtml(summaryText)}</pre></div>`,
    attachments: [
      {
        filename: xlsxFile.filename,
        content: xlsxFile.content.toString("base64")
      },
      {
        filename: pdfFile.filename,
        content: pdfFile.content.toString("base64")
      }
    ],
    idempotencyKey: `monthly-payment-mandate-issues-${jobKey}-${recipient.email}`
  });
}

export async function runMonthlyPaymentMandateIssuesReportJob({ force = false, jobKey = "" } = {}) {
  const jobName = "monthly-payment-mandate-issues-report";
  const resolvedJobKey = clean(jobKey) || (force ? `manual-${new Date().toISOString()}` : monthlyJobKey());
  const claimed = force || await claimJobRun(jobName, resolvedJobKey);
  if (!claimed) {
    return { ok: true, skipped: true, reason: "already_running_or_completed", jobName, jobKey: resolvedJobKey };
  }

  try {
    if (force) await claimJobRun(jobName, resolvedJobKey);
    const params = buildReportSearchParams();
    const [xlsxFile, pdfFile, recipients] = await Promise.all([
      buildPaymentReportExcelExport(params),
      buildPaymentReportPdfExport(params),
      listSuperAdminRecipients()
    ]);

    const sent = [];
    const errors = [];
    for (const recipient of recipients) {
      try {
        await sendReportToRecipient({ recipient, jobKey: resolvedJobKey, xlsxFile, pdfFile });
        sent.push(recipient.email);
      } catch (error) {
        errors.push({ email: recipient.email, message: clean(error?.message) || "שליחת הדוח נכשלה" });
      }
    }

    const details = {
      recipients: recipients.length,
      sentCount: sent.length,
      errors,
      reportType: "mandates",
      mandateStatus: "issues",
      files: [xlsxFile.filename, pdfFile.filename]
    };
    await finalizeJobRun(jobName, resolvedJobKey, errors.length ? "failed" : "completed", details);
    return { ok: errors.length === 0, jobName, jobKey: resolvedJobKey, ...details };
  } catch (error) {
    await finalizeJobRun(jobName, resolvedJobKey, "failed", {
      error: clean(error?.message) || "Monthly payment mandate issues report failed"
    });
    throw error;
  }
}
