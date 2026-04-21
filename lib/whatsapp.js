import { initDb, sql } from "./db";

function clean(value) {
  return String(value || "").trim();
}

function generateLinkCode() {
  return crypto.randomUUID().replace(/-/g, "").slice(0, 10).toUpperCase();
}

function getGraphApiVersion() {
  return clean(process.env.WHATSAPP_GRAPH_VERSION) || "v23.0";
}

function getPhoneNumberId() {
  const value = clean(process.env.WHATSAPP_PHONE_NUMBER_ID);
  if (!value) throw new Error("Missing WHATSAPP_PHONE_NUMBER_ID env variable.");
  return value;
}

function getAccessToken() {
  const value = clean(process.env.WHATSAPP_ACCESS_TOKEN);
  if (!value) throw new Error("Missing WHATSAPP_ACCESS_TOKEN env variable.");
  return value;
}

export function isWhatsAppConfigured() {
  return Boolean(clean(process.env.WHATSAPP_PHONE_NUMBER_ID) && clean(process.env.WHATSAPP_ACCESS_TOKEN));
}

export function getWhatsAppWebhookAppSecret() {
  return clean(process.env.META_APP_SECRET);
}

function getMessagesEndpoint() {
  return `https://graph.facebook.com/${getGraphApiVersion()}/${getPhoneNumberId()}/messages`;
}

export async function createWhatsAppLinkCode(clerkUserId, ttlMinutes = 15) {
  const userId = clean(clerkUserId);
  if (!userId) throw new Error("Missing user id.");

  await initDb();
  await sql`
    UPDATE whatsapp_link_codes
    SET used_at = NOW()
    WHERE clerk_user_id = ${userId}
      AND used_at IS NULL
  `;

  const code = generateLinkCode();
  const expiresAt = new Date(Date.now() + Math.max(1, Number(ttlMinutes) || 15) * 60 * 1000).toISOString();
  await sql`
    INSERT INTO whatsapp_link_codes (code, clerk_user_id, expires_at)
    VALUES (${code}, ${userId}, ${expiresAt})
  `;

  return { code, expiresAt };
}

export async function getWhatsAppLinkByClerkUserId(clerkUserId) {
  const userId = clean(clerkUserId);
  if (!userId) return null;
  await initDb();
  const rows = await sql`
    SELECT clerk_user_id, whatsapp_wa_id, phone_number, profile_name, is_active, linked_at, updated_at
    FROM whatsapp_user_links
    WHERE clerk_user_id = ${userId}
    LIMIT 1
  `;
  return rows[0] || null;
}

export async function getWhatsAppLinkByWaId(waId) {
  const normalizedWaId = clean(waId);
  if (!normalizedWaId) return null;
  await initDb();
  const rows = await sql`
    SELECT clerk_user_id, whatsapp_wa_id, phone_number, profile_name, is_active, linked_at, updated_at
    FROM whatsapp_user_links
    WHERE whatsapp_wa_id = ${normalizedWaId}
      AND is_active = TRUE
    LIMIT 1
  `;
  return rows[0] || null;
}

export async function unlinkWhatsAppByClerkUserId(clerkUserId) {
  const userId = clean(clerkUserId);
  if (!userId) return;
  await initDb();
  await sql`
    DELETE FROM whatsapp_user_links
    WHERE clerk_user_id = ${userId}
  `;
}

export async function consumeWhatsAppLinkCode({ code, waId, phoneNumber = "", profileName = "" }) {
  const normalizedCode = clean(code).toUpperCase();
  const normalizedWaId = clean(waId);
  if (!normalizedCode || !normalizedWaId) throw new Error("Missing WhatsApp link payload.");

  await initDb();
  const rows = await sql`
    SELECT code, clerk_user_id, expires_at, used_at
    FROM whatsapp_link_codes
    WHERE code = ${normalizedCode}
    LIMIT 1
  `;
  const row = rows[0];
  if (!row) throw new Error("קוד החיבור לא נמצא.");
  if (row.used_at) throw new Error("קוד החיבור כבר נוצל.");
  if (new Date(row.expires_at).getTime() < Date.now()) throw new Error("קוד החיבור פג תוקף.");

  await sql`
    INSERT INTO whatsapp_user_links (clerk_user_id, whatsapp_wa_id, phone_number, profile_name, is_active)
    VALUES (${row.clerk_user_id}, ${normalizedWaId}, ${clean(phoneNumber) || null}, ${clean(profileName) || null}, TRUE)
    ON CONFLICT (clerk_user_id)
    DO UPDATE SET
      whatsapp_wa_id = EXCLUDED.whatsapp_wa_id,
      phone_number = EXCLUDED.phone_number,
      profile_name = EXCLUDED.profile_name,
      is_active = TRUE,
      updated_at = NOW()
  `;

  await sql`
    UPDATE whatsapp_link_codes
    SET used_at = NOW()
    WHERE code = ${normalizedCode}
  `;

  return {
    clerkUserId: row.clerk_user_id,
    waId: normalizedWaId
  };
}

function splitTextForWhatsApp(text, maxChars = 3500) {
  const raw = clean(text);
  if (!raw) return [];
  if (raw.length <= maxChars) return [raw];

  const chunks = [];
  let remaining = raw;
  while (remaining.length > maxChars) {
    let splitIndex = remaining.lastIndexOf("\n", maxChars);
    if (splitIndex < Math.floor(maxChars * 0.6)) {
      splitIndex = remaining.lastIndexOf(" ", maxChars);
    }
    if (splitIndex < Math.floor(maxChars * 0.6)) {
      splitIndex = maxChars;
    }
    chunks.push(remaining.slice(0, splitIndex).trim());
    remaining = remaining.slice(splitIndex).trim();
  }
  if (remaining) chunks.push(remaining);
  return chunks;
}

export async function sendWhatsAppTextMessage(to, text) {
  const payload = {
    messaging_product: "whatsapp",
    to: clean(to),
    type: "text",
    text: {
      preview_url: false,
      body: clean(text).slice(0, 4096) || " "
    }
  };

  const response = await fetch(getMessagesEndpoint(), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${getAccessToken()}`
    },
    body: JSON.stringify(payload)
  });

  const data = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(data?.error?.message || "WhatsApp send message failed");
  }
  return data;
}

export async function sendWhatsAppTextMessages(to, text) {
  const chunks = splitTextForWhatsApp(text);
  for (const chunk of chunks) {
    await sendWhatsAppTextMessage(to, chunk);
  }
}
