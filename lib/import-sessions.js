import { initDb, sql } from "./db";

function clean(value) {
  return String(value || "").trim();
}

function parseJson(value, fallback) {
  if (!value) return fallback;
  if (typeof value === "object") return value;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

export async function createImportSession({ createdByUserId, fileName, headers, rows }) {
  await initDb();
  const id = crypto.randomUUID();
  await sql`
    INSERT INTO import_sessions (
      id,
      created_by_user_id,
      file_name,
      headers,
      rows
    )
    VALUES (
      ${id},
      ${clean(createdByUserId)},
      ${clean(fileName) || "import.xlsx"},
      ${JSON.stringify(headers || [])}::jsonb,
      ${JSON.stringify(rows || [])}::jsonb
    )
  `;
  return id;
}

export async function getImportSession(sessionId) {
  await initDb();
  const rows = await sql`
    SELECT id, created_by_user_id, file_name, headers, rows, created_at
    FROM import_sessions
    WHERE id = ${clean(sessionId)}
    LIMIT 1
  `;
  const session = rows[0];
  if (!session) return null;
  return {
    ...session,
    headers: parseJson(session.headers, []),
    rows: parseJson(session.rows, [])
  };
}

export async function deleteImportSession(sessionId) {
  await initDb();
  await sql`
    DELETE FROM import_sessions
    WHERE id = ${clean(sessionId)}
  `;
}
