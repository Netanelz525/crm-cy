import { initDb, sql } from "./db";

function clean(value) {
  return String(value || "").trim();
}

function normalizeMetadata(metadata) {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return {};
  return metadata;
}

export async function listAiChatMessagesByUser(clerkUserId, limit = 50) {
  const userId = clean(clerkUserId);
  if (!userId) return [];

  await initDb();
  const rows = await sql`
    SELECT id, role, content, metadata, created_at
    FROM ai_chat_messages
    WHERE clerk_user_id = ${userId}
    ORDER BY created_at ASC
    LIMIT ${Math.max(1, Math.min(Number(limit) || 50, 200))}
  `;

  return rows.map((row) => ({
    id: clean(row.id),
    role: clean(row.role) || "assistant",
    content: clean(row.content),
    studentCards: Array.isArray(row.metadata?.studentCards) ? row.metadata.studentCards : [],
    exportUrl: clean(row.metadata?.exportUrl) || "",
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
  const rows = await sql`
    SELECT id, role, content, metadata, created_at
    FROM ai_chat_messages
    WHERE clerk_user_id = ${userId}
    ORDER BY created_at DESC
    LIMIT ${Math.max(1, Math.min(Number(limit) || 8, 50))}
  `;

  const cutoff = Date.now() - Math.max(1, Number(withinMinutes) || 45) * 60 * 1000;
  return rows
    .filter((row) => {
      const ts = new Date(row.created_at || 0).getTime();
      return Number.isFinite(ts) && ts >= cutoff;
    })
    .reverse()
    .map((row) => ({
      id: clean(row.id),
      role: clean(row.role) || "assistant",
      content: clean(row.content),
      studentCards: Array.isArray(row.metadata?.studentCards) ? row.metadata.studentCards : [],
      exportUrl: clean(row.metadata?.exportUrl) || "",
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
    documentInfo: safeMetadata.documentInfo || null,
    updatableFields: Array.isArray(safeMetadata.updatableFields) ? safeMetadata.updatableFields : [],
    pendingAction: safeMetadata.pendingAction || null
  };
}
