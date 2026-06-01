import { initDb, sql } from "./db";

function clean(value) {
  return String(value || "").trim();
}

function normalizeMetadata(metadata) {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return {};
  return metadata;
}

function normalizeSortLevels(sortLevels) {
  if (!Array.isArray(sortLevels)) return [];
  return sortLevels
    .map((level) => ({
      sortBy: clean(level?.sortBy),
      sortDir: clean(level?.sortDir).toLowerCase() === "desc" ? "desc" : "asc"
    }))
    .filter((level) => level.sortBy);
}

function normalizePaymentReportConfig(config) {
  if (!config || typeof config !== "object" || Array.isArray(config)) return null;
  const connectionIds = Array.isArray(config.connectionIds) ? config.connectionIds.map(clean).filter(Boolean) : [];
  const sortBy = clean(config.sortBy) === "amount" ? "amount" : "date";
  const sortDir = clean(config.sortDir).toLowerCase() === "asc" ? "asc" : "desc";
  const dateFrom = clean(config.dateFrom);
  const dateTo = clean(config.dateTo);
  if (!dateFrom || !dateTo) return null;
  return {
    dateFrom,
    dateTo,
    connectionIds,
    sortBy,
    sortDir
  };
}

export async function listAiChatMessagesByUser(clerkUserId, limit = 50) {
  const userId = clean(clerkUserId);
  if (!userId) return [];

  await initDb();
  const rows = await sql`
    SELECT m.id, m.role, m.content, m.metadata, m.created_at, f.feedback
    FROM ai_chat_messages m
    LEFT JOIN ai_chat_message_feedback f ON f.message_id = m.id
    WHERE m.clerk_user_id = ${userId}
    ORDER BY m.created_at ASC
    LIMIT ${Math.max(1, Math.min(Number(limit) || 50, 200))}
  `;

  return rows.map((row) => ({
    id: clean(row.id),
    role: clean(row.role) || "assistant",
    content: clean(row.content),
    studentCards: Array.isArray(row.metadata?.studentCards) ? row.metadata.studentCards : [],
    exportUrl: clean(row.metadata?.exportUrl) || "",
    pdfUrl: clean(row.metadata?.pdfUrl) || "",
    exportColumns: Array.isArray(row.metadata?.exportColumns) ? row.metadata.exportColumns.map(clean).filter(Boolean) : [],
    sortLevels: normalizeSortLevels(row.metadata?.sortLevels),
    paymentReportConfig: normalizePaymentReportConfig(row.metadata?.paymentReportConfig),
    viewUrl: clean(row.metadata?.viewUrl) || "",
    searchSummary: clean(row.metadata?.searchSummary) || "",
    feedback: clean(row.feedback) || "",
    documentInfo: row.metadata?.documentInfo || null,
    updatableFields: Array.isArray(row.metadata?.updatableFields) ? row.metadata.updatableFields : [],
    pendingAction: null,
    createdAt: row.created_at || null
  }));
}

export async function listRecentAiChatMessagesByUser(clerkUserId, { limit = 8, withinMinutes = 45 } = {}) {
  const userId = clean(clerkUserId);
  if (!userId) return [];

  await initDb();
  const rawLimit = Math.max(1, Math.min(Number(limit) || 8, 50));
  const rows = await sql`
    SELECT m.id, m.role, m.content, m.metadata, m.created_at, f.feedback
    FROM ai_chat_messages m
    LEFT JOIN ai_chat_message_feedback f ON f.message_id = m.id
    WHERE m.clerk_user_id = ${userId}
    ORDER BY m.created_at DESC
    LIMIT ${Math.max(rawLimit * 4, 20)}
  `;

  const cutoff = Date.now() - Math.max(1, Number(withinMinutes) || 45) * 60 * 1000;
  const filteredRows = rows
    .filter((row) => {
      const ts = new Date(row.created_at || 0).getTime();
      return Number.isFinite(ts) && ts >= cutoff;
    });
  const resetIndex = filteredRows.findIndex((row) => row.metadata?.conversationReset === true);
  const scopedRows = (resetIndex >= 0 ? filteredRows.slice(0, resetIndex + 1) : filteredRows)
    .slice(0, rawLimit);
  return scopedRows
    .reverse()
    .map((row) => ({
      id: clean(row.id),
      role: clean(row.role) || "assistant",
      content: clean(row.content),
      studentCards: Array.isArray(row.metadata?.studentCards) ? row.metadata.studentCards : [],
      exportUrl: clean(row.metadata?.exportUrl) || "",
      pdfUrl: clean(row.metadata?.pdfUrl) || "",
      exportColumns: Array.isArray(row.metadata?.exportColumns) ? row.metadata.exportColumns.map(clean).filter(Boolean) : [],
      sortLevels: normalizeSortLevels(row.metadata?.sortLevels),
      paymentReportConfig: normalizePaymentReportConfig(row.metadata?.paymentReportConfig),
      viewUrl: clean(row.metadata?.viewUrl) || "",
      searchSummary: clean(row.metadata?.searchSummary) || "",
      feedback: clean(row.feedback) || "",
      documentInfo: row.metadata?.documentInfo || null,
      updatableFields: Array.isArray(row.metadata?.updatableFields) ? row.metadata.updatableFields : [],
      pendingAction: null,
      createdAt: row.created_at || null
    }));
}

