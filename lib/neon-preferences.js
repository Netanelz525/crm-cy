import { initDb, sql } from "./db";

function clean(value) {
  return String(value || "").trim();
}

export async function getNeonPreferencesForUser(ownerUserId) {
  await initDb();
  const rows = await sql`
    SELECT owner_user_id, query_string, created_at, updated_at
    FROM neon_user_preferences
    WHERE owner_user_id = ${clean(ownerUserId)}
    LIMIT 1
  `;
  return rows?.[0] || null;
}

export async function saveNeonPreferencesForUser({ ownerUserId, queryString }) {
  await initDb();
  await sql`
    INSERT INTO neon_user_preferences (owner_user_id, query_string)
    VALUES (${clean(ownerUserId)}, ${clean(queryString)})
    ON CONFLICT (owner_user_id)
    DO UPDATE SET
      query_string = EXCLUDED.query_string,
      updated_at = NOW()
  `;
}

export async function deleteNeonPreferencesForUser(ownerUserId) {
  await initDb();
  await sql`
    DELETE FROM neon_user_preferences
    WHERE owner_user_id = ${clean(ownerUserId)}
  `;
}
