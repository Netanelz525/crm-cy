import { initDb, sql } from "./db";
import { createStudentByData, deleteStudentById, getStudentById, listAllStudents, updateStudentById } from "./twenty";

function clean(value) {
  return String(value || "").trim();
}

function isMarriedStatus(value) {
  return clean(value).toUpperCase() === "MARRIED";
}

function normalizeChildrenCount(value) {
  if (value === null || value === undefined || clean(value) === "") return null;
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return null;
  return Math.max(0, Math.floor(numeric));
}

function normalizeDigits(value) {
  return clean(value).replace(/[^\d]/g, "");
}

function normalizeHebrewText(value) {
  return clean(value)
    .toLowerCase()
    .replace(/[׳״"'`]/g, "")
    .replace(/[-_/\\.,]+/g, " ")
    .replace(/\s+/g, " ")
    .replace(/ך/g, "כ")
    .replace(/ם/g, "מ")
    .replace(/ן/g, "נ")
    .replace(/ף/g, "פ")
    .replace(/ץ/g, "צ")
    .trim();
}

function tokenizeName(value) {
  return normalizeHebrewText(value).split(" ").filter(Boolean);
}

function bigrams(value) {
  const normalized = normalizeHebrewText(value).replace(/\s+/g, "");
  if (!normalized) return [];
  if (normalized.length === 1) return [normalized];
  const out = [];
  for (let i = 0; i < normalized.length - 1; i += 1) {
    out.push(normalized.slice(i, i + 2));
  }
  return out;
}

function diceCoefficient(a, b) {
  const left = bigrams(a);
  const right = bigrams(b);
  if (!left.length || !right.length) return 0;
  const rightMap = new Map();
  for (const gram of right) {
    rightMap.set(gram, (rightMap.get(gram) || 0) + 1);
  }
  let matches = 0;
  for (const gram of left) {
    const count = rightMap.get(gram) || 0;
    if (count > 0) {
      matches += 1;
      rightMap.set(gram, count - 1);
    }
  }
  return (2 * matches) / (left.length + right.length);
}

function bestTokenScore(queryTokens, candidateTokens) {
  if (!queryTokens.length || !candidateTokens.length) return 0;
  let total = 0;
  for (const queryToken of queryTokens) {
    let best = 0;
    for (const candidateToken of candidateTokens) {
      if (candidateToken === queryToken) {
        best = 1;
        break;
      }
      if (candidateToken.startsWith(queryToken) || queryToken.startsWith(candidateToken)) {
        best = Math.max(best, 0.92);
      } else if (candidateToken.includes(queryToken) || queryToken.includes(candidateToken)) {
        best = Math.max(best, 0.82);
      } else {
        best = Math.max(best, diceCoefficient(queryToken, candidateToken));
      }
    }
    total += best;
  }
  return total / queryTokens.length;
}

function scoreStudentNameMatch(student, query) {
  const normalizedQuery = normalizeHebrewText(query);
  if (!normalizedQuery) return 0;

  const firstName = clean(student?.fullName?.firstName);
  const lastName = clean(student?.fullName?.lastName);
  const fullName = [firstName, lastName].filter(Boolean).join(" ") || clean(student?.label) || clean(student?.name);
  const queryTokens = tokenizeName(normalizedQuery);
  const fullNameTokens = tokenizeName(fullName);
  const firstTokens = tokenizeName(firstName);
  const lastTokens = tokenizeName(lastName);

  const exactFull = normalizeHebrewText(fullName);
  if (exactFull && exactFull === normalizedQuery) return 1;

  let score = 0;
  score = Math.max(score, diceCoefficient(normalizedQuery, fullName));
  score = Math.max(score, bestTokenScore(queryTokens, fullNameTokens));

  if (firstTokens.length) {
    score = Math.max(score, bestTokenScore(queryTokens, firstTokens) * 0.94);
  }
  if (lastTokens.length) {
    score = Math.max(score, bestTokenScore(queryTokens, lastTokens) * 0.97);
  }

  const hasAllTokens = queryTokens.length > 1 && queryTokens.every((token) => fullNameTokens.some((candidate) => candidate.includes(token) || token.includes(candidate)));
  if (hasAllTokens) {
    score = Math.max(score, 0.95);
  }

  if (exactFull && (exactFull.includes(normalizedQuery) || normalizedQuery.includes(exactFull))) {
    score = Math.max(score, 0.88);
  }

  return Number(score.toFixed(3));
}

function scoreStudentGeneralMatch(student, query) {
  const normalizedQuery = normalizeHebrewText(query);
  if (!normalizedQuery) return 0;

  let score = scoreStudentNameMatch(student, normalizedQuery);

  const generalFields = [
    clean(student?.email?.primaryEmail).toLowerCase(),
    clean(student?.fatherEmail?.primaryEmail).toLowerCase(),
    clean(student?.motherEmail?.primaryEmail).toLowerCase(),
    clean(student?.phone?.primaryPhoneNumber),
    clean(student?.dadPhone?.primaryPhoneNumber),
    clean(student?.momPhone?.primaryPhoneNumber)
  ];

  for (const field of generalFields) {
    const normalizedField = normalizeHebrewText(field);
    if (!normalizedField) continue;
    if (normalizedField === normalizedQuery) {
      score = Math.max(score, 0.93);
      continue;
    }
    if (normalizedField.includes(normalizedQuery) || normalizedQuery.includes(normalizedField)) {
      score = Math.max(score, 0.8);
      continue;
    }
    score = Math.max(score, diceCoefficient(normalizedQuery, normalizedField) * 0.7);
  }

  return Number(score.toFixed(3));
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

const BASE_NEON_SELECT = `
  SELECT
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
    children_count,
    payload,
    synced_at
  FROM neon_students
`;

function buildNeonQuery({
  institution = "",
  class: classCode = "",
  registration = "",
  famliystatus = "",
  institutionSearch = "",
  q = "",
  tz = "",
  limit = null
} = {}) {
  const normalizedInstitution = clean(institution).toUpperCase();
  const normalizedClass = clean(classCode).toUpperCase();
  const normalizedRegistration = clean(registration).toUpperCase();
  const normalizedFamilyStatus = clean(famliystatus).toUpperCase();
  const term = clean(institutionSearch || q);
  const likeTerm = `%${term}%`;
  const normalizedTz = normalizeDigits(tz);
  const likeTz = `%${normalizedTz}%`;

  let query = `${BASE_NEON_SELECT}
    WHERE ($1 = '' OR current_institution = $1)
      AND ($2 = '' OR class = $2)
      AND ($3 = '' OR registration = $3)
      AND ($4 = '' OR COALESCE(payload->>'famliystatus', '') = $4)
      AND ($5 = '' OR full_name ILIKE $5)
      AND ($6 = '' OR (
        full_name ILIKE $6
        OR first_name ILIKE $6
        OR last_name ILIKE $6
        OR primary_email ILIKE $6
        OR father_email ILIKE $6
        OR mother_email ILIKE $6
        OR student_phone ILIKE $6
        OR father_phone ILIKE $6
        OR mother_phone ILIKE $6
      ))
      AND ($7 = '' OR (
        tznum ILIKE $7
        OR COALESCE(payload->>'tzMotherNum', '') ILIKE $7
        OR COALESCE(payload->>'tzaba', '') ILIKE $7
      ))
    ORDER BY full_name ASC
  `;

  const params = [
    normalizedInstitution,
    normalizedClass,
    normalizedRegistration,
    normalizedFamilyStatus,
    institutionSearch ? likeTerm : "",
    q ? likeTerm : "",
    normalizedTz ? likeTz : ""
  ];

  if (limit && Number(limit) > 0) {
    query += ` LIMIT ${Math.max(1, Math.floor(Number(limit)))}`;
  }

  return { query, params };
}

async function queryNeonStudents(options = {}) {
  await initDb();
  const { query, params } = buildNeonQuery(options);
  const rows = await sql(query, params);
  return rows.map(mapMirrorRow).filter(Boolean);
}

export async function listNeonStudentsByFilters(options = {}) {
  return queryNeonStudents(options);
}

function withChildrenCount(student, childrenCount) {
  if (!student || typeof student !== "object") return student;
  const normalizedCount = normalizeChildrenCount(childrenCount);
  if (!isMarriedStatus(student?.famliystatus)) {
    const out = { ...student };
    delete out.childrenCount;
    return out;
  }
  return {
    ...student,
    childrenCount: normalizedCount
  };
}

function mapMirrorRow(row) {
  const payload = parsePayload(row?.payload);
  if (!payload) return null;
  const payloadWithLocalFields = withChildrenCount(payload, row?.children_count);
  const childrenCount = isMarriedStatus(payloadWithLocalFields?.famliystatus)
    ? normalizeChildrenCount(payloadWithLocalFields?.childrenCount)
    : null;
  const label = buildStudentLabel(payload) || clean(row?.full_name) || "ללא שם";
  return {
    ...payloadWithLocalFields,
    id: clean(payload?.id) || clean(row?.student_id),
    label,
    name: label,
    childrenCount,
    _syncedAt: row?.synced_at || null
  };
}

async function getExistingChildrenCount(studentId) {
  await initDb();
  const rows = await sql`
    SELECT children_count
    FROM neon_students
    WHERE student_id = ${clean(studentId)}
    LIMIT 1
  `;
  return normalizeChildrenCount(rows?.[0]?.children_count);
}

async function buildStudentMirrorRecord(student) {
  const label = buildStudentLabel(student);
  const studentId = clean(student?.id);
  const married = isMarriedStatus(student?.famliystatus);
  const incomingChildrenCount = normalizeChildrenCount(student?.childrenCount);
  const existingChildrenCount = married && incomingChildrenCount === null && studentId
    ? await getExistingChildrenCount(studentId)
    : null;
  const childrenCount = married ? incomingChildrenCount ?? existingChildrenCount : null;
  const payloadStudent = withChildrenCount(
    {
      ...student,
      label,
      name: label
    },
    childrenCount
  );

  return {
    student_id: studentId,
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
    children_count: childrenCount,
    payload: JSON.stringify(payloadStudent)
  };
}

export async function upsertNeonStudent(student) {
  await initDb();
  const record = await buildStudentMirrorRecord(student);
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
      children_count,
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
      ${record.children_count},
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
      children_count = EXCLUDED.children_count,
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
  return queryNeonStudents();
}

export async function listAllNeonStudents() {
  return listNeonStudents();
}

export async function getNeonStudentsByInstitution(institution) {
  const normalizedInstitution = clean(institution).toUpperCase();
  if (!normalizedInstitution) return [];
  return queryNeonStudents({ institution: normalizedInstitution });
}

export async function searchNeonStudentsByText(q, maxResults = 10, minScore = 0.42) {
  const rawQ = clean(q);
  const normalizedQ = normalizeHebrewText(q);
  if (!normalizedQ) return [];
  const students = await queryNeonStudents({ q: rawQ, limit: Math.max(50, maxResults * 20) });
  return students
    .map((student) => ({ ...student, _matchScore: scoreStudentGeneralMatch(student, normalizedQ) }))
    .filter((student) => student._matchScore >= minScore)
    .sort((a, b) => b._matchScore - a._matchScore || clean(a.label).localeCompare(clean(b.label), "he"))
    .slice(0, maxResults);
}

export async function searchNeonStudentsByTz(tznum) {
  const normalizedTz = normalizeDigits(tznum);
  if (!normalizedTz) return [];
  return queryNeonStudents({ tz: normalizedTz, limit: 50 });
}

export async function searchNeonStudents({
  q = "",
  tz = "",
  institution = "",
  class: classCode = "",
  registration = "",
  famliystatus = "",
  minScore = 0.42
} = {}) {
  const rawQ = clean(q);
  const normalizedQ = normalizeHebrewText(q);
  const students = await queryNeonStudents({
    q: rawQ,
    tz,
    institution,
    class: classCode,
    registration,
    famliystatus,
    limit: normalizedQ ? 500 : null
  });

  if (!normalizedQ) {
    return students;
  }

  return students
    .map((student) => ({ ...student, _matchScore: scoreStudentGeneralMatch(student, normalizedQ) }))
    .filter((student) => student._matchScore >= minScore)
    .sort((a, b) => (b._matchScore || 0) - (a._matchScore || 0) || clean(a.label).localeCompare(clean(b.label), "he"));
}

export async function getNeonStudentById(studentId) {
  await initDb();
  const rows = await sql`
    SELECT student_id, full_name, children_count, payload, synced_at
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

export async function syncNeonStudentFromTwentyById(studentId) {
  const normalizedStudentId = clean(studentId);
  if (!normalizedStudentId) return null;

  const freshStudent = await getStudentById(normalizedStudentId);
  if (!freshStudent) return null;

  const existing = await getNeonStudentById(normalizedStudentId);
  const mergedStudent = existing?.childrenCount !== undefined
    ? { ...freshStudent, childrenCount: existing.childrenCount }
    : freshStudent;

  await upsertNeonStudent({ ...mergedStudent, id: normalizedStudentId });
  return getNeonStudentById(normalizedStudentId);
}

export async function removeNeonStudentById(studentId) {
  await initDb();
  await sql`
    DELETE FROM neon_students
    WHERE student_id = ${clean(studentId)}
  `;
}

async function updateNeonStudentLocalFields(studentId, nextStudentData) {
  await initDb();
  const current = await getNeonStudentById(studentId);
  if (!current) return null;

  const merged = {
    ...current,
    ...nextStudentData,
    fullName: {
      ...(current.fullName || {}),
      ...(nextStudentData.fullName || {})
    }
  };

  await upsertNeonStudent({ ...merged, id: studentId });
  return getNeonStudentById(studentId);
}

function mergeStudentData(current, nextData) {
  return {
    ...current,
    ...nextData,
    fullName: {
      ...(current?.fullName || {}),
      ...(nextData?.fullName || {})
    },
    phone: {
      ...(current?.phone || {}),
      ...(nextData?.phone || {})
    },
    dadPhone: {
      ...(current?.dadPhone || {}),
      ...(nextData?.dadPhone || {})
    },
    momPhone: {
      ...(current?.momPhone || {}),
      ...(nextData?.momPhone || {})
    },
    email: {
      ...(current?.email || {}),
      ...(nextData?.email || {})
    },
    fatherEmail: {
      ...(current?.fatherEmail || {}),
      ...(nextData?.fatherEmail || {})
    },
    motherEmail: {
      ...(current?.motherEmail || {}),
      ...(nextData?.motherEmail || {})
    },
    adders: {
      ...(current?.adders || {}),
      ...(nextData?.adders || {})
    }
  };
}

export async function updateNeonStudentViaTwenty(studentId, data) {
  const normalizedStudentId = clean(studentId);
  const localChildrenCount = Object.prototype.hasOwnProperty.call(data || {}, "childrenCount")
    ? normalizeChildrenCount(data?.childrenCount)
    : undefined;
  const twentyData = { ...(data || {}) };
  delete twentyData.childrenCount;

  const hasTwentyFields = Object.keys(twentyData).length > 0;
  if (hasTwentyFields) {
    const current = await getNeonStudentById(normalizedStudentId);
    await updateStudentById(normalizedStudentId, twentyData);
    if (current) {
      const mergedStudent = mergeStudentData(current, twentyData);
      const studentWithLocalField = localChildrenCount !== undefined
        ? { ...mergedStudent, childrenCount: localChildrenCount }
        : mergedStudent;
      await upsertNeonStudent({ ...studentWithLocalField, id: normalizedStudentId });
    }
  } else if (localChildrenCount !== undefined || Object.prototype.hasOwnProperty.call(data || {}, "famliystatus")) {
    return updateNeonStudentLocalFields(normalizedStudentId, {
      ...(Object.prototype.hasOwnProperty.call(data || {}, "famliystatus") ? { famliystatus: data.famliystatus } : {}),
      ...(localChildrenCount !== undefined ? { childrenCount: localChildrenCount } : {})
    });
  }

  const finalStudent = await getNeonStudentById(normalizedStudentId);
  if (!finalStudent) return null;
  if (!isMarriedStatus(finalStudent?.famliystatus) && finalStudent?.childrenCount !== null) {
    return updateNeonStudentLocalFields(normalizedStudentId, { childrenCount: null });
  }
  return finalStudent;
}

export async function createNeonStudentViaTwenty(data) {
  const localChildrenCount = Object.prototype.hasOwnProperty.call(data || {}, "childrenCount")
    ? normalizeChildrenCount(data?.childrenCount)
    : undefined;
  const twentyData = { ...(data || {}) };
  delete twentyData.childrenCount;

  const created = await createStudentByData(twentyData);
  const studentId = clean(created?.id);
  if (!studentId) return null;
  const freshStudent = await getStudentById(studentId);
  if (freshStudent) {
    const studentWithLocalField = localChildrenCount !== undefined
      ? { ...freshStudent, childrenCount: localChildrenCount }
      : freshStudent;
    await upsertNeonStudent(studentWithLocalField);
  }
  return getNeonStudentById(studentId);
}

export async function deleteNeonStudentViaTwenty(studentId) {
  await deleteStudentById(studentId);
  await removeNeonStudentById(studentId);
}
