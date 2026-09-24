import { getAttendanceRoster, getAttendanceSessionById } from "./attendance";
import { sendAttendanceInvitationEmails } from "./attendance-email";
import {
  listWhatsAppCoexistenceApprovedTemplates,
  sendAttendanceSessionWhatsAppApprovedTemplate,
  uploadAttendanceWhatsAppImage
} from "./attendance-whatsapp";
import { getObjectBytesFromR2 } from "./r2";

function clean(value) {
  return String(value || "").trim();
}
function isInvitationTemplate(template) {
  return clean(template?.name).startsWith("general_meeting_invitation");
}

function attachmentKind(attachment) {
  const contentType = clean(attachment?.contentType).toLowerCase();
  if (contentType.startsWith("image/")) return "image";
  if (contentType === "application/pdf") return "document";
  return "";
}

function templateMatchesInvitationInput(template, attachment) {
  const format = clean(template?.headerFormat).toUpperCase();
  const kind = attachmentKind(attachment);
  if (!attachment) return !template?.requiresMedia;
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
  const mediaCompatible = compatible.filter((item) => item.requiresMedia);
  return mediaCompatible[0] || compatible[0] || null;
}

async function getAttachment(session) {
  const attachment = session?.invitationAttachment;
  if (!attachment?.objectKey) return null;
  const object = await getObjectBytesFromR2(attachment.objectKey);
  const content = Buffer.from(object.bytes).toString("base64");
  return {
    ...attachment,
    content,
    file: new File([Buffer.from(object.bytes)], attachment.fileName || "invitation", { type: attachment.contentType || object.contentType })
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
    if (!session.invitationWhatsAppTemplateName) throw new Error("לא הוגדרה תבנית WhatsApp להזמנה במפגש.");
    const templates = (await listWhatsAppCoexistenceApprovedTemplates()).filter(isInvitationTemplate);
    const preferredTemplate = templates.find((item) => item.name === session.invitationWhatsAppTemplateName);
    if (!preferredTemplate) throw new Error("תבנית WhatsApp להזמנה אינה מאושרת או שאינה זמינה בחיבור של בוט התפוצה.");
    const template = chooseInvitationTemplate(templates, session.invitationWhatsAppTemplateName, attachment);
    if (!template) {
      const requiredFile = attachmentKind(attachment) === "document" ? "תמונה" : "קובץ PDF או תבנית ללא קובץ";
      throw new Error(`לא נמצאה תבנית WhatsApp להזמנה שמתאימה ל${requiredFile}.`);
    }
    whatsappContext = {
      templates,
      template,
      switchedFrom: template.name === preferredTemplate.name ? "" : preferredTemplate.name
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
    let mediaId = "";
    let mediaType = "image";
    if (attachment) {
      if (template.headerFormat === "IMAGE" && !clean(attachment.contentType).startsWith("image/")) {
        throw new Error("תבנית WhatsApp זו דורשת תמונה, אך צורף PDF.");
      }
      if (template.headerFormat === "DOCUMENT" && attachment.contentType !== "application/pdf") {
        throw new Error("תבנית WhatsApp זו דורשת PDF.");
      }
      mediaType = template.headerFormat === "DOCUMENT" ? "document" : "image";
      // A text-only WhatsApp template can still be selected when no matching
      // media template exists. In that case the same file remains attached to
      // the email, while WhatsApp correctly sends the approved text template.
      if (template.requiresMedia) mediaId = await uploadAttendanceWhatsAppImage(attachment.file);
    }
    console.info("Attendance invitation WhatsApp template selected", {
      sessionId,
      preferredTemplateName: session.invitationWhatsAppTemplateName,
      templateName: template.name,
      headerFormat: template.headerFormat || "TEXT",
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
