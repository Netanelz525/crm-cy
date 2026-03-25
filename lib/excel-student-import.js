import * as XLSX from "xlsx";
import { FIELD_SECTIONS, normalizeStudentInput } from "./student-fields";
import { listAllNeonStudents, updateNeonStudentViaTwenty } from "./neon-students";

function clean(value) {
  return String(value || "").trim();
}

function normalizeHeader(value) {
  return clean(value)
    .toLowerCase()
    .replace(/["']/g, "")
    .replace(/[()]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

const IDENTIFIER_HEADERS = {
  id: "id",
  student_id: "id",
  "student id": "id",
  "record id": "id",
  "מזהה תלמיד": "id",
  "מזהה": "id",
  tznum: "tznum",
  "tz num": "tznum",
  "tz": "tznum",
  'ת"ז': "tznum",
  "תז": "tznum",
  "תעודת זהות": "tznum",
  email: "email",
  "primary email": "email",
  "email.primaryemail": "email",
  "אימייל": "email",
  "אימייל תלמיד": "email",
  "מייל": "email"
};

function buildFieldHeaderMap() {
  const map = new Map();
  for (const section of FIELD_SECTIONS) {
    for (const field of section.fields) {
      map.set(normalizeHeader(field.key), field.key);
      map.set(normalizeHeader(field.label), field.key);
    }
  }
  return map;
}

const FIELD_HEADER_MAP = buildFieldHeaderMap();

function resolveHeaderKey(header) {
  const normalized = normalizeHeader(header);
  if (!normalized) return "";
  return IDENTIFIER_HEADERS[normalized] || FIELD_HEADER_MAP.get(normalized) || "";
}

function hasMeaningfulValues(row) {
  return Object.values(row || {}).some((value) => clean(value) !== "");
}

function buildStudentIndexes(students) {
  const indexes = {
    id: new Map(),
    tznum: new Map(),
    email: new Map()
  };

  for (const student of students) {
    const studentId = clean(student?.id);
    if (studentId) indexes.id.set(studentId, [student]);

    const tznum = clean(student?.tznum).replace(/[^\d]/g, "");
    if (tznum) {
      const current = indexes.tznum.get(tznum) || [];
      current.push(student);
      indexes.tznum.set(tznum, current);
    }

    const emails = [
      clean(student?.email?.primaryEmail).toLowerCase(),
      clean(student?.fatherEmail?.primaryEmail).toLowerCase(),
      clean(student?.motherEmail?.primaryEmail).toLowerCase()
    ].filter(Boolean);
    for (const email of emails) {
      const current = indexes.email.get(email) || [];
      current.push(student);
      indexes.email.set(email, current);
    }
  }

  return indexes;
}

function extractMatchValues(row) {
  const values = {
    id: "",
    tznum: "",
    email: ""
  };

  for (const [header, rawValue] of Object.entries(row || {})) {
    const key = resolveHeaderKey(header);
    if (!key || !(key in values)) continue;
    if (key === "tznum") values.tznum = clean(rawValue).replace(/[^\d]/g, "");
    else if (key === "email") values.email = clean(rawValue).toLowerCase();
    else values[key] = clean(rawValue);
  }

  return values;
}

function resolveStudent(row, matchFields, indexes) {
  const matchValues = extractMatchValues(row);
  const candidateGroups = [];

  for (const field of matchFields) {
    const value = matchValues[field];
    if (!value) {
      throw new Error(`חסר ערך התאמה עבור ${field}`);
    }
    const matches = indexes[field].get(value) || [];
    if (!matches.length) {
      return null;
    }
    candidateGroups.push(matches);
  }

  if (!candidateGroups.length) return null;

  const firstGroup = candidateGroups[0];
  const matchingStudents = firstGroup.filter((student) =>
    candidateGroups.every((group) => group.some((candidate) => candidate.id === student.id))
  );

  if (matchingStudents.length !== 1) {
    throw new Error(matchingStudents.length ? "נמצאו כמה תלמידים תואמים" : "לא נמצא תלמיד תואם באופן מלא");
  }

  return matchingStudents[0];
}

function buildStudentUpdate(row) {
  const rawData = {};
  for (const [header, value] of Object.entries(row || {})) {
    const key = resolveHeaderKey(header);
    if (!key || key === "id" || key === "tznum") continue;
    rawData[key] = value;
  }
  return normalizeStudentInput(rawData);
}

export async function importStudentsFromExcelFile(file, matchFields = ["id", "tznum"]) {
  if (!file) {
    throw new Error("לא נבחר קובץ");
  }

  const fileName = clean(file.name).toLowerCase();
  if (!/\.(xlsx|xls|csv)$/.test(fileName)) {
    throw new Error("אפשר להעלות רק קובץ Excel או CSV");
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  const workbook = XLSX.read(buffer, { type: "buffer" });
  const firstSheetName = workbook.SheetNames[0];
  if (!firstSheetName) {
    throw new Error("לא נמצאה גליון עבודה בקובץ");
  }

  const sheet = workbook.Sheets[firstSheetName];
  const rows = XLSX.utils.sheet_to_json(sheet, { defval: "" });
  const allowedMatchFields = Array.isArray(matchFields) ? matchFields.map(clean).filter(Boolean) : [];
  if (!allowedMatchFields.length) {
    throw new Error("יש לבחור לפחות שדה התאמה אחד");
  }
  const students = await listAllNeonStudents();
  const indexes = buildStudentIndexes(students);

  let updated = 0;
  let skipped = 0;
  let failed = 0;
  const errors = [];

  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index];
    const rowNumber = index + 2;

    if (!hasMeaningfulValues(row)) {
      skipped += 1;
      continue;
    }

    try {
      const student = resolveStudent(row, allowedMatchFields, indexes);
      if (!student?.id) {
        failed += 1;
        errors.push(`שורה ${rowNumber}: לא נמצא תלמיד לפי שדות ההתאמה שנבחרו`);
        continue;
      }

      const data = buildStudentUpdate(row);
      if (!Object.keys(data).length) {
        skipped += 1;
        continue;
      }

      await updateNeonStudentViaTwenty(student.id, data);
      updated += 1;
    } catch (error) {
      failed += 1;
      errors.push(`שורה ${rowNumber}: ${error?.message || "העדכון נכשל"}`);
    }
  }

  return {
    totalRows: rows.length,
    updated,
    skipped,
    failed,
    errors
  };
}
