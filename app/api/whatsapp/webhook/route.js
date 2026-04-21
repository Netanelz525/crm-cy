import { createHmac, timingSafeEqual } from "crypto";
import { NextResponse } from "next/server";
import { getAppUserByClerkUserId } from "../../../../lib/rbac";
import { processTextAiMessage } from "../../../../lib/ai-text-agent";
import {
  consumeWhatsAppLinkCode,
  getWhatsAppLinkByWaId,
  getWhatsAppWebhookAppSecret,
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
          contact: Array.isArray(value?.contacts) ? value.contacts[0] || null : null
        };
      }
    }
  }
  return { message: null, contact: null };
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
  try {
    const rawBody = await request.text();
    if (!isWebhookSignatureValid(rawBody, request.headers.get("x-hub-signature-256"))) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const body = rawBody ? JSON.parse(rawBody) : null;
    if (!body || typeof body !== "object") {
      return NextResponse.json({ ok: true });
    }

    const { message, contact } = extractIncomingMessage(body);
    if (!message) {
      return NextResponse.json({ ok: true });
    }

    const waId = clean(message?.from || contact?.wa_id);
    const profileName = clean(contact?.profile?.name);
    const text = extractText(message);
    if (!waId) {
      return NextResponse.json({ ok: true });
    }

    if (text) {
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
        return NextResponse.json({ ok: true });
      } catch (error) {
        const messageText = clean(error?.message);
        const isCodeAttempt = /^[A-Z0-9]{6,12}$/i.test(text);
        if (isCodeAttempt && messageText) {
          await sendWhatsAppTextMessages(waId, messageText);
          return NextResponse.json({ ok: true });
        }
      }
    }

    const link = await getWhatsAppLinkByWaId(waId);
    if (!link?.clerk_user_id) {
      await sendWhatsAppTextMessages(
        waId,
        "המספר הזה עדיין לא מחובר למערכת. היכנס ל-CRM, פתח את מסך WhatsApp, צור קוד חיבור ושלח כאן רק את הקוד."
      );
      return NextResponse.json({ ok: true });
    }

    const user = await getAppUserByClerkUserId(link.clerk_user_id);
    if (!user || (!user.is_team_member && !user.is_manager)) {
      await sendWhatsAppTextMessages(waId, "החשבון הזה אינו מורשה להשתמש בסוכן.");
      return NextResponse.json({ ok: true });
    }

    if (!text) {
      await sendWhatsAppTextMessages(waId, "כרגע אפשר לשלוח ב-WhatsApp הודעות טקסט בלבד.");
      return NextResponse.json({ ok: true });
    }

    const result = await processTextAiMessage({
      user,
      messageText: text,
      source: "whatsapp"
    });

    const replyParts = [result.reply, result.searchSummary ? `איך חיפשתי: ${result.searchSummary}` : ""]
      .filter(Boolean)
      .join("\n\n");
    await sendWhatsAppTextMessages(waId, replyParts);
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("WhatsApp webhook failed:", error?.message || error);
    return NextResponse.json({ ok: true });
  }
}
