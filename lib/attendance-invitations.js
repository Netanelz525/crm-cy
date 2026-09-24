import { getAttendanceRoster, getAttendanceSessionById } from "./attendance";
import { sendAttendanceInvitationEmails } from "./attendance-email";
import {
  listWhatsAppCoexistenceApprovedTemplates,
  sendAttendanceSessionWhatsAppApprovedTemplate,
  templateHeaderMediaType,
  uploadAttendanceWhatsAppImage
} from "./attendance-whatsapp";
import { getObjectBytesFromR2 } from "./r2";

function clean(value) {
  return String(value || "").trim();
}

function isInvitationTemplateName(value) {
  const name = clean(value).toLowerCase();
  return name.startsWith("general_meeting_invitation") || name.includes("meeting_invitation");
}

function isInvitationTemplate(template) {
  return isInvitationTemplateName(template?.name);
}

function inferredContentType(fileName) {
  const name = clean(fileName).toLowerCase();
  if (name.endsWith(".jpg") || name.endsWith(".jpeg")) return "image/jpeg";
  if (name.endsWith(".png")) return "image/png";
  if (name.endsWith(".pdf")) return "application/pdf";
  return "";
}

function attachmentKind(attachment) {
  const contentType = clean(attachment?.contentType).toLowerCase() || inferredContentType(attachment?.fileName);
  if (contentType.startsWith("image/")) return "image";
  if (contentType === "application/pdf") return "document";
  return "";
}

function templateMatchesInvitationInput(template, attachment) {
  const format = clean(template?.headerFormat).toUpperCase();
  const kind = attachmentKind(attachment);
  const requiresMedia = Boolean(templateHeaderMediaType(template) || template?.requiresMedia);
  if (!attachment) return !requiresMedia;
  if (format === "IMAGE") return kind === "image";
  if (format === "DOCUMENT") return kind === "document";
  return format === "";
}

function chooseInvitationTemplate(templates, preferredName, attachment) {
  const preferred = templates.find((item) => item.name === preferredName);
  const candidates = [preferred, ...templates.filter((item) => item !== preferred)].filter(Boolean);
  const compatible = candidates.filter((item) => templateMatchesInvitationInput(item, attachment));
  if (!attachment) return compatible[0] || null;

  // When a file is attached, prefer a matching media header so the same file
  // reaches WhatsApp as well as email. Fall back to an approved text template
  // only when the connection has no compatible media template.
  const mediaCompatible = compatible.filter((item) => Boolean(templateHeaderMediaType(item) || item.requiresMedia));
  return mediaCompatible[0] || compatible[0] || null;
}

async function getAttachment(session) {
  const attachment = session?.invitationAttachment;
  if (!attachment?.objectKey) return null;
  const object = await getObjectBytesFromR2(attachment.objectKey);
  const content = Buffer.from(object.bytes).toString("base64");
  const contentType = clean(attachment.contentType).toLowerCase()
    || clean(object.contentType).toLowerCase()
    || inferredContentType(attachment.fileName)
    || "application/octet-stream";
  return {
    ...attachment,
    contentType,
    content,
    file: new File([Buffer.from(object.bytes)], attachment.fileName || "invitation", { type: contentType })
  };
}

export async function sendAttendanceInvitation({ sessionId, studentId = "", channels = [] } = {}) {
  const session = await getAttendanceSessionById(sessionId);
  if (!session) throw new Error("המפגש לא נמצא.");
  const roster = await getAttendanceRoster(sessionId);
  if (!roster) throw new Error("המפגש לא נמצא.");
  const selectedChannels = Array.isArray(channels) && channels.length ? channels : ["email", "whatsapp"];
  const attachment = await getAttachment(session);
  const result = { email: null, whatsapp: null };

  // Validate the WhatsApp route before sending email so a partial invitation
  // cannot look successful when the second channel is misconfigured.
  let whatsappContext = null;
  if (selectedChannels.includes("whatsapp")) {
    const templates = (await listWhatsAppCoexistenceApprovedTemplates()).filter(isInvitationTemplate);
    const preferredTemplate = templates.find((item) => item.name === session.invitationWhatsAppTemplateName) || null;
    const template = chooseInvitationTemplate(templates, session.invitationWhatsAppTemplateName, attachment);
    if (!template) {
      const requiredFile = attachmentKind(attachment) === "document" ? "תבנית PDF" : attachment ? "תבנית תמונה או מסמך" : "תבנית ללא קובץ בכותרת";
      throw new Error(`לא נמצאה תבנית WhatsApp להזמנה שמתאימה ל${requiredFile}.`);
    }
    whatsappContext = {
      templates,
      template,
      switchedFrom: preferredTemplate && template.name !== preferredTemplate.name ? preferredTemplate.name : ""
    };
  }

  if (selectedChannels.includes("email")) {
    if (!session.invitationEmailBody) throw new Error("לא הוגדרה הודעת מייל להזמנה.");
    result.email = await sendAttendanceInvitationEmails({
      sessionId,
      studentId,
      subject: session.invitationEmailSubject,
      body: session.invitationEmailBody,
      recipientRoles: session.invitationEmailRecipientRoles,
      attachment
    });
  }

  if (selectedChannels.includes("whatsapp")) {
    const { templates, template } = whatsappContext;
    const headerMediaType = templateHeaderMediaType(template);
    const requiresMedia = Boolean(headerMediaType || template.requiresMedia);
    let mediaId = "";
    let mediaType = "image";
    if (attachment) {
      const fileKind = attachmentKind(attachment);
      if (headerMediaType === "image" && fileKind !== "image") {
        throw new Error("תבנית WhatsApp זו דורשת תמונה, אך צורף PDF.");
      }
      if (headerMediaType === "document" && fileKind !== "document") {
        throw new Error("תבנית WhatsApp זו דורשת PDF.");
      }
      mediaType = fileKind === "document" ? "document" : "image";
      // A text-only WhatsApp template can still be selected when no matching
      // media template exists. In that case the same file remains attached to
      // the email, while WhatsApp correctly sends the approved text template.
      if (requiresMedia) mediaId = await uploadAttendanceWhatsAppImage(attachment.file);
    }
    if (requiresMedia && !mediaId) {
      throw new Error("לא התקבל מזהה לקובץ המצורף מ־WhatsApp, ולכן השליחה נעצרה.");
    }
    console.info("Attendance invitation WhatsApp template selected", {
      sessionId,
      preferredTemplateName: session.invitationWhatsAppTemplateName,
      templateName: template.name,
      headerFormat: template.headerFormat || "TEXT",
      headerMediaType,
      hasAttachment: Boolean(attachment),
      switchedAutomatically: Boolean(whatsappContext.switchedFrom)
    });
    result.whatsapp = await sendAttendanceSessionWhatsAppApprovedTemplate({
      sessionId,
      studentId,
      templateName: template.name,
      templateLanguage: session.invitationWhatsAppTemplateLanguage || template.language,
      recipientRoles: session.invitationWhatsAppRecipientRoles,
      templates,
      imageId: mediaId,
      mediaType,
      invitation: true
    });
    if (!result.whatsapp.sentMessages) {
      const detail = result.whatsapp.errors?.[0]
        || (result.whatsapp.missingRecipients
          ? "לא נמצאו מספרי WhatsApp תקינים לנמענים שנבחרו."
          : "לא התקבלה הצלחה מ-Dualhook.");
      throw new Error(`שליחת WhatsApp נכשלה: ${detail}`);
    }
  }

  return result;
}
