import { initDb, sql } from "./db";

function clean(value) {
  return String(value || "").trim();
}

function normalizePayload(payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return {};
  return payload;
}

export async function createWhatsAppInboundEvent({
  messageId = "",
  waId = "",
  phoneNumberId = "",
  displayPhoneNumber = "",
  profileName = "",
  messageType = "",
  textPreview = "",
  payload = {},
  processingStatus = "received",
  clerkUserId = "",
  responseText = ""
}) {
  await initDb();
  const normalizedMessageId = clean(messageId);
  if (normalizedMessageId) {
    const existingRows = await sql`
      SELECT id, processing_status
      FROM whatsapp_inbound_events
      WHERE message_id = ${normalizedMessageId}
      ORDER BY created_at DESC
      LIMIT 1
    `;
    const existing = existingRows[0];
    if (existing?.id) {
      return {
        id: clean(existing.id),
        duplicate: true,
        processingStatus: clean(existing.processing_status) || ""
      };
    }
  }

  const id = crypto.randomUUID();
  await sql`
    INSERT INTO whatsapp_inbound_events (
      id,
      message_id,
      whatsapp_wa_id,
      phone_number_id,
      display_phone_number,
      profile_name,
      message_type,
      text_preview,
      processing_status,
      clerk_user_id,
      payload,
      response_text
    )
    VALUES (
      ${id},
      ${normalizedMessageId || null},
      ${clean(waId) || null},
      ${clean(phoneNumberId) || null},
      ${clean(displayPhoneNumber) || null},
      ${clean(profileName) || null},
      ${clean(messageType) || null},
      ${clean(textPreview) || null},
      ${clean(processingStatus) || "received"},
      ${clean(clerkUserId) || null},
      ${JSON.stringify(normalizePayload(payload))}::jsonb,
      ${clean(responseText) || null}
    )
  `;

  return { id, duplicate: false };
}

export async function updateWhatsAppInboundEvent(eventId, {
  processingStatus = "",
  clerkUserId = "",
  responseText = ""
} = {}) {
  const id = clean(eventId);
  if (!id) return;
  await initDb();
  await sql`
    UPDATE whatsapp_inbound_events
    SET
      processing_status = COALESCE(${clean(processingStatus) || null}, processing_status),
      clerk_user_id = COALESCE(${clean(clerkUserId) || null}, clerk_user_id),
      response_text = COALESCE(${clean(responseText) || null}, response_text),
      updated_at = NOW()
    WHERE id = ${id}
  `;
}
