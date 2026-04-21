import { initDb, sql } from "./db";

const MULTI_VALUE_PREFERENCE_KEYS = new Set(["cols", "sby", "sdir", "pdfBlankCol"]);
const SINGLE_VALUE_PREFERENCE_KEYS = new Set(["pdfOrientation"]);

function clean(value) {
  return String(value || "").trim();
}

function parseSearchParamsLike(input) {
  if (input instanceof URLSearchParams) return new URLSearchParams(input.toString());
  return new URLSearchParams(clean(input));
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

export function mergeSearchParamsWithNeonPreferences(searchParamsLike, preferenceQueryString) {
  const incoming = parseSearchParamsLike(searchParamsLike);
  const saved = parseSearchParamsLike(preferenceQueryString);
  const merged = new URLSearchParams(incoming.toString());

  for (const key of MULTI_VALUE_PREFERENCE_KEYS) {
    if (incoming.getAll(key).length || !saved.getAll(key).length) continue;
    saved.getAll(key).forEach((value) => merged.append(key, value));
  }

  for (const key of SINGLE_VALUE_PREFERENCE_KEYS) {
    if (incoming.get(key) || !saved.get(key)) continue;
    merged.set(key, saved.get(key));
  }

  return merged;
}
