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
    if (!session.invitationWhatsAppTemplateName) throw new Error("לא הוגדרה תבנית WhatsApp להזמנה.");
    const templates = (await listWhatsAppCoexistenceApprovedTemplates()).filter(isInvitationTemplate);
    const template = templates.find((item) => item.name === session.invitationWhatsAppTemplateName);
    if (!template) throw new Error("תבנית WhatsApp להזמנה אינה מאושרת או שאינה זמינה.");
    let mediaId = "";
    let mediaType = "image";
    if (attachment) {
      if (template.headerFormat === "IMAGE" && !attachment.contentType.startsWith("image/")) {
        throw new Error("תבנית WhatsApp זו דורשת תמונה, אך צורף PDF.");
      }
      if (template.headerFormat === "DOCUMENT" && attachment.contentType !== "application/pdf") {
        throw new Error("תבנית WhatsApp זו דורשת PDF.");
      }
      mediaType = template.headerFormat === "DOCUMENT" ? "document" : "image";
      mediaId = await uploadAttendanceWhatsAppImage(attachment.file);
    }
    result.whatsapp = await sendAttendanceSessionWhatsAppApprovedTemplate({
      sessionId,
      studentId,
      templateName: session.invitationWhatsAppTemplateName,
      templateLanguage: session.invitationWhatsAppTemplateLanguage || template.language,
      recipientRoles: session.invitationWhatsAppRecipientRoles,
      templates,
      imageId: mediaId,
      mediaType,
      invitation: true
    });
  }

  return result;
}
