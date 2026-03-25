import { NextResponse } from "next/server";
import { authenticateApiToken, readBearerToken } from "../../../../../lib/api-tokens";
import { normalizeStudentInput } from "../../../../../lib/student-fields";
import { deleteNeonStudentViaTwenty, getNeonStudentById, updateNeonStudentViaTwenty } from "../../../../../lib/neon-students";

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
  const id = clean(resolvedParams?.id);

  if (resource !== "students") {
    return unsupportedResource(resource);
  }

  const student = await getNeonStudentById(id);
  if (!student) {
    return NextResponse.json({ error: "Student not found" }, { status: 404 });
  }

  return NextResponse.json({
    resource: "students",
    names: [{ id: student.id, name: student.label || student.name || "" }],
    item: student
  });
}

export async function PATCH(request, { params }) {
  const tokenCheck = await requireApiToken(request, "students:write");
  if (!tokenCheck.ok) return tokenCheck.response;

  const resolvedParams = await params;
  const resource = clean(resolvedParams?.resource).toLowerCase();
  const id = clean(resolvedParams?.id);

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

  const updated = await updateNeonStudentViaTwenty(id, data);
  if (!updated) {
    return NextResponse.json({ error: "Student update failed" }, { status: 500 });
  }

  return NextResponse.json({
    resource: "students",
    names: [{ id: updated.id, name: updated.label || updated.name || "" }],
    item: updated
  });
}

export async function DELETE(request, { params }) {
  const tokenCheck = await requireApiToken(request, "students:delete");
  if (!tokenCheck.ok) return tokenCheck.response;

  const resolvedParams = await params;
  const resource = clean(resolvedParams?.resource).toLowerCase();
  const id = clean(resolvedParams?.id);

  if (resource !== "students") {
    return unsupportedResource(resource);
  }

  await deleteNeonStudentViaTwenty(id);
  return NextResponse.json({
    resource: "students",
    deleted: true,
    id
  });
}
