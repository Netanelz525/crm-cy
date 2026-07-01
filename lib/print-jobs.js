import crypto from "node:crypto";
import { initDb, sql } from "./db";

export const MAX_PRINT_FILE_BYTES = 10 * 1024 * 1024;

function clean(value) {
  return String(value || "").trim();
}

function mapPrintJobRow(row, { includeFile = false } = {}) {
  if (!row) return null;
  return {
    id: clean(row.id),
    fileName: clean(row.file_name),
    contentType: clean(row.content_type) || "application/octet-stream",
    fileSizeBytes: Number(row.file_size_bytes || 0),
    fileBase64Length: Number(row.file_base64_length || (includeFile ? clean(row.file_base64).length : 0)),
    ...(includeFile ? { fileBase64: clean(row.file_base64) } : {}),
    status: clean(row.status) || "pending",
    uploadedByUserId: clean(row.uploaded_by_user_id),
    uploadedByDisplayName: clean(row.uploaded_by_display_name) || clean(row.uploaded_by_user_id) || "לא ידוע",
    uploadedByEmail: clean(row.uploaded_by_email),
    claimedByTokenId: clean(row.claimed_by_token_id),
    claimedAt: row.claimed_at || null,
    createdAt: row.created_at || null
  };
}

export function canUsePrintQueue(user) {
  return Boolean(user?.is_team_member || user?.is_manager || user?.is_super_admin);
}

export async function createPrintJob({ file, uploadedByUserId }) {
  await initDb();
  if (!file || typeof file.arrayBuffer !== "function") {
    throw new Error("יש לבחור קובץ להדפסה.");
  }

  const fileName = clean(file.name);
  const contentType = clean(file.type) || "application/octet-stream";
  const fileSizeBytes = Number(file.size || 0);
  if (!fileName) throw new Error("שם הקובץ חסר.");
  if (!fileSizeBytes) throw new Error("הקובץ ריק.");
  if (fileSizeBytes > MAX_PRINT_FILE_BYTES) {
    throw new Error("אפשר לשלוח להדפסה קבצים עד 10MB.");
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  const id = crypto.randomUUID();

  await sql`
    INSERT INTO print_jobs (
      id,
      file_name,
      content_type,
      file_size_bytes,
      file_base64,
      status,
      uploaded_by_user_id,
      created_at
    )
    VALUES (
      ${id},
      ${fileName},
      ${contentType},
      ${fileSizeBytes},
      ${buffer.toString("base64")},
      'pending',
      ${clean(uploadedByUserId) || null},
      NOW()
    )
  `;

  return getPrintJobById(id);
}

export async function getPrintJobById(id, { includeFile = false } = {}) {
  await initDb();
  const rows = await sql`
    SELECT
      p.id,
      p.file_name,
      p.content_type,
      p.file_size_bytes,
      p.file_base64,
      LENGTH(p.file_base64) AS file_base64_length,
      p.status,
      p.uploaded_by_user_id,
      p.claimed_by_token_id,
      p.claimed_at,
      p.created_at,
      u.display_name AS uploaded_by_display_name,
      u.email AS uploaded_by_email
    FROM print_jobs p
    LEFT JOIN app_users u
      ON u.clerk_user_id = p.uploaded_by_user_id
    WHERE p.id = ${clean(id)}
    LIMIT 1
  `;
  return mapPrintJobRow(rows[0] || null, { includeFile });
}

export async function listPrintJobs({ limit = 30 } = {}) {
  await initDb();
  const safeLimit = Math.max(1, Math.min(100, Number(limit) || 30));
  const rows = await sql`
    SELECT
      p.id,
      p.file_name,
      p.content_type,
      p.file_size_bytes,
      LENGTH(p.file_base64) AS file_base64_length,
      p.status,
      p.uploaded_by_user_id,
      p.claimed_by_token_id,
      p.claimed_at,
      p.created_at,
      u.display_name AS uploaded_by_display_name,
      u.email AS uploaded_by_email
    FROM print_jobs p
    LEFT JOIN app_users u
      ON u.clerk_user_id = p.uploaded_by_user_id
    ORDER BY p.created_at DESC
    LIMIT ${safeLimit}
  `;
  return rows.map((row) => mapPrintJobRow(row)).filter(Boolean);
}

export async function claimNextPrintJob({ claimedByTokenId }) {
  await initDb();
  const rows = await sql`
    UPDATE print_jobs
    SET
      status = 'claimed',
      claimed_by_token_id = ${clean(claimedByTokenId) || null},
      claimed_at = NOW()
    WHERE id = (
      SELECT id
      FROM print_jobs
      WHERE status = 'pending'
        OR (status = 'claimed' AND claimed_at < NOW() - INTERVAL '10 minutes')
      ORDER BY created_at ASC
      LIMIT 1
    )
    RETURNING id
  `;

  const id = clean(rows?.[0]?.id);
  return id ? getPrintJobById(id) : null;
}

export async function deletePrintJob(id) {
  await initDb();
  const normalizedId = clean(id);
  if (!normalizedId) throw new Error("Missing print job id.");
  await sql`
    DELETE FROM print_jobs
    WHERE id = ${normalizedId}
  `;
}

export async function getPrintJobFileChunk(id, { offset = 0, length = 1000000 } = {}) {
  await initDb();
  const normalizedId = clean(id);
  if (!normalizedId) throw new Error("Missing print job id.");
  const safeOffset = Math.max(0, Number(offset) || 0);
  const safeLength = Math.max(4, Math.min(1200000, Number(length) || 1000000));
  const rows = await sql`
    SELECT
      SUBSTRING(file_base64 FROM ${safeOffset + 1} FOR ${safeLength}) AS chunk,
      LENGTH(file_base64) AS total_length
    FROM print_jobs
    WHERE id = ${normalizedId}
    LIMIT 1
  `;
  const row = rows?.[0] || null;
  if (!row) return null;
  const chunk = clean(row.chunk);
  const totalLength = Number(row.total_length || 0);
  const nextOffset = safeOffset + chunk.length;
  return {
    id: normalizedId,
    offset: safeOffset,
    nextOffset,
    length: chunk.length,
    totalLength,
    done: nextOffset >= totalLength,
    chunk
  };
}
