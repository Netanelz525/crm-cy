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
    SELECT
      id,
      created_by_user_id,
      file_name,
      headers,
      rows,
      status,
      match_mapping_json,
      field_mapping_json,
      progress_json,
      started_at,
      result_json,
      completed_at,
      created_at
    FROM import_sessions
    WHERE id = ${clean(sessionId)}
    LIMIT 1
  `;
  const session = rows[0];
  if (!session) return null;
  return {
    ...session,
    headers: parseJson(session.headers, []),
    rows: parseJson(session.rows, []),
    match_mapping_json: parseJson(session.match_mapping_json, {}),
    field_mapping_json: parseJson(session.field_mapping_json, {}),
    progress_json: parseJson(session.progress_json, null),
    result_json: parseJson(session.result_json, null)
  };
}

export async function updateImportSessionResult(sessionId, result) {
  await initDb();
  await sql`
    UPDATE import_sessions
    SET
      result_json = ${JSON.stringify(result || {})}::jsonb,
      progress_json = NULL,
      status = 'completed',
      completed_at = NOW()
    WHERE id = ${clean(sessionId)}
  `;
}

export async function configureImportSession(sessionId, { matchMapping = {}, fieldMapping = {} } = {}) {
  await initDb();
  await sql`
    UPDATE import_sessions
    SET
      match_mapping_json = ${JSON.stringify(matchMapping || {})}::jsonb,
      field_mapping_json = ${JSON.stringify(fieldMapping || {})}::jsonb,
      status = 'queued',
      progress_json = NULL,
      result_json = NULL,
      started_at = NULL,
      completed_at = NULL
    WHERE id = ${clean(sessionId)}
  `;
}

export async function markImportSessionRunning(sessionId, progress = {}) {
  await initDb();
  await sql`
    UPDATE import_sessions
    SET
      status = 'running',
      progress_json = ${JSON.stringify(progress || {})}::jsonb,
      started_at = COALESCE(started_at, NOW()),
      completed_at = NULL
    WHERE id = ${clean(sessionId)}
  `;
}

export async function updateImportSessionProgress(sessionId, progress = {}) {
  await initDb();
  await sql`
    UPDATE import_sessions
    SET progress_json = ${JSON.stringify(progress || {})}::jsonb
    WHERE id = ${clean(sessionId)}
  `;
}

export async function markImportSessionFailed(sessionId, errorMessage) {
  await initDb();
  await sql`
    UPDATE import_sessions
    SET
      status = 'failed',
      completed_at = NOW(),
      result_json = ${JSON.stringify({ error: clean(errorMessage) || "ייבוא נכשל" })}::jsonb
    WHERE id = ${clean(sessionId)}
  `;
}

export async function deleteImportSession(sessionId) {
  await initDb();
  await sql`
    DELETE FROM import_sessions
    WHERE id = ${clean(sessionId)}
  `;
}
