import { initDb, sql } from "./db.js";
import { sendResendEmail, buildResendFromAddress } from "./resend.js";
import { listStudentEventReminderDigest } from "./student-events.js";

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

function normalizeTagName(value) {
  return clean(value).toLowerCase().replace(/\s+/g, " ");
}

function formatJerusalemDateTime(date = new Date()) {
  return new Intl.DateTimeFormat("he-IL", {
    timeZone: "Asia/Jerusalem",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  }).format(date);
}

function formatEventOffsetLabel(daysUntil) {
  const normalized = Number(daysUntil);
  if (!Number.isFinite(normalized)) return "-";
  if (normalized === 0) return "היום";
  if (normalized === 1) return "מחר";
  if (normalized > 1) return `בעוד ${normalized} ימים`;
  if (normalized === -1) return "אתמול";
  return `לפני ${Math.abs(normalized)} ימים`;
}

function currentJobKey() {
  return new Date().toISOString().slice(0, 10);
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

export function assertCronAuthorized(request) {
  const secret = clean(process.env.CRON_SECRET);
  if (!secret) {
    throw new Error("Missing CRON_SECRET env variable.");
  }
  return clean(request.headers.get("authorization")) === `Bearer ${secret}`;
}

function isThursdayInJerusalem(date = new Date()) {
  const weekday = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Jerusalem",
    weekday: "short"
  }).format(date);
  return weekday === "Thu";
}

function getBaseUrl() {
  const raw = clean(process.env.VERCEL_PROJECT_PRODUCTION_URL || process.env.VERCEL_URL);
  if (!raw) return "";
  return `https://${raw.replace(/^https?:\/\//, "").replace(/\/$/, "")}`;
}

async function listEventReminderRecipients(tagName = "צוות חכמי") {
  await initDb();
  const normalizedTagName = normalizeTagName(tagName);
  const rows = await sql`
    SELECT DISTINCT
      u.clerk_user_id,
      u.email,
      u.display_name,
      u.created_at AS user_created_at,
      u.linked_student_id,
      u.linked_student_class,
      ns.full_name AS linked_student_name,
      ns.current_institution AS linked_student_institution,
      t.name AS tag_name
    FROM app_users u
    JOIN student_tag_assignments a
      ON a.student_id = u.linked_student_id
    JOIN student_tags t
      ON t.id = a.tag_id
    LEFT JOIN neon_students ns
      ON ns.student_id = u.linked_student_id
    WHERE LOWER(BTRIM(COALESCE(t.normalized_name, t.name, ''))) = ${normalizedTagName}
      AND COALESCE(NULLIF(BTRIM(u.email), ''), '') <> ''
    ORDER BY user_created_at ASC
  `;

  return rows.map((row) => ({
    clerkUserId: clean(row?.clerk_user_id),
    email: clean(row?.email),
    displayName: clean(row?.display_name),
    linkedStudentId: clean(row?.linked_student_id),
    linkedStudentClass: clean(row?.linked_student_class),
    linkedStudentName: clean(row?.linked_student_name),
    linkedStudentInstitution: clean(row?.linked_student_institution),
    tagName: clean(row?.tag_name) || tagName
  }));
}

function buildStudentLink(studentId) {
  const baseUrl = getBaseUrl();
  const normalizedId = clean(studentId);
  if (!baseUrl || !normalizedId) return "";
  return `${baseUrl}/neon/students/${normalizedId}`;
}

function buildDigestTextSection(title, events = []) {
  if (!events.length) {
    return `${title}\n- אין אירועים ברשימה זו.`;
  }

  return [
    title,
    ...events.map((event, index) => {
      const occurrence = event?.relevantOccurrence || event?.nextOccurrence || null;
      const detailLines = [
        `${index + 1}. ${event.eventLabel} | ${event.studentName || "ללא שם"} | ${event.hebrewDateLabel}`,
        `   תאריך בפועל: ${occurrence?.hebrewDateDisplay || event.hebrewDateLabel} | לועזי: ${occurrence?.gregorianDisplay || "-"}`,
        `   זמן: ${formatEventOffsetLabel(occurrence?.daysUntil)} | שיעור: ${event.studentClass || "-"} | מוסד: ${event.currentInstitution || "-"}`,
        `   הערה: ${event.noteText || "-"}`
      ];
      if (occurrence?.adjustmentNote) detailLines.push(`   התאמה: ${occurrence.adjustmentNote}`);
      const studentLink = buildStudentLink(event.studentId);
      if (studentLink) detailLines.push(`   כרטיס תלמיד: ${studentLink}`);
      return detailLines.join("\n");
    })
  ].join("\n");
}

