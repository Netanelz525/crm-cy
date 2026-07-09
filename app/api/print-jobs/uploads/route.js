import { NextResponse } from "next/server";
import { initDb, sql } from "../../../../lib/db";
import { canUsePrintQueue, createPrintJobFromBuffer, MAX_PRINT_COPIES, MAX_PRINT_FILE_BYTES, normalizePrintPlan } from "../../../../lib/print-jobs";
import { requireAuthenticatedUser } from "../../../../lib/rbac";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_CHUNK_BASE64_LENGTH = 800000;
const MAX_UPLOAD_CHUNKS = 80;

function clean(value) {
  return String(value || "").trim();
}

function json(data, status = 200) {
  return NextResponse.json(data, { status });
}

function normalizeCopies(value) {
  const numeric = Number(value || 1);
  if (!Number.isFinite(numeric)) return 1;
  return Math.max(1, Math.min(MAX_PRINT_COPIES, Math.floor(numeric)));
}

function isSafeBase64(value) {
  return /^[A-Za-z0-9+/=]*$/.test(value);
}

function validateUploadMetadata(body) {
  const uploadId = clean(body?.uploadId);
  const fileName = clean(body?.fileName);
  const contentType = clean(body?.contentType) || "application/octet-stream";
  const fileSizeBytes = Number(body?.fileSizeBytes || 0);
  const totalChunks = Number(body?.totalChunks || 0);
  const copies = normalizeCopies(body?.copies);
  const printPlan = normalizePrintPlan(body?.printPlan);

  if (!uploadId || uploadId.length > 120) throw new Error("מזהה העלאה חסר.");
  if (!fileName) throw new Error("שם הקובץ חסר.");
  if (!fileSizeBytes) throw new Error("הקובץ ריק.");
  if (fileSizeBytes > MAX_PRINT_FILE_BYTES) throw new Error("אפשר לשלוח להדפסה קבצים עד 10MB.");
  if (!Number.isInteger(totalChunks) || totalChunks < 1 || totalChunks > MAX_UPLOAD_CHUNKS) {
    throw new Error("מספר חלקי הקובץ לא תקין.");
  }

  return { uploadId, fileName, contentType, fileSizeBytes, totalChunks, copies, printPlan };
}

async function saveChunk(body, user) {
  const metadata = validateUploadMetadata(body);
  const chunkIndex = Number(body?.chunkIndex);
  const chunkBase64 = clean(body?.chunkBase64);

  if (!Number.isInteger(chunkIndex) || chunkIndex < 0 || chunkIndex >= metadata.totalChunks) {
    throw new Error("מספר חלק הקובץ לא תקין.");
  }
  if (!chunkBase64 || chunkBase64.length > MAX_CHUNK_BASE64_LENGTH || !isSafeBase64(chunkBase64)) {
    throw new Error("חלק הקובץ לא תקין.");
  }

  await initDb();
  await sql`
    INSERT INTO print_job_uploads (
      id,
      file_name,
      content_type,
      file_size_bytes,
      copies,
      print_plan,
      total_chunks,
      uploaded_by_user_id,
      created_at
    )
    VALUES (
      ${metadata.uploadId},
      ${metadata.fileName},
      ${metadata.contentType},
      ${metadata.fileSizeBytes},
      ${metadata.copies},
      ${metadata.printPlan},
      ${metadata.totalChunks},
      ${clean(user.clerk_user_id)},
      NOW()
    )
    ON CONFLICT (id) DO UPDATE SET
      file_name = EXCLUDED.file_name,
      content_type = EXCLUDED.content_type,
      file_size_bytes = EXCLUDED.file_size_bytes,
      copies = EXCLUDED.copies,
      print_plan = EXCLUDED.print_plan,
      total_chunks = EXCLUDED.total_chunks
    WHERE print_job_uploads.uploaded_by_user_id = EXCLUDED.uploaded_by_user_id
  `;

  const ownerRows = await sql`
    SELECT uploaded_by_user_id
    FROM print_job_uploads
    WHERE id = ${metadata.uploadId}
    LIMIT 1
  `;
  if (clean(ownerRows[0]?.uploaded_by_user_id) !== clean(user.clerk_user_id)) {
    throw new Error("אין הרשאה לעדכן את העלאת הקובץ הזו.");
  }

  await sql`
    INSERT INTO print_job_upload_chunks (upload_id, chunk_index, chunk_base64, created_at)
    VALUES (${metadata.uploadId}, ${chunkIndex}, ${chunkBase64}, NOW())
    ON CONFLICT (upload_id, chunk_index) DO UPDATE SET
      chunk_base64 = EXCLUDED.chunk_base64,
      created_at = NOW()
  `;

  return { ok: true };
}

async function finishUpload(body, user) {
  const uploadId = clean(body?.uploadId);
  if (!uploadId) throw new Error("מזהה העלאה חסר.");

  await initDb();
  const uploadRows = await sql`
    SELECT id, file_name, content_type, file_size_bytes, copies, print_plan, total_chunks, uploaded_by_user_id
    FROM print_job_uploads
    WHERE id = ${uploadId}
      AND uploaded_by_user_id = ${clean(user.clerk_user_id)}
    LIMIT 1
  `;
  const upload = uploadRows[0];
  if (!upload) throw new Error("העלאת הקובץ לא נמצאה.");

  const chunkRows = await sql`
    SELECT chunk_index, chunk_base64
    FROM print_job_upload_chunks
    WHERE upload_id = ${uploadId}
    ORDER BY chunk_index ASC
  `;
  const totalChunks = Number(upload.total_chunks || 0);
  if (chunkRows.length !== totalChunks) {
    throw new Error("לא כל חלקי הקובץ נקלטו. נסה לשלוח שוב.");
  }

  for (let index = 0; index < chunkRows.length; index += 1) {
    if (Number(chunkRows[index].chunk_index) !== index) {
      throw new Error("סדר חלקי הקובץ לא תקין.");
    }
  }

  const fileBase64 = chunkRows.map((row) => clean(row.chunk_base64)).join("");
  const buffer = Buffer.from(fileBase64, "base64");
  if (buffer.length !== Number(upload.file_size_bytes || 0)) {
    throw new Error("גודל הקובץ שהתקבל לא תואם לקובץ המקורי.");
  }

  const job = await createPrintJobFromBuffer({
    buffer,
    fileName: upload.file_name,
    contentType: upload.content_type,
    copies: upload.copies,
    printPlan: upload.print_plan,
    uploadedByUserId: user.clerk_user_id
  });

  await sql`DELETE FROM print_job_uploads WHERE id = ${uploadId}`;
  return { ok: true, jobId: job.id };
}

export async function POST(request) {
  const user = await requireAuthenticatedUser();
  if (!canUsePrintQueue(user)) return json({ error: "אין הרשאה לשליחה להדפסה." }, 403);

  try {
    const body = await request.json();
    const action = clean(body?.action);
    if (action === "chunk") return json(await saveChunk(body, user));
    if (action === "finish") return json(await finishUpload(body, user));
    return json({ error: "פעולת העלאה לא תקינה." }, 400);
  } catch (error) {
    return json({ error: clean(error?.message) || "שליחת המסמך להדפסה נכשלה." }, 400);
  }
}