export async function createAiChatMessage({ clerkUserId, role, content, metadata = {} }) {
  const userId = clean(clerkUserId);
  const safeRole = clean(role) || "assistant";
  const safeContent = clean(content);
  if (!userId || !safeContent) return null;

  await initDb();
  const id = crypto.randomUUID();
  const safeMetadata = normalizeMetadata(metadata);

  await sql`
    INSERT INTO ai_chat_messages (id, clerk_user_id, role, content, metadata)
    VALUES (${id}, ${userId}, ${safeRole}, ${safeContent}, ${JSON.stringify(safeMetadata)}::jsonb)
  `;

  return {
    id,
    role: safeRole,
    content: safeContent,
    studentCards: Array.isArray(safeMetadata.studentCards) ? safeMetadata.studentCards : [],
    exportUrl: clean(safeMetadata.exportUrl) || "",
    pdfUrl: clean(safeMetadata.pdfUrl) || "",
    exportColumns: Array.isArray(safeMetadata.exportColumns) ? safeMetadata.exportColumns.map(clean).filter(Boolean) : [],
    sortLevels: normalizeSortLevels(safeMetadata.sortLevels),
    paymentReportConfig: normalizePaymentReportConfig(safeMetadata.paymentReportConfig),
    viewUrl: clean(safeMetadata.viewUrl) || "",
    searchSummary: clean(safeMetadata.searchSummary) || "",
    feedback: "",
    documentInfo: safeMetadata.documentInfo || null,
    updatableFields: Array.isArray(safeMetadata.updatableFields) ? safeMetadata.updatableFields : [],
    pendingAction: safeMetadata.pendingAction || null
  };
}

export async function getAiChatMessageById({ clerkUserId, messageId }) {
  const userId = clean(clerkUserId);
  const id = clean(messageId);
  if (!userId || !id) return null;

  await initDb();
  const rows = await sql`
    SELECT m.id, m.role, m.content, m.metadata, m.created_at, f.feedback
    FROM ai_chat_messages m
    LEFT JOIN ai_chat_message_feedback f ON f.message_id = m.id
    WHERE m.id = ${id}
      AND m.clerk_user_id = ${userId}
    LIMIT 1
  `;
  const row = rows[0];
  if (!row) return null;
  return {
    id: clean(row.id),
    role: clean(row.role) || "assistant",
    content: clean(row.content),
    studentCards: Array.isArray(row.metadata?.studentCards) ? row.metadata.studentCards : [],
    exportUrl: clean(row.metadata?.exportUrl) || "",
    pdfUrl: clean(row.metadata?.pdfUrl) || "",
    exportColumns: Array.isArray(row.metadata?.exportColumns) ? row.metadata.exportColumns.map(clean).filter(Boolean) : [],
    sortLevels: normalizeSortLevels(row.metadata?.sortLevels),
    paymentReportConfig: normalizePaymentReportConfig(row.metadata?.paymentReportConfig),
    viewUrl: clean(row.metadata?.viewUrl) || "",
    searchSummary: clean(row.metadata?.searchSummary) || "",
    feedback: clean(row.feedback) || "",
    documentInfo: row.metadata?.documentInfo || null,
    updatableFields: Array.isArray(row.metadata?.updatableFields) ? row.metadata.updatableFields : [],
    pendingAction: row.metadata?.pendingAction || null,
    createdAt: row.created_at || null
  };
}

export async function getAiChatMessageByIdPrefix({ clerkUserId, messageIdPrefix }) {
  const userId = clean(clerkUserId);
  const prefix = clean(messageIdPrefix);
  if (!userId || !prefix) return null;

  await initDb();
  const rows = await sql`
    SELECT m.id, m.role, m.content, m.metadata, m.created_at, f.feedback
    FROM ai_chat_messages m
    LEFT JOIN ai_chat_message_feedback f ON f.message_id = m.id
    WHERE m.id LIKE ${`${prefix}%`}
      AND m.clerk_user_id = ${userId}
    ORDER BY m.created_at DESC
    LIMIT 2
  `;
  if (rows.length !== 1) return null;
  const row = rows[0];
  return {
    id: clean(row.id),
    role: clean(row.role) || "assistant",
    content: clean(row.content),
    studentCards: Array.isArray(row.metadata?.studentCards) ? row.metadata.studentCards : [],
    exportUrl: clean(row.metadata?.exportUrl) || "",
    pdfUrl: clean(row.metadata?.pdfUrl) || "",
    exportColumns: Array.isArray(row.metadata?.exportColumns) ? row.metadata.exportColumns.map(clean).filter(Boolean) : [],
    sortLevels: normalizeSortLevels(row.metadata?.sortLevels),
    paymentReportConfig: normalizePaymentReportConfig(row.metadata?.paymentReportConfig),
    viewUrl: clean(row.metadata?.viewUrl) || "",
    searchSummary: clean(row.metadata?.searchSummary) || "",
    feedback: clean(row.feedback) || "",
    documentInfo: row.metadata?.documentInfo || null,
    updatableFields: Array.isArray(row.metadata?.updatableFields) ? row.metadata.updatableFields : [],
    pendingAction: row.metadata?.pendingAction || null,
    createdAt: row.created_at || null
  };
}

