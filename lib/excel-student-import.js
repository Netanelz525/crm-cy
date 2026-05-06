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

function decodeCsvBuffer(buffer) {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  const encodings = ["utf-8", "windows-1255", "iso-8859-8"];

  for (const encoding of encodings) {
    try {
      const text = new TextDecoder(encoding).decode(bytes);
      if (!text) continue;
      const looksBroken = /×|�/.test(text);
      if (!looksBroken || encoding === encodings[encodings.length - 1]) {
        return text.replace(/^\uFEFF/, "");
      }
    } catch {
      // Try next encoding.
    }
  }

  return new TextDecoder("utf-8").decode(bytes).replace(/^\uFEFF/, "");
}

export const MATCH_FIELD_OPTIONS = [
  { key: "id", label: "מזהה תלמיד" },
  { key: "tznum", label: 'ת"ז' },
  { key: "email", label: "מייל" }
];

const FIELD_LABELS = new Map(
  FIELD_SECTIONS.flatMap((section) =>
    (section.fields || []).map((field) => [field.key, field.label || field.key])
  )
);

const MATCH_FIELD_LABELS = new Map(
  MATCH_FIELD_OPTIONS.map((field) => [field.key, field.label || field.key])
);

function hasMeaningfulValues(row) {
  return Object.values(row || {}).some((value) => clean(value) !== "");
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizeRowStatus(status, outcome = "") {
  const normalizedStatus = clean(status).toLowerCase();
  if (["updated", "skipped", "failed"].includes(normalizedStatus)) {
    return normalizedStatus;
  }

  const normalizedOutcome = clean(outcome);
  if (normalizedOutcome === "עודכן") return "updated";
  if (normalizedOutcome === "דולג" || normalizedOutcome === "השורה ריקה") return "skipped";
  if (normalizedOutcome === "נכשל") return "failed";
  return "failed";
}

function outcomeLabelForStatus(status) {
  if (status === "updated") return "עודכן";
  if (status === "skipped") return "דולג";
  return "נכשל";
}

function normalizeRowResult(result = {}) {
  const status = normalizeRowStatus(result?.status, result?.outcome);
  return {
    ...result,
    status,
    outcome: outcomeLabelForStatus(status),
    message: clean(result?.message),
    studentId: clean(result?.studentId),
    studentName: clean(result?.studentName),
    row: result?.row && typeof result.row === "object" ? result.row : {}
  };
}

function summarizeRowResults(rowResults = []) {
  const normalizedRowResults = rowResults.map(normalizeRowResult);
  const summary = {
    totalRows: normalizedRowResults.length,
    updated: 0,
    skipped: 0,
    failed: 0,
    rowResults: normalizedRowResults
  };

  for (const rowResult of normalizedRowResults) {
    if (rowResult.status === "updated") summary.updated += 1;
    else if (rowResult.status === "skipped") summary.skipped += 1;
    else summary.failed += 1;
  }

  return summary;
}

function isRateLimitError(error) {
  const message = clean(error?.message).toLowerCase();
  return message.includes("limit reached") || message.includes("rate limit") || message.includes("too many requests");
}

async function runImportUpdateWithThrottle(task, state) {
  const minIntervalMs = 700;
  const now = Date.now();
  const sinceLastRun = now - state.lastRunAt;

  if (state.lastRunAt && sinceLastRun < minIntervalMs) {
    await sleep(minIntervalMs - sinceLastRun);
  }

  for (let attempt = 0; attempt < 4; attempt += 1) {
    try {
      const result = await task();
      state.lastRunAt = Date.now();
      return result;
    } catch (error) {
      if (!isRateLimitError(error) || attempt === 3) {
        throw error;
      }

      const retryDelayMs = 15000 * (attempt + 1);
      await sleep(retryDelayMs);
      state.lastRunAt = Date.now();
    }
  }
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

function resolveStudentByValues(matchValues, matchFields, indexes) {
  const candidateGroups = [];

  for (const field of matchFields) {
    const value = clean(matchValues[field]);
    if (!value) {
      throw new Error(`חסר ערך התאמה עבור ${field}`);
    }
    const matches = indexes[field].get(field === "email" ? value.toLowerCase() : value) || [];
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

export async function parseExcelFile(file) {
  if (!file) {
    throw new Error("לא נבחר קובץ");
  }

  const fileName = clean(file.name);
  const normalizedFileName = fileName.toLowerCase();
  const extension = normalizedFileName.includes(".")
    ? normalizedFileName.slice(normalizedFileName.lastIndexOf(".") + 1).trim()
    : "";
  const mimeType = clean(file.type).toLowerCase();
  const looksLikeSupportedFile = ["xlsx", "xls", "csv"].includes(extension)
    || mimeType.includes("csv")
    || mimeType.includes("spreadsheet")
    || mimeType.includes("excel");

  if (!looksLikeSupportedFile) {
    throw new Error("אפשר להעלות רק קובץ Excel או CSV");
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  const workbook = extension === "csv"
    ? XLSX.read(decodeCsvBuffer(buffer), { type: "string" })
    : XLSX.read(buffer, { type: "buffer" });
  const firstSheetName = workbook.SheetNames[0];
  if (!firstSheetName) {
    throw new Error("לא נמצאה גליון עבודה בקובץ");
  }

  const sheet = workbook.Sheets[firstSheetName];
  const rows = XLSX.utils.sheet_to_json(sheet, { defval: "" }).filter(hasMeaningfulValues);
  const headers = Object.keys(rows[0] || {});

  return {
    fileName: fileName || "import.xlsx",
    headers,
    rows
  };
}


export async function importStudentsFromRowsWithMapping(rows, { matchMapping = {}, fieldMapping = {}, onProgress = null } = {}) {
  const matchFields = Object.entries(matchMapping)
    .filter(([, header]) => clean(header))
    .map(([field]) => clean(field));

  if (!matchFields.length) {
    throw new Error("יש לבחור לפחות עמודת זיהוי אחת");
  }

  const students = await listAllNeonStudents();
  const indexes = buildStudentIndexes(students);

  let updated = 0;
  let skipped = 0;
  let failed = 0;
  const errors = [];
  const rowResults = [];
  const throttleState = { lastRunAt: 0 };
  const totalRows = rows.length;

  async function emitProgress(currentRowNumber = 0) {
    if (typeof onProgress !== "function") return;
    await onProgress({
      totalRows,
      processedRows: Math.min(currentRowNumber, totalRows),
      updated,
      skipped,
      failed
    });
  }

  await emitProgress(0);

  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index];
    const rowNumber = index + 2;

    if (!hasMeaningfulValues(row)) {
      skipped += 1;
      rowResults.push({
        rowNumber,
        status: "skipped",
        outcome: "השורה ריקה",
        message: "לא נמצאו ערכים לעדכון",
        studentId: "",
        studentName: "",
        row
      });
      await emitProgress(index + 1);
      continue;
    }

    try {
      const matchValues = {};
      for (const [field, header] of Object.entries(matchMapping)) {
        const rawValue = row?.[header];
        if (field === "tznum") matchValues[field] = clean(rawValue).replace(/[^\d]/g, "");
        else if (field === "email") matchValues[field] = clean(rawValue).toLowerCase();
        else matchValues[field] = clean(rawValue);
      }

      const student = resolveStudentByValues(matchValues, matchFields, indexes);
      if (!student?.id) {
        failed += 1;
        const message = "לא נמצא תלמיד לפי עמודות הזיהוי שנבחרו";
        errors.push(`שורה ${rowNumber}: ${message}`);
        rowResults.push({
          rowNumber,
          status: "failed",
          outcome: "נכשל",
          message,
          studentId: "",
          studentName: "",
          row
        });
        await emitProgress(index + 1);
        continue;
      }

      const rawData = {};
      for (const [fieldKey, header] of Object.entries(fieldMapping)) {
        if (!clean(header)) continue;
        const value = row?.[header];
        if (value === undefined) continue;
        rawData[fieldKey] = value;
      }

      const data = normalizeStudentInput(rawData);
      if (!Object.keys(data).length) {
        skipped += 1;
        rowResults.push({
          rowNumber,
          status: "skipped",
          outcome: "דולג",
          message: "לא זוהו שדות לעדכון בשורה",
          studentId: clean(student.id),
          studentName: clean(student.label),
          row
        });
        await emitProgress(index + 1);
        continue;
      }

      await runImportUpdateWithThrottle(() => updateNeonStudentViaTwenty(student.id, data), throttleState);
      updated += 1;
      rowResults.push({
        rowNumber,
        status: "updated",
        outcome: "עודכן",
        message: "העדכון בוצע בהצלחה",
        studentId: clean(student.id),
        studentName: clean(student.label),
        row
      });
      await emitProgress(index + 1);
    } catch (error) {
      failed += 1;
      const message = error?.message || "העדכון נכשל";
      errors.push(`שורה ${rowNumber}: ${message}`);
      rowResults.push({
        rowNumber,
        status: "failed",
        outcome: "נכשל",
        message,
        studentId: "",
        studentName: "",
        row
      });
      await emitProgress(index + 1);
    }
  }

  return {
    totalRows: rows.length,
    updated,
    skipped,
    failed,
    errors,
    rowResults
  };
}

export function normalizeImportResult(result = {}) {
  const normalizedSummary = summarizeRowResults(result?.rowResults || []);
  return {
    ...result,
    totalRows: normalizedSummary.totalRows,
    updated: normalizedSummary.updated,
    skipped: normalizedSummary.skipped,
    failed: normalizedSummary.failed,
    rowResults: normalizedSummary.rowResults
  };
}

export function buildImportReportWorkbook({ fileName, matchMapping = {}, fieldMapping = {}, rowResults = [] } = {}) {
  const workbook = XLSX.utils.book_new();
  const matchSummary = buildMappingSummary(matchMapping);
  const fieldSummary = buildMappingSummary(fieldMapping);
  const normalizedSummary = summarizeRowResults(rowResults);
  const normalizedRowResults = normalizedSummary.rowResults;

  const summaryRows = [
    { פריט: "קובץ מקור", ערך: clean(fileName) || "import.xlsx" },
    { פריט: "תאריך הפקה", ערך: new Date().toLocaleString("he-IL") },
    { פריט: "עמודות זיהוי", ערך: matchSummary || "-" },
    { פריט: "שדות לעדכון", ערך: fieldSummary || "-" },
    { פריט: "סה\"כ שורות", ערך: normalizedSummary.totalRows },
    { פריט: "עודכנו", ערך: normalizedSummary.updated },
    { פריט: "דולגו", ערך: normalizedSummary.skipped },
    { פריט: "נכשלו", ערך: normalizedSummary.failed }
  ];

  const mappingRows = [
    ...buildMappingRows("זיהוי תלמיד", matchMapping),
    ...buildMappingRows("שדות לעדכון", fieldMapping)
  ];

  const reportRows = normalizedRowResults.map((result) => ({
    "שורה באקסל": result.rowNumber,
    סטטוס: result.outcome,
    פירוט: clean(result.message),
    "מזהה תלמיד במערכת": clean(result.studentId),
    "שם תלמיד במערכת": clean(result.studentName),
    ...buildMappedValueColumns("זיהוי", matchMapping, result.row),
    ...buildMappedValueColumns("עדכון", fieldMapping, result.row)
  }));

  XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(summaryRows, { skipHeader: false }), "סיכום");
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(mappingRows, { skipHeader: false }), "מיפוי");
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(reportRows, { skipHeader: false }), "דוח שורות");
  return XLSX.write(workbook, { type: "buffer", bookType: "xlsx" });
}

function getFieldLabel(fieldKey) {
  return MATCH_FIELD_LABELS.get(fieldKey) || FIELD_LABELS.get(fieldKey) || fieldKey;
}

function getSourceHeaderLabel(header) {
  const normalized = clean(header);
  return normalized || "עמודה ללא כותרת";
}

function buildMappingSummary(mapping = {}) {
  return Object.entries(mapping)
    .filter(([, header]) => clean(header))
    .map(([field, header]) => `${getFieldLabel(field)} <- ${getSourceHeaderLabel(header)}`)
    .join(" | ");
}

function buildMappingRows(groupLabel, mapping = {}) {
  return Object.entries(mapping)
    .filter(([, header]) => clean(header))
    .map(([field, header]) => ({
      קבוצה: groupLabel,
      שדה: getFieldLabel(field),
      "עמודת מקור": getSourceHeaderLabel(header)
    }));
}

function buildMappedValueColumns(prefix, mapping = {}, row = {}) {
  const values = {};

  for (const [field, header] of Object.entries(mapping)) {
    if (!clean(header)) continue;
    values[`${prefix} - ${getFieldLabel(field)}`] = row?.[header] ?? "";
  }

  return values;
}
