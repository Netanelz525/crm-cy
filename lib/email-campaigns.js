import { initDb, sql } from "./db";
import { listNeonStudentsByFilters, searchNeonStudentsByText } from "./neon-students";
import { buildResendFromAddress, sendResendEmail } from "./resend";
import { sanitizeAnnouncementHtml } from "./announcements";
import { clean, INSTITUTIONS } from "./student-view";
import * as XLSX from "xlsx";

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

const RESEND_MAX_EMAIL_SIZE_BYTES = 40 * 1024 * 1024;
const ATTACHMENT_OVERHEAD_BUFFER_BYTES = 1 * 1024 * 1024;
const SAFE_ATTACHMENT_TOTAL_BYTES = 20 * 1024 * 1024;

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

function unsubscribeUrl(deliveryId) {
  const baseUrl = trackingBaseUrl();
  if (!baseUrl || !clean(deliveryId)) return "";
  return `${baseUrl}/email/unsubscribe?delivery=${encodeURIComponent(clean(deliveryId))}`;
}

function addTracking(html, deliveryId) {
  const baseUrl = trackingBaseUrl();
  if (!baseUrl) return html;

  const withTrackedLinks = html.replace(/href="(https?:\/\/[^"]+)"/g, (_match, url) => {
    const tracked = `${baseUrl}/api/email/click/${deliveryId}?url=${encodeURIComponent(url)}`;
    return `href="${tracked}"`;
  });
  const unsubscribeHref = unsubscribeUrl(deliveryId);
  const unsubscribeBlock = unsubscribeHref
    ? `<div dir="rtl" align="right" style="margin-top:24px;padding-top:16px;border-top:1px solid #d7e1ef;font-size:13px;line-height:1.7;color:#5a6f86;text-align:right;">
        אם אינך מעוניין לקבל עדכונים מאיתנו,
        <a href="${unsubscribeHref}" style="color:#0b4f8c;text-decoration:underline;">לחץ כאן להסרה מרשימת התפוצה</a>.
      </div>`
    : "";
  const pixel = `<img src="${baseUrl}/api/email/open/${deliveryId}.gif" width="1" height="1" alt="" style="display:none;opacity:0" />`;
  const withFooter = unsubscribeBlock
    ? (withTrackedLinks.includes("</body>")
      ? withTrackedLinks.replace("</body>", `${unsubscribeBlock}${pixel}</body>`)
      : `${withTrackedLinks}${unsubscribeBlock}${pixel}`)
    : (withTrackedLinks.includes("</body>")
      ? withTrackedLinks.replace("</body>", `${pixel}</body>`)
      : `${withTrackedLinks}${pixel}`);
  return withFooter;
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
    body { margin: 0; padding: 32px 16px; background: #f3f6fb; direction: rtl; text-align: right; font-family: Arial, Helvetica, sans-serif; color: #10243f; }
    .container { max-width: 640px; margin: 0 auto; background: #ffffff; border: 1px solid #d7e1ef; border-radius: 18px; overflow: hidden; direction: rtl; text-align: right; }
    .header { background: linear-gradient(180deg, #f8fbff, #eef6ff); padding: 26px 32px; border-bottom: 1px solid #d7e1ef; direction: rtl; text-align: right; }
    .title { margin: 0; font-size: 26px; line-height: 1.25; direction: rtl; text-align: right; }
    .content { padding: 30px 32px; font-size: 16px; line-height: 1.8; direction: rtl; text-align: right; }
    .content p, .content ul, .content ol, .content h2, .content h3, .content h4, .content h5, .content h6, .content li, .content div {
      margin: 0 0 18px;
      direction: rtl;
      text-align: right;
    }
  </style>
</head>
<body dir="rtl" align="right">
  <div class="container" dir="rtl" align="right">
    <div class="header" dir="rtl" align="right"><h1 class="title" dir="rtl" align="right">${subjectText}</h1></div>
    <div class="content" dir="rtl" align="right">${contentHtml}</div>
  </div>
</body>
</html>`;
}

async function fileToAttachment(file) {
  if (!file || !clean(file.name) || Number(file.size || 0) <= 0) return null;
  const sizeBytes = Number(file.size || 0);
  const bytes = Buffer.from(await file.arrayBuffer());
  return {
    filename: clean(file.name),
    content: bytes.toString("base64"),
    sizeBytes
  };
}

function estimateBase64Size(bytes) {
  return Math.ceil(Number(bytes || 0) / 3) * 4;
}

export async function buildAttachmentsFromForm(formData) {
  const files = formData.getAll("attachments") || [];
  const attachments = [];
  let totalRawBytes = 0;
  let totalEncodedBytes = 0;

  for (const file of files) {
    const attachment = await fileToAttachment(file);
    if (!attachment) continue;
    totalRawBytes += attachment.sizeBytes;
    if (totalRawBytes > SAFE_ATTACHMENT_TOTAL_BYTES) {
      throw new Error("סך הקבצים המצורפים חורג מהמגבלה של 20MB. יש להסיר קבצים לפני השליחה.");
    }
    totalEncodedBytes += estimateBase64Size(attachment.sizeBytes);
    if (totalEncodedBytes + ATTACHMENT_OVERHEAD_BUFFER_BYTES > RESEND_MAX_EMAIL_SIZE_BYTES) {
      throw new Error("סך הקבצים המצורפים חורג ממגבלת Resend. יש להקטין את הקבצים לפני השליחה.");
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

export async function saveEmailCampaignDraft({ id, createdByUserId, payload }) {
  await initDb();
  const draftId = clean(id) || crypto.randomUUID();
  await sql`
    INSERT INTO email_campaign_drafts (
      id,
      created_by_user_id,
      draft_json,
      updated_at
    )
    VALUES (
      ${draftId},
      ${clean(createdByUserId) || null},
      ${JSON.stringify(payload || {})}::jsonb,
      NOW()
    )
    ON CONFLICT (id) DO UPDATE
    SET
      created_by_user_id = EXCLUDED.created_by_user_id,
      draft_json = EXCLUDED.draft_json,
      updated_at = NOW()
  `;
  return draftId;
}

export async function getEmailCampaignDraft(id) {
  await initDb();
  const draftId = clean(id);
  if (!draftId) return null;
  const rows = await sql`
    SELECT id, created_by_user_id, draft_json, created_at, updated_at, final_send_started_at, final_send_completed_at, sent_campaign_id
    FROM email_campaign_drafts
    WHERE id = ${draftId}
    LIMIT 1
  `;
  return rows[0] || null;
}

export async function claimEmailCampaignDraftForSend(draftId) {
  await initDb();
  const id = clean(draftId);
  if (!id) return { ok: true, status: "no-draft" };
  const rows = await sql`
    UPDATE email_campaign_drafts
    SET
      final_send_started_at = NOW(),
      updated_at = NOW()
    WHERE id = ${id}
      AND sent_campaign_id IS NULL
      AND final_send_started_at IS NULL
    RETURNING id
  `;
  if (rows[0]?.id) return { ok: true, status: "claimed" };

  const current = await getEmailCampaignDraft(id);
  if (current?.sent_campaign_id) {
    return { ok: false, status: "already-sent", campaignId: clean(current.sent_campaign_id) };
  }
  if (current?.final_send_started_at) {
    return { ok: false, status: "sending" };
  }
  return { ok: false, status: "missing" };
}

export async function releaseEmailCampaignDraftSendClaim(draftId) {
  await initDb();
  const id = clean(draftId);
  if (!id) return;
  await sql`
    UPDATE email_campaign_drafts
    SET
      final_send_started_at = NULL,
      updated_at = NOW()
    WHERE id = ${id}
      AND sent_campaign_id IS NULL
  `;
}

export async function finalizeEmailCampaignDraftSend(draftId, campaignId) {
  await initDb();
  const id = clean(draftId);
  if (!id) return;
  await sql`
    UPDATE email_campaign_drafts
    SET
      sent_campaign_id = ${clean(campaignId) || null},
      final_send_completed_at = NOW(),
      updated_at = NOW()
    WHERE id = ${id}
  `;
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
  const draftId = clean(formData.get("draftId"));
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
  const unsubscribedEmails = await getUnsubscribedEmailSet(targets.map((target) => target.email));
  const unsubscribedTargets = targets.filter((target) => unsubscribedEmails.has(normalizeEmail(target.email)));
  const allowedTargets = targets.filter((target) => !unsubscribedEmails.has(normalizeEmail(target.email)));
  const studentsWithoutRecipients = targetStudents.filter((student) => buildRecipientsForStudent(student, filters.recipientMode).length === 0).length;
  if (!allowedTargets.length) {
    throw new Error("כל הכתובות שנבחרו הוסרו מרשימת התפוצה ולא ניתן לשלוח אליהן.");
  }

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
      ${allowedTargets.length},
      ${JSON.stringify(filters)}::jsonb,
      ${clean(createdByUserId) || null},
      NOW(),
      NOW()
    )
  `;

  let sent = 0;
  let failed = 0;

  for (const target of unsubscribedTargets) {
    const deliveryId = crypto.randomUUID();
    const content = buildMessageParts({
      subject,
      bodyText,
      bodyHtml: sanitizedBodyHtml,
      includeGreeting,
      recipientName: target.recipientName,
      recipientRoleLabel: target.recipientRoleLabel,
      student: target.primaryStudent
    });

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
        body_text,
        body_html,
        related_student_ids,
        related_student_names,
        certainty_level,
        status,
        error_message
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
        ${content.text},
        ${content.html},
        ${JSON.stringify(target.relatedStudents.map((student) => student.id))}::jsonb,
        ${JSON.stringify(target.relatedStudents.map((student) => student.name))}::jsonb,
        ${EMAIL_CERTAINTY.none.level},
        'unsubscribed',
        ${"הנמען הוסר מרשימת התפוצה"}
      )
      ON CONFLICT (campaign_id, recipient_email) DO NOTHING
    `;
  }

  for (const target of allowedTargets) {
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
        body_text,
        body_html,
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
        ${content.text},
        ${content.html},
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
    skipped: studentsWithoutRecipients + unsubscribedTargets.length,
    draftId
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
      body_text,
      body_html,
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

export async function listStudentEmailDeliveries(studentId, limit = 12) {
  await initDb();
  const normalizedStudentId = clean(studentId);
  if (!normalizedStudentId) return [];
  return sql`
    SELECT
      d.id,
      d.campaign_id,
      d.student_id,
      d.student_name,
      d.recipient_role,
      d.recipient_email,
      d.recipient_name,
      d.personalized_greeting,
      d.subject,
      d.sender_name,
      d.body_text,
      d.body_html,
      d.certainty_level,
      d.status,
      d.error_message,
      d.open_count,
      d.opened_at,
      d.clicked_at,
      d.sent_at,
      d.created_at
    FROM email_deliveries d
    WHERE d.student_id = ${normalizedStudentId}
       OR d.related_student_ids @> ${JSON.stringify([normalizedStudentId])}::jsonb
    ORDER BY d.created_at DESC
    LIMIT ${Math.max(1, Math.min(50, Number(limit) || 12))}
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

export async function getUnsubscribedEmailSet(emails = []) {
  await initDb();
  const normalized = Array.from(new Set((Array.isArray(emails) ? emails : []).map(normalizeEmail).filter(Boolean)));
  if (!normalized.length) return new Set();
  const rows = await sql`
    SELECT recipient_email
    FROM email_unsubscribes
    WHERE recipient_email = ANY(${normalized})
  `;
  return new Set(rows.map((row) => normalizeEmail(row.recipient_email)).filter(Boolean));
}

export async function getEmailUnsubscribeInfo(deliveryId) {
  await initDb();
  const id = clean(deliveryId);
  if (!id) return null;
  const rows = await sql`
    SELECT
      d.id AS delivery_id,
      d.campaign_id,
      d.recipient_email,
      d.recipient_name,
      d.student_name,
      d.subject,
      d.sender_name,
      u.recipient_email AS unsubscribed_email,
      u.created_at AS unsubscribed_at
    FROM email_deliveries d
    LEFT JOIN email_unsubscribes u
      ON LOWER(u.recipient_email) = LOWER(d.recipient_email)
    WHERE d.id = ${id}
    LIMIT 1
  `;
  const row = rows[0] || null;
  if (!row) return null;
  return {
    ...row,
    isUnsubscribed: Boolean(clean(row.unsubscribed_email))
  };
}

export async function unsubscribeEmailByDeliveryId(deliveryId) {
  await initDb();
  const info = await getEmailUnsubscribeInfo(deliveryId);
  if (!info) throw new Error("לא נמצאה הודעת מייל מתאימה להסרה.");
  const recipientEmail = normalizeEmail(info.recipient_email);
  if (!recipientEmail) throw new Error("לא נמצאה כתובת מייל להסרה.");

  await sql`
    INSERT INTO email_unsubscribes (
      recipient_email,
      source_delivery_id,
      source_campaign_id,
      recipient_name,
      reason_text,
      updated_at
    )
    VALUES (
      ${recipientEmail},
      ${clean(info.delivery_id)},
      ${clean(info.campaign_id)},
      ${clean(info.recipient_name) || clean(info.student_name)},
      ${"הסרה עצמית דרך קישור מתוך המייל"},
      NOW()
    )
    ON CONFLICT (recipient_email) DO UPDATE
    SET
      source_delivery_id = EXCLUDED.source_delivery_id,
      source_campaign_id = EXCLUDED.source_campaign_id,
      recipient_name = COALESCE(NULLIF(EXCLUDED.recipient_name, ''), email_unsubscribes.recipient_name),
      reason_text = EXCLUDED.reason_text,
      updated_at = NOW()
  `;

  return {
    recipientEmail,
    recipientName: clean(info.recipient_name) || clean(info.student_name)
  };
}

export async function listEmailUnsubscribes(limit = 200) {
  await initDb();
  return sql`
    SELECT
      recipient_email,
      source_delivery_id,
      source_campaign_id,
      recipient_name,
      reason_text,
      created_at,
      updated_at
    FROM email_unsubscribes
    ORDER BY updated_at DESC
    LIMIT ${Math.max(1, Math.min(500, Number(limit) || 200))}
  `;
}

export async function addEmailUnsubscribe({ email, recipientName = "", reasonText = "" }) {
  await initDb();
  const recipientEmail = normalizeEmail(email);
  if (!recipientEmail) throw new Error("יש להזין כתובת מייל תקינה.");

  await sql`
    INSERT INTO email_unsubscribes (
      recipient_email,
      recipient_name,
      reason_text,
      updated_at
    )
    VALUES (
      ${recipientEmail},
      ${clean(recipientName)},
      ${clean(reasonText) || "הוספה ידנית לרשימה השחורה"},
      NOW()
    )
    ON CONFLICT (recipient_email) DO UPDATE
    SET
      recipient_name = COALESCE(NULLIF(EXCLUDED.recipient_name, ''), email_unsubscribes.recipient_name),
      reason_text = EXCLUDED.reason_text,
      updated_at = NOW()
  `;
}

export async function removeEmailUnsubscribe(email) {
  await initDb();
  const recipientEmail = normalizeEmail(email);
  if (!recipientEmail) throw new Error("חסרה כתובת מייל להסרה.");
  await sql`
    DELETE FROM email_unsubscribes
    WHERE recipient_email = ${recipientEmail}
  `;
}

export async function getEmailCampaignById(campaignId) {
  await initDb();
  const id = clean(campaignId);
  if (!id) return null;
  const rows = await sql`
    SELECT
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
      total_recipients,
      sent_count,
      failed_count,
      opened_count,
      status,
      filter_json,
      created_by_user_id,
      sent_at,
      created_at,
      updated_at
    FROM email_campaigns
    WHERE id = ${id}
    LIMIT 1
  `;
  return rows[0] || null;
}

export async function listFavoriteEmailCampaignsForUser(clerkUserId, limit = 12) {
  await initDb();
  const userId = clean(clerkUserId);
  if (!userId) return [];
  return sql`
    SELECT
      f.campaign_id,
      f.label,
      f.created_at AS favorited_at,
      c.subject,
      c.sender_name,
      c.institution,
      c.class_filter,
      c.recipient_mode,
      c.send_scope,
      c.total_recipients,
      c.sent_count,
      c.opened_count,
      c.status,
      c.created_at
    FROM email_campaign_favorites f
    JOIN email_campaigns c
      ON c.id = f.campaign_id
    WHERE f.clerk_user_id = ${userId}
    ORDER BY f.updated_at DESC
    LIMIT ${Math.max(1, Math.min(50, Number(limit) || 12))}
  `;
}

export async function isEmailCampaignFavorite(clerkUserId, campaignId) {
  await initDb();
  const userId = clean(clerkUserId);
  const id = clean(campaignId);
  if (!userId || !id) return false;
  const rows = await sql`
    SELECT 1
    FROM email_campaign_favorites
    WHERE clerk_user_id = ${userId}
      AND campaign_id = ${id}
    LIMIT 1
  `;
  return Boolean(rows[0]);
}

export async function addFavoriteEmailCampaign({ clerkUserId, campaignId, label = "" }) {
  await initDb();
  const userId = clean(clerkUserId);
  const id = clean(campaignId);
  if (!userId || !id) throw new Error("חסרים פרטי משתמש או קמפיין לשמירה במועדפים.");
  await sql`
    INSERT INTO email_campaign_favorites (
      clerk_user_id,
      campaign_id,
      label,
      updated_at
    )
    VALUES (
      ${userId},
      ${id},
      ${clean(label)},
      NOW()
    )
    ON CONFLICT (clerk_user_id, campaign_id) DO UPDATE
    SET
      label = COALESCE(NULLIF(EXCLUDED.label, ''), email_campaign_favorites.label),
      updated_at = NOW()
  `;
}

export async function removeFavoriteEmailCampaign({ clerkUserId, campaignId }) {
  await initDb();
  const userId = clean(clerkUserId);
  const id = clean(campaignId);
  if (!userId || !id) throw new Error("חסרים פרטי משתמש או קמפיין להסרה מהמועדפים.");
  await sql`
    DELETE FROM email_campaign_favorites
    WHERE clerk_user_id = ${userId}
      AND campaign_id = ${id}
  `;
}

export async function listEmailCampaignDeliveries(campaignId) {
  await initDb();
  const id = clean(campaignId);
  if (!id) return [];
  return sql`
    SELECT
      d.id,
      d.campaign_id,
      d.student_id,
      d.student_name,
      d.recipient_role,
      d.recipient_email,
      d.recipient_name,
      d.personalized_greeting,
      d.subject,
      d.sender_name,
      d.body_text,
      d.body_html,
      d.related_student_ids,
      d.related_student_names,
      d.certainty_level,
      d.status,
      d.error_message,
      d.open_count,
      d.opened_at,
      d.clicked_at,
      d.sent_at,
      d.created_at
    FROM email_deliveries d
    WHERE d.campaign_id = ${id}
    ORDER BY d.created_at ASC
  `;
}

function formatExportDate(value) {
  const raw = clean(value);
  if (!raw) return "";
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) return raw;
  return date.toLocaleString("he-IL", { timeZone: "Asia/Jerusalem" });
}

function relatedStudentNames(delivery) {
  if (Array.isArray(delivery?.related_student_names)) return delivery.related_student_names.filter(Boolean).join(", ");
  return "";
}

export async function buildEmailCampaignExport(campaignId) {
  const campaign = await getEmailCampaignById(campaignId);
  if (!campaign) throw new Error("קמפיין המייל לא נמצא.");
  const deliveries = await listEmailCampaignDeliveries(campaignId);

  const workbook = XLSX.utils.book_new();
  const summaryRows = [
    ["נושא", clean(campaign.subject)],
    ["שם שולח", clean(campaign.sender_name)],
    ["מוסד", institutionLabel(campaign.institution) || clean(campaign.institution)],
    ["שיעור", clean(campaign.class_filter)],
    ["סוג נמענים", clean(campaign.recipient_mode)],
    ["נמענים", Number(campaign.total_recipients || 0)],
    ["נשלחו", Number(campaign.sent_count || 0)],
    ["נכשלו", Number(campaign.failed_count || 0)],
    ["נפתחו", Number(campaign.opened_count || 0)],
    ["תאריך שליחה", formatExportDate(campaign.sent_at)],
    ["תאריך יצירה", formatExportDate(campaign.created_at)]
  ];
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(summaryRows), "סיכום");

  const deliverySheetRows = deliveries.map((delivery) => ({
    מזהה_שליחה: clean(delivery.id),
    סטטוס: clean(delivery.status),
    ודאות: Number(delivery.certainty_level || 0),
    נמען: clean(delivery.recipient_name) || clean(delivery.student_name),
    אימייל: clean(delivery.recipient_email),
    סוג_נמען: clean(delivery.recipient_role),
    תלמיד_ראשי: clean(delivery.student_name),
    תלמידים_קשורים: relatedStudentNames(delivery),
    נושא: clean(delivery.subject),
    שם_שולח: clean(delivery.sender_name),
    פתיחות: Number(delivery.open_count || 0),
    נפתח_לראשונה: formatExportDate(delivery.opened_at),
    נלחץ: formatExportDate(delivery.clicked_at),
    זמן_שליחה: formatExportDate(delivery.sent_at),
    שגיאה: clean(delivery.error_message)
  }));
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(deliverySheetRows), "נמענים");

  const filename = `email-campaign-${clean(campaignId).slice(0, 8) || "report"}.xlsx`;
  return {
    content: XLSX.write(workbook, { type: "buffer", bookType: "xlsx" }),
    filename,
    contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
  };
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
