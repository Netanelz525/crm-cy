import { initDb, sql } from "./db";
import { listNeonStudentsByFilters, searchNeonStudentsByText } from "./neon-students";
import { buildResendFromAddress, sendResendEmail } from "./resend";
import { sanitizeAnnouncementHtml } from "./announcements";
import { clean, INSTITUTIONS } from "./student-view";

export const EMAIL_CERTAINTY = {
  none: { level: 0, label: "אין כתובת", description: "אין לנו כתובת מייל לנמען הזה." },
  queued: { level: 1, label: "בתור", description: "השליחה נוצרה במערכת ועדיין לא יצאה לספק." },
  sent: { level: 2, label: "נשלח לספק", description: "Resend קיבל את ההודעה. זה לא אומר שהנמען פתח אותה." },
  opened: { level: 3, label: "נפתח", description: "נטען פיקסל מעקב מתוך המייל. המדד לא תמיד מדויק." },
  clicked: { level: 4, label: "נלחץ", description: "הנמען לחץ על קישור מתוך המייל. זה סימן חזק יותר מפתיחה." }
};

const ROLE_LABELS = {
  student: "תלמיד",
  father: "אב",
  mother: "אם",
  parent: "הורה",
  mixed: "הורה/תלמיד"
};

const MAX_ATTACHMENT_SIZE_BYTES = 8 * 1024 * 1024;
const MAX_ATTACHMENTS_TOTAL_BYTES = 20 * 1024 * 1024;

function normalizeEmail(value) {
  return clean(value).toLowerCase();
}

function studentName(student) {
  return clean(student?.name) || clean(student?.label) || [clean(student?.fullName?.firstName), clean(student?.fullName?.lastName)].filter(Boolean).join(" ") || "ללא שם";
}

function parentName(student, role) {
  if (role === "father") return clean(student?.shmHb) || "הורה";
  if (role === "mother") return clean(student?.shmHm) || "הורה";
  return clean(student?.shmHb) || clean(student?.shmHm) || "הורה";
}

function institutionLabel(value) {
  const key = clean(value).toUpperCase();
  return INSTITUTIONS[key] || clean(value);
}

function stripHtml(value) {
  return clean(value)
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>\s*/gi, "\n\n")
    .replace(/<\/li>\s*/gi, "\n")
    .replace(/<li>/gi, "• ")
    .replace(/<[^>]*>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .trim();
}

function normalizeHtml(value) {
  const safeHtml = sanitizeAnnouncementHtml(value);
  if (!safeHtml) return "";
  return safeHtml.includes("<p") || safeHtml.includes("<h") || safeHtml.includes("<ul") || safeHtml.includes("<ol")
    ? safeHtml
    : `<p>${safeHtml}</p>`;
}

function escapeHtml(value) {
  return clean(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function renderPlainTextToHtml(value) {
  return escapeHtml(value)
    .split(/\n{2,}/)
    .map((paragraph) => `<p>${paragraph.replace(/\n/g, "<br />")}</p>`)
    .join("");
}

function personalize(raw, { student, recipientName, recipientRoleLabel }) {
  const replacements = {
    "{{שם}}": recipientName || studentName(student),
    "{{תלמיד}}": studentName(student),
    "{{מוסד}}": institutionLabel(student?.currentInstitution) || clean(student?.currentInstitution),
    "{{שיעור}}": clean(student?.class),
    "{{נמען}}": recipientRoleLabel || ""
  };

  let out = String(raw || "");
  for (const [token, value] of Object.entries(replacements)) {
    out = out.split(token).join(value || "");
  }
  return out;
}

function buildGreeting(name) {
  const safeName = clean(name);
  return safeName ? `שלום ${safeName},` : "";
}

function trackingBaseUrl() {
  return clean(process.env.CRM_BASE_URL || process.env.APP_BASE_URL).replace(/\/$/, "");
}

function addTracking(html, deliveryId) {
  const baseUrl = trackingBaseUrl();
  if (!baseUrl) return html;

  const withTrackedLinks = html.replace(/href="(https?:\/\/[^"]+)"/g, (_match, url) => {
    const tracked = `${baseUrl}/api/email/click/${deliveryId}?url=${encodeURIComponent(url)}`;
    return `href="${tracked}"`;
  });
  const pixel = `<img src="${baseUrl}/api/email/open/${deliveryId}.gif" width="1" height="1" alt="" style="display:none;opacity:0" />`;
  return withTrackedLinks.includes("</body>")
    ? withTrackedLinks.replace("</body>", `${pixel}</body>`)
    : `${withTrackedLinks}${pixel}`;
}

