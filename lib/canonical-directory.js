import { randomUUID } from "node:crypto";
import { initDb, sql } from "./db";
import { listNeonStudentsByFilters } from "./neon-students";
import { ENUM_LABELS } from "./student-fields";

const SYNC_SOURCE = "neon_sync";

function clean(value) {
  return String(value || "").trim();
}

function normalizeDigits(value) {
  return clean(value).replace(/[^\d]/g, "");
}

function normalizeEmail(value) {
  return clean(value).toLowerCase();
}

function normalizePhone(value) {
  return normalizeDigits(value);
}

function normalizeDate(value) {
  const raw = clean(value);
  if (!raw) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString().slice(0, 10);
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

function buildStudentName(student) {
  const first = clean(student?.fullName?.firstName);
  const last = clean(student?.fullName?.lastName);
  return [first, last].filter(Boolean).join(" ") || clean(student?.label) || clean(student?.name) || "ללא שם";
}

function buildParentSnapshot(student, side) {
  if (side === "father") {
    return {
      sourceKey: `parent:${clean(student?.id)}:father`,
      role: "parent",
      relationType: "father_of",
      name: clean(student?.shmHb),
      governmentId: normalizeDigits(student?.tzaba),
      birthDate: normalizeDate(student?.fatherDatebirth),
      primaryEmail: normalizeEmail(student?.fatherEmail?.primaryEmail),
      additionalEmails: Array.isArray(student?.fatherEmail?.additionalEmails) ? student.fatherEmail.additionalEmails : [],
      primaryPhone: normalizePhone(student?.dadPhone?.primaryPhoneNumber),
      additionalPhones: Array.isArray(student?.dadPhone?.additionalPhones) ? student.dadPhone.additionalPhones : [],
      rawData: {
        side: "father",
        sourceStudentId: clean(student?.id),
        name: clean(student?.shmHb)
      }
    };
  }

  return {
    sourceKey: `parent:${clean(student?.id)}:mother`,
    role: "parent",
    relationType: "mother_of",
    name: clean(student?.shmHm),
    governmentId: normalizeDigits(student?.tzMotherNum),
    birthDate: normalizeDate(student?.motherDateBirth),
    primaryEmail: normalizeEmail(student?.motherEmail?.primaryEmail),
    additionalEmails: Array.isArray(student?.motherEmail?.additionalEmails) ? student.motherEmail.additionalEmails : [],
    primaryPhone: normalizePhone(student?.momPhone?.primaryPhoneNumber),
    additionalPhones: Array.isArray(student?.momPhone?.additionalPhones) ? student.momPhone.additionalPhones : [],
    rawData: {
      side: "mother",
      sourceStudentId: clean(student?.id),
      name: clean(student?.shmHm)
    }
  };
}

function nameCompatible(left, right) {
  const a = normalizeHebrewText(left);
  const b = normalizeHebrewText(right);
  if (!a || !b) return true;
  if (a === b) return true;
  if (a.includes(b) || b.includes(a)) return true;
  const aTokens = a.split(" ").filter(Boolean);
  const bTokens = b.split(" ").filter(Boolean);
  if (!aTokens.length || !bTokens.length) return false;
  return aTokens.every((token) => bTokens.includes(token)) || bTokens.every((token) => aTokens.includes(token));
}

function pickPreferredText(currentValue, nextValue) {
  const current = clean(currentValue);
  const next = clean(nextValue);
  if (!current) return next;
  if (!next) return current;
  return next.length > current.length ? next : current;
}

function parseJson(value) {
  if (!value) return {};
  if (typeof value === "object") return value;
  try {
    return JSON.parse(value);
  } catch {
    return {};
  }
}

async function seedInstitutions(institutionCodes = []) {
  const base = Object.entries(ENUM_LABELS.currentInstitution || {}).map(([code, name]) => ({
    code,
    name,
    institutionType: code.startsWith("BOGER") ? "alumni" : "yeshiva"
  }));
  const dynamic = institutionCodes
    .map((code) => clean(code).toUpperCase())
    .filter(Boolean)
    .filter((code, index, array) => array.indexOf(code) === index)
    .map((code) => ({
      code,
      name: ENUM_LABELS.currentInstitution?.[code] || code,
      institutionType: code.startsWith("BOGER") ? "alumni" : "yeshiva"
    }));

  for (const institution of [...base, ...dynamic]) {
    const institutionId = `institution:${institution.code}`;
    await sql`
      INSERT INTO crm_institutions (
        id,
        code,
        name,
        institution_type,
        is_active,
        metadata_json,
        created_at,
        updated_at
      )
      VALUES (
        ${institutionId},
        ${institution.code},
        ${institution.name},
        ${institution.institutionType},
        TRUE,
        ${JSON.stringify({ seededBy: SYNC_SOURCE })}::jsonb,
        NOW(),
        NOW()
      )
      ON CONFLICT (code)
      DO UPDATE SET
        name = EXCLUDED.name,
        institution_type = EXCLUDED.institution_type,
        is_active = TRUE,
        updated_at = NOW()
    `;
  }
}

async function findPeopleByColumn(columnName, value) {
  const normalized = clean(value);
  if (!normalized) return [];
  if (columnName === "source_key") {
    return sql`SELECT * FROM crm_people WHERE source_key = ${normalized} LIMIT 5`;
  }
  if (columnName === "government_id") {
    return sql`SELECT * FROM crm_people WHERE government_id = ${normalized} LIMIT 5`;
  }
  if (columnName === "primary_email") {
    return sql`SELECT * FROM crm_people WHERE primary_email = ${normalized} LIMIT 5`;
  }
  if (columnName === "primary_phone") {
    return sql`SELECT * FROM crm_people WHERE primary_phone = ${normalized} LIMIT 5`;
  }
  return [];
}

async function resolvePerson(incoming, { allowEmailPhoneMatch = false } = {}) {
  const sourceKeyMatches = await findPeopleByColumn("source_key", incoming.sourceKey);
  if (sourceKeyMatches[0]) {
    return { person: sourceKeyMatches[0], matchBasis: "source_key", confidenceScore: 1 };
  }

  if (incoming.governmentId) {
    const matches = await findPeopleByColumn("government_id", incoming.governmentId);
    if (matches[0]) {
      return { person: matches[0], matchBasis: "government_id", confidenceScore: 1 };
    }
  }

  if (allowEmailPhoneMatch && incoming.primaryEmail && clean(incoming.name)) {
    const matches = await findPeopleByColumn("primary_email", incoming.primaryEmail);
    const compatible = matches.find((candidate) => nameCompatible(candidate.canonical_name, incoming.name));
    if (compatible) {
      return { person: compatible, matchBasis: "email_name", confidenceScore: 0.91 };
    }
  }

  if (allowEmailPhoneMatch && incoming.primaryPhone && clean(incoming.name)) {
    const matches = await findPeopleByColumn("primary_phone", incoming.primaryPhone);
    const compatible = matches.find((candidate) => nameCompatible(candidate.canonical_name, incoming.name));
    if (compatible) {
      return { person: compatible, matchBasis: "phone_name", confidenceScore: 0.87 };
    }
  }

  return { person: null, matchBasis: "new", confidenceScore: 0.6 };
}

async function ensurePersonRole(personId, roleKey, sourceStudentId) {
  await sql`
    INSERT INTO crm_person_roles (person_id, role_key, source_student_id, created_at)
    VALUES (${personId}, ${roleKey}, ${clean(sourceStudentId)}, NOW())
    ON CONFLICT (person_id, role_key)
    DO UPDATE SET
      source_student_id = COALESCE(crm_person_roles.source_student_id, EXCLUDED.source_student_id)
  `;
}

async function upsertPerson(incoming, { allowEmailPhoneMatch = false } = {}) {
  const { person, matchBasis, confidenceScore } = await resolvePerson(incoming, { allowEmailPhoneMatch });
  const personId = clean(person?.id) || randomUUID();
  const existingRaw = parseJson(person?.raw_data);
  const nextRaw = {
    ...existingRaw,
    ...incoming.rawData,
    sources: {
      ...(existingRaw.sources || {}),
      [incoming.sourceKey]: incoming.rawData || {}
    }
  };
  const canonicalName = pickPreferredText(person?.canonical_name, incoming.name);
  const email = pickPreferredText(person?.primary_email, incoming.primaryEmail);
  const phone = pickPreferredText(person?.primary_phone, incoming.primaryPhone);
  const governmentId = pickPreferredText(person?.government_id, incoming.governmentId);
  const birthDate = normalizeDate(person?.birth_date) || incoming.birthDate || null;

  if (person?.id) {
    await sql`
      UPDATE crm_people
      SET
        source_key = COALESCE(source_key, ${incoming.sourceKey}),
        canonical_name = ${canonicalName},
        first_name = COALESCE(NULLIF(first_name, ''), ${clean(incoming.firstName)}),
        last_name = COALESCE(NULLIF(last_name, ''), ${clean(incoming.lastName)}),
        hebrew_name = ${pickPreferredText(person?.hebrew_name, incoming.name)},
        government_id = COALESCE(NULLIF(government_id, ''), ${governmentId}),
        birth_date = COALESCE(birth_date, ${birthDate}),
        primary_email = COALESCE(NULLIF(primary_email, ''), ${email}),
        primary_phone = COALESCE(NULLIF(primary_phone, ''), ${phone}),
        source_student_id = COALESCE(NULLIF(source_student_id, ''), ${clean(incoming.sourceStudentId)}),
        raw_data = ${JSON.stringify(nextRaw)}::jsonb,
        updated_at = NOW()
      WHERE id = ${personId}
    `;
  } else {
    await sql`
      INSERT INTO crm_people (
        id,
        source_key,
        canonical_name,
        first_name,
        last_name,
        hebrew_name,
        government_id,
        birth_date,
        primary_email,
        primary_phone,
        source_student_id,
        raw_data,
        created_at,
        updated_at
      )
      VALUES (
        ${personId},
        ${incoming.sourceKey},
        ${canonicalName},
        ${clean(incoming.firstName)},
        ${clean(incoming.lastName)},
        ${clean(incoming.name)},
        ${governmentId},
        ${birthDate},
        ${email},
        ${phone},
        ${clean(incoming.sourceStudentId)},
        ${JSON.stringify(nextRaw)}::jsonb,
        NOW(),
        NOW()
      )
    `;
  }

  await ensurePersonRole(personId, incoming.role, incoming.sourceStudentId);

  return {
    id: personId,
    canonicalName,
    governmentId,
    primaryEmail: email,
    primaryPhone: phone,
    matchBasis,
    confidenceScore,
    matchedExistingPerson: Boolean(person?.id)
  };
}

async function insertContact(personId, contactType, value, label, isPrimary, sourceStudentId) {
  const raw = clean(value);
  if (!raw) return;
  const normalizedValue = contactType === "email" ? normalizeEmail(raw) : normalizePhone(raw);
  if (!normalizedValue) return;
  await sql`
    INSERT INTO crm_person_contacts (
      id,
      person_id,
      contact_type,
      contact_label,
      contact_value,
      normalized_value,
      is_primary,
      source_kind,
      source_student_id,
      created_at,
      updated_at
    )
    VALUES (
      ${randomUUID()},
      ${personId},
      ${contactType},
      ${clean(label)},
      ${raw},
      ${normalizedValue},
      ${Boolean(isPrimary)},
      ${SYNC_SOURCE},
      ${clean(sourceStudentId)},
      NOW(),
      NOW()
    )
    ON CONFLICT (person_id, contact_type, normalized_value)
    DO UPDATE SET
      contact_label = EXCLUDED.contact_label,
      contact_value = EXCLUDED.contact_value,
      is_primary = crm_person_contacts.is_primary OR EXCLUDED.is_primary,
      updated_at = NOW()
  `;
}

async function insertRelationship(fromPersonId, toPersonId, relationType, confidenceScore, matchBasis, sourceStudentId) {
  await sql`
    INSERT INTO crm_person_relationships (
      id,
      from_person_id,
      to_person_id,
      relation_type,
      confidence_score,
      match_basis,
      source_kind,
      source_student_id,
      is_primary,
      created_at,
      updated_at
    )
    VALUES (
      ${randomUUID()},
      ${fromPersonId},
      ${toPersonId},
      ${relationType},
      ${confidenceScore},
      ${clean(matchBasis)},
      ${SYNC_SOURCE},
      ${clean(sourceStudentId)},
      TRUE,
      NOW(),
      NOW()
    )
    ON CONFLICT (from_person_id, to_person_id, relation_type, source_student_id)
    DO UPDATE SET
      confidence_score = EXCLUDED.confidence_score,
      match_basis = EXCLUDED.match_basis,
      updated_at = NOW()
  `;
}

async function insertAlert(entityType, entityId, alertType, severity, title, detailsJson, confidenceScore = null) {
  await sql`
    INSERT INTO crm_match_alerts (
      id,
      entity_type,
      entity_id,
      alert_type,
      severity,
      status,
      confidence_score,
      title,
      details_json,
      source_kind,
      created_at,
      updated_at
    )
    VALUES (
      ${randomUUID()},
      ${entityType},
      ${entityId},
      ${alertType},
      ${severity},
      'open',
      ${confidenceScore},
      ${title},
      ${JSON.stringify(detailsJson || {})}::jsonb,
      ${SYNC_SOURCE},
      NOW(),
      NOW()
    )
  `;
}

async function upsertStudentProfile(student, studentPersonId) {
  const studentId = clean(student?.id);
  await sql`
    INSERT INTO crm_student_profiles (
      student_id,
      person_id,
      class_code,
      registration_status,
      family_status,
      current_institution_code,
      source_payload,
      synced_at,
      updated_at
    )
    VALUES (
      ${studentId},
      ${studentPersonId},
      ${clean(student?.class)},
      ${clean(student?.registration)},
      ${clean(student?.famliystatus)},
      ${clean(student?.currentInstitution).toUpperCase()},
      ${JSON.stringify(student || {})}::jsonb,
      NOW(),
      NOW()
    )
    ON CONFLICT (student_id)
    DO UPDATE SET
      person_id = EXCLUDED.person_id,
      class_code = EXCLUDED.class_code,
      registration_status = EXCLUDED.registration_status,
      family_status = EXCLUDED.family_status,
      current_institution_code = EXCLUDED.current_institution_code,
      source_payload = EXCLUDED.source_payload,
      synced_at = NOW(),
      updated_at = NOW()
  `;
}

async function upsertStudentInstitution(studentId, institutionCode) {
  const code = clean(institutionCode).toUpperCase();
  if (!code) return;
  const institutionId = `institution:${code}`;
  await sql`
    INSERT INTO crm_student_institutions (
      id,
      student_id,
      institution_id,
      relation_type,
      is_primary,
      source_kind,
      source_value,
      confidence_score,
      created_at,
      updated_at
    )
    VALUES (
      ${randomUUID()},
      ${studentId},
      ${institutionId},
      'current',
      TRUE,
      ${SYNC_SOURCE},
      ${code},
      1,
      NOW(),
      NOW()
    )
    ON CONFLICT (student_id, institution_id, relation_type)
    DO UPDATE SET
      is_primary = TRUE,
      source_kind = EXCLUDED.source_kind,
      source_value = EXCLUDED.source_value,
      confidence_score = EXCLUDED.confidence_score,
      updated_at = NOW()
  `;
}

async function clearGeneratedProjection() {
  await sql`DELETE FROM crm_match_alerts WHERE source_kind = ${SYNC_SOURCE}`;
  await sql`DELETE FROM crm_student_institutions WHERE source_kind = ${SYNC_SOURCE}`;
  await sql`DELETE FROM crm_person_relationships WHERE source_kind = ${SYNC_SOURCE}`;
  await sql`DELETE FROM crm_person_contacts WHERE source_kind = ${SYNC_SOURCE}`;
  await sql`DELETE FROM crm_student_profiles`;
  await sql`
    DELETE FROM crm_person_roles
    WHERE role_key IN ('student', 'parent', 'alumnus')
      AND source_student_id IS NOT NULL
  `;
}

async function buildGlobalDuplicateAlerts() {
  const duplicateIds = await sql`
    SELECT government_id, COUNT(*)::int AS duplicate_count, ARRAY_AGG(id ORDER BY canonical_name) AS person_ids
    FROM crm_people
    WHERE government_id IS NOT NULL AND BTRIM(government_id) <> ''
    GROUP BY government_id
    HAVING COUNT(*) > 1
  `;

  for (const row of duplicateIds) {
    await insertAlert(
      "person_group",
      clean(row.government_id),
      "duplicate_government_id",
      "high",
      "אותה תעודת זהות משויכת ליותר מאדם אחד",
      {
        duplicateCount: Number(row.duplicate_count || 0),
        personIds: row.person_ids || []
      },
      0.99
    );
  }

  const duplicateContacts = await sql`
    SELECT
      contact_type,
      normalized_value,
      COUNT(DISTINCT person_id)::int AS person_count,
      ARRAY_AGG(DISTINCT person_id ORDER BY person_id) AS person_ids
    FROM crm_person_contacts
    WHERE source_kind = ${SYNC_SOURCE}
      AND normalized_value IS NOT NULL
      AND BTRIM(normalized_value) <> ''
    GROUP BY contact_type, normalized_value
    HAVING COUNT(DISTINCT person_id) > 1
  `;

  for (const row of duplicateContacts) {
    await insertAlert(
      "contact_group",
      `${clean(row.contact_type)}:${clean(row.normalized_value)}`,
      "shared_contact",
      Number(row.person_count || 0) >= 3 ? "warn" : "info",
      `אותו ${clean(row.contact_type) === "phone" ? "טלפון" : "אימייל"} משויך ליותר מאדם אחד`,
      {
        contactType: clean(row.contact_type),
        normalizedValue: clean(row.normalized_value),
        personCount: Number(row.person_count || 0),
        personIds: row.person_ids || []
      },
      0.82
    );
  }
}

export async function syncCanonicalDirectoryFromNeon() {
  await initDb();
  const students = await listNeonStudentsByFilters({});
  const institutionCodes = students.map((student) => clean(student?.currentInstitution).toUpperCase()).filter(Boolean);

  await seedInstitutions(institutionCodes);
  await clearGeneratedProjection();

  for (const student of students) {
    const studentId = clean(student?.id);
    const studentName = buildStudentName(student);
    const studentTz = normalizeDigits(student?.tznum);
    const studentPerson = await upsertPerson({
      sourceKey: `student:${studentId}`,
      role: "student",
      sourceStudentId: studentId,
      name: studentName,
      firstName: clean(student?.fullName?.firstName),
      lastName: clean(student?.fullName?.lastName),
      governmentId: studentTz,
      birthDate: normalizeDate(student?.dateofbirth),
      primaryEmail: normalizeEmail(student?.email?.primaryEmail),
      primaryPhone: normalizePhone(student?.phone?.primaryPhoneNumber),
      rawData: {
        kind: "student",
        currentInstitution: clean(student?.currentInstitution),
        label: studentName
      }
    });

    await upsertStudentProfile(student, studentPerson.id);
    if (clean(student?.currentInstitution).toUpperCase().startsWith("BOGER")) {
      await ensurePersonRole(studentPerson.id, "alumnus", studentId);
    }
    await upsertStudentInstitution(studentId, student?.currentInstitution);
    await insertContact(studentPerson.id, "email", student?.email?.primaryEmail, "student_primary", true, studentId);
    for (const extraEmail of Array.isArray(student?.email?.additionalEmails) ? student.email.additionalEmails : []) {
      await insertContact(studentPerson.id, "email", extraEmail, "student_additional", false, studentId);
    }
    await insertContact(studentPerson.id, "phone", student?.phone?.primaryPhoneNumber, "student_primary", true, studentId);
    for (const extraPhone of Array.isArray(student?.phone?.additionalPhones) ? student.phone.additionalPhones : []) {
      await insertContact(studentPerson.id, "phone", extraPhone, "student_additional", false, studentId);
    }

    for (const side of ["father", "mother"]) {
      const parent = buildParentSnapshot(student, side);
      const hasIdentifier = Boolean(parent.name || parent.governmentId || parent.primaryEmail || parent.primaryPhone);
      if (!hasIdentifier) continue;

      if (parent.governmentId && studentTz && parent.governmentId === studentTz) {
        await insertAlert(
          "student",
          studentId,
          "self_parent_match",
          "high",
          "תעודת הזהות של ההורה זהה לתעודת הזהות של התלמיד",
          { studentId, side, governmentId: parent.governmentId },
          0.99
        );
      }

      const parentPerson = await upsertPerson(
        {
          ...parent,
          sourceStudentId: studentId
        },
        { allowEmailPhoneMatch: true }
      );

      await insertRelationship(
        parentPerson.id,
        studentPerson.id,
        parent.relationType,
        parentPerson.confidenceScore,
        parentPerson.matchBasis,
        studentId
      );
      await insertContact(parentPerson.id, "email", parent.primaryEmail, `${side}_primary`, true, studentId);
      for (const extraEmail of parent.additionalEmails || []) {
        await insertContact(parentPerson.id, "email", extraEmail, `${side}_additional`, false, studentId);
      }
      await insertContact(parentPerson.id, "phone", parent.primaryPhone, `${side}_primary`, true, studentId);
      for (const extraPhone of parent.additionalPhones || []) {
        await insertContact(parentPerson.id, "phone", extraPhone, `${side}_additional`, false, studentId);
      }

      if (parentPerson.matchedExistingPerson && parentPerson.matchBasis !== "source_key") {
        await insertAlert(
          "student",
          studentId,
          "parent_matched_existing_person",
          parentPerson.matchBasis === "government_id" ? "info" : "warn",
          `ה-${side === "father" ? "אב" : "אם"} קושר/ה לאדם קיים במערכת`,
          {
            studentId,
            studentName,
            side,
            personId: parentPerson.id,
            matchBasis: parentPerson.matchBasis,
            parentName: parent.name
          },
          parentPerson.confidenceScore
        );
      }
    }
  }

  await buildGlobalDuplicateAlerts();

  const stats = await sql`
    SELECT
      (SELECT COUNT(*)::int FROM crm_people) AS people_count,
      (SELECT COUNT(*)::int FROM crm_student_profiles) AS student_profiles_count,
      (SELECT COUNT(*)::int FROM crm_person_relationships WHERE source_kind = ${SYNC_SOURCE}) AS relationship_count,
      (SELECT COUNT(*)::int FROM crm_match_alerts WHERE source_kind = ${SYNC_SOURCE} AND status = 'open') AS open_alert_count
  `;

  return {
    studentCount: students.length,
    peopleCount: Number(stats?.[0]?.people_count || 0),
    studentProfilesCount: Number(stats?.[0]?.student_profiles_count || 0),
    relationshipCount: Number(stats?.[0]?.relationship_count || 0),
    openAlertCount: Number(stats?.[0]?.open_alert_count || 0)
  };
}

function deriveFamilyStatus(row) {
  const alertCount = Number(row?.alert_count || 0);
  const minConfidence = Number(row?.min_confidence || 1);
  if (alertCount > 0) return "צריך בדיקה";
  if (minConfidence < 0.9) return "בדיקה קלה";
  return "תקין";
}

export async function getCanonicalDirectoryDashboard({ autoSync = true } = {}) {
  await initDb();
  const counts = await sql`
    SELECT
      (SELECT COUNT(*)::int FROM crm_people) AS people_count,
      (SELECT COUNT(*)::int FROM crm_student_profiles) AS student_profiles_count,
      (SELECT COUNT(*)::int FROM crm_institutions) AS institutions_count,
      (SELECT COUNT(*)::int FROM crm_match_alerts WHERE status = 'open') AS open_alert_count
  `;

  const currentCounts = counts[0] || {};
  if (autoSync && Number(currentCounts.student_profiles_count || 0) === 0) {
    await syncCanonicalDirectoryFromNeon();
  }

  const statsRows = await sql`
    SELECT
      (SELECT COUNT(*)::int FROM crm_people) AS people_count,
      (SELECT COUNT(*)::int FROM crm_student_profiles) AS student_profiles_count,
      (SELECT COUNT(*)::int FROM crm_institutions) AS institutions_count,
      (SELECT COUNT(*)::int FROM crm_person_relationships WHERE source_kind = ${SYNC_SOURCE}) AS relationship_count,
      (SELECT COUNT(*)::int FROM crm_match_alerts WHERE status = 'open') AS open_alert_count,
      (SELECT COUNT(*)::int FROM crm_person_roles WHERE role_key = 'parent') AS parent_role_count
  `;
  const stats = statsRows[0] || {};

  const institutions = await sql`
    SELECT
      i.id,
      i.code,
      i.name,
      i.institution_type,
      COUNT(DISTINCT si.student_id)::int AS student_count
    FROM crm_institutions i
    LEFT JOIN crm_student_institutions si
      ON si.institution_id = i.id
    GROUP BY i.id, i.code, i.name, i.institution_type
    ORDER BY student_count DESC, i.name ASC
  `;

  const alerts = await sql`
    SELECT id, entity_type, entity_id, alert_type, severity, confidence_score, title, details_json, created_at
    FROM crm_match_alerts
    WHERE status = 'open'
    ORDER BY
      CASE severity
        WHEN 'high' THEN 1
        WHEN 'warn' THEN 2
        ELSE 3
      END,
      created_at DESC
    LIMIT 80
  `;

  const familyRows = await sql`
    SELECT
      sp.student_id,
      sp.class_code,
      sp.registration_status,
      sp.family_status,
      sp.current_institution_code,
      student_person.canonical_name AS student_name,
      COUNT(rel.id)::int AS parent_count,
      COALESCE(MIN(rel.confidence_score), 1) AS min_confidence,
      (
        SELECT COUNT(*)::int
        FROM crm_match_alerts a
        WHERE a.status = 'open'
          AND (
            (a.entity_type = 'student' AND a.entity_id = sp.student_id)
            OR (a.entity_type = 'person' AND a.entity_id = student_person.id)
          )
      ) AS alert_count
    FROM crm_student_profiles sp
    JOIN crm_people student_person
      ON student_person.id = sp.person_id
    LEFT JOIN crm_person_relationships rel
      ON rel.to_person_id = student_person.id
      AND rel.source_kind = ${SYNC_SOURCE}
    GROUP BY
      sp.student_id,
      sp.class_code,
      sp.registration_status,
      sp.family_status,
      sp.current_institution_code,
      student_person.id,
      student_person.canonical_name
    ORDER BY student_person.canonical_name ASC
    LIMIT 120
  `;

  const families = [];
  for (const row of familyRows) {
    const parents = await sql`
      SELECT
        rel.relation_type,
        rel.confidence_score,
        rel.match_basis,
        parent_person.canonical_name,
        parent_person.government_id,
        parent_person.primary_email,
        parent_person.primary_phone
      FROM crm_person_relationships rel
      JOIN crm_people parent_person
        ON parent_person.id = rel.from_person_id
      JOIN crm_student_profiles sp
        ON sp.person_id = rel.to_person_id
      WHERE sp.student_id = ${clean(row.student_id)}
        AND rel.source_kind = ${SYNC_SOURCE}
      ORDER BY rel.relation_type ASC, parent_person.canonical_name ASC
    `;

    families.push({
      studentId: clean(row.student_id),
      studentName: clean(row.student_name),
      classCode: clean(row.class_code),
      registrationStatus: clean(row.registration_status),
      familyStatus: clean(row.family_status),
      currentInstitutionCode: clean(row.current_institution_code),
      parentCount: Number(row.parent_count || 0),
      minConfidence: Number(row.min_confidence || 1),
      alertCount: Number(row.alert_count || 0),
      matchStatus: deriveFamilyStatus(row),
      parents: parents.map((parent) => ({
        relationType: clean(parent.relation_type),
        canonicalName: clean(parent.canonical_name),
        governmentId: clean(parent.government_id),
        primaryEmail: clean(parent.primary_email),
        primaryPhone: clean(parent.primary_phone),
        confidenceScore: Number(parent.confidence_score || 0),
        matchBasis: clean(parent.match_basis)
      }))
    });
  }

  return {
    stats: {
      peopleCount: Number(stats.people_count || 0),
      studentProfilesCount: Number(stats.student_profiles_count || 0),
      parentRoleCount: Number(stats.parent_role_count || 0),
      institutionsCount: Number(stats.institutions_count || 0),
      relationshipCount: Number(stats.relationship_count || 0),
      openAlertCount: Number(stats.open_alert_count || 0)
    },
    institutions,
    alerts: alerts.map((alert) => ({
      ...alert,
      confidence_score: alert.confidence_score === null ? null : Number(alert.confidence_score),
      details_json: parseJson(alert.details_json)
    })),
    families
  };
}
