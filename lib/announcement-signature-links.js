import crypto from "node:crypto";
import { initDb, sql } from "./db";
import { getObjectBytesFromR2 } from "./r2";

const SIGNATURE_LINK_TTL_SECONDS = 60;

function clean(value) {
  return String(value || "").trim();
}

function isPlainObject(value) {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function temporarySignatureUrl(origin, token) {
  const normalizedOrigin = clean(origin).replace(/\/$/, "");
  return `${normalizedOrigin}/api/announcements/signature-links/${encodeURIComponent(token)}`;
}

async function createSignatureAccessToken({ signatureId, printJobId }) {
  await initDb();
  const token = crypto.randomBytes(32).toString("base64url");
  await sql`
    INSERT INTO announcement_signature_access_tokens (
      token,
      signature_id,
      print_job_id,
      expires_at,
      created_at
    )
    VALUES (
      ${token},
      ${clean(signatureId)},
      ${clean(printJobId) || null},
      NOW() + make_interval(secs => ${SIGNATURE_LINK_TTL_SECONDS}),
      NOW()
    )
  `;
  return token;
}

async function enrichValue(value, { origin, printJobId }) {
  if (Array.isArray(value)) {
    return Promise.all(value.map((item) => enrichValue(item, { origin, printJobId })));
  }

  if (!isPlainObject(value)) return value;

  const source = clean(value.source);
  const signatureId = clean(value.signatureId);
  if (value.type === "image" && source === "signature" && signatureId) {
    const token = await createSignatureAccessToken({ signatureId, printJobId });
    return {
      ...value,
      url: temporarySignatureUrl(origin, token),
      temporaryUrlExpiresInSeconds: SIGNATURE_LINK_TTL_SECONDS
    };
  }

  const entries = await Promise.all(
    Object.entries(value).map(async ([key, nestedValue]) => [
      key,
      await enrichValue(nestedValue, { origin, printJobId })
    ])
  );
  return Object.fromEntries(entries);
}

export async function withTemporaryAnnouncementSignatureLinks(job, origin) {
  if (!job?.id || !isPlainObject(job.sourceMetadata) || !clean(origin)) return job;
  return {
    ...job,
    sourceMetadata: await enrichValue(job.sourceMetadata, {
      origin,
      printJobId: job.id
    })
  };
}

export async function revokeAnnouncementSignatureLinksForPrintJob(printJobId) {
  await initDb();
  const normalizedPrintJobId = clean(printJobId);
  if (!normalizedPrintJobId) return;
  await sql`
    UPDATE announcement_signature_access_tokens
    SET revoked_at = NOW()
    WHERE print_job_id = ${normalizedPrintJobId}
      AND revoked_at IS NULL
  `;
}

export async function getAnnouncementSignatureByAccessToken(token) {
  await initDb();
  const normalizedToken = clean(token);
  if (!normalizedToken) return null;
  const rows = await sql`
    SELECT
      t.token,
      t.signature_id,
      t.print_job_id,
      t.expires_at,
      s.object_key,
      s.content_type
    FROM announcement_signature_access_tokens t
    JOIN announcement_signatures s
      ON s.id = t.signature_id
    WHERE t.token = ${normalizedToken}
      AND t.revoked_at IS NULL
      AND t.expires_at > NOW()
      AND s.active = TRUE
    LIMIT 1
  `;
  const row = rows[0] || null;
  if (!row?.object_key) return null;
  const object = await getObjectBytesFromR2(row.object_key);
  return {
    bytes: object.bytes,
    contentType: clean(row.content_type) || object.contentType || "application/octet-stream",
    expiresAt: row.expires_at || null
  };
}
