import { initDb, sql } from "./db";

function clean(value) {
  return String(value || "").trim();
}

export function isTelegramConfigured() {
  return Boolean(clean(process.env.BOT_TELEGRAM));
}

function getTelegramToken() {
  const token = clean(process.env.BOT_TELEGRAM);
  if (!token) throw new Error("Missing BOT_TELEGRAM env variable.");
  return token;
}

export function getTelegramWebhookSecret() {
  return clean(process.env.BOT_TELEGRAM_SECRET);
}

function getTelegramApiBase() {
  return `https://api.telegram.org/bot${getTelegramToken()}`;
}

function getTelegramFileBase() {
  return `https://api.telegram.org/file/bot${getTelegramToken()}`;
}

function generateLinkCode() {
  return crypto.randomUUID().replace(/-/g, "").slice(0, 10).toUpperCase();
}

export async function createTelegramLinkCode(clerkUserId, ttlMinutes = 15) {
  const userId = clean(clerkUserId);
  if (!userId) throw new Error("Missing user id.");

  await initDb();
  await sql`
    UPDATE telegram_link_codes
    SET used_at = NOW()
    WHERE clerk_user_id = ${userId}
      AND used_at IS NULL
  `;

  const code = generateLinkCode();
  const expiresAt = new Date(Date.now() + Math.max(1, Number(ttlMinutes) || 15) * 60 * 1000).toISOString();
  await sql`
    INSERT INTO telegram_link_codes (code, clerk_user_id, expires_at)
    VALUES (${code}, ${userId}, ${expiresAt})
  `;

  return {
    code,
    expiresAt
  };
}

export async function getTelegramLinkByClerkUserId(clerkUserId) {
  const userId = clean(clerkUserId);
  if (!userId) return null;
  await initDb();
  const rows = await sql`
    SELECT clerk_user_id, telegram_chat_id, telegram_user_id, telegram_username, is_active, linked_at, updated_at
    FROM telegram_user_links
    WHERE clerk_user_id = ${userId}
    LIMIT 1
  `;
  return rows[0] || null;
}

export async function getTelegramLinkByChatId(chatId) {
  const normalizedChatId = clean(chatId);
  if (!normalizedChatId) return null;
  await initDb();
  const rows = await sql`
    SELECT clerk_user_id, telegram_chat_id, telegram_user_id, telegram_username, is_active, linked_at, updated_at
    FROM telegram_user_links
    WHERE telegram_chat_id = ${normalizedChatId}
      AND is_active = TRUE
    LIMIT 1
  `;
  return rows[0] || null;
}

export async function unlinkTelegramByClerkUserId(clerkUserId) {
  const userId = clean(clerkUserId);
  if (!userId) return;
  await initDb();
  await sql`
    DELETE FROM telegram_user_links
    WHERE clerk_user_id = ${userId}
  `;
}

export async function consumeTelegramLinkCode({ code, telegramChatId, telegramUserId = "", telegramUsername = "" }) {
  const normalizedCode = clean(code).toUpperCase();
  const chatId = clean(telegramChatId);
  if (!normalizedCode || !chatId) throw new Error("Missing Telegram link payload.");

  await initDb();
  const rows = await sql`
    SELECT code, clerk_user_id, expires_at, used_at
    FROM telegram_link_codes
    WHERE code = ${normalizedCode}
    LIMIT 1
  `;
  const row = rows[0];
  if (!row) throw new Error("קוד החיבור לא נמצא.");
  if (row.used_at) throw new Error("קוד החיבור כבר נוצל.");
  if (new Date(row.expires_at).getTime() < Date.now()) throw new Error("קוד החיבור פג תוקף.");

  await sql`
    INSERT INTO telegram_user_links (clerk_user_id, telegram_chat_id, telegram_user_id, telegram_username, is_active)
    VALUES (${row.clerk_user_id}, ${chatId}, ${clean(telegramUserId) || null}, ${clean(telegramUsername) || null}, TRUE)
    ON CONFLICT (clerk_user_id)
    DO UPDATE SET
      telegram_chat_id = EXCLUDED.telegram_chat_id,
      telegram_user_id = EXCLUDED.telegram_user_id,
      telegram_username = EXCLUDED.telegram_username,
      is_active = TRUE,
      updated_at = NOW()
  `;

  await sql`
    UPDATE telegram_link_codes
    SET used_at = NOW()
    WHERE code = ${normalizedCode}
  `;

  return {
    clerkUserId: row.clerk_user_id,
    telegramChatId: chatId
  };
}

export async function sendTelegramMessage(chatId, text, options = {}) {
  const payload = {
    chat_id: clean(chatId),
    text: clean(text).slice(0, 4096) || " ",
    parse_mode: options.parseMode || undefined,
    reply_markup: options.replyMarkup || undefined
  };

  const response = await fetch(`${getTelegramApiBase()}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });

  const data = await response.json().catch(() => null);
  if (!response.ok || !data?.ok) {
    throw new Error(data?.description || "Telegram sendMessage failed");
  }
  return data.result;
}

export async function getTelegramFile(fileId) {
  const normalizedFileId = clean(fileId);
  if (!normalizedFileId) throw new Error("Missing Telegram file id.");
  const response = await fetch(`${getTelegramApiBase()}/getFile`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ file_id: normalizedFileId })
  });
  const data = await response.json().catch(() => null);
  if (!response.ok || !data?.ok) {
    throw new Error(data?.description || "Telegram getFile failed");
  }
  return data.result;
}

export async function downloadTelegramFileAsAttachment(fileId, { fileName = "", contentType = "application/octet-stream" } = {}) {
  const fileMeta = await getTelegramFile(fileId);
  const filePath = clean(fileMeta?.file_path);
  if (!filePath) throw new Error("Telegram file path missing.");

  const downloadResponse = await fetch(`${getTelegramFileBase()}/${filePath}`);
  if (!downloadResponse.ok) {
    throw new Error(`Telegram file download failed (${downloadResponse.status})`);
  }

  const bytes = new Uint8Array(await downloadResponse.arrayBuffer());
  const finalName = clean(fileName) || clean(filePath.split("/").pop()) || "telegram-file";
  const finalType = clean(contentType) || clean(downloadResponse.headers.get("content-type")) || "application/octet-stream";

  return {
    name: finalName,
    type: finalType,
    size: bytes.byteLength,
    async arrayBuffer() {
      return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    }
  };
}

export async function answerTelegramCallbackQuery(callbackQueryId, text = "") {
  const response = await fetch(`${getTelegramApiBase()}/answerCallbackQuery`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      callback_query_id: clean(callbackQueryId),
      text: clean(text) || undefined
    })
  });
  const data = await response.json().catch(() => null);
  if (!response.ok || !data?.ok) {
    throw new Error(data?.description || "Telegram answerCallbackQuery failed");
  }
}

export async function setTelegramWebhook(webhookUrl) {
  const secretToken = getTelegramWebhookSecret();
  const response = await fetch(`${getTelegramApiBase()}/setWebhook`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      url: clean(webhookUrl),
      secret_token: secretToken || undefined
    })
  });
  const data = await response.json().catch(() => null);
  if (!response.ok || !data?.ok) {
    throw new Error(data?.description || "Telegram setWebhook failed");
  }
  return data.result;
}
