import { initDb, sql } from "./db.js";
import { buildResendFromAddress, sendResendEmail } from "./resend.js";
import { listTaskReminderLogsForDate, markTaskReminderSent } from "./task-contact-logs.js";
import { getTaskById, taskStatusLabel } from "./tasks.js";

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

function getBaseUrl() {
  const raw = clean(process.env.CRM_BASE_URL || process.env.VERCEL_PROJECT_PRODUCTION_URL || process.env.VERCEL_URL);
  if (!raw) return "";
  return `https://${raw.replace(/^https?:\/\//, "").replace(/\/$/, "")}`;
}

function formatDate(date) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Jerusalem",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(date);
}

function tomorrowInJerusalem() {
  const now = new Date();
  const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000);
  return formatDate(tomorrow);
}

function jobKeyForDate(dateValue) {
  return clean(dateValue) || tomorrowInJerusalem();
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

export function assertTaskReminderCronAuthorized(request) {
  const secret = clean(process.env.CRON_SECRET);
  if (!secret) throw new Error("Missing CRON_SECRET env variable.");
  return clean(request.headers.get("authorization")) === `Bearer ${secret}`;
}

function taskUrl(taskId) {
  const baseUrl = getBaseUrl();
  const path = `/tasks?taskId=${encodeURIComponent(clean(taskId))}`;
  return baseUrl ? `${baseUrl}${path}` : path;
}

function recipientsForTask(task) {
  const emails = (task?.assignees || [])
    .map((user) => clean(user.email).toLowerCase())
    .filter(Boolean);
  return [...new Set(emails)];
}

async function sendReminderEmail(log, task) {
  const recipients = recipientsForTask(task);
  if (!recipients.length) return { sent: false, reason: "no_recipients" };
  const url = taskUrl(task.id);
  await sendResendEmail({
    to: recipients,
    from: buildResendFromAddress("מערכת CRM"),
    subject: `תזכורת לטיפול במשימה: ${clean(task.title)}`,
    text: [
      "תזכורת לטיפול במשימה שמועד הטיפול שלה מחר.",
      "",
      `משימה: ${clean(task.title)}`,
      `סטטוס: ${taskStatusLabel(task.status)}`,
      `תאריך תזכורת: ${clean(log.reminderDate)}`,
      `תיעוד: ${clean(log.noteText)}`,
      "",
      `פתיחה במערכת: ${url}`
    ].join("\n"),
    html: [
      "<div dir=\"rtl\" style=\"font-family:Arial,sans-serif;line-height:1.7\">",
      "<h2>תזכורת לטיפול במשימה</h2>",
      `<p><b>משימה:</b> ${escapeHtml(task.title)}</p>`,
      `<p><b>סטטוס:</b> ${escapeHtml(taskStatusLabel(task.status))}</p>`,
      `<p><b>תאריך תזכורת:</b> ${escapeHtml(log.reminderDate)}</p>`,
      `<div style=\"white-space:pre-wrap;border:1px solid #d7e1ef;border-radius:10px;padding:12px;background:#f8fbff\">${escapeHtml(log.noteText)}</div>`,
      `<p><a href=\"${escapeHtml(url)}\" style=\"display:inline-block;padding:10px 14px;border-radius:10px;background:#0b4f8c;color:#fff;text-decoration:none;font-weight:bold\">פתח את המשימה</a></p>`,
      "</div>"
    ].join(""),
    idempotencyKey: `task-reminder-${log.id}-${log.reminderDate}`
  });
  await markTaskReminderSent(log.id);
  return { sent: true };
}

export async function runTaskReminderJob({ reminderDate = "", force = false } = {}) {
  const jobName = "task-reminders";
  const targetDate = jobKeyForDate(reminderDate);
  const jobKey = targetDate;
  const claimed = force || await claimJobRun(jobName, jobKey);
  if (!claimed) {
    return { ok: true, skipped: true, reason: "already_running_or_completed", jobName, jobKey };
  }

  try {
    const logs = await listTaskReminderLogsForDate(targetDate);
    let sentCount = 0;
    let skippedNoRecipients = 0;
    const errors = [];

    for (const log of logs) {
      const task = await getTaskById(log.taskId);
      if (!task) continue;
      try {
        const result = await sendReminderEmail(log, task);
        if (result.sent) sentCount += 1;
        else if (result.reason === "no_recipients") skippedNoRecipients += 1;
      } catch (error) {
        errors.push({ logId: log.id, message: clean(error?.message) || "שליחת תזכורת נכשלה" });
      }
    }

    const details = {
      reminderDate: targetDate,
      reminders: logs.length,
      sentCount,
      skippedNoRecipients,
      errors
    };
    await finalizeJobRun(jobName, jobKey, errors.length ? "failed" : "completed", details);
    return { ok: errors.length === 0, jobName, jobKey, ...details };
  } catch (error) {
    await finalizeJobRun(jobName, jobKey, "failed", { error: clean(error?.message) || "Task reminder job failed" });
    throw error;
  }
}
