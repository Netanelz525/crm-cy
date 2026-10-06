import { randomUUID } from "node:crypto";
import { initDb, sql } from "./db";
import { getAppUserByEmail } from "./rbac";
import { getNeonStudentByPrimaryEmail } from "./neon-students";
import { buildStudentSummary, findStudentsForAgent } from "./student-agent";
import { createStudentDocumentFromStoredObject } from "./student-documents";
import { createTask } from "./tasks";
import { buildResendFromAddress, getDefaultResendReplyTo, sendResendEmail } from "./resend";
import { createPrintJobFromStoredDocument, storePendingDocumentFile } from "./ai-document-agent";
import { createEmailPrintAction } from "./email-print-actions";
import { processTextAiMessage } from "./ai-text-agent";

function clean(value) {
  return String(value || "").trim();
}

function normalizeEmail(value) {
  return clean(value).toLowerCase();
}

function parseAddress(value) {
  const raw = Array.isArray(value) ? value[0] : value;
  const text = clean(raw);
  const match = text.match(/<([^>]+)>/);
  return normalizeEmail(match?.[1] || text);
}

function safeSubject(value) {
  return clean(value).replace(/\s+/g, " ").slice(0, 240) || "פנייה חדשה במייל";
}

function messageText(data) {
  const text = clean(data?.text || data?.plain_text || data?.body_text);
  if (text) return text.slice(0, 20000);
  const html = clean(data?.html || data?.body_html);
  return html.replace(/<br\s*\/?\s*>/gi, "\n").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 20000);
}

function isFullStaffUser(user) {
  return Boolean(user?.is_team_member || user?.is_manager || user?.is_super_admin);
}

