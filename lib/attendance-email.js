import { randomUUID } from "node:crypto";
import { initDb, sql } from "./db";
import {
  ATTENDANCE_STATUS_LABELS,
  getAttendanceRoster,
  normalizeAttendanceStatus,
  saveAttendanceRecord,
  updateAttendanceSessionMessaging
} from "./attendance";
import { getNeonStudentById } from "./neon-students";
import {
  buildPreviewMessageParts,
  buildRecipientsForStudent,
  getUnsubscribedEmailSet,
  normalizeRecipientRoles,
  renderEmailHtml
} from "./email-campaigns";
import { buildResendFromAddress, sendResendEmail } from "./resend";

function clean(value) {
  return String(value || "").trim();
}

function normalizeStatusList(values) {
  const raw = Array.isArray(values) ? values : [values];
  return Array.from(new Set(raw.map((value) => normalizeAttendanceStatus(value)).filter((value) => ATTENDANCE_STATUS_LABELS[value])));
}

function getBaseUrl() {
  const value = clean(process.env.CRM_BASE_URL || process.env.APP_BASE_URL);
  return value.replace(/\/+$/, "");
}

function responseLink(tokenId) {
  const baseUrl = getBaseUrl();
  if (!baseUrl) throw new Error("Missing CRM_BASE_URL or APP_BASE_URL for attendance email links.");
  return `${baseUrl}/api/attendance/respond/${encodeURIComponent(clean(tokenId))}`;
}

function statusLabel(status) {
  const normalized = normalizeAttendanceStatus(status);
  return ATTENDANCE_STATUS_LABELS[normalized] || ATTENDANCE_STATUS_LABELS.missing;
}

function buildAttendanceEmailSubject(session) {
  return [
    "עדכון נוכחות",
    clean(session?.institutionLabel),
    clean(session?.sessionTypeLabel || session?.title),
    clean(session?.sessionDate)
  ].filter(Boolean).join(" | ");
}

function buildButtonsHtml(buttons) {
  if (!buttons.length) return "";
  return `
    <div style="margin-top:24px">
      <div style="margin-bottom:10px;font-weight:700;color:#17365d;">עדכון מהיר מתוך המייל:</div>
      <div style="display:flex;flex-wrap:wrap;gap:10px;">
        ${buttons.map((button) => `
          <a href="${button.url}" style="display:inline-block;padding:10px 16px;border-radius:999px;background:#0f5fa4;color:#ffffff;text-decoration:none;font-weight:700;">
            ${button.label}
          </a>
        `).join("")}
      </div>
    </div>
  `;
}

function buildButtonsText(buttons) {
  if (!buttons.length) return "";
  return `\n\nעדכון מהיר מתוך המייל:\n${buttons.map((button) => `${button.label}: ${button.url}`).join("\n")}`;
}

async function resolveCreatedByUserId(value) {
  const normalized = clean(value);
  if (!normalized) return null;
  const rows = await sql`
    SELECT clerk_user_id
    FROM app_users
    WHERE clerk_user_id = ${normalized}
    LIMIT 1
  `;
  return clean(rows?.[0]?.clerk_user_id) || null;
}

async function createResponseToken({ sessionId, studentId, recipientEmail, recipientName, recipientRole, status, createdByUserId }) {
  const id = randomUUID();
  const validCreatedByUserId = await resolveCreatedByUserId(createdByUserId);
  await sql`
    INSERT INTO attendance_email_response_tokens (
      id,
      session_id,
      student_id,
      recipient_email,
      recipient_name,
      recipient_role,
      status,
      created_by_user_id,
      created_at
    )
    VALUES (
      ${id},
      ${clean(sessionId)},
      ${clean(studentId)},
      ${clean(recipientEmail).toLowerCase()},
      ${clean(recipientName)},
      ${clean(recipientRole)},
      ${normalizeAttendanceStatus(status)},
      ${validCreatedByUserId},
      NOW()
    )
  `;
  return id;
}

function hasAnyRecipientEmail(student) {
  return Boolean(
    clean(student?.email?.primaryEmail)
    || clean(student?.fatherEmail?.primaryEmail)
    || clean(student?.motherEmail?.primaryEmail)
  );
}

