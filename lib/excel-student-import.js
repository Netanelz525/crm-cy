import * as XLSX from "xlsx";
import { FIELD_SECTIONS, normalizeStudentInput } from "./student-fields";
import { getNeonStudentById, searchNeonStudentsByTz, updateNeonStudentViaTwenty } from "./neon-students";

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
  "תעודת זהות": "tznum"
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

async function resolveStudent(row) {
  const rawId = Object.entries(row).find(([header]) => resolveHeaderKey(header) === "id")?.[1];
  const rawTz = Object.entries(row).find(([header]) => resolveHeaderKey(header) === "tznum")?.[1];
  const studentId = clean(rawId);
  const tznum = clean(rawTz).replace(/[^\d]/g, "");

  if (studentId) {
    return getNeonStudentById(studentId);
  }

  if (!tznum) return null;
  const matches = await searchNeonStudentsByTz(tznum);
  return matches.find((student) => clean(student?.tznum).replace(/[^\d]/g, "") === tznum) || null;
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

export async function importStudentsFromExcelFile(file) {
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
      const student = await resolveStudent(row);
      if (!student?.id) {
        failed += 1;
        errors.push(`שורה ${rowNumber}: לא נמצא תלמיד לפי מזהה או ת"ז`);
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
