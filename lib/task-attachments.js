import { randomUUID } from "node:crypto";
import { initDb, sql } from "./db";
import { getObjectBytesFromR2, isR2Configured, uploadBufferToR2 } from "./r2";

const MAX_TASK_ATTACHMENT_BYTES = 2 * 1024 * 1024;
const SUPPORTED_CONTENT_TYPES = new Set([
  "application/pdf",
  "image/png",
  "image/jpeg",
  "image/webp",
  "text/plain",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
]);

function clean(value) {
  return String(value || "").trim();
}

function getExtension(fileName, contentType) {
  const byName = clean(fileName).split(".").pop()?.toLowerCase() || "";
  if (["pdf", "png", "jpg", "jpeg", "webp", "txt", "doc", "docx", "xls", "xlsx"].includes(byName)) return byName;
  const byType = {
    "application/pdf": "pdf",
    "image/png": "png",
    "image/jpeg": "jpg",
    "image/webp": "webp",
    "text/plain": "txt",
    "application/msword": "doc",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
    "application/vnd.ms-excel": "xls",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx"
  };
  return byType[clean(contentType).toLowerCase()] || "bin";
}

function mapAttachmentRow(row) {
  if (!row) return null;
  return {
    id: clean(row.id),
    taskId: clean(row.task_id),
    fileName: clean(row.file_name),
    contentType: clean(row.content_type),
    objectKey: clean(row.object_key),
    sizeBytes: Number(row.size_bytes) || 0,
    uploadedByUserId: clean(row.uploaded_by_user_id),
    createdAt: row.created_at || null
  };
}

export async function createTaskAttachment({ taskId, uploadedByUserId, file }) {
  const normalizedTaskId = clean(taskId);
  if (!normalizedTaskId) throw new Error("לא נבחרה משימה לצירוף הקובץ.");
  if (!file || typeof file.arrayBuffer !== "function" || !clean(file.name)) return null;
  if (!isR2Configured()) throw new Error("R2 לא מוגדר ב-ENV.");

  const contentType = clean(file.type).toLowerCase() || "application/octet-stream";
  if (!SUPPORTED_CONTENT_TYPES.has(contentType)) {
    throw new Error("נתמכים קבצי PDF, תמונה, Word, Excel או TXT בלבד.");
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  if (!buffer.length) return null;
  if (buffer.length > MAX_TASK_ATTACHMENT_BYTES) {
    throw new Error("ניתן לצרף קובץ עד 2MB בלבד.");
  }

  const id = randomUUID();
  const fileName = clean(file.name);
  const extension = getExtension(fileName, contentType);
  const objectKey = `tasks/${normalizedTaskId}/attachments/${id}.${extension}`;

  await uploadBufferToR2({
    key: objectKey,
    buffer,
    contentType,
    contentDisposition: `inline; filename="${fileName.replace(/"/g, "")}"`
  });

  await initDb();
  const rows = await sql`
    INSERT INTO crm_task_attachments (
      id,
      task_id,
      file_name,
      content_type,
      object_key,
      size_bytes,
      uploaded_by_user_id
    )
    VALUES (
      ${id},
      ${normalizedTaskId},
      ${fileName},
      ${contentType},
      ${objectKey},
      ${buffer.length},
      ${clean(uploadedByUserId) || null}
    )
    RETURNING id, task_id, file_name, content_type, object_key, size_bytes, uploaded_by_user_id, created_at
  `;
  return mapAttachmentRow(rows[0]);
}

export async function listTaskAttachments(taskId) {
  const normalizedTaskId = clean(taskId);
  if (!normalizedTaskId) return [];
  await initDb();
  const rows = await sql`
    SELECT id, task_id, file_name, content_type, object_key, size_bytes, uploaded_by_user_id, created_at
    FROM crm_task_attachments
    WHERE task_id = ${normalizedTaskId}
    ORDER BY created_at DESC
  `;
  return rows.map(mapAttachmentRow).filter(Boolean);
}

export async function getTaskAttachmentById(id) {
  const normalizedId = clean(id);
  if (!normalizedId) return null;
  await initDb();
  const rows = await sql`
    SELECT id, task_id, file_name, content_type, object_key, size_bytes, uploaded_by_user_id, created_at
    FROM crm_task_attachments
    WHERE id = ${normalizedId}
    LIMIT 1
  `;
  return mapAttachmentRow(rows[0]);
}

export async function getTaskAttachmentFile(id) {
  const attachment = await getTaskAttachmentById(id);
  if (!attachment) return null;
  const object = await getObjectBytesFromR2(attachment.objectKey);
  return {
    attachment,
    bytes: object.bytes,
    contentType: attachment.contentType || object.contentType || "application/octet-stream"
  };
}
