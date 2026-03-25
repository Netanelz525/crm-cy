import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { neon } from "@neondatabase/serverless";

function readEnvFile(filePath) {
  const out = {};
  const content = fs.readFileSync(filePath, "utf8");
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) continue;
    const idx = trimmed.indexOf("=");
    out[trimmed.slice(0, idx)] = trimmed.slice(idx + 1);
  }
  return out;
}

function parseArgs(argv) {
  const args = {
    out: "",
    env: "",
    pretty: true
  };

  for (let i = 0; i < argv.length; i += 1) {
    const part = argv[i];
    if (part === "--out" || part === "-o") {
      args.out = argv[i + 1] || "";
      i += 1;
      continue;
    }
    if (part === "--env") {
      args.env = argv[i + 1] || "";
      i += 1;
      continue;
    }
    if (part === "--compact") {
      args.pretty = false;
      continue;
    }
    if (!args.out && !part.startsWith("-")) {
      args.out = part;
    }
  }

  return args;
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, "..");
const cliArgs = parseArgs(process.argv.slice(2));
const envPath = cliArgs.env
  ? path.resolve(process.cwd(), cliArgs.env)
  : path.join(projectRoot, ".env.local");

if (!fs.existsSync(envPath)) {
  console.error(`Missing env file: ${envPath}`);
  process.exit(1);
}

const env = readEnvFile(envPath);
if (!env.DATABASE_URL) {
  console.error(`Missing DATABASE_URL in ${envPath}`);
  process.exit(1);
}

const sql = neon(env.DATABASE_URL);

const [appUsers, notes, savedViews, neonStudents, apiTokens] = await Promise.all([
  sql`SELECT * FROM app_users ORDER BY created_at ASC`,
  sql`SELECT * FROM student_internal_notes ORDER BY updated_at DESC`,
  sql`SELECT * FROM saved_student_views ORDER BY updated_at DESC`,
  sql`SELECT * FROM neon_students ORDER BY full_name ASC`,
  sql`SELECT * FROM api_tokens ORDER BY created_at DESC`
]);

const payload = {
  exportedAt: new Date().toISOString(),
  source: "crm-neon",
  counts: {
    app_users: appUsers.length,
    student_internal_notes: notes.length,
    saved_student_views: savedViews.length,
    neon_students: neonStudents.length,
    api_tokens: apiTokens.length
  },
  data: {
    app_users: appUsers,
    student_internal_notes: notes,
    saved_student_views: savedViews,
    neon_students: neonStudents,
    api_tokens: apiTokens
  }
};

const json = JSON.stringify(payload, null, cliArgs.pretty ? 2 : 0);

if (!cliArgs.out || cliArgs.out === "-") {
  process.stdout.write(json);
  process.stdout.write("\n");
} else {
  const outputPath = path.resolve(process.cwd(), cliArgs.out);
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, json);
  console.log(outputPath);
}
