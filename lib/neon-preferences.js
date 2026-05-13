import { initDb, sql } from "./db";

const MULTI_VALUE_PREFERENCE_KEYS = new Set(["cols", "sby", "sdir", "pdfBlankCol"]);
const SINGLE_VALUE_PREFERENCE_KEYS = new Set(["pdfOrientation"]);

function clean(value) {
  return String(value || "").trim();
}

function isInvalidQueryEntry(key, value = "") {
  const normalizedKey = clean(key).toLowerCase();
  const normalizedValue = clean(value).toLowerCase();
  if (!normalizedKey) return true;
  if (normalizedKey.includes("[object object]") || normalizedValue.includes("[object object]")) return true;
  if (["undefined", "null"].includes(normalizedKey)) return true;
  return false;
}

function parseSearchParamsLike(input) {
  if (input instanceof URLSearchParams) return new URLSearchParams(input.toString());
  if (input && typeof input === "object") {
    const params = new URLSearchParams();
    for (const [key, rawValue] of Object.entries(input)) {
      const name = clean(key);
      if (isInvalidQueryEntry(name)) continue;
      if (Array.isArray(rawValue)) {
        rawValue
          .map(clean)
          .filter(Boolean)
          .forEach((value) => {
            if (!isInvalidQueryEntry(name, value)) params.append(name, value);
          });
        continue;
      }
      if (rawValue && typeof rawValue === "object") continue;
      const value = clean(rawValue);
      if (value && !isInvalidQueryEntry(name, value)) params.set(name, value);
    }
    return params;
  }
  const params = new URLSearchParams(clean(input));
  for (const [key, value] of Array.from(params.entries())) {
    if (isInvalidQueryEntry(key, value)) params.delete(key);
  }
  return params;
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
