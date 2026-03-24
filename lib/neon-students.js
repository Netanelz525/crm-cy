import { initDb, sql } from "./db";
import { getStudentById, listAllStudents, updateStudentById } from "./twenty";

function clean(value) {
  return String(value || "").trim();
}

function normalizeDigits(value) {
  return clean(value).replace(/[^\d]/g, "");
}

function buildStudentLabel(student) {
  const firstName = clean(student?.fullName?.firstName);
  const lastName = clean(student?.fullName?.lastName);
  const fullNameLabel = [firstName, lastName].filter(Boolean).join(" ");
  if (fullNameLabel) return fullNameLabel;

  const rawName = clean(student?.label) || clean(student?.name);
  const normalizedRawName = rawName.toLowerCase();
  const isBrokenName = !rawName || normalizedRawName === "untitled" || /undefined|null/i.test(rawName);
  if (!isBrokenName) return rawName;

  const tznum = clean(student?.tznum);
  return tznum ? `ללא שם (${tznum})` : "ללא שם";
}

function parsePayload(payload) {
  if (!payload) return null;
  if (typeof payload === "object") return payload;
  try {
    return JSON.parse(payload);
  } catch {
    return null;
  }
}

function mapMirrorRow(row) {
  const payload = parsePayload(row?.payload);
  if (!payload) return null;
  const label = buildStudentLabel(payload) || clean(row?.full_name) || "ללא שם";
  return {
    ...payload,
    id: clean(payload?.id) || clean(row?.student_id),
    label,
    name: label,
    _syncedAt: row?.synced_at || null
  };
}

function studentMirrorRecord(student) {
  const label = buildStudentLabel(student);
  return {
    student_id: clean(student?.id),
    full_name: label,
    first_name: clean(student?.fullName?.firstName),
    last_name: clean(student?.fullName?.lastName),
    tznum: clean(student?.tznum),
    class: clean(student?.class),
    current_institution: clean(student?.currentInstitution),
    registration: clean(student?.registration),
    primary_email: clean(student?.email?.primaryEmail).toLowerCase(),
    father_email: clean(student?.fatherEmail?.primaryEmail).toLowerCase(),
    mother_email: clean(student?.motherEmail?.primaryEmail).toLowerCase(),
    student_phone: normalizeDigits(student?.phone?.primaryPhoneNumber),
    father_phone: normalizeDigits(student?.dadPhone?.primaryPhoneNumber),
    mother_phone: normalizeDigits(student?.momPhone?.primaryPhoneNumber),
    payload: JSON.stringify({
      ...student,
      label,
      name: label
    })
  };
}

export async function upsertNeonStudent(student) {
  await initDb();
  const record = studentMirrorRecord(student);
  if (!record.student_id) return false;

  await sql`
    INSERT INTO neon_students (
      student_id,
      full_name,
      first_name,
      last_name,
      tznum,
      class,
      current_institution,
      registration,
      primary_email,
      father_email,
      mother_email,
      student_phone,
      father_phone,
      mother_phone,
      payload,
      synced_at
    )
    VALUES (
      ${record.student_id},
      ${record.full_name},
      ${record.first_name},
      ${record.last_name},
      ${record.tznum},
      ${record.class},
      ${record.current_institution},
      ${record.registration},
      ${record.primary_email},
      ${record.father_email},
      ${record.mother_email},
      ${record.student_phone},
      ${record.father_phone},
      ${record.mother_phone},
      ${record.payload}::jsonb,
      NOW()
    )
    ON CONFLICT (student_id)
    DO UPDATE SET
      full_name = EXCLUDED.full_name,
      first_name = EXCLUDED.first_name,
      last_name = EXCLUDED.last_name,
      tznum = EXCLUDED.tznum,
      class = EXCLUDED.class,
      current_institution = EXCLUDED.current_institution,
      registration = EXCLUDED.registration,
      primary_email = EXCLUDED.primary_email,
      father_email = EXCLUDED.father_email,
      mother_email = EXCLUDED.mother_email,
      student_phone = EXCLUDED.student_phone,
      father_phone = EXCLUDED.father_phone,
      mother_phone = EXCLUDED.mother_phone,
      payload = EXCLUDED.payload,
      synced_at = NOW()
  `;

  return true;
}

