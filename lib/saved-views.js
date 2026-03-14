import { initDb, sql } from "./db";

function clean(value) {
  return String(value || "").trim();
}

export async function listSavedViewsForUser(ownerUserId) {
  await initDb();
  return sql`
    SELECT id, owner_user_id, name, folder_name, query_string, created_at, updated_at
    FROM saved_student_views
    WHERE owner_user_id = ${ownerUserId}
    ORDER BY updated_at DESC, created_at DESC
  `;
}

export async function findDuplicateSavedView({ ownerUserId, name, folderName, queryString, excludeId = "" }) {
  await initDb();
  const rows = await sql`
    SELECT id, owner_user_id, name, folder_name, query_string, created_at, updated_at
    FROM saved_student_views
    WHERE owner_user_id = ${ownerUserId}
      AND id <> ${clean(excludeId) || "__none__"}
      AND (
        (
          LOWER(name) = LOWER(${clean(name)})
          AND LOWER(COALESCE(folder_name, '')) = LOWER(${clean(folderName)})
        )
        OR query_string = ${clean(queryString)}
      )
    ORDER BY updated_at DESC, created_at DESC
    LIMIT 1
  `;
  return rows?.[0] || null;
}

export async function createSavedView({ id, ownerUserId, name, folderName, queryString }) {
  await initDb();
  await sql`
    INSERT INTO saved_student_views (id, owner_user_id, name, folder_name, query_string)
    VALUES (${id}, ${ownerUserId}, ${clean(name)}, ${clean(folderName)}, ${clean(queryString)})
  `;
}

export async function updateSavedView({ id, ownerUserId, name, folderName, queryString }) {
  await initDb();
  await sql`
    UPDATE saved_student_views
    SET
      name = ${clean(name)},
      folder_name = ${clean(folderName)},
      query_string = ${clean(queryString)},
      updated_at = NOW()
    WHERE id = ${id}
      AND owner_user_id = ${ownerUserId}
  `;
}

export async function deleteSavedView({ id, ownerUserId }) {
  await initDb();
  await sql`
    DELETE FROM saved_student_views
    WHERE id = ${id}
      AND owner_user_id = ${ownerUserId}
  `;
}