export async function clearAiChatMessagePendingAction({ messageId, clerkUserId }) {
  const normalizedMessageId = clean(messageId);
  const normalizedUserId = clean(clerkUserId);
  if (!normalizedMessageId || !normalizedUserId) throw new Error("Missing message target.");

  await initDb();
  await sql`
    UPDATE ai_chat_messages
    SET metadata = COALESCE(metadata, '{}'::jsonb) - 'pendingAction'
    WHERE id = ${normalizedMessageId}
      AND clerk_user_id = ${normalizedUserId}
      AND role = 'assistant'
  `;

  return { messageId: normalizedMessageId };
}

export async function setAiChatMessageExportColumns({ messageId, clerkUserId, exportColumns }) {
  const normalizedMessageId = clean(messageId);
  const normalizedUserId = clean(clerkUserId);
  const normalizedColumns = Array.isArray(exportColumns) ? exportColumns.map(clean).filter(Boolean) : [];
  if (!normalizedMessageId || !normalizedUserId) throw new Error("Missing message target.");

  await initDb();
  await sql`
    UPDATE ai_chat_messages
    SET metadata = jsonb_set(
      COALESCE(metadata, '{}'::jsonb),
      '{exportColumns}',
      ${JSON.stringify(normalizedColumns)}::jsonb,
      true
    )
    WHERE id = ${normalizedMessageId}
      AND clerk_user_id = ${normalizedUserId}
      AND role = 'assistant'
  `;

  return {
    messageId: normalizedMessageId,
    exportColumns: normalizedColumns
  };
}

export async function setAiChatMessageReportConfig({
  messageId,
  clerkUserId,
  exportColumns,
  sortLevels,
  paymentReportConfig,
  exportUrl,
  pdfUrl,
  viewUrl,
  searchSummary,
  paymentSummary
}) {
  const normalizedMessageId = clean(messageId);
  const normalizedUserId = clean(clerkUserId);
  if (!normalizedMessageId || !normalizedUserId) throw new Error("Missing message target.");

  const updates = {};
  if (exportColumns !== undefined) {
    updates.exportColumns = Array.isArray(exportColumns) ? exportColumns.map(clean).filter(Boolean) : [];
  }
  if (sortLevels !== undefined) {
    updates.sortLevels = normalizeSortLevels(sortLevels);
  }
  if (paymentReportConfig !== undefined) {
    updates.paymentReportConfig = normalizePaymentReportConfig(paymentReportConfig);
  }
  if (exportUrl !== undefined) {
    updates.exportUrl = clean(exportUrl);
  }
  if (pdfUrl !== undefined) {
    updates.pdfUrl = clean(pdfUrl);
  }
  if (viewUrl !== undefined) {
    updates.viewUrl = clean(viewUrl);
  }
  if (searchSummary !== undefined) {
    updates.searchSummary = clean(searchSummary);
  }
  if (paymentSummary !== undefined) {
    updates.paymentSummary = paymentSummary || null;
  }
  if (!Object.keys(updates).length) return { messageId: normalizedMessageId };

  await initDb();
  await sql`
    UPDATE ai_chat_messages
    SET metadata = COALESCE(metadata, '{}'::jsonb) || ${JSON.stringify(updates)}::jsonb
    WHERE id = ${normalizedMessageId}
      AND clerk_user_id = ${normalizedUserId}
      AND role = 'assistant'
  `;

  return {
    messageId: normalizedMessageId,
    exportColumns: updates.exportColumns,
    sortLevels: updates.sortLevels
  };
}

export async function setAiChatMessageFeedback({ messageId, clerkUserId, feedback }) {
  const normalizedMessageId = clean(messageId);
  const normalizedUserId = clean(clerkUserId);
  const normalizedFeedback = clean(feedback).toLowerCase();
  if (!normalizedMessageId || !normalizedUserId) throw new Error("Missing feedback target.");
  if (!["good", "bad"].includes(normalizedFeedback)) throw new Error("Invalid feedback value.");

  await initDb();

  const rows = await sql`
    SELECT id
    FROM ai_chat_messages
    WHERE id = ${normalizedMessageId}
      AND clerk_user_id = ${normalizedUserId}
      AND role = 'assistant'
    LIMIT 1
  `;

  if (!rows[0]?.id) {
    throw new Error("Message not found.");
  }

  await sql`
    INSERT INTO ai_chat_message_feedback (message_id, clerk_user_id, feedback)
    VALUES (${normalizedMessageId}, ${normalizedUserId}, ${normalizedFeedback})
    ON CONFLICT (message_id)
    DO UPDATE SET feedback = EXCLUDED.feedback, updated_at = NOW()
  `;

  return {
    messageId: normalizedMessageId,
    feedback: normalizedFeedback
  };
}