export async function syncStudentsToNeon() {
  const students = await listAllStudents();
  let syncedCount = 0;

  for (const student of students) {
    const synced = await upsertNeonStudent(student);
    if (synced) syncedCount += 1;
  }

  return {
    totalFetched: students.length,
    syncedCount
  };
}

export async function listNeonStudents() {
  await initDb();
  const rows = await sql`
    SELECT student_id, full_name, tznum, class, current_institution, registration, payload, synced_at
    FROM neon_students
    ORDER BY full_name ASC
  `;
  return rows.map(mapMirrorRow).filter(Boolean);
}

export async function listAllNeonStudents() {
  return listNeonStudents();
}

export async function getNeonStudentsByInstitution(institution) {
  const normalizedInstitution = clean(institution).toUpperCase();
  if (!normalizedInstitution) return [];
  const students = await listNeonStudents();
  return students.filter((student) => clean(student?.currentInstitution).toUpperCase() === normalizedInstitution);
}

export async function searchNeonStudentsByText(q, maxResults = 10) {
  const normalizedQ = clean(q).toLowerCase();
  if (!normalizedQ) return [];
  const students = await listNeonStudents();
  return students.filter((student) => {
    const haystack = [
      clean(student?.label),
      clean(student?.fullName?.firstName),
      clean(student?.fullName?.lastName),
      clean(student?.email?.primaryEmail),
      clean(student?.fatherEmail?.primaryEmail),
      clean(student?.motherEmail?.primaryEmail),
      clean(student?.phone?.primaryPhoneNumber),
      clean(student?.dadPhone?.primaryPhoneNumber),
      clean(student?.momPhone?.primaryPhoneNumber)
    ]
      .join(" ")
      .toLowerCase();
    return haystack.includes(normalizedQ);
  }).slice(0, maxResults);
}

export async function searchNeonStudentsByTz(tznum) {
  const normalizedTz = normalizeDigits(tznum);
  if (!normalizedTz) return [];
  const students = await listNeonStudents();
  return students.filter((student) => {
    const values = [
      normalizeDigits(student?.tznum),
      normalizeDigits(student?.tzMotherNum),
      normalizeDigits(student?.tzaba)
    ];
    return values.some((value) => value.includes(normalizedTz));
  }).slice(0, 50);
}

export async function searchNeonStudents({ q = "", tz = "", institution = "" } = {}) {
  const students = await listNeonStudents();
  const normalizedQ = clean(q).toLowerCase();
  const normalizedTz = normalizeDigits(tz);
  const normalizedInstitution = clean(institution).toUpperCase();

  return students.filter((student) => {
    if (normalizedInstitution && clean(student?.currentInstitution).toUpperCase() !== normalizedInstitution) {
      return false;
    }

    if (normalizedTz) {
      const candidates = [
        normalizeDigits(student?.tznum),
        normalizeDigits(student?.tzMotherNum),
        normalizeDigits(student?.tzaba)
      ];
      if (!candidates.some((value) => value.includes(normalizedTz))) return false;
    }

    if (normalizedQ) {
      const haystack = [
        clean(student?.label),
        clean(student?.fullName?.firstName),
        clean(student?.fullName?.lastName),
        clean(student?.email?.primaryEmail),
        clean(student?.fatherEmail?.primaryEmail),
        clean(student?.motherEmail?.primaryEmail),
        clean(student?.phone?.primaryPhoneNumber),
        clean(student?.dadPhone?.primaryPhoneNumber),
        clean(student?.momPhone?.primaryPhoneNumber)
      ]
        .join(" ")
        .toLowerCase();

      if (!haystack.includes(normalizedQ)) return false;
    }

    return true;
  });
}

export async function getNeonStudentById(studentId) {
  await initDb();
  const rows = await sql`
    SELECT student_id, full_name, payload, synced_at
    FROM neon_students
    WHERE student_id = ${clean(studentId)}
    LIMIT 1
  `;
  return mapMirrorRow(rows[0]);
}

export async function getNeonStudentsStats() {
  await initDb();
  const rows = await sql`
    SELECT COUNT(*)::int AS total, MAX(synced_at) AS last_synced_at
    FROM neon_students
  `;
  return rows[0] || { total: 0, last_synced_at: null };
}

export async function updateNeonStudentViaTwenty(studentId, data) {
  await updateStudentById(studentId, data);
  const freshStudent = await getStudentById(studentId);
  if (freshStudent) {
    await upsertNeonStudent(freshStudent);
  }
  return freshStudent;
}
