import { randomUUID } from "node:crypto";
import { initDb, sql } from "./db";
import {
  ATTENDANCE_STATUS_LABELS,
  buildAttendanceStatusLabels,
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

function normalizeStatusList(values, customStatuses = []) {
  const statusLabels = buildAttendanceStatusLabels(customStatuses);
  const raw = Array.isArray(values) ? values : [values];
  return Array.from(new Set(raw.map((value) => normalizeAttendanceStatus(value)).filter((value) => statusLabels[value])));
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

function statusLabel(status, statusLabels = ATTENDANCE_STATUS_LABELS) {
  const normalized = normalizeAttendanceStatus(status);
  return statusLabels[normalized] || ATTENDANCE_STATUS_LABELS[normalized] || normalized;
}

function buildAttendanceEmailSubject(session) {
  if (clean(session?.emailSubject)) return clean(session.emailSubject);
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
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin-top:24px;">
      <tr>
        <td style="padding:0 0 10px;font-weight:700;color:#17365d;">עדכון מהיר מתוך המייל:</td>
      </tr>
      <tr>
        <td>
          <table role="presentation" cellpadding="0" cellspacing="0" border="0">
            <tr>
              ${buttons.map((button) => `
                <td style="padding:0 0 10px 10px;">
                  <a href="${button.url}" style="display:inline-block;padding:12px 18px;border-radius:999px;background:#0f5fa4;color:#ffffff !important;text-decoration:none;font-weight:700;border:1px solid #0f5fa4;white-space:nowrap;">
                    ${button.label}
                  </a>
                </td>
              `).join("")}
            </tr>
          </table>
        </td>
      </tr>
    </table>
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
  emailSubject = "",
  personalMessage = "",
  emailResponseStatuses = [],
  targetStatuses = [],
  recipientRoles = ["father", "mother", "student"],
  createdByUserId = ""
}) {
  await initDb();
  const roster = await getAttendanceRoster(sessionId);
  if (!roster) throw new Error("Attendance session not found.");
  const statusLabels = buildAttendanceStatusLabels(roster.session.customStatuses);

  const subjectText = clean(emailSubject || roster.session.emailSubject);
  const messageText = clean(personalMessage || roster.session.personalMessage);
  if (!subjectText) throw new Error("יש להזין נושא מייל לפני שליחת מיילים.");
  if (!messageText) throw new Error("יש להזין הודעה אישית לפני שליחת מיילים.");

  const responseStatuses = normalizeStatusList(emailResponseStatuses.length ? emailResponseStatuses : roster.session.emailResponseStatuses, roster.session.customStatuses);
  if (!responseStatuses.length) throw new Error("יש לבחור לפחות סטטוס אחד לעדכון דרך המייל.");
  const normalizedRecipientRoles = normalizeRecipientRoles(recipientRoles.length ? recipientRoles : roster.session.emailRecipientRoles);
  if (!normalizedRecipientRoles.length) throw new Error("יש לבחור לפחות סוג נמען אחד לשליחת מיילים.");

  const sendStatuses = normalizeStatusList(targetStatuses.length ? targetStatuses : ["missing"], roster.session.customStatuses);
  const selectedRosterStudents = roster.students.filter((student) => sendStatuses.includes(normalizeAttendanceStatus(student.status)));
  if (!selectedRosterStudents.length) {
    return {
      ok: true,
      sessionId: roster.session.id,
      emailSubject: subjectText,
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
    emailSubject: subjectText,
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
  let failedEmails = 0;
  const subject = subjectText || buildAttendanceEmailSubject(roster.session);

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
        label: statusLabel(status, statusLabels),
        url: responseLink(tokenId)
      });
    }

    const parts = buildPreviewMessageParts({
      subject,
      bodyText: messageText,
      bodyHtml: "",
      includeGreeting: true,
      recipientName: item.recipient.name || item.recipient.email,
      recipientRoleLabel: item.recipient.roleLabel,
      student: item.student
    });
    const html = renderEmailHtml({
      subject: parts.subject,
      html: `${parts.html}${buildButtonsHtml(buttons)}`,
      trustedHtml: true
    });
    const text = `${parts.text}${buildButtonsText(buttons)}`;

    try {
      await sendResendEmail({
        to: item.recipient.email,
        subject: parts.subject,
        text,
        html,
        from: buildResendFromAddress("מערכת נוכחות")
      });
      sentEmails += 1;
    } catch (error) {
      failedEmails += 1;
    }
  }

  return {
    ok: true,
    sessionId: roster.session.id,
    emailSubject: subject,
    targetStatuses: sendStatuses,
    responseStatuses,
    recipientRoles: normalizedRecipientRoles,
    matchedStudents: selectedStudents.length,
    sentEmails,
    failedEmails,
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
