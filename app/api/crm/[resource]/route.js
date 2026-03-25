import { NextResponse } from "next/server";
import { authenticateApiToken, readBearerToken } from "../../../../lib/api-tokens";
import { normalizeStudentInput } from "../../../../lib/student-fields";
import { createNeonStudentViaTwenty, listAllNeonStudents, searchNeonStudents } from "../../../../lib/neon-students";

function clean(value) {
  return String(value || "").trim();
}

function unauthorized() {
  return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
}

function forbidden(scope) {
  return NextResponse.json({ error: `Missing required scope: ${scope}` }, { status: 403 });
}

function unsupportedResource(resource) {
  return NextResponse.json(
    {
      error: `Unsupported resource: ${resource}`,
      supportedResources: ["students"]
    },
    { status: 404 }
  );
}

async function requireApiToken(request, scope) {
  const token = readBearerToken(request);
  if (!token) return { ok: false, response: unauthorized() };
  const auth = await authenticateApiToken(token);
  if (!auth) return { ok: false, response: unauthorized() };
  const scopes = Array.isArray(auth.scopes) ? auth.scopes : [];
  if (scope && !scopes.includes(scope)) {
    return { ok: false, response: forbidden(scope) };
  }
  return { ok: true, auth };
}

export async function GET(request, { params }) {
  const tokenCheck = await requireApiToken(request, "students:read");
  if (!tokenCheck.ok) return tokenCheck.response;

  const resolvedParams = await params;
  const resource = clean(resolvedParams?.resource).toLowerCase();
  if (resource !== "students") {
    return unsupportedResource(resource);
  }

  const url = new URL(request.url);
  const q = clean(url.searchParams.get("q"));
  const tz = clean(url.searchParams.get("tz"));
  const institution = clean(url.searchParams.get("institution"));
  const limit = Math.max(1, Math.min(Number(url.searchParams.get("limit")) || 50, 500));
  const offset = Math.max(0, Number(url.searchParams.get("offset")) || 0);
  const minScore = Math.max(0, Math.min(Number(url.searchParams.get("minScore")) || 0.42, 1));

  const students = q || tz || institution
    ? await searchNeonStudents({ q, tz, institution, minScore })
    : await listAllNeonStudents();

  const items = students.slice(offset, offset + limit);
  const names = items.map((student) => ({
    id: student.id,
    name: student.label || student.name || "",
    matchScore: student._matchScore ?? null
  }));

  return NextResponse.json({
    resource: "students",
    count: items.length,
    total: students.length,
    limit,
    offset,
    minScore,
    names,
    items
  });
}

export async function POST(request, { params }) {
  const tokenCheck = await requireApiToken(request, "students:write");
  if (!tokenCheck.ok) return tokenCheck.response;

  const resolvedParams = await params;
  const resource = clean(resolvedParams?.resource).toLowerCase();
  if (resource !== "students") {
    return unsupportedResource(resource);
  }

  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const data = normalizeStudentInput(body);
  if (!Object.keys(data).length) {
    return NextResponse.json({ error: "No valid student fields provided" }, { status: 400 });
  }

  const created = await createNeonStudentViaTwenty(data);
  if (!created?.id) {
    return NextResponse.json({ error: "Student creation failed" }, { status: 500 });
  }

  return NextResponse.json(
    {
      resource: "students",
      names: [{ id: created.id, name: created.label || created.name || "" }],
      item: created
    },
    { status: 201 }
  );
}