function buildDigestHtmlSection(title, events = []) {
  if (!events.length) {
    return `<h3>${escapeHtml(title)}</h3><p>אין אירועים ברשימה זו.</p>`;
  }

  const items = events.map((event) => {
    const occurrence = event?.relevantOccurrence || event?.nextOccurrence || null;
    const studentLink = buildStudentLink(event.studentId);
    const linkHtml = studentLink
      ? ` <a href="${escapeHtml(studentLink)}">פתח כרטיס תלמיד</a>`
      : "";

    return `
      <li style="margin-bottom:16px;">
        <div><strong>${escapeHtml(event.eventLabel)}</strong> | ${escapeHtml(event.studentName || "ללא שם")}</div>
        <div>תאריך שנרשם: ${escapeHtml(event.hebrewDateLabel)}</div>
        <div>התאריך בפועל השנה: ${escapeHtml(occurrence?.hebrewDateDisplay || event.hebrewDateLabel)}</div>
        <div>מועד לועזי: ${escapeHtml(occurrence?.gregorianDisplay || "-")} | ${escapeHtml(formatEventOffsetLabel(occurrence?.daysUntil))}</div>
        <div>שיעור: ${escapeHtml(event.studentClass || "-")} | מוסד: ${escapeHtml(event.currentInstitution || "-")}</div>
        <div>הערה: ${escapeHtml(event.noteText || "-")}</div>
        ${occurrence?.adjustmentNote ? `<div>התאמה שנתית: ${escapeHtml(occurrence.adjustmentNote)}</div>` : ""}
        ${linkHtml ? `<div>${linkHtml}</div>` : ""}
      </li>
    `;
  }).join("");

  return `<h3>${escapeHtml(title)}</h3><ol>${items}</ol>`;
}

function buildReminderEmail({ digest, generatedAt }) {
  const upcomingTitle = `אירועים ב-${digest.daysAhead} הימים הקרובים`;
  const pastTitle = `אירועים שחלו ב-${digest.daysBack} הימים האחרונים`;

  const text = [
    "תזכורת אירועים שבועית לצוות חכמי",
    `נוצר בתאריך: ${generatedAt}`,
    "",
    buildDigestTextSection(upcomingTitle, digest.upcoming),
    "",
    buildDigestTextSection(pastTitle, digest.recentPast)
  ].join("\n");

  const html = `
    <div dir="rtl" style="font-family:Arial,sans-serif;line-height:1.7;color:#0f172a;">
      <h2 style="margin-bottom:8px;">תזכורת אירועים שבועית לצוות חכמי</h2>
      <p style="margin-top:0;color:#475569;">נוצר בתאריך: ${escapeHtml(generatedAt)}</p>
      ${buildDigestHtmlSection(upcomingTitle, digest.upcoming)}
      ${buildDigestHtmlSection(pastTitle, digest.recentPast)}
    </div>
  `;

  return { text, html };
}

export async function runStudentEventReminderJob({ force = false } = {}) {
  const now = new Date();
  if (!force && !isThursdayInJerusalem(now)) {
    return {
      ok: true,
      skipped: true,
      reason: "not_thursday"
    };
  }

  const jobName = "student-event-reminders";
  const jobKey = currentJobKey();
  const claimed = force ? true : await claimJobRun(jobName, jobKey);
  if (!claimed) {
    return {
      ok: true,
      skipped: true,
      reason: "already_ran_today"
    };
  }

  try {
    const recipients = await listEventReminderRecipients("צוות חכמי");
    const digest = await listStudentEventReminderDigest({ daysAhead: 10, daysBack: 10, fromDate: now });
    const generatedAt = formatJerusalemDateTime(now);
    const message = buildReminderEmail({ digest, generatedAt });
    const subject = `תזכורת אירועים שבועית | ${generatedAt}`;
    let sentCount = 0;

    for (const recipient of recipients) {
      await sendResendEmail({
        to: recipient.email,
        from: buildResendFromAddress("CRM חכמי"),
        subject,
        text: message.text,
        html: message.html,
        idempotencyKey: `${jobName}:${jobKey}:${recipient.clerkUserId || recipient.email}`
      });
      sentCount += 1;
    }

    const details = {
      recipients: recipients.length,
      sentCount,
      upcomingCount: digest.upcoming.length,
      recentPastCount: digest.recentPast.length
    };

    if (!force) {
      await finalizeJobRun(jobName, jobKey, "completed", details);
    }

    return {
      ok: true,
      ...details
    };
  } catch (error) {
    if (!force) {
      await finalizeJobRun(jobName, jobKey, "failed", {
        error: error?.message || String(error)
      });
    }
    throw error;
  }
}
