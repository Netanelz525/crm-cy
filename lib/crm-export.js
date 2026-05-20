import { initDb, sql } from "./db.js";

function clean(value) {
  return String(value || "").trim();
}

function normalizeResourceName(resource) {
  return clean(resource).toLowerCase();
}

function quoteIdentifier(name) {
  const normalized = clean(name);
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(normalized)) {
    throw new Error(`Unsafe SQL identifier: ${normalized}`);
  }
  return `"${normalized}"`;
}

async function listPublicTables() {
  const rows = await sql`
    SELECT table_name
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_type = 'BASE TABLE'
    ORDER BY table_name ASC
  `;
  return rows.map((row) => row.table_name);
}

async function listTableColumns(tableName) {
  const rows = await sql`
    SELECT column_name
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = ${tableName}
    ORDER BY ordinal_position ASC
  `;
  return rows.map((row) => row.column_name);
}

function buildOrderByClause(columns) {
  const normalized = new Set((columns || []).map((column) => normalizeResourceName(column)));
  const preferredColumns = [
    "updated_at",
    "created_at",
    "completed_at",
    "started_at",
    "deleted_at",
    "announcement_date",
    "session_date",
    "linked_at"
  ];

  for (const column of preferredColumns) {
    if (normalized.has(column)) {
      return ` ORDER BY ${quoteIdentifier(column)} DESC NULLS LAST`;
    }
  }

  if (normalized.has("id")) {
    return ` ORDER BY ${quoteIdentifier("id")} ASC`;
  }

  return "";
}

function pickResources(resource, exportableTables) {
  const normalized = normalizeResourceName(resource || "all");
  if (!normalized || normalized === "all") {
    return exportableTables;
  }

  if (!exportableTables.includes(normalized)) {
    throw new Error(`Unknown export resource: ${normalized}`);
  }

  return [normalized];
}

export async function exportCrmData(resource = "all") {
  await initDb();
  const exportableTables = await listPublicTables();
  const resources = pickResources(resource, exportableTables);
  const data = {};
  const counts = {};

  for (const tableName of resources) {
    const columns = await listTableColumns(tableName);
    const orderByClause = buildOrderByClause(columns);
    const query = `SELECT * FROM ${quoteIdentifier(tableName)}${orderByClause}`;
    const rows = await sql(query);
    data[tableName] = rows;
    counts[tableName] = rows.length;
  }

  return {
    exportedAt: new Date().toISOString(),
    source: "crm-neon",
    resource: resources.length === 1 ? resources[0] : "all",
    counts,
    data
  };
}
