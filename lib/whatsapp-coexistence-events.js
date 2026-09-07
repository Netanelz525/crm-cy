import { createHash } from "crypto";
import { initDb, sql } from "./db";

let tableReady = false;
let tablePromise = null;

function clean(value) {
  return String(value || "").trim();
}

async function ensureTable() {
  if (tableReady) return;
  if (tablePromise) return tablePromise;
  tablePromise = (async () => {
    await initDb();
    await sql`
      CREATE TABLE IF NOT EXISTS whatsapp_coexistence_events (
        id TEXT PRIMARY KEY,
        event_key TEXT NOT NULL UNIQUE,
        event_type TEXT NOT NULL,
        message_id TEXT,
        status TEXT,
        whatsapp_wa_id TEXT,
        phone_number_id TEXT,
        display_phone_number TEXT,
        profile_name TEXT,
        message_type TEXT,
        text_preview TEXT,
        occurred_at TIMESTAMPTZ,
        payload JSONB NOT NULL DEFAULT '{}'::jsonb,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `;
    await sql`CREATE INDEX IF NOT EXISTS idx_wa_coexistence_created_at ON whatsapp_coexistence_events (created_at DESC)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_wa_coexistence_wa_id ON whatsapp_coexistence_events (whatsapp_wa_id)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_wa_coexistence_message_id ON whatsapp_coexistence_events (message_id)`;
    tableReady = true;
  })().finally(() => {
    tablePromise = null;
  });
  return tablePromise;
}

function eventKey(event) {
  const explicit = clean(event.eventKey);
  if (explicit) return explicit;
  return createHash("sha256").update(JSON.stringify(event.payload || {})).digest("hex");
}

export async function saveWhatsAppCoexistenceEvent(event) {
  await ensureTable();
  const id = crypto.randomUUID();
  const key = eventKey(event);
  const occurredAt = Number(event.occurredAt || 0);
  const rows = await sql`
    INSERT INTO whatsapp_coexistence_events (
      id, event_key, event_type, message_id, status, whatsapp_wa_id,
      phone_number_id, display_phone_number, profile_name, message_type,
      text_preview, occurred_at, payload
    ) VALUES (
      ${id}, ${key}, ${clean(event.eventType) || "event"},
      ${clean(event.messageId) || null}, ${clean(event.status) || null},
      ${clean(event.waId) || null}, ${clean(event.phoneNumberId) || null},
      ${clean(event.displayPhoneNumber) || null}, ${clean(event.profileName) || null},
      ${clean(event.messageType) || null}, ${clean(event.textPreview).slice(0, 1000) || null},
      ${occurredAt > 0 ? new Date(occurredAt * 1000).toISOString() : null}::timestamptz,
      ${JSON.stringify(event.payload || {})}::jsonb
    )
    ON CONFLICT (event_key) DO NOTHING
    RETURNING id
  `;
  return { id: clean(rows[0]?.id), duplicate: !rows[0]?.id };
}