export function renderEmailHtml({ subject, html = "", content = "" }) {
  const subjectText = escapeHtml(subject || "");
  const contentHtml = normalizeHtml(html) || renderPlainTextToHtml(content || "");
  return `<!DOCTYPE html>
<html dir="rtl" lang="he">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${subjectText}</title>
  <style>
    body { margin: 0; padding: 32px 16px; background: #f3f6fb; direction: rtl; font-family: Arial, Helvetica, sans-serif; color: #10243f; }
    .container { max-width: 640px; margin: 0 auto; background: #ffffff; border: 1px solid #d7e1ef; border-radius: 18px; overflow: hidden; }
    .header { background: linear-gradient(180deg, #f8fbff, #eef6ff); padding: 26px 32px; border-bottom: 1px solid #d7e1ef; }
    .title { margin: 0; font-size: 26px; line-height: 1.25; }
    .content { padding: 30px 32px; font-size: 16px; line-height: 1.8; }
    .content p, .content ul, .content ol, .content h2, .content h3 { margin: 0 0 18px; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header"><h1 class="title">${subjectText}</h1></div>
    <div class="content">${contentHtml}</div>
  </div>
</body>
</html>`;
}

async function fileToAttachment(file) {
  if (!file || !clean(file.name) || Number(file.size || 0) <= 0) return null;
  const sizeBytes = Number(file.size || 0);
  if (sizeBytes > MAX_ATTACHMENT_SIZE_BYTES) {
    throw new Error(`הקובץ ${clean(file.name)} חורג מהמגבלה של 8MB.`);
  }
  const bytes = Buffer.from(await file.arrayBuffer());
  return {
    filename: clean(file.name),
    content: bytes.toString("base64"),
    sizeBytes
  };
}

export async function buildAttachmentsFromForm(formData) {
  const files = formData.getAll("attachments") || [];
  const attachments = [];
  let totalBytes = 0;

  for (const file of files) {
    const attachment = await fileToAttachment(file);
    if (!attachment) continue;
    totalBytes += attachment.sizeBytes;
    if (totalBytes > MAX_ATTACHMENTS_TOTAL_BYTES) {
      throw new Error("סך הקבצים המצורפים חורג מהמגבלה של 20MB.");
    }
    attachments.push({
      filename: attachment.filename,
      content: attachment.content
    });
  }

  return attachments;
}

export function buildEmailFiltersFromForm(formData) {
  return {
    institution: clean(formData.get("institution")),
    class: clean(formData.get("class")),
    registration: clean(formData.get("registration")),
    familystatus: clean(formData.get("familystatus")),
    q: clean(formData.get("q")),
    recipientMode: clean(formData.get("recipientMode")) || "parents",
    sendScope: clean(formData.get("sendScope")) || "selected",
    selectedStudentIds: formData.getAll("studentIds").map(clean).filter(Boolean)
  };
}

export async function getEmailCandidateStudents(filters = {}) {
  const institution = clean(filters.institution);
  const classCode = clean(filters.class);
  const registration = clean(filters.registration);
  const familystatus = clean(filters.familystatus);
  const q = clean(filters.q);
  const requestedIds = Array.isArray(filters.selectedStudentIds) ? filters.selectedStudentIds.map(clean).filter(Boolean) : [];

  let students = [];
  if (q) {
    students = await searchNeonStudentsByText(q, 250, 0.35);
    if (institution) students = students.filter((student) => clean(student.currentInstitution).toUpperCase() === institution.toUpperCase());
    if (classCode) students = students.filter((student) => clean(student.class).toUpperCase() === classCode.toUpperCase());
  } else if (institution || classCode) {
    students = await listNeonStudentsByFilters({
      institution,
      class: classCode,
      registration,
      famliystatus: familystatus,
      limit: 250
    });
  } else {
    students = await listNeonStudentsByFilters({
      registration,
      famliystatus: familystatus,
      limit: 250
    });
  }

  if (institution) {
    const normalizedInstitution = institution.toUpperCase();
    students = students.filter((student) => clean(student?.currentInstitution).toUpperCase() === normalizedInstitution);
  }

  if (classCode) {
    const normalizedClass = classCode.toUpperCase();
    students = students.filter((student) => clean(student?.class).toUpperCase() === normalizedClass);
  }

  if (registration) {
    const normalizedRegistration = registration.toUpperCase();
    students = students.filter((student) => clean(student?.registration).toUpperCase() === normalizedRegistration);
  }

  if (familystatus) {
    const normalizedFamilyStatus = familystatus.toUpperCase();
    students = students.filter((student) => clean(student?.famliystatus).toUpperCase() === normalizedFamilyStatus);
  }

  if (requestedIds.length) {
    const requestedSet = new Set(requestedIds);
    students = students.filter((student) => requestedSet.has(clean(student.id)));
  }

  return students.slice(0, 250);
}

