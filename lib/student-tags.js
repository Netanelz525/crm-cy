import { randomUUID } from "crypto";
import { initDb, sql } from "./db";
export { getStudentTagTheme } from "./student-tag-theme";

function clean(value) {
  return String(value || "").trim();
}

function normalizeTagName(value) {
  return clean(value).toLowerCase().replace(/\s+/g, " ");
}

function mapTagRow(row) {
  return {
    id: clean(row?.id),
    name: clean(row?.name),
    normalizedName: clean(row?.normalized_name),
    usageCount: Number(row?.usage_count || 0),
    createdAt: row?.created_at || null,
    updatedAt: row?.updated_at || null
  };
}

export async function listStudentTags() {
  await initDb();
  const rows = await sql`
    SELECT id, name, normalized_name, created_at, updated_at
    FROM student_tags
    ORDER BY LOWER(name) ASC, created_at ASC
  `;
  return rows.map(mapTagRow);
}

export async function listStudentTagsWithUsage() {
  await initDb();
  const rows = await sql`
    SELECT
      t.id,
      t.name,
      t.normalized_name,
      t.created_at,
      t.updated_at,
      COUNT(a.student_id)::int AS usage_count
    FROM student_tags t
    LEFT JOIN student_tag_assignments a ON a.tag_id = t.id
    GROUP BY t.id, t.name, t.normalized_name, t.created_at, t.updated_at
    ORDER BY LOWER(t.name) ASC, t.created_at ASC
  `;
  return rows.map(mapTagRow);
}

export async function getStudentTagsByStudentIds(studentIds) {
  await initDb();
  const ids = (studentIds || []).map(clean).filter(Boolean);
  if (!ids.length) return {};

  const rows = await sql`
    SELECT
      a.student_id,
      t.id,
      t.name,
      t.normalized_name
    FROM student_tag_assignments a
    JOIN student_tags t ON t.id = a.tag_id
    WHERE a.student_id = ANY(${ids})
    ORDER BY LOWER(t.name) ASC, t.created_at ASC
  `;

  const map = {};
  for (const studentId of ids) {
    map[studentId] = [];
  }
  for (const row of rows) {
    const studentId = clean(row.student_id);
    if (!map[studentId]) map[studentId] = [];
    map[studentId].push({
      id: clean(row.id),
      name: clean(row.name),
      normalizedName: clean(row.normalized_name)
    });
  }
  return map;
}

export async function getStudentTagIdsSet() {
  const tags = await listStudentTags();
  return new Set(tags.map((tag) => tag.id));
}

export async function attachStudentTagsToStudents(students) {
  const list = Array.isArray(students) ? students : [];
  if (!list.length) return list;
  const tagMap = await getStudentTagsByStudentIds(list.map((student) => clean(student?.id)));
  return list.map((student) => {
    const tags = tagMap[clean(student?.id)] || [];
    return {
      ...student,
      tags,
      tagIds: tags.map((tag) => tag.id),
      tagNames: tags.map((tag) => tag.name)
    };
  });
}

export async function createStudentTag({ name, createdByUserId }) {
  await initDb();
  const tagName = clean(name);
  const normalizedName = normalizeTagName(name);
  if (!tagName) {
    throw new Error("יש להזין שם תגית.");
  }

  const existing = await sql`
    SELECT id, name, normalized_name, created_at, updated_at
    FROM student_tags
    WHERE normalized_name = ${normalizedName}
    LIMIT 1
  `;
  if (existing[0]) {
    throw new Error("התגית כבר קיימת.");
  }

  const id = randomUUID();
  const rows = await sql`
    INSERT INTO student_tags (
      id,
      name,
      normalized_name,
      created_by_user_id,
      created_at,
      updated_at
    )
    VALUES (
      ${id},
      ${tagName},
      ${normalizedName},
      ${clean(createdByUserId) || null},
      NOW(),
      NOW()
    )
    RETURNING id, name, normalized_name, created_at, updated_at
  `;
  return mapTagRow(rows[0]);
}

