import { initDb, sql } from "./db";
import { isR2Configured, uploadBufferToR2, getObjectBytesFromR2 } from "./r2";

function clean(value) {
  return String(value || "").trim();
}

function normalizeDocumentKind(value) {
  const raw = clean(value).toLowerCase();
  if (["id", "tuition", "medical", "general"].includes(raw)) return raw;
  return "general";
}

function getExtension(fileName, contentType) {
  const byName = clean(fileName).split(".").pop()?.toLowerCase() || "";
  if (["png", "jpg", "jpeg", "webp", "pdf"].includes(byName)) return byName;
  const byType = {
    "image/png": "png",
    "image/jpeg": "jpg",
    "image/webp": "webp",
    "application/pdf": "pdf"
  };
  return byType[clean(contentType).toLowerCase()] || "bin";
}

export function assertSupportedStudentDocument(file) {
  const contentType = clean(file?.type).toLowerCase();
  if (!contentType) throw new Error("לא התקבל סוג קובץ.");
  if (!["image/png", "image/jpeg", "image/webp", "application/pdf"].includes(contentType)) {
    throw new Error("נתמכים רק PDF, PNG, JPG או WEBP.");
  }
}

export async function createStudentDocument({
  studentId,
  uploadedByUserId,
  file,
  documentKind = "general",
  displayName = "",
  noteText = ""
}) {
  const normalizedStudentId = clean(studentId);
  if (!normalizedStudentId) throw new Error("Missing studentId.");
  if (!file || typeof file.arrayBuffer !== "function" || !clean(file.name)) {
    throw new Error("לא התקבל קובץ תקין.");
  }
  if (!isR2Configured()) {
    throw new Error("R2 לא מוגדר ב-ENV.");
  }

  assertSupportedStudentDocument(file);
  const contentType = clean(file.type).toLowerCase();
  const fileName = clean(file.name);
  const normalizedDisplayName = clean(displayName) || fileName;
  const normalizedNoteText = clean(noteText);
  const extension = getExtension(fileName, contentType);
  const id = crypto.randomUUID();
  const objectKey = `students/${normalizedStudentId}/documents/${id}.${extension}`;
  const buffer = Buffer.from(await file.arrayBuffer());

  await uploadBufferToR2({
    key: objectKey,
    buffer,
    contentType,
    contentDisposition: `inline; filename="${fileName.replace(/"/g, "")}"`
  });

  await initDb();
  await sql`
    INSERT INTO student_documents (
      id,
      student_id,
      display_name,
      file_name,
      note_text,
      content_type,
      object_key,
      size_bytes,
      document_kind,
      uploaded_by_user_id
    )
    VALUES (
      ${id},
      ${normalizedStudentId},
      ${normalizedDisplayName},
      ${fileName},
      ${normalizedNoteText || null},
      ${contentType},
      ${objectKey},
      ${buffer.length},
      ${normalizeDocumentKind(documentKind)},
      ${clean(uploadedByUserId) || null}
    )
  `;

  return {
    id,
    studentId: normalizedStudentId,
    name: normalizedDisplayName,
    fileName,
    noteText: normalizedNoteText,
    contentType,
    objectKey,
    sizeBytes: buffer.length,
    documentKind: normalizeDocumentKind(documentKind),
    uploadedAt: new Date().toISOString()
  };
}

export async function createStudentDocumentFromStoredObject({
  studentId,
  uploadedByUserId,
  fileName,
  displayName = "",
  noteText = "",
  contentType,
  objectKey,
  sizeBytes = 0,
  documentKind = "general"
}) {
  const normalizedStudentId = clean(studentId);
  const normalizedObjectKey = clean(objectKey);
  const normalizedFileName = clean(fileName) || "document";
  const normalizedContentType = clean(contentType) || "application/octet-stream";
  if (!normalizedStudentId) throw new Error("Missing studentId.");
  if (!normalizedObjectKey) throw new Error("Missing stored document key.");

  await initDb();
  const id = crypto.randomUUID();
  const normalizedDisplayName = clean(displayName) || normalizedFileName;
  const normalizedNoteText = clean(noteText);

  await sql`
    INSERT INTO student_documents (
      id,
      student_id,
      display_name,
      file_name,
      note_text,
      content_type,
      object_key,
      size_bytes,
      document_kind,
      uploaded_by_user_id
    )
    VALUES (
      ${id},
      ${normalizedStudentId},
      ${normalizedDisplayName},
      ${normalizedFileName},
      ${normalizedNoteText || null},
      ${normalizedContentType},
      ${normalizedObjectKey},
      ${Math.max(0, Number(sizeBytes) || 0)},
      ${normalizeDocumentKind(documentKind)},
      ${clean(uploadedByUserId) || null}
    )
  `;

  return {
    id,
    studentId: normalizedStudentId,
    name: normalizedDisplayName,
    fileName: normalizedFileName,
    noteText: normalizedNoteText,
    contentType: normalizedContentType,
    objectKey: normalizedObjectKey,
    sizeBytes: Math.max(0, Number(sizeBytes) || 0),
    documentKind: normalizeDocumentKind(documentKind),
    uploadedAt: new Date().toISOString()
  };
}