export function buildRecipientsForStudent(student, recipientMode = "parents") {
  const mode = clean(recipientMode) || "parents";
  const candidates = [];

  const add = (role, email, name) => {
    const normalized = normalizeEmail(email);
    if (!normalized) return;
    candidates.push({
      role,
      roleLabel: ROLE_LABELS[role] || role,
      email: normalized,
      name: clean(name)
    });
  };

  if (mode === "student" || mode === "all") add("student", student?.email?.primaryEmail, studentName(student));
  if (mode === "father" || mode === "parents" || mode === "all") add("father", student?.fatherEmail?.primaryEmail, parentName(student, "father"));
  if (mode === "mother" || mode === "parents" || mode === "all") add("mother", student?.motherEmail?.primaryEmail, parentName(student, "mother"));

  const seen = new Set();
  return candidates.filter((candidate) => {
    const key = `${candidate.role}:${candidate.email}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function aggregateRecipientRole(roles) {
  const list = Array.from(roles);
  if (!list.length) return "unknown";
  if (list.every((role) => role === "student")) return "student";
  if (list.every((role) => role === "father")) return "father";
  if (list.every((role) => role === "mother")) return "mother";
  if (list.every((role) => role === "father" || role === "mother")) return "parent";
  return "mixed";
}

export function buildDeliveryTargets(students, recipientMode = "parents") {
  const byEmail = new Map();

  for (const student of students) {
    const recipients = buildRecipientsForStudent(student, recipientMode);
    for (const recipient of recipients) {
      const key = recipient.email;
      if (!byEmail.has(key)) {
        byEmail.set(key, {
          email: recipient.email,
          roles: new Set(),
          roleLabels: new Set(),
          relatedStudents: [],
          recipientName: clean(recipient.name),
          primaryStudent: student
        });
      }

      const bucket = byEmail.get(key);
      bucket.roles.add(recipient.role);
      bucket.roleLabels.add(recipient.roleLabel);
      if (!bucket.recipientName && clean(recipient.name)) bucket.recipientName = clean(recipient.name);
      if (!bucket.relatedStudents.some((item) => clean(item.id) === clean(student.id))) {
        bucket.relatedStudents.push({
          id: clean(student.id),
          name: studentName(student)
        });
      }
    }
  }

  return Array.from(byEmail.values()).map((item) => {
    const recipientRole = aggregateRecipientRole(item.roles);
    return {
      email: item.email,
      recipientRole,
      recipientRoleLabel: ROLE_LABELS[recipientRole] || Array.from(item.roleLabels).join(" / "),
      recipientName: item.recipientName || studentName(item.primaryStudent),
      primaryStudent: item.primaryStudent,
      relatedStudents: item.relatedStudents
    };
  });
}

export function summarizeEmailCandidates(students, recipientMode) {
  const dedupedRecipients = buildDeliveryTargets(students, recipientMode);
  const summary = {
    students: students.length,
    recipientEmails: dedupedRecipients.length,
    missingStudents: 0,
    fatherEmails: 0,
    motherEmails: 0,
    studentEmails: 0
  };

  for (const student of students) {
    const recipients = buildRecipientsForStudent(student, recipientMode);
    if (!recipients.length) summary.missingStudents += 1;
    if (recipients.some((recipient) => recipient.role === "father")) summary.fatherEmails += 1;
    if (recipients.some((recipient) => recipient.role === "mother")) summary.motherEmails += 1;
    if (recipients.some((recipient) => recipient.role === "student")) summary.studentEmails += 1;
  }

  return summary;
}

function buildMessageParts({ subject, bodyText, bodyHtml, includeGreeting, recipientName, recipientRoleLabel, student }) {
  const personalizedSubject = personalize(subject, { student, recipientName, recipientRoleLabel });
  const personalizedText = personalize(bodyText, { student, recipientName, recipientRoleLabel });
  const personalizedHtml = personalize(bodyHtml, { student, recipientName, recipientRoleLabel });
  const greeting = includeGreeting ? buildGreeting(recipientName) : "";

  const finalText = greeting ? `${greeting}\n\n${personalizedText}` : personalizedText;
  const finalHtml = greeting
    ? `<p>${escapeHtml(greeting)}</p>${normalizeHtml(personalizedHtml)}`
    : normalizeHtml(personalizedHtml);

  return {
    subject: personalizedSubject,
    text: finalText.trim(),
    html: finalHtml,
    greeting
  };
}

export function buildPreviewMessageParts({ subject, bodyText, bodyHtml, includeGreeting, recipientName, recipientRoleLabel, student }) {
  return buildMessageParts({ subject, bodyText, bodyHtml, includeGreeting, recipientName, recipientRoleLabel, student });
}

function defaultSenderNameForInstitution(institution) {
  const label = institutionLabel(institution);
  return label ? `משרד ישיבת ${label}` : "משרד הישיבה";
}

function inferInstitutionFromStudents(students = []) {
  const institutions = Array.from(new Set(
    (Array.isArray(students) ? students : [])
      .map((student) => clean(student?.currentInstitution))
      .filter(Boolean)
  ));
  return institutions.length === 1 ? institutions[0] : "";
}

export async function sendEmailCampaign({ formData, createdByUserId, permissions = {} }) {
  await initDb();
  const filters = buildEmailFiltersFromForm(formData);
  const subject = clean(formData.get("subject"));
  const rawBodyHtml = String(formData.get("bodyHtml") || "");
  const sanitizedBodyHtml = normalizeHtml(rawBodyHtml);
  const bodyText = stripHtml(String(formData.get("bodyText") || "")) || stripHtml(sanitizedBodyHtml);
  const includeGreeting = clean(formData.get("includeGreeting")) !== "0";
  const senderNameInput = clean(formData.get("senderName"));
  const defaultSenderName = defaultSenderNameForInstitution(filters.institution);
  const senderName = permissions.canEditEmailSender ? (senderNameInput || defaultSenderName) : defaultSenderName;
  const attachments = await buildAttachmentsFromForm(formData);

  if (!subject) throw new Error("יש להזין נושא למייל.");
  if (!sanitizedBodyHtml && !bodyText) throw new Error("יש להזין תוכן למייל.");
  if (!permissions.canEmailParents && ["parents", "father", "mother", "all"].includes(filters.recipientMode)) {
    throw new Error("למשתמש הנוכחי אין הרשאה לשלוח להורים.");
  }

  const allStudents = await getEmailCandidateStudents(filters);
  const selectedIds = new Set(filters.selectedStudentIds);
  const targetStudents = filters.sendScope === "filtered"
    ? allStudents
    : allStudents.filter((student) => selectedIds.has(clean(student.id)));

  if (!targetStudents.length) throw new Error("לא נבחרו תלמידים לשליחה.");

  const targets = buildDeliveryTargets(targetStudents, filters.recipientMode);
  if (!targets.length) throw new Error("לא נמצאו נמענים עם כתובת מייל.");
  const studentsWithoutRecipients = targetStudents.filter((student) => buildRecipientsForStudent(student, filters.recipientMode).length === 0).length;

  const campaignId = crypto.randomUUID();
  await sql`
    INSERT INTO email_campaigns (
      id,
      subject,
      body_text,
      body_html,
      sender_name,
      institution,
      class_filter,
      recipient_mode,
      send_scope,
      include_greeting,
      status,
      total_recipients,
      filter_json,
      created_by_user_id,
      locked_at,
      updated_at
    )
    VALUES (
      ${campaignId},
      ${subject},
      ${bodyText},
      ${sanitizedBodyHtml},
      ${senderName},
      ${filters.institution || null},
      ${filters.class || null},
      ${filters.recipientMode},
      ${filters.sendScope},
      ${includeGreeting},
      'sending',
      ${targets.length},
      ${JSON.stringify(filters)}::jsonb,
      ${clean(createdByUserId) || null},
      NOW(),
      NOW()
    )
  `;

  let sent = 0;
  let failed = 0;

  for (const target of targets) {
    const deliveryId = crypto.randomUUID();
    const idempotencyKey = `${campaignId}:${target.email}`;
    const content = buildMessageParts({
      subject,
      bodyText,
      bodyHtml: sanitizedBodyHtml,
      includeGreeting,
      recipientName: target.recipientName,
      recipientRoleLabel: target.recipientRoleLabel,
      student: target.primaryStudent
    });
    const htmlWithTracking = addTracking(renderEmailHtml({
      subject: content.subject,
      html: content.html,
      content: content.text
    }), deliveryId);

    await sql`
      INSERT INTO email_deliveries (
        id,
        campaign_id,
        student_id,
        student_name,
        recipient_role,
        recipient_email,
        recipient_name,
        personalized_greeting,
        subject,
        sender_name,
        related_student_ids,
        related_student_names,
        idempotency_key,
        certainty_level,
        status
      )
      VALUES (
        ${deliveryId},
        ${campaignId},
        ${clean(target.primaryStudent?.id)},
        ${studentName(target.primaryStudent)},
        ${target.recipientRole},
        ${target.email},
        ${target.recipientName},
        ${content.greeting},
        ${content.subject},
        ${senderName},
        ${JSON.stringify(target.relatedStudents.map((student) => student.id))}::jsonb,
        ${JSON.stringify(target.relatedStudents.map((student) => student.name))}::jsonb,
        ${idempotencyKey},
        ${EMAIL_CERTAINTY.queued.level},
        'queued'
      )
      ON CONFLICT (campaign_id, recipient_email) DO NOTHING
    `;

    try {
      const result = await sendResendEmail({
        to: target.email,
        subject: content.subject,
        text: content.text,
        html: htmlWithTracking,
        from: buildResendFromAddress(senderName),
        attachments,
        idempotencyKey
      });

      await sql`
        UPDATE email_deliveries
        SET
          status = 'sent',
          certainty_level = ${EMAIL_CERTAINTY.sent.level},
          provider_message_id = ${clean(result.id)},
          sent_at = NOW(),
          updated_at = NOW()
        WHERE id = ${deliveryId}
      `;
      sent += 1;
    } catch (error) {
      await sql`
        UPDATE email_deliveries
        SET
          status = 'failed',
          error_message = ${clean(error?.message)},
          updated_at = NOW()
        WHERE id = ${deliveryId}
      `;
      failed += 1;
    }
  }

  await sql`
    UPDATE email_campaigns
    SET
      status = ${failed > 0 && sent === 0 ? "failed" : "sent"},
      sent_count = ${sent},
      failed_count = ${failed},
      sent_at = NOW(),
      updated_at = NOW()
    WHERE id = ${campaignId}
  `;

  return {
    campaignId,
    sent,
    failed,
    skipped: studentsWithoutRecipients
  };
}

export async function listRecentEmailDeliveries(limit = 30) {
  await initDb();
  return sql`
    SELECT
      id,
      campaign_id,
      student_name,
      recipient_role,
      recipient_email,
      recipient_name,
      subject,
      sender_name,
      certainty_level,
      status,
      error_message,
      open_count,
      opened_at,
      clicked_at,
      sent_at,
      created_at
    FROM email_deliveries
    ORDER BY created_at DESC
    LIMIT ${Math.max(1, Math.min(100, Number(limit) || 30))}
  `;
}

export async function listRecentEmailCampaigns(limit = 12) {
  await initDb();
  return sql`
    SELECT
      id,
      subject,
      sender_name,
      institution,
      class_filter,
      recipient_mode,
      total_recipients,
      sent_count,
      failed_count,
      opened_count,
      status,
      sent_at,
      created_at
    FROM email_campaigns
    ORDER BY created_at DESC
    LIMIT ${Math.max(1, Math.min(50, Number(limit) || 12))}
  `;
}

export async function markEmailOpened(deliveryId) {
  await initDb();
  await sql`
    UPDATE email_deliveries
    SET
      status = CASE WHEN status = 'sent' THEN 'opened' ELSE status END,
      certainty_level = GREATEST(certainty_level, ${EMAIL_CERTAINTY.opened.level}),
      open_count = COALESCE(open_count, 0) + 1,
      opened_at = COALESCE(opened_at, NOW()),
      updated_at = NOW()
    WHERE id = ${clean(deliveryId)}
  `;

  await sql`
    UPDATE email_campaigns
    SET
      opened_count = (
        SELECT COUNT(*)
        FROM email_deliveries
        WHERE campaign_id = email_campaigns.id
          AND open_count > 0
      ),
      updated_at = NOW()
    WHERE id = (
      SELECT campaign_id
      FROM email_deliveries
      WHERE id = ${clean(deliveryId)}
      LIMIT 1
    )
  `;
}

export async function markEmailClicked(deliveryId) {
  await initDb();
  await sql`
    UPDATE email_deliveries
    SET
      status = 'clicked',
      certainty_level = GREATEST(certainty_level, ${EMAIL_CERTAINTY.clicked.level}),
      clicked_at = COALESCE(clicked_at, NOW()),
      updated_at = NOW()
    WHERE id = ${clean(deliveryId)}
  `;
}

export function buildDefaultSenderName(institution) {
  return defaultSenderNameForInstitution(institution);
}

export function buildDefaultSenderNameForStudents(students = []) {
  return defaultSenderNameForInstitution(inferInstitutionFromStudents(students));
}