export async function getOrCreateStudentTag({ name, createdByUserId }) {
  await initDb();
  const tagName = clean(name);
  const normalizedName = normalizeTagName(name);
  if (!tagName) {
    throw new Error("יש להזין שם תגית.");
  }

  const existing = await sql`
    SELECT id, name, normalized_name, created_at, updated_at
    FROM student_tags
    WHERE normalized_name = ${normalizedName}
    LIMIT 1
  `;
  if (existing[0]) {
    return mapTagRow(existing[0]);
  }

  return createStudentTag({ name: tagName, createdByUserId });
}

export async function deleteStudentTag(tagId) {
  await initDb();
  const normalizedId = clean(tagId);
  if (!normalizedId) {
    throw new Error("לא נבחרה תגית למחיקה.");
  }
  await sql`
    DELETE FROM student_tags
    WHERE id = ${normalizedId}
  `;
}

export async function replaceStudentTags({ studentId, tagIds, assignedByUserId }) {
  await initDb();
  const normalizedStudentId = clean(studentId);
  if (!normalizedStudentId) {
    throw new Error("לא נבחר תלמיד לעדכון תגיות.");
  }

  const availableTagIds = await getStudentTagIdsSet();
  const normalizedTagIds = Array.from(new Set((tagIds || []).map(clean).filter(Boolean)))
    .filter((tagId) => availableTagIds.has(tagId));

  await sql`
    DELETE FROM student_tag_assignments
    WHERE student_id = ${normalizedStudentId}
  `;

  for (const tagId of normalizedTagIds) {
    await sql`
      INSERT INTO student_tag_assignments (
        student_id,
        tag_id,
        assigned_by_user_id,
        created_at
      )
      VALUES (
        ${normalizedStudentId},
        ${tagId},
        ${clean(assignedByUserId) || null},
        NOW()
      )
      ON CONFLICT (student_id, tag_id) DO NOTHING
    `;
  }
}

export async function addStudentTagToStudent({ studentId, tagId, tagName, assignedByUserId, createdByUserId }) {
  await initDb();
  const normalizedStudentId = clean(studentId);
  if (!normalizedStudentId) {
    throw new Error("לא נבחר תלמיד לעדכון תגיות.");
  }

  let resolvedTagId = clean(tagId);
  if (clean(tagName)) {
    const tag = await getOrCreateStudentTag({ name: tagName, createdByUserId });
    resolvedTagId = tag.id;
  }

  if (!resolvedTagId) {
    throw new Error("יש לבחור תווית קיימת או ליצור תווית חדשה.");
  }

  const availableTagIds = await getStudentTagIdsSet();
  if (!availableTagIds.has(resolvedTagId)) {
    throw new Error("התווית שנבחרה אינה קיימת.");
  }

  await sql`
    INSERT INTO student_tag_assignments (
      student_id,
      tag_id,
      assigned_by_user_id,
      created_at
    )
    VALUES (
      ${normalizedStudentId},
      ${resolvedTagId},
      ${clean(assignedByUserId) || null},
      NOW()
    )
    ON CONFLICT (student_id, tag_id) DO NOTHING
  `;

  const rows = await sql`
    SELECT id, name, normalized_name
    FROM student_tags
    WHERE id = ${resolvedTagId}
    LIMIT 1
  `;
  const row = rows[0];
  return row
    ? {
      id: clean(row.id),
      name: clean(row.name),
      normalizedName: clean(row.normalized_name)
    }
    : null;
}

export async function removeStudentTagFromStudent({ studentId, tagId }) {
  await initDb();
  const normalizedStudentId = clean(studentId);
  const normalizedTagId = clean(tagId);
  if (!normalizedStudentId || !normalizedTagId) {
    throw new Error("לא נבחרו תלמיד ותווית להסרה.");
  }

  await sql`
    DELETE FROM student_tag_assignments
    WHERE student_id = ${normalizedStudentId}
      AND tag_id = ${normalizedTagId}
  `;
}
