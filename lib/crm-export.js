import { initDb, sql } from "./db";

function pickResources(resource) {
  const normalized = String(resource || "all").trim().toLowerCase();
  if (!normalized || normalized === "all") {
    return ["app_users", "student_internal_notes", "saved_student_views", "neon_students", "api_tokens"];
  }
  return [normalized];
}

export async function exportCrmData(resource = "all") {
  await initDb();
  const resources = pickResources(resource);
  const data = {};
  const counts = {};

  if (resources.includes("app_users")) {
    const rows = await sql`SELECT * FROM app_users ORDER BY created_at ASC`;
    data.app_users = rows;
    counts.app_users = rows.length;
  }

  if (resources.includes("student_internal_notes")) {
    const rows = await sql`SELECT * FROM student_internal_notes ORDER BY updated_at DESC`;
    data.student_internal_notes = rows;
    counts.student_internal_notes = rows.length;
  }

  if (resources.includes("saved_student_views")) {
    const rows = await sql`SELECT * FROM saved_student_views ORDER BY updated_at DESC`;
    data.saved_student_views = rows;
    counts.saved_student_views = rows.length;
  }

  if (resources.includes("neon_students")) {
    const rows = await sql`SELECT * FROM neon_students ORDER BY full_name ASC`;
    data.neon_students = rows;
    counts.neon_students = rows.length;
  }

  if (resources.includes("api_tokens")) {
    const rows = await sql`SELECT * FROM api_tokens ORDER BY created_at DESC`;
    data.api_tokens = rows;
    counts.api_tokens = rows.length;
  }

  return {
    exportedAt: new Date().toISOString(),
    source: "crm-neon",
    resource: resources.length === 1 ? resources[0] : "all",
    counts,
    data
  };
}
