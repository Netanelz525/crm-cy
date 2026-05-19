import { initDb, sql } from "./db.js";

const IDENTIFIER_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;

function clean(value) {
  return String(value || "").trim();
}

function normalizeResource(resource) {
  return clean(resource).toLowerCase() || "all";
}

function isSafeIdentifier(value) {
  return IDENTIFIER_RE.test(value);
}

function quoteIdentifier(value) {
  return `"${value.replace(/"/g, "\"\"")}"`;
}

async function listExportableTables() {
  const rows = await sql(
    `SELECT table_name
     FROM information_schema.tables
     WHERE table_schema = 'public'
       AND table_type = 'BASE TABLE'
     ORDER BY table_name ASC`
  );

  return rows
    .map((row) => clean(row?.table_name))
    .filter((tableName) => tableName && isSafeIdentifier(tableName));
}

async function listTableColumns(tableName) {
  return sql(
    `SELECT column_name
     FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name = $1
     ORDER BY ordinal_position ASC`,
    [tableName]
  );
}

function buildOrderByClause(columnNames) {
  const columns = new Set((Array.isArray(columnNames) ? columnNames : []).map((name) => clean(name)));
  const preferredGroups = [
    ["created_at"],
    ["updated_at", "created_at"],
    ["session_date", "created_at"],
    ["sent_at", "created_at"],
    ["opened_at", "created_at"],
    ["deleted_at", "created_at"],
    ["marked_at", "created_at"],
    ["linked_at", "created_at"],
    ["expires_at", "created_at"],
    ["id"],
    ["student_id"],
    ["clerk_user_id"],
    ["code"],
    ["job_name", "job_key"]
  ];

  for (const group of preferredGroups) {
    if (group.every((column) => columns.has(column))) {
      return ` ORDER BY ${group.map((column) => `${quoteIdentifier(column)} ASC`).join(", ")}`;
    }
  }

  return "";
}

async function readTableRows(tableName) {
  const columnRows = await listTableColumns(tableName);
  const columnNames = columnRows.map((row) => clean(row?.column_name)).filter(Boolean);
  const orderByClause = buildOrderByClause(columnNames);

  return sql(`SELECT * FROM ${quoteIdentifier(tableName)}${orderByClause}`);
}

export async function exportCrmData(resource = "all") {
  await initDb();

  const requestedResource = normalizeResource(resource);
  const availableTables = await listExportableTables();
  const resources = requestedResource === "all"
    ? availableTables
    : availableTables.filter((tableName) => tableName === requestedResource);
  const data = {};
  const counts = {};

  for (const tableName of resources) {
    const rows = await readTableRows(tableName);
    data[tableName] = rows;
    counts[tableName] = rows.length;
  }

  return {
    exportedAt: new Date().toISOString(),
    source: "crm-neon",
    resource: resources.length === 1 ? resources[0] : requestedResource,
    counts,
    data
  };
}
