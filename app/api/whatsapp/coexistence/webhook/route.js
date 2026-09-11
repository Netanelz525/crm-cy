import { createHash, createHmac, timingSafeEqual } from "crypto";
import { NextResponse } from "next/server";
import { saveWhatsAppCoexistenceEvent } from "../../../../../lib/whatsapp-coexistence-events";
import { applyAttendanceWhatsAppResponse } from "../../../../../lib/attendance-whatsapp";

export const runtime = "nodejs";

function clean(value) {
  return String(value || "").trim();
}

function safeEqual(left, right) {
  const leftBuffer = Buffer.from(clean(left));
  const rightBuffer = Buffer.from(clean(right));
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

function isSignatureValid(rawBody, signatureHeader) {
  const secret = clean(process.env.WHATSAPP_COEX_APP_SECRET);
  if (!secret) return true;
  const expected = `sha256=${createHmac("sha256", secret).update(rawBody).digest("hex")}`;
  return safeEqual(expected, signatureHeader);
}

function payloadPhoneNumberIds(payload) {
  return (Array.isArray(payload?.entry) ? payload.entry : []).flatMap((entry) =>
    (Array.isArray(entry?.changes) ? entry.changes : [])
      .map((change) => clean(change?.value?.metadata?.phone_number_id))
      .filter(Boolean)
  );
}

function textFromMessage(message) {
  if (message?.text?.body) return clean(message.text.body);
  if (message?.button?.text) return clean(message.button.text);
  if (message?.interactive?.button_reply?.title) return clean(message.interactive.button_reply.title);
  if (message?.interactive?.list_reply?.title) return clean(message.interactive.list_reply.title);
  if (message?.image?.caption) return clean(message.image.caption);
  if (message?.document?.caption) return clean(message.document.caption);
  return "";
}

function extractEvents(body, rawBody) {
  const events = [];
  for (const entry of Array.isArray(body?.entry) ? body.entry : []) {
    for (const change of Array.isArray(entry?.changes) ? entry.changes : []) {
      const value = change?.value || {};
      const metadata = value?.metadata || {};
      const contacts = new Map(
        (Array.isArray(value?.contacts) ? value.contacts : []).map((contact) => [
          clean(contact?.wa_id),
          clean(contact?.profile?.name)
        ])
      );
      for (const message of Array.isArray(value?.messages) ? value.messages : []) {
        const messageId = clean(message?.id);
        const waId = clean(message?.from);
        events.push({
          eventKey: messageId ? `message:${messageId}` : "",
          eventType: "message",
          messageId,
          waId,
          phoneNumberId: metadata?.phone_number_id,
          displayPhoneNumber: metadata?.display_phone_number,
          profileName: contacts.get(waId) || "",
          messageType: message?.type,
          textPreview: textFromMessage(message),
          occurredAt: message?.timestamp,
          payload: { object: body?.object, entryId: entry?.id, field: change?.field, value, message }
        });
      }
      for (const status of Array.isArray(value?.statuses) ? value.statuses : []) {
        const messageId = clean(status?.id);
        const state = clean(status?.status);
        events.push({
          eventKey: `status:${messageId}:${state}:${clean(status?.timestamp)}`,
          eventType: "status",
          messageId,
          status: state,
          waId: status?.recipient_id,
          phoneNumberId: metadata?.phone_number_id,
          displayPhoneNumber: metadata?.display_phone_number,
          occurredAt: status?.timestamp,
          payload: { object: body?.object, entryId: entry?.id, field: change?.field, value, status }
        });
      }
    }
  }
  if (!events.length) {
    events.push({
      eventKey: `event:${createHash("sha256").update(rawBody).digest("hex")}`,
      eventType: "event",
      payload: body
    });
  }
  return events;
}

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const mode = clean(searchParams.get("hub.mode"));
  const token = clean(searchParams.get("hub.verify_token"));
  const challenge = clean(searchParams.get("hub.challenge"));
  const expected = clean(process.env.WHATSAPP_COEX_VERIFY_TOKEN);
  if (mode === "subscribe" && expected && token === expected) {
    return new Response(challenge, { status: 200 });
  }
  return new Response("Forbidden", { status: 403 });
}

export async function POST(request) {
  try {
    const rawBody = await request.text();
    if (!rawBody || rawBody.length > 2_000_000) {
      return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
    }
    if (!isSignatureValid(rawBody, request.headers.get("x-hub-signature-256"))) {
      return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
    }
    const body = JSON.parse(rawBody);
    const expectedPhoneNumberId = clean(process.env.WHATSAPP_COEX_PHONE_NUMBER_ID);
    const receivedPhoneNumberIds = payloadPhoneNumberIds(body);
    if (expectedPhoneNumberId && receivedPhoneNumberIds.length && receivedPhoneNumberIds.some((id) => id !== expectedPhoneNumberId)) {
      console.warn("Coexistence WhatsApp webhook ignored an event for another phone number.");
      return NextResponse.json({ ok: true, ignored: "phone_number_mismatch" });
    }
    const events = extractEvents(body, rawBody);
    const results = [];
    for (const event of events) {
      results.push(await saveWhatsAppCoexistenceEvent(event));
      const payload = clean(event?.payload?.message?.button?.payload || event?.payload?.message?.interactive?.button_reply?.id);
      if (payload.startsWith("attendance:")) {
        await applyAttendanceWhatsAppResponse(payload, event.waId);
      }
    }
    return NextResponse.json({ ok: true, received: events.length, stored: results.filter((item) => !item.duplicate).length });
  } catch (error) {
    console.error("WhatsApp coexistence webhook failed:", error?.message || error);
    return NextResponse.json({ error: "Webhook processing failed" }, { status: 500 });
  }
}
