import { createHash, randomUUID } from "node:crypto";
import { initDb, sql } from "./db";

function clean(value) {
  return String(value || "").trim();
}

function hashToken(token) {
  return createHash("sha256").update(clean(token)).digest("hex");
}

export async function createEmailPrintAction({ senderEmail, storedDocument, ttlMinutes = 60 }) {
  const token = randomUUID();
  const id = randomUUID();
  const expiresAt = new Date(Date.now() + Math.max(10, Number(ttlMinutes) || 60) * 60 * 1000);
  await initDb();
  await sql`
    INSERT INTO email_print_actions (
      id, token_hash, sender_email, file_name, content_type, object_key, size_bytes, status, expires_at
    )
    VALUES (
      ${id}, ${hashToken(token)}, ${clean(senderEmail)}, ${clean(storedDocument?.fileName) || "document"},
      ${clean(storedDocument?.contentType) || "application/octet-stream"}, ${clean(storedDocument?.objectKey)},
      ${Math.max(0, Number(storedDocument?.sizeBytes) || 0)}, 'pending', ${expiresAt.toISOString()}
    )
  `;
  return { token, id, expiresAt: expiresAt.toISOString() };
}

export async function getEmailPrintAction(token) {
  await initDb();
  const rows = await sql`
    SELECT id, token_hash, sender_email, file_name, content_type, object_key, size_bytes, status,
           print_job_id, expires_at, used_at
    FROM email_print_actions
    WHERE token_hash = ${hashToken(token)}
    LIMIT 1
  `;
  return rows[0] || null;
}

export async function claimEmailPrintAction(token) {
  await initDb();
  const rows = await sql`
    UPDATE email_print_actions
    SET status = 'processing'
    WHERE token_hash = ${hashToken(token)}
      AND status = 'pending'
      AND expires_at > NOW()
    RETURNING id, sender_email, file_name, content_type, object_key, size_bytes, status, expires_at
  `;
  return rows[0] || null;
}

export async function completeEmailPrintAction(token, printJobId) {
  await initDb();
  await sql`
    UPDATE email_print_actions
    SET status = 'completed', print_job_id = ${clean(printJobId) || null}, used_at = NOW()
    WHERE token_hash = ${hashToken(token)}
  `;
}

export async function failEmailPrintAction(token) {
  await initDb();
  await sql`
    UPDATE email_print_actions
    SET status = 'failed'
    WHERE token_hash = ${hashToken(token)} AND status = 'processing'
  `;
}
