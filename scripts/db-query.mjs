import fs from "node:fs";
import { neon } from "@neondatabase/serverless";

function loadEnvFile(path) {
  if (!fs.existsSync(path)) return;
  const lines = fs.readFileSync(path, "utf8").split(/\r?\n/);
  for (const line of lines) {
    const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!match) continue;
    const [, key, rawValue] = match;
    if (process.env[key]) continue;
    process.env[key] = rawValue.replace(/^"|"$/g, "");
  }
}

function printUsage() {
  console.log([
    "Usage:",
    "  node scripts/db-query.mjs \"select count(*) from neon_students\"",
    "",
    "Only SELECT / WITH / EXPLAIN queries are allowed by default.",
    "Set DB_QUERY_ALLOW_WRITE=1 only when a write query is intentionally needed."
  ].join("\n"));
}

loadEnvFile(".env.vercel");
loadEnvFile(".env.local");

const query = process.argv.slice(2).join(" ").trim();
if (!query || query === "--help" || query === "-h") {
  printUsage();
  process.exit(query ? 0 : 1);
}

if (!process.env.DATABASE_URL) {
  console.error("Missing DATABASE_URL. Run: vercel env pull .env.vercel --yes");
  process.exit(1);
}

const firstWord = query.replace(/^\s*\(/, "").split(/\s+/)[0]?.toLowerCase();
const readOnly = ["select", "with", "explain"].includes(firstWord);
if (!readOnly && process.env.DB_QUERY_ALLOW_WRITE !== "1") {
  console.error("Refusing to run a write query. Set DB_QUERY_ALLOW_WRITE=1 if this is intentional.");
  process.exit(1);
}

const sql = neon(process.env.DATABASE_URL);
const rows = await sql(query);
console.log(JSON.stringify(rows, null, 2));