export async function listStudentDocuments(studentId) {
  const normalizedStudentId = clean(studentId);
  if (!normalizedStudentId) return [];

  await initDb();
  const rows = await sql`
    SELECT id, student_id, display_name, file_name, note_text, content_type, object_key, size_bytes, document_kind, uploaded_by_user_id, created_at
    FROM student_documents
    WHERE student_id = ${normalizedStudentId}
    ORDER BY created_at DESC
  `;

  return rows.map((row) => ({
    id: clean(row.id),
    studentId: clean(row.student_id),
    name: clean(row.display_name) || clean(row.file_name),
    fileName: clean(row.file_name),
    noteText: clean(row.note_text),
    contentType: clean(row.content_type),
    objectKey: clean(row.object_key),
    sizeBytes: Number(row.size_bytes) || 0,
    documentKind: clean(row.document_kind) || "general",
    uploadedByUserId: clean(row.uploaded_by_user_id) || "",
    createdAt: row.created_at || null,
    uploadedAt: row.created_at || null
  }));
}

export async function getStudentDocumentById(id) {
  const normalizedId = clean(id);
  if (!normalizedId) return null;

  await initDb();
  const rows = await sql`
    SELECT id, student_id, display_name, file_name, note_text, content_type, object_key, size_bytes, document_kind, uploaded_by_user_id, created_at
    FROM student_documents
    WHERE id = ${normalizedId}
    LIMIT 1
  `;
  const row = rows[0];
  if (!row) return null;
  return {
    id: clean(row.id),
    studentId: clean(row.student_id),
    name: clean(row.display_name) || clean(row.file_name),
    fileName: clean(row.file_name),
    noteText: clean(row.note_text),
    contentType: clean(row.content_type),
    objectKey: clean(row.object_key),
    sizeBytes: Number(row.size_bytes) || 0,
    documentKind: clean(row.document_kind) || "general",
    uploadedByUserId: clean(row.uploaded_by_user_id) || "",
    createdAt: row.created_at || null,
    uploadedAt: row.created_at || null
  };
}

export async function updateStudentDocumentName({ id, displayName }) {
  const normalizedId = clean(id);
  const normalizedName = clean(displayName);
  if (!normalizedId) throw new Error("Missing document id.");
  if (!normalizedName) throw new Error("יש להזין שם מסמך.");

  await initDb();
  const rows = await sql`
    UPDATE student_documents
    SET display_name = ${normalizedName}
    WHERE id = ${normalizedId}
    RETURNING id, student_id, display_name, file_name, note_text, content_type, object_key, size_bytes, document_kind, uploaded_by_user_id, created_at
  `;
  const row = rows[0];
  if (!row) return null;
  return {
    id: clean(row.id),
    studentId: clean(row.student_id),
    name: clean(row.display_name) || clean(row.file_name),
    fileName: clean(row.file_name),
    noteText: clean(row.note_text),
    contentType: clean(row.content_type),
    objectKey: clean(row.object_key),
    sizeBytes: Number(row.size_bytes) || 0,
    documentKind: clean(row.document_kind) || "general",
    uploadedByUserId: clean(row.uploaded_by_user_id) || "",
    createdAt: row.created_at || null,
    uploadedAt: row.created_at || null
  };
}

export async function getStudentDocumentFile(id) {
  const doc = await getStudentDocumentById(id);
  if (!doc) return null;
  const object = await getObjectBytesFromR2(doc.objectKey);
  return {
    ...doc,
    bytes: object.bytes,
    contentType: object.contentType || doc.contentType
  };
}

export async function getStudentDocumentsStats({ studentIds = [] } = {}) {
  await initDb();
  const normalizedIds = Array.isArray(studentIds)
    ? studentIds.map((id) => clean(id)).filter(Boolean)
    : [];

  if (!normalizedIds.length) {
    const rows = await sql`
      SELECT COUNT(*)::int AS total_documents, COUNT(DISTINCT student_id)::int AS students_with_documents
      FROM student_documents
    `;
    const row = rows[0] || {};
    return {
      totalDocuments: Number(row.total_documents) || 0,
      studentsWithDocuments: Number(row.students_with_documents) || 0
    };
  }

  const rows = await sql(
    `SELECT COUNT(*)::int AS total_documents, COUNT(DISTINCT student_id)::int AS students_with_documents
     FROM student_documents
     WHERE student_id = ANY($1::text[])`,
    [normalizedIds]
  );
  const row = rows[0] || {};
  return {
    totalDocuments: Number(row.total_documents) || 0,
    studentsWithDocuments: Number(row.students_with_documents) || 0
  };
}