function canLinkDocumentsToStudents(user) {
  const role = clean(user?.role).toLowerCase();
  return Boolean(user?.is_super_admin || role === "admin");
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function getCrmOrigin() {
  const configured = clean(
    process.env.CRM_BASE_URL
      || process.env.APP_BASE_URL
      || process.env.NEXT_PUBLIC_APP_URL
      || process.env.VERCEL_PROJECT_PRODUCTION_URL
      || process.env.VERCEL_URL
  );
  return (configured ? (configured.startsWith("http") ? configured : `https://${configured}`) : "https://crm-cy-nu.vercel.app").replace(/\/$/, "");
}

function absoluteUrl(url, origin = getCrmOrigin()) {
  const value = clean(url);
  if (!value) return "";
  try {
    return new URL(value, origin).toString();
  } catch {
    return "";
  }
}

function normalizePhoneForLink(value) {
  const text = clean(value);
  if (!text || text === "-") return "";
  let digits = text.replace(/\D/g, "");
  if (digits.startsWith("00")) digits = digits.slice(2);
  if (digits.startsWith("0")) digits = `972${digits.slice(1)}`;
  return digits.length >= 8 ? digits : "";
}

function formatStudentField(label, value) {
  const text = clean(value);
  return text ? `<tr><td style="padding:4px 0;color:#64748b;vertical-align:top">${escapeHtml(label)}</td><td style="padding:4px 0;font-weight:600;color:#172554">${escapeHtml(text)}</td></tr>` : "";
}

function formatStudentPhoneField(label, value) {
  const text = clean(value);
  if (!text) return "";
  const phone = normalizePhoneForLink(text);
  if (!phone) return formatStudentField(label, text);
  const callHref = `tel:+${phone}`;
  const whatsappHref = `https://wa.me/${phone}`;
  const linkedValue = `<span dir="ltr" style="unicode-bidi:isolate;white-space:nowrap"><a href="${escapeHtml(callHref)}" style="color:#1558b0;font-weight:700;text-decoration:underline">${escapeHtml(text)}</a><a href="${escapeHtml(whatsappHref)}" title="WhatsApp" aria-label="WhatsApp" style="display:inline-block;margin-right:7px;width:24px;height:24px;line-height:24px;border-radius:50%;background:#25d366;color:#fff;text-decoration:none;text-align:center;font-size:10px;font-weight:700;vertical-align:middle">WA</a></span>`;
  return `<tr><td style="padding:4px 0;color:#64748b;vertical-align:top">${escapeHtml(label)}</td><td style="padding:4px 0;font-weight:600;color:#172554">${linkedValue}</td></tr>`;
}

function buildStudentCardsHtml(studentCards = [], origin = getCrmOrigin()) {
  if (!Array.isArray(studentCards) || !studentCards.length) return "";
  const cards = studentCards.map((card) => {
    const url = absoluteUrl(card?.studentCardUrl, origin);
    const fields = [
      formatStudentField("ת.ז.", card?.tznum),
      formatStudentField("מוסד", card?.currentInstitutionLabel || card?.currentInstitution),
      formatStudentField("כיתה", card?.classLabel || card?.class),
      formatStudentPhoneField("טלפון תלמיד", card?.studentPhone),
      formatStudentPhoneField("טלפון אב", card?.dadPhone),
      formatStudentPhoneField("טלפון אם", card?.momPhone),
      formatStudentField("מייל", card?.primaryEmail)
    ].filter(Boolean).join("");
    return `<div style="border:1px solid #dbe5f1;border-radius:14px;padding:18px;margin:12px 0;background:#f8fbff;direction:rtl;text-align:right">
      <div style="font-size:20px;font-weight:700;color:#172554;margin-bottom:8px">${escapeHtml(card?.name || "תלמיד")}</div>
      <table role="presentation" style="width:100%;border-collapse:collapse;font-size:14px">${fields}</table>
      ${url ? `<a href="${escapeHtml(url)}" style="display:inline-block;margin-top:14px;background:#1769aa;color:#fff;text-decoration:none;border-radius:8px;padding:10px 16px;font-weight:700">פתיחת כרטיס התלמיד</a>` : ""}
    </div>`;
  }).join("");
  return `<section style="margin-top:22px"><h2 style="font-size:20px;color:#172554;margin:0 0 10px">תלמידים שנמצאו</h2>${cards}</section>`;
}

function buildStudentReportPdfLinks(result, origin = getCrmOrigin()) {
  const rawUrl = absoluteUrl(result?.pdfUrl, origin);
  if (!rawUrl) return [];

  let baseUrl;
  try {
    baseUrl = new URL(rawUrl);
  } catch {
    return [[result.pdfUrl, "הפקת PDF"]];
  }

  if (!baseUrl.pathname.endsWith("/api/export/institution-pdf")) {
    return [[result.pdfUrl, "הפקת PDF"]];
  }

  const build = (sortFields) => {
    const url = new URL(baseUrl);
    url.searchParams.delete("sby");
    url.searchParams.delete("sdir");
    sortFields.forEach((field) => {
      url.searchParams.append("sby", field);
      url.searchParams.append("sdir", "asc");
    });
    return url.toString();
  };

  return [
    [build(["name"]), "PDF לפי שם משפחה"],
    [build(["class", "name"]), "PDF לפי שיעור ואז שם משפחה"]
  ];
}

function buildActionLinksHtml(result, attachmentLinks = [], origin = getCrmOrigin()) {
  const reportPdfLinks = buildStudentReportPdfLinks(result, origin);
  const links = [
    [result?.viewUrl, "פתיחת הרשימה ב־CRM"],
    [result?.exportUrl, "הפקת Excel"],
    ...reportPdfLinks,
    ...attachmentLinks
  ].map(([url, label]) => {
    const href = absoluteUrl(url, origin);
    return href ? `<a href="${escapeHtml(href)}" style="display:inline-block;margin:5px 6px 5px 0;border:1px solid #bfdbfe;border-radius:8px;padding:9px 12px;color:#125b97;text-decoration:none;font-weight:600">${escapeHtml(label)}</a>` : "";
  }).filter(Boolean).join("");
  return links ? `<section style="margin-top:22px"><h2 style="font-size:20px;color:#172554;margin:0 0 8px">קישורים שימושיים</h2>${links}</section>` : "";
}

function buildAgentReplyHtml({ reply, result, attachmentLinks = [], origin = getCrmOrigin() }) {
  const safeReply = escapeHtml(reply || "קיבלתי את ההודעה וטיפלתי בה.").replace(/\r?\n/g, "<br>");
  return `<!doctype html><html lang="he" dir="rtl"><body style="margin:0;background:#f1f5f9;font-family:Arial,sans-serif;color:#172554"><main style="max-width:720px;margin:0 auto;padding:28px 16px"><div style="background:#fff;border:1px solid #dbe5f1;border-radius:16px;padding:24px"><div style="font-size:13px;color:#64748b;margin-bottom:12px">CRM · תשובת הבוט</div><div style="font-size:17px;line-height:1.65">${safeReply}</div>${buildStudentCardsHtml(result?.studentCards, origin)}${buildActionLinksHtml(result, attachmentLinks, origin)}</div></main></body></html>`;
}

function isPrintRequest(text) {
  return /\bprint\b|הדפס|להדפיס|הדפסה/iu.test(clean(text));
}

function isAttachRequest(text) {
  return /שייך|צרף|לצרף|שמור בכרטיס|קובץ לתלמיד|attach|link document/iu.test(clean(text));
}

function buildInboundFile({ filename, contentType, bytes }) {
  const safeBytes = Buffer.from(bytes || []);
  return {
    name: clean(filename) || "document",
    type: clean(contentType) || "application/octet-stream",
    size: safeBytes.length,
    async arrayBuffer() {
      return safeBytes.buffer.slice(safeBytes.byteOffset, safeBytes.byteOffset + safeBytes.byteLength);
    }
  };
}

async function fetchResendInboundAttachments(emailId, metadata = []) {
  const apiKey = clean(process.env.RESEND_API_KEY);
  const normalizedId = clean(emailId);
  if (!apiKey || !normalizedId || !Array.isArray(metadata) || !metadata.length) return [];
  const response = await fetch(`https://api.resend.com/emails/receiving/${encodeURIComponent(normalizedId)}/attachments`, {
    headers: { Authorization: `Bearer ${apiKey}` },
    cache: "no-store"
  });
  if (!response.ok) throw new Error(`Resend attachments API returned ${response.status}`);
  const payload = await response.json();
  const items = Array.isArray(payload?.data) ? payload.data : [];
  const files = [];
  for (const item of items.slice(0, 5)) {
    const downloadUrl = clean(item?.download_url);
    if (!downloadUrl) continue;
    const fileResponse = await fetch(downloadUrl, { cache: "no-store" });
    if (!fileResponse.ok) continue;
    const bytes = Buffer.from(await fileResponse.arrayBuffer());
    if (!bytes.length || bytes.length > 30 * 1024 * 1024) continue;
    files.push(buildInboundFile({
      filename: item?.filename,
      contentType: item?.content_type,
      bytes
    }));
  }
  return files;
}

async function handleInboundAttachments({ files, body, staffUser, senderEmail }) {
  if (!files.length || !isFullStaffUser(staffUser)) return { messages: [], links: [] };
  const messages = [];
  const links = [];
  for (const file of files) {
    const storedDocument = await storePendingDocumentFile(file);
    const printAction = await createEmailPrintAction({ senderEmail, storedDocument });
    const printPageUrl = `/api/email/print?token=${encodeURIComponent(printAction.token)}`;
    const quickPrintUrl = `${printPageUrl}&action=print&printPlan=booklet-bw&copies=1`;
    if (isPrintRequest(body)) {
      messages.push(`הקובץ ${file.name} מוכן להדפסה. בחר תוכנית ומספר עותקים, או לחץ על הדפסה מהירה.`);
      links.push([quickPrintUrl, "הדפסה מהירה · עותק אחד"], [printPageUrl, "בחירת תוכנית ומספר עותקים"]);
      continue;
    }
    if (isAttachRequest(body) && canLinkDocumentsToStudents(staffUser)) {
      const { students } = await findStudentsForAgent({ query: body, minScore: 0.55 });
      if (students.length === 1) {
        const student = students[0];
        await createStudentDocumentFromStoredObject({
          studentId: student.id,
          uploadedByUserId: staffUser?.clerk_user_id,
          fileName: file.name,
          displayName: file.name,
          noteText: `נשמר מתוך מייל מ־${senderEmail}`,
          contentType: file.type,
          objectKey: storedDocument.objectKey,
          sizeBytes: storedDocument.sizeBytes,
          documentKind: "general"
        });
        messages.push(`הקובץ ${file.name} שויך לכרטיס של ${clean(student.label || student.name) || "התלמיד"}.`);
        links.push([`/neon/students/${encodeURIComponent(student.id)}`, "פתיחת כרטיס התלמיד"]);
      } else {
        messages.push(`הקובץ ${file.name} נשמר וממתין לשיוך; נמצאו ${students.length} התאמות.`);
        links.push(["/neon", "חיפוש תלמיד לשיוך"]);
      }
      continue;
    }
    messages.push(`קיבלתי את הקובץ ${file.name}. אפשר לבחור תוכנית ומספר עותקים ישירות מהמייל.`);
    links.push([quickPrintUrl, "הדפסה מהירה · עותק אחד"], [printPageUrl, "בחירת תוכנית ומספר עותקים"], ["/neon", "חיפוש תלמיד לשיוך"]);
  }
  return { messages, links };
}

function buildRequestTitle(subject, senderEmail) {
  return `פנייה במייל: ${safeSubject(subject)}${senderEmail ? ` | ${senderEmail}` : ""}`.slice(0, 240);
}

async function createInboundRequest({ senderEmail, subject, body, student, providerEmailId, payload }) {
  const taskId = await createTask({
    title: buildRequestTitle(subject, senderEmail),
    description: body || "התקבלה פנייה במייל ללא תוכן טקסטואלי.",
    linkedType: student?.id ? "student" : "general",
    studentId: student?.id || "",
    sourceSnapshot: {
      source: "resend_inbound",
      providerEmailId,
      senderEmail,
      subject: safeSubject(subject),
      receivedAt: new Date().toISOString()
    },
    createdByUserId: null
  });

  return taskId;
}

async function saveMessage({ providerEmailId, senderEmail, recipientEmail, subject, body, bodyHtml, accessMode, staffUser, student, taskId, status, payload }) {
  const id = randomUUID();
  const rows = await sql`
    INSERT INTO email_agent_messages (
      id, provider_email_id, sender_email, recipient_email, subject, body_text, body_html,
      access_mode, matched_staff_user_id, matched_student_id, task_id, status, provider_payload
    )
    VALUES (
      ${id}, ${providerEmailId || null}, ${senderEmail}, ${recipientEmail || null}, ${safeSubject(subject)},
      ${body || null}, ${bodyHtml || null}, ${accessMode}, ${staffUser?.clerk_user_id || null},
      ${student?.id || null}, ${taskId || null}, ${status}, ${JSON.stringify(payload || {})}::jsonb
    )
    ON CONFLICT (provider_email_id) DO NOTHING
    RETURNING id
  `;
  return rows[0]?.id || "";
}

async function updateMessage(id, values = {}) {
  if (!id) return;
  await sql`
    UPDATE email_agent_messages
    SET response_provider_message_id = ${values.responseProviderMessageId || null},
        status = ${values.status || "processed"},
        updated_at = NOW()
    WHERE id = ${id}
  `;
}

export function getResendAgentEmail() {
  return normalizeEmail(process.env.RESEND_AGENT_EMAIL);
}

export async function processResendInboundEmail(eventPayload) {
  await initDb();
  const data = eventPayload?.data || {};
  const providerEmailId = clean(data.email_id || data.id);
  const senderEmail = parseAddress(data.from);
  const recipientEmail = parseAddress(data.to);
  const subject = safeSubject(data.subject);
  const body = messageText(data);
  const bodyHtml = clean(data.html || data.body_html);

  if (!senderEmail) return { ok: false, ignored: true, reason: "missing_sender" };
  const configuredAddress = getResendAgentEmail();
  if (configuredAddress && recipientEmail && configuredAddress !== recipientEmail) {
    return { ok: true, ignored: true, reason: "wrong_recipient" };
  }

  const existing = providerEmailId
    ? await sql`SELECT id, status FROM email_agent_messages WHERE provider_email_id = ${providerEmailId} LIMIT 1`
    : [];
  if (existing[0]) return { ok: true, duplicate: true, id: existing[0].id, status: existing[0].status };

  const staffUser = await getAppUserByEmail(senderEmail);
  const fullStaffAccess = isFullStaffUser(staffUser);
  const student = fullStaffAccess ? null : await getNeonStudentByPrimaryEmail(senderEmail);
  const accessMode = fullStaffAccess ? "full_staff" : student ? "request_student" : "request_unknown";
  let taskId = "";
  if (!fullStaffAccess) {
    taskId = await createInboundRequest({ senderEmail, subject, body, student, providerEmailId, payload: eventPayload });
  }

  const messageId = await saveMessage({
    providerEmailId,
    senderEmail,
    recipientEmail,
    subject,
    body,
    bodyHtml,
    accessMode,
    staffUser,
    student,
    taskId,
    status: "received",
    payload: eventPayload
  });

  let replyText;
  let result = null;
  let attachmentLinks = [];
  if (fullStaffAccess) {
    result = await processTextAiMessage({ user: staffUser, messageText: body || subject, source: "email" });
    replyText = clean(result?.reply) || "קיבלתי את ההודעה וטיפלתי בה.";
  } else {
    result = student ? { studentCards: [buildStudentSummary(student)] } : { studentCards: [] };
    replyText = student
      ? `קיבלנו את הפנייה שלך והיא נפתחה לטיפול עבור ${clean(student?.name) || "התלמיד"}. צוות המערכת יחזור אליך. מספר פנייה: ${taskId}`
      : `קיבלנו את הפנייה שלך והיא נפתחה לטיפול. צוות המערכת יחזור אליך. מספר פנייה: ${taskId}`;
  }

  if (fullStaffAccess && Array.isArray(data.attachments) && data.attachments.length) {
    try {
      const files = await fetchResendInboundAttachments(providerEmailId, data.attachments);
      const attachmentResult = await handleInboundAttachments({ files, body, staffUser, senderEmail });
      attachmentLinks = attachmentResult.links;
      if (attachmentResult.messages.length) {
        replyText = `${replyText}\n\n${attachmentResult.messages.join("\n")}`;
      }
    } catch (error) {
      console.error("Resend inbound attachment processing failed:", error?.message || error);
      replyText = `${replyText}\n\nזיהיתי קובץ מצורף, אבל לא הצלחתי להוריד אותו כרגע. אפשר לפתוח את המייל שוב או להעלות את הקובץ דרך מסלול ההדפסה.`;
      attachmentLinks = [["/print", "פתיחת מסלול ההדפסה"]];
    }
  }

  let responseProviderMessageId = "";
  try {
    const response = await sendResendEmail({
      from: buildResendFromAddress("CRM"),
      to: senderEmail,
      subject: `Re: ${subject}`,
      text: replyText,
      html: buildAgentReplyHtml({ reply: replyText, result, attachmentLinks }),
      replyTo: getResendAgentEmail() || getDefaultResendReplyTo(),
      idempotencyKey: providerEmailId ? `email-agent-reply-${providerEmailId}` : `email-agent-reply-${messageId}`
    });
    responseProviderMessageId = clean(response?.id);
    await updateMessage(messageId, { responseProviderMessageId, status: "replied" });
  } catch (error) {
    await updateMessage(messageId, { status: "received_reply_failed" });
    console.error("Resend inbound reply failed:", error?.message || error);
  }

  return { ok: true, id: messageId, accessMode, taskId, responseProviderMessageId };
}