export async function sendAttendanceSessionEmails({
  sessionId,
  personalMessage = "",
  emailResponseStatuses = [],
  targetStatuses = [],
  recipientRoles = ["father", "mother", "student"],
  createdByUserId = ""
}) {
  await initDb();
  const roster = await getAttendanceRoster(sessionId);
  if (!roster) throw new Error("Attendance session not found.");

  const messageText = clean(personalMessage || roster.session.personalMessage);
  if (!messageText) throw new Error("יש להזין הודעה אישית לפני שליחת מיילים.");

  const responseStatuses = normalizeStatusList(emailResponseStatuses.length ? emailResponseStatuses : roster.session.emailResponseStatuses);
  if (!responseStatuses.length) throw new Error("יש לבחור לפחות סטטוס אחד לעדכון דרך המייל.");
  const normalizedRecipientRoles = normalizeRecipientRoles(recipientRoles.length ? recipientRoles : roster.session.emailRecipientRoles);
  if (!normalizedRecipientRoles.length) throw new Error("יש לבחור לפחות סוג נמען אחד לשליחת מיילים.");

  const sendStatuses = normalizeStatusList(targetStatuses.length ? targetStatuses : ["missing"]);
  const selectedRosterStudents = roster.students.filter((student) => sendStatuses.includes(normalizeAttendanceStatus(student.status)));
  if (!selectedRosterStudents.length) {
    return {
      ok: true,
      sessionId: roster.session.id,
      targetStatuses: sendStatuses,
      responseStatuses,
      recipientRoles: normalizedRecipientRoles,
      matchedStudents: 0,
      sentEmails: 0,
      skippedBlacklisted: 0,
      missingRecipients: 0
    };
  }

  await updateAttendanceSessionMessaging(roster.session.id, {
    personalMessage: messageText,
    emailResponseStatuses: responseStatuses,
    emailRecipientRoles: normalizedRecipientRoles
  });

  const fullStudents = await Promise.all(selectedRosterStudents.map((student) => getNeonStudentById(student.id)));
  const selectedStudents = fullStudents.filter(Boolean);
  const rawRecipients = [];
  let missingRecipients = 0;

  for (const student of selectedStudents) {
    const recipients = buildRecipientsForStudent(student, normalizedRecipientRoles);
    if (!recipients.length) {
      if (!hasAnyRecipientEmail(student)) missingRecipients += 1;
      continue;
    }
    for (const recipient of recipients) {
      rawRecipients.push({
        student,
        recipient
      });
    }
  }

  const blockedEmails = await getUnsubscribedEmailSet(rawRecipients.map((item) => item.recipient.email));
  let sentEmails = 0;
  let skippedBlacklisted = 0;
  const subject = buildAttendanceEmailSubject(roster.session);

  for (const item of rawRecipients) {
    if (blockedEmails.has(clean(item.recipient.email).toLowerCase())) {
      skippedBlacklisted += 1;
      continue;
    }

    const buttons = [];
    for (const status of responseStatuses) {
      const tokenId = await createResponseToken({
        sessionId: roster.session.id,
        studentId: item.student.id,
        recipientEmail: item.recipient.email,
        recipientName: item.recipient.name,
        recipientRole: item.recipient.role,
        status,
        createdByUserId
      });
      buttons.push({
        label: statusLabel(status),
        url: responseLink(tokenId)
      });
    }

    const parts = buildPreviewMessageParts({
      subject,
      bodyText: `${messageText}\n\nתלמיד: ${clean(item.student.label)}\nשיעור: ${clean(item.student.class) || "-"}`,
      bodyHtml: "",
      includeGreeting: true,
      recipientName: item.recipient.name || item.recipient.email,
      recipientRoleLabel: item.recipient.roleLabel,
      student: item.student
    });
    const html = renderEmailHtml({
      subject: parts.subject,
      html: `${parts.html}${buildButtonsHtml(buttons)}`
    });
    const text = `${parts.text}${buildButtonsText(buttons)}`;

    await sendResendEmail({
      to: item.recipient.email,
      subject: parts.subject,
      text,
      html,
      from: buildResendFromAddress("מערכת נוכחות")
    });
    sentEmails += 1;
  }

  return {
    ok: true,
    sessionId: roster.session.id,
    targetStatuses: sendStatuses,
    responseStatuses,
    recipientRoles: normalizedRecipientRoles,
    matchedStudents: selectedStudents.length,
    sentEmails,
    skippedBlacklisted,
    missingRecipients
  };
}

export async function applyAttendanceEmailResponseToken(tokenId) {
  await initDb();
  const rows = await sql`
    SELECT
      t.id,
      t.session_id,
      t.student_id,
      t.recipient_email,
      t.status,
      t.created_by_user_id,
      s.session_date,
      s.title,
      s.session_type
    FROM attendance_email_response_tokens t
    INNER JOIN attendance_sessions s
      ON s.id = t.session_id
    WHERE t.id = ${clean(tokenId)}
    LIMIT 1
  `;
  const token = rows[0] || null;
  if (!token) throw new Error("קישור העדכון לא נמצא או שאינו תקין.");

  const student = await getNeonStudentById(token.student_id);
  const existingRows = await sql`
    SELECT note_text
    FROM attendance_records
    WHERE session_id = ${clean(token.session_id)}
      AND student_id = ${clean(token.student_id)}
    LIMIT 1
  `;
  const existingNoteText = clean(existingRows?.[0]?.note_text);
  await saveAttendanceRecord({
    sessionId: token.session_id,
    record: {
      studentId: token.student_id,
      studentName: clean(student?.label) || clean(token.student_id),
      studentClass: clean(student?.class),
      status: token.status,
      noteText: existingNoteText || "עודכן דרך קישור מייל"
    },
    markedByUserId: clean(token.created_by_user_id) || null
  });

  await sql`
    UPDATE attendance_email_response_tokens
    SET used_at = NOW()
    WHERE id = ${clean(tokenId)}
  `;

  return {
    sessionId: clean(token.session_id),
    sessionDate: clean(token.session_date),
    sessionTitle: clean(token.title),
    studentName: clean(student?.label) || clean(token.student_id),
    status: normalizeAttendanceStatus(token.status),
    statusLabel: statusLabel(token.status)
  };
}
