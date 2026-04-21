import { createHmac, timingSafeEqual } from "crypto";
import { NextResponse } from "next/server";
import { getAppUserByClerkUserId } from "../../../../lib/rbac";
import { getAiChatMessageById, setAiChatMessageFeedback } from "../../../../lib/ai-chat-history";
import { CRM_SCOPE_MESSAGE, processTextAiMessage, handleApprovedAiAction, getPendingActionForMessage } from "../../../../lib/ai-text-agent";
import { processDocumentAttachment } from "../../../../lib/ai-document-agent";
import { createWhatsAppInboundEvent, updateWhatsAppInboundEvent } from "../../../../lib/whatsapp-events";
import {
  consumeWhatsAppLinkCode,
  downloadWhatsAppMediaAsAttachment,
  getWhatsAppLinkByWaId,
  getWhatsAppWebhookAppSecret,
  sendWhatsAppReplyButtons,
  sendWhatsAppTextMessages
} from "../../../../lib/whatsapp";

function clean(value) {
  return String(value || "").trim();
}

function safeEqualHex(left, right) {
  const a = Buffer.from(clean(left), "utf8");
  const b = Buffer.from(clean(right), "utf8");
  if (!a.length || a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

function isWebhookSignatureValid(rawBody, signatureHeader) {
  const appSecret = getWhatsAppWebhookAppSecret();
  if (!appSecret) return true;
  const header = clean(signatureHeader);
  if (!header.startsWith("sha256=")) return false;
  const expected = `sha256=${createHmac("sha256", appSecret).update(rawBody).digest("hex")}`;
  return safeEqualHex(expected, header);
}

function extractIncomingMessage(payload) {
  const entries = Array.isArray(payload?.entry) ? payload.entry : [];
  for (const entry of entries) {
    const changes = Array.isArray(entry?.changes) ? entry.changes : [];
    for (const change of changes) {
      const value = change?.value || {};
      const messages = Array.isArray(value?.messages) ? value.messages : [];
      if (messages[0]) {
        return {
          message: messages[0],
          contact: Array.isArray(value?.contacts) ? value.contacts[0] || null : null,
          metadata: value?.metadata || {}
        };
      }
    }
  }
  return { message: null, contact: null, metadata: {} };
}

function extractText(message) {
  if (message?.type === "text") return clean(message?.text?.body);
  if (message?.type === "button") return clean(message?.button?.text);
  if (message?.type === "interactive") {
    return clean(
      message?.interactive?.button_reply?.title
      || message?.interactive?.list_reply?.title
      || message?.interactive?.button_reply?.id
      || message?.interactive?.list_reply?.id
    );
  }
  return "";
}

function extractInteractiveActionId(message) {
  if (message?.type !== "interactive") return "";
  return clean(
    message?.interactive?.button_reply?.id
    || message?.interactive?.list_reply?.id
  );
}

function resolveAttachmentMeta(message) {
  if (message?.type === "document" && message?.document?.id) {
    return {
      mediaId: clean(message.document.id),
      fileName: clean(message.document.filename) || "whatsapp-document",
      contentType: clean(message.document.mime_type) || "application/octet-stream"
    };
  }

  if (message?.type === "image" && message?.image?.id) {
    const contentType = clean(message.image.mime_type) || "image/jpeg";
    return {
      mediaId: clean(message.image.id),
      fileName: `${clean(message.image.id) || "whatsapp-image"}.${contentType === "image/png" ? "png" : "jpg"}`,
      contentType
    };
  }

  return null;
}

function resolveBaseUrl() {
  const explicit = process.env.CRM_BASE_URL || process.env.APP_BASE_URL;
  if (explicit) return clean(explicit).replace(/\/$/, "");
  const vercelUrl = process.env.VERCEL_PROJECT_PRODUCTION_URL || process.env.VERCEL_URL;
  if (!vercelUrl) return "";
  return `https://${clean(vercelUrl).replace(/^https?:\/\//, "").replace(/\/$/, "")}`;
}

function toAbsoluteUrl(path) {
  const baseUrl = resolveBaseUrl();
  const relativePath = clean(path);
  if (!baseUrl || !relativePath) return "";
  if (/^https?:\/\//i.test(relativePath)) return relativePath;
  return `${baseUrl}${relativePath.startsWith("/") ? relativePath : `/${relativePath}`}`;
}

function buildReplyText(result) {
  const parts = [clean(result?.reply)];

  const absoluteViewUrl = toAbsoluteUrl(result?.viewUrl);
  const absoluteExportUrl = toAbsoluteUrl(result?.exportUrl);
  if (absoluteViewUrl) parts.push(`תצוגה מלאה במערכת:\n${absoluteViewUrl}`);
  if (absoluteExportUrl) parts.push(`אקסל:\n${absoluteExportUrl}`);

  const cardLinks = (Array.isArray(result?.studentCards) ? result.studentCards : [])
    .slice(0, 3)
    .map((student) => {
      const url = toAbsoluteUrl(student?.studentCardUrl);
      if (!url) return "";
      return `${clean(student?.name) || "תלמיד"}:\n${url}`;
    })
    .filter(Boolean);

  if (cardLinks.length) {
    parts.push(`כרטיסי תלמיד:\n${cardLinks.join("\n\n")}`);
  }

  if (clean(result?.searchSummary)) {
    parts.push(`איך חיפשתי: ${clean(result.searchSummary)}`);
  }

  return parts.filter(Boolean).join("\n\n");
}

async function sendWhatsAppResult(waId, result) {
  const replyText = buildReplyText(result);
  if (replyText) {
    await sendWhatsAppTextMessages(waId, replyText);
  }

  if (result?.pendingAction?.id && result?.id) {
    await sendWhatsAppReplyButtons(waId, {
      bodyText: "לא בוצע שינוי עדיין. אפשר לאשר או לדחות כאן.",
      buttons: [
        { id: `approve:${result.id}`, title: "אשר" },
        { id: `reject:${result.id}`, title: "דחה" }
      ]
    });
    return;
  }

  if (result?.id) {
    await sendWhatsAppReplyButtons(waId, {
      bodyText: "האם התשובה עזרה?",
      buttons: [
        { id: `feedback:good:${result.id}`, title: "עזר" },
        { id: `feedback:bad:${result.id}`, title: "לא מדויק" }
      ]
    });
  }
}

function shouldSuppressScopeOnlyReply(result) {
  return clean(result?.reply) === clean(CRM_SCOPE_MESSAGE)
    && !clean(result?.viewUrl)
    && !clean(result?.exportUrl)
    && !(Array.isArray(result?.studentCards) && result.studentCards.length)
    && !result?.pendingAction;
}

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const mode = clean(searchParams.get("hub.mode"));
  const verifyToken = clean(searchParams.get("hub.verify_token"));
  const challenge = clean(searchParams.get("hub.challenge"));

  if (
    mode === "subscribe"
    && verifyToken
    && verifyToken === clean(process.env.WHATSAPP_VERIFY_TOKEN)
  ) {
    return new Response(challenge, { status: 200 });
  }

  return new Response("Forbidden", { status: 403 });
}

export async function POST(request) {
  let inboundEventId = "";
  try {
    const rawBody = await request.text();
    const signatureHeader = request.headers.get("x-hub-signature-256");
    const parsedBody = rawBody ? JSON.parse(rawBody) : null;

    if (!isWebhookSignatureValid(rawBody, signatureHeader)) {
      const { message, contact, metadata } = extractIncomingMessage(parsedBody || {});
      const waId = clean(message?.from || contact?.wa_id);
      const profileName = clean(contact?.profile?.name);
      const text = extractText(message);
      const attachmentMeta = resolveAttachmentMeta(message);
      await createWhatsAppInboundEvent({
        messageId: clean(message?.id),
        waId,
        phoneNumberId: clean(metadata?.phone_number_id),
        displayPhoneNumber: clean(metadata?.display_phone_number),
        profileName,
        messageType: clean(message?.type) || (attachmentMeta ? "attachment" : "unknown"),
        textPreview: text,
        payload: {
          signatureHeader: clean(signatureHeader),
          body: parsedBody || {}
        },
        processingStatus: "forbidden_signature"
      });
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const body = parsedBody;
    if (!body || typeof body !== "object") {
      return NextResponse.json({ ok: true });
    }

    const { message, contact, metadata } = extractIncomingMessage(body);
    if (!message) {
      return NextResponse.json({ ok: true });
    }

    const waId = clean(message?.from || contact?.wa_id);
    const profileName = clean(contact?.profile?.name);
    const text = extractText(message);
    const interactiveActionId = extractInteractiveActionId(message);
    const attachmentMeta = resolveAttachmentMeta(message);
    const messageType = clean(message?.type) || (attachmentMeta ? "attachment" : "unknown");
    const inboundEvent = await createWhatsAppInboundEvent({
      messageId: clean(message?.id),
      waId,
      phoneNumberId: clean(metadata?.phone_number_id),
      displayPhoneNumber: clean(metadata?.display_phone_number),
      profileName,
      messageType,
      textPreview: text,
      payload: body
    });
    inboundEventId = inboundEvent.id;
    if (!waId) {
      return NextResponse.json({ ok: true });
    }

    if (interactiveActionId) {
      const link = await getWhatsAppLinkByWaId(waId);
      if (!link?.clerk_user_id) {
        const responseText = "המספר הזה עדיין לא מחובר למערכת. היכנס ל-CRM, פתח את מסך WhatsApp, צור קוד חיבור ושלח כאן רק את הקוד.";
        await sendWhatsAppTextMessages(waId, responseText);
        await updateWhatsAppInboundEvent(inboundEvent.id, {
          processingStatus: "unlinked",
          responseText
        });
        return NextResponse.json({ ok: true });
      }

      const user = await getAppUserByClerkUserId(link.clerk_user_id);
      if (!user || (!user.is_team_member && !user.is_manager)) {
        const responseText = "החשבון הזה אינו מורשה להשתמש בסוכן.";
        await sendWhatsAppTextMessages(waId, responseText);
        await updateWhatsAppInboundEvent(inboundEvent.id, {
          processingStatus: "unauthorized",
          clerkUserId: link.clerk_user_id,
          responseText
        });
        return NextResponse.json({ ok: true });
      }

      if (interactiveActionId.startsWith("feedback:")) {
        const [, feedback, messageId] = interactiveActionId.split(":");
        await setAiChatMessageFeedback({
          messageId,
          clerkUserId: user.clerk_user_id,
          feedback
        });
        const responseText = feedback === "good"
          ? "תודה, שמרתי שהתשובה עזרה."
          : "תודה, שמרתי שהתשובה לא היתה מדויקת.";
        await sendWhatsAppTextMessages(waId, responseText);
        await updateWhatsAppInboundEvent(inboundEvent.id, {
          processingStatus: "feedback_saved",
          clerkUserId: user.clerk_user_id,
          responseText
        });
        return NextResponse.json({ ok: true });
      }

      if (interactiveActionId.startsWith("approve:") || interactiveActionId.startsWith("reject:")) {
        const [decision, messageId] = interactiveActionId.split(":");
        const pendingAction = await getPendingActionForMessage({
          clerkUserId: user.clerk_user_id,
          messageId
        });
        if (!pendingAction) {
          const responseText = "לא נמצאה פעולה ממתינה.";
          await sendWhatsAppTextMessages(waId, responseText);
          await updateWhatsAppInboundEvent(inboundEvent.id, {
            processingStatus: "missing_pending_action",
            clerkUserId: user.clerk_user_id,
            responseText
          });
          return NextResponse.json({ ok: true });
        }

        const result = await handleApprovedAiAction({ user, decision, pendingAction });
        const assistantMessage = await getAiChatMessageById({
          clerkUserId: user.clerk_user_id,
          messageId
        });
        await sendWhatsAppResult(waId, {
          id: messageId,
          reply: result.reply,
          studentCards: result.studentCards || [],
          searchSummary: result.searchSummary || "",
          viewUrl: assistantMessage?.viewUrl || "",
          exportUrl: assistantMessage?.exportUrl || ""
        });
        await updateWhatsAppInboundEvent(inboundEvent.id, {
          processingStatus: decision === "approve" ? "approved_action" : "rejected_action",
          clerkUserId: user.clerk_user_id,
          responseText: result.reply
        });
        return NextResponse.json({ ok: true });
      }
    }

    if (text && !attachmentMeta) {
      try {
        const linkResult = await consumeWhatsAppLinkCode({
          code: text,
          waId,
          phoneNumber: waId,
          profileName
        });
        const user = await getAppUserByClerkUserId(linkResult.clerkUserId);
        await sendWhatsAppTextMessages(
          waId,
          `החיבור הושלם בהצלחה. מעכשיו אני מזהה אותך כ-${user?.display_name || "משתמש מורשה"}.`
        );
        await updateWhatsAppInboundEvent(inboundEvent.id, {
          processingStatus: "linked",
          clerkUserId: linkResult.clerkUserId,
          responseText: `החיבור הושלם בהצלחה. מעכשיו אני מזהה אותך כ-${user?.display_name || "משתמש מורשה"}.`
        });
        return NextResponse.json({ ok: true });
      } catch (error) {
        const messageText = clean(error?.message);
        const isCodeAttempt = /^[A-Z0-9]{6,12}$/i.test(text);
        if (isCodeAttempt && messageText) {
          await sendWhatsAppTextMessages(waId, messageText);
          await updateWhatsAppInboundEvent(inboundEvent.id, {
            processingStatus: "link_failed",
            responseText: messageText
          });
          return NextResponse.json({ ok: true });
        }
      }
    }

    const link = await getWhatsAppLinkByWaId(waId);
    if (!link?.clerk_user_id) {
      const responseText = "המספר הזה עדיין לא מחובר למערכת. היכנס ל-CRM, פתח את מסך WhatsApp, צור קוד חיבור ושלח כאן רק את הקוד.";
      await sendWhatsAppTextMessages(
        waId,
        responseText
      );
      await updateWhatsAppInboundEvent(inboundEvent.id, {
        processingStatus: "unlinked",
        responseText
      });
      return NextResponse.json({ ok: true });
    }

    const user = await getAppUserByClerkUserId(link.clerk_user_id);
    if (!user || (!user.is_team_member && !user.is_manager)) {
      const responseText = "החשבון הזה אינו מורשה להשתמש בסוכן.";
      await sendWhatsAppTextMessages(waId, responseText);
      await updateWhatsAppInboundEvent(inboundEvent.id, {
        processingStatus: "unauthorized",
        clerkUserId: link.clerk_user_id,
        responseText
      });
      return NextResponse.json({ ok: true });
    }

    if (attachmentMeta) {
      const attachment = await downloadWhatsAppMediaAsAttachment(attachmentMeta.mediaId, {
        fileName: attachmentMeta.fileName,
        contentType: attachmentMeta.contentType
      });
      const result = await processDocumentAttachment({
        user,
        attachment,
        messageText: text,
        source: "whatsapp"
      });
      await sendWhatsAppResult(waId, result);
      await updateWhatsAppInboundEvent(inboundEvent.id, {
        processingStatus: "processed_document",
        clerkUserId: user.clerk_user_id,
        responseText: buildReplyText(result)
      });
      return NextResponse.json({ ok: true });
    }

    if (!text) {
      const responseText = "כרגע אפשר לשלוח ב-WhatsApp טקסט, תמונות ומסמכי PDF.";
      await sendWhatsAppTextMessages(waId, responseText);
      await updateWhatsAppInboundEvent(inboundEvent.id, {
        processingStatus: "unsupported_message",
        clerkUserId: user.clerk_user_id,
        responseText
      });
      return NextResponse.json({ ok: true });
    }

    const result = await processTextAiMessage({
      user,
      messageText: text,
      source: "whatsapp"
    });
    if (shouldSuppressScopeOnlyReply(result)) {
      await updateWhatsAppInboundEvent(inboundEvent.id, {
        processingStatus: "ignored_non_crm",
        clerkUserId: user.clerk_user_id,
        responseText: ""
      });
      return NextResponse.json({ ok: true });
    }
    await sendWhatsAppResult(waId, result);
    await updateWhatsAppInboundEvent(inboundEvent.id, {
      processingStatus: "processed_text",
      clerkUserId: user.clerk_user_id,
      responseText: buildReplyText(result)
    });
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("WhatsApp webhook failed:", error?.message || error);
    if (inboundEventId) {
      await updateWhatsAppInboundEvent(inboundEventId, {
        processingStatus: "failed",
        responseText: clean(error?.message || error)
      }).catch(() => null);
    }
    return NextResponse.json({ ok: true });
  }
}
