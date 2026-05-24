import { ENUM_LABELS, FIELD_SECTIONS, getByPath } from "./student-fields";
import { ageOf, buildMissingState, enumLabel, formatFieldValue, phoneText } from "./student-view";
import { getNeonStudentById, listAllNeonStudents, searchNeonStudents } from "./neon-students";

function clean(value) {
  return String(value || "").trim();
}

function normalizeText(value) {
  return clean(value)
    .toLowerCase()
    .replace(/[׳״"'`]/g, "")
    .replace(/[-_/\\.,]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeSearchQuery(query) {
  let normalized = clean(query);
  if (!normalized) return "";

  const removablePatterns = [
    /^מי\s+(זה|זאת)\s+/,
    /^תמצא\s+(לי\s+)?/,
    /^תחפש\s+(לי\s+)?/,
    /^חפש\s+(לי\s+)?/,
    /^מצא\s+(לי\s+)?/,
    /^איפה\s+/,
    /^כרטיס\s+(של\s+)?/,
    /^(התלמיד|תלמיד|בן אדם|אדם|איש|בחור)\s+/,
    /\s+(התלמיד|תלמיד|בן אדם|אדם|איש|בחור)$/
  ];

  let changed = true;
  while (changed) {
    changed = false;
    for (const pattern of removablePatterns) {
      const next = normalized.replace(pattern, "").trim();
      if (next !== normalized) {
        normalized = next;
        changed = true;
      }
    }
  }

  return normalized || clean(query);
}

function findFieldDefinition(fieldKey) {
  const normalized = clean(fieldKey);
  if (!normalized) return null;
  const normalizedKey = normalized.toLowerCase().replace(/\s+/g, "");

  for (const section of FIELD_SECTIONS) {
    for (const field of section.fields) {
      if (field.key === normalized) return field;
      if (normalizeText(field.label) === normalizeText(normalized)) return field;
    }
  }

  const aliases = {
    institution: "currentInstitution",
    school: "currentInstitution",
    class: "class",
    city: "adders.addressCity",
    address: "adders.addressStreet1",
    email: "email.primaryEmail",
    studentemail: "email.primaryEmail",
    fatheremail: "fatherEmail.primaryEmail",
    motheremail: "motherEmail.primaryEmail",
    phone: "phone.primaryPhoneNumber",
    studentphone: "phone.primaryPhoneNumber",
    dadphone: "dadPhone.primaryPhoneNumber",
    momphone: "momPhone.primaryPhoneNumber",
    tz: "tznum",
    tznum: "tznum",
    name: "label"
  };

  const aliasTarget = aliases[normalizedKey];
  if (!aliasTarget) return null;
  return findFieldDefinition(aliasTarget) || { key: aliasTarget, label: aliasTarget };
}

function getEnumFieldDefinitions() {
  const enumFields = [];
  for (const section of FIELD_SECTIONS) {
    for (const field of section.fields) {
      if (!field.enum) continue;
      enumFields.push({
        enumName: field.enum,
        field: field.key,
        label: field.label
      });
    }
  }
  return enumFields;
}

const ENUM_VALUE_ALIASES = {
  class: {
    Z: ["אברך", "אברכים", "אברכי כולל", "שיעור אברך", "שיעור אברכים"],
    A: ["שיעור א", "שיעור א׳", "שיעור א'", "שעור א", "ועד א"],
    B: ["שיעור ב", "שיעור ב׳", "שיעור ב'", "שעור ב", "ועד ב"],
    C: ["שיעור ג", "שיעור ג׳", "שיעור ג'", "שעור ג", "ועד ג"],
    D: ["שיעור ד", "שיעור ד׳", "שיעור ד'", "שעור ד", "ועד ד"],
    E: ["שיעור ה", "שיעור ה׳", "שיעור ה'", "שעור ה", "ועד ה"],
    X: ["קיבוץ", "קיבוץ בישיבה"],
    TEAM: ["צוות", "אנשי צוות"]
  },
  currentInstitution: {
    CY: ["חכמי ירושלים", "ישיבת חכמי ירושלים"],
    YR: ["יחי ראובן", "ישיבת יחי ראובן"],
    OE: ["אור אפרים", "ישיבת אור אפרים"],
    BOGER: ["בוגר", "בוגרים"],
    BOGERNOCONTACT: ["בוגר ללא יצירת קשר", "בוגרים ללא יצירת קשר"],
    TEST: ["טסט", "בדיקה"]
  },
  familystatus: {
    SINGLE: ["רווק", "רווקים"],
    MARRIED: ["נשוי", "נשואים"],
    DIVORCED: ["גרוש", "גרושים"],
    WIDOWED: ["אלמן", "אלמנים"]
  },
  registration: {
    MINISTRY_OF_EDUCATION: ["משרד החינוך", "חינוך", "רשום במשרד החינוך", "רשומים במשרד החינוך"],
    DATOT: ["דתות", "רשום בדתות", "רשומים בדתות"],
    NOT_ELIGIBLE: ["לא זכאי", "לא זכאים", "אינו זכאי", "אינם זכאים"],
    UPDATE_DATOT: ["לעדכן דתות", "עדכון דתות", "צריך לעדכן דתות", "סטטוס לעדכן דתות", "רשומים בסטטוס לעדכן דתות"],
    UPDATE_EDUCATION: ["לעדכן חינוך", "לעדכן משרד החינוך", "עדכון משרד החינוך", "עדכון חינוך", "סטטוס לעדכן חינוך", "רשומים בסטטוס לעדכן חינוך"]
  }
};

function enumOptionTexts(enumName, value, label) {
  return [
    value,
    label,
    ...(ENUM_VALUE_ALIASES?.[enumName]?.[value] || [])
  ].map(normalizeText).filter(Boolean);
}

function buildFirstEnumTokenPattern(token, index) {
  const escapedToken = token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  if (index !== 0) return escapedToken;
  return `ו?(?:ב|ל|כ|ה|מ)?${escapedToken}`;
}

function containsEnumPhrase(queryText, optionText) {
  const query = normalizeText(queryText);
  const option = normalizeText(optionText);
  if (!query || !option || option.length < 2) return false;
  if (query === option) return true;
  const tokens = option.split(" ").filter(Boolean);
  const escapedOption = option.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const escapedWithVav = tokens.length
    ? tokens.map((token, index) => buildFirstEnumTokenPattern(token, index)).join("\\s+")
    : escapedOption;
  return new RegExp(`(^|\\s)(?:${escapedOption}|${escapedWithVav})($|\\s)`, "u").test(query);
}

function normalizeEnumValue(enumName, rawValue) {
  const raw = clean(rawValue);
  if (!raw) return "";
  const options = ENUM_LABELS?.[enumName] || {};
  if (options[raw]) return raw;

  const rawNormalized = normalizeText(raw);
  for (const [value, label] of Object.entries(options)) {
    if (enumOptionTexts(enumName, value, label).includes(rawNormalized)) {
      return value;
    }
  }

  return raw;
}

export function normalizeChoiceFilterValue(fieldKey, rawValue) {
  const fieldDef = findFieldDefinition(fieldKey);
  if (!fieldDef?.enum) return clean(rawValue);
  return normalizeEnumValue(fieldDef.enum, rawValue);
}

export function inferEnumFiltersFromQuery(query) {
  const raw = clean(query);
  if (!raw) return [];

  const inferred = [];
  const enumFields = getEnumFieldDefinitions();
  const queryText = normalizeText(raw);

  for (const enumField of enumFields) {
    const entries = Object.entries(ENUM_LABELS[enumField.enumName] || {})
      .sort(([, leftLabel], [, rightLabel]) => normalizeText(rightLabel).length - normalizeText(leftLabel).length);

    const matchedValues = [];
    for (const [value, label] of entries) {
      const optionTexts = enumOptionTexts(enumField.enumName, value, label)
        .sort((left, right) => right.length - left.length);
      if (!queryText) continue;
      const matched = optionTexts.some((optionText) => containsEnumPhrase(queryText, optionText));
      if (matched) {
        matchedValues.push(value);
      }
    }

    if (!matchedValues.length) continue;
    inferred.push({
      field: enumField.field,
      operator: matchedValues.length > 1 ? "in" : "equals",
      value: matchedValues.length > 1 ? matchedValues : matchedValues[0]
    });
  }

  return inferred;
}

function toExportOperator(operator) {
  const raw = clean(operator).toLowerCase();
  if (raw === "starts_with") return "starts";
  if (raw === "ends_with") return "ends";
  return raw || "contains";
}

function appendFilterParams(params, filters = []) {
  for (const filter of filters) {
    const field = clean(filter?.field);
    const operator = toExportOperator(filter?.operator);
    const values = Array.isArray(filter?.value)
      ? filter.value.map((item) => clean(item)).filter(Boolean)
      : [clean(filter?.value)].filter(Boolean);
    const value = values[0] || "";

    if (field === "currentInstitution" && (operator === "equals" || operator === "in") && values.length) {
      params.delete("institution");
      values.forEach((item) => params.append("institution", item));
      continue;
    }
    if (field === "class" && (operator === "equals" || operator === "in") && values.length) {
      params.delete("quickClass");
      values.forEach((item) => params.append("quickClass", item));
      continue;
    }
    if (field === "registration" && (operator === "equals" || operator === "in") && values.length) {
      params.delete("quickRegistration");
      values.forEach((item) => params.append("quickRegistration", item));
      continue;
    }
    if ((field === "famliystatus" || field === "familystatus") && (operator === "equals" || operator === "in") && values.length) {
      params.delete("quickFamilyStatus");
      values.forEach((item) => params.append("quickFamilyStatus", item));
      continue;
    }

    const exportField = ["institution", "class", "registration", "missing"].includes(field)
      ? field
      : `field:${field}`;
    if (operator === "in" && values.length) {
      values.forEach((item, index) => {
        params.append("ff", exportField);
        params.append("fo", "equals");
        params.append("fv", item);
        params.append("fj", "AND");
        params.append("fg", `group-in-${field}`);
        params.append("gj", index === values.length - 1 ? "AND" : "OR");
      });
      continue;
    }
    params.append("ff", exportField);
    params.append("fo", operator);
    params.append("fv", value);
    params.append("fj", "AND");
    params.append("fg", "group-1");
    params.append("gj", "AND");
  }

  return params;
}

function compareValues(actual, operator, expected) {
  const left = normalizeText(actual);
  const right = Array.isArray(expected) ? expected.map((item) => normalizeText(item)).filter(Boolean) : normalizeText(expected);

  if (operator === "empty") return !left;
  if (operator === "not_empty") return Boolean(left);
  if (operator === "in") {
    return Array.isArray(right) ? right.includes(left) : left === right;
  }
  if (!left) return false;
  if (operator === "equals") return left === right;
  if (operator === "starts_with") return left.startsWith(right);
  if (operator === "ends_with") return left.endsWith(right);
  return left.includes(right);
}

function extractComparableValue(student, fieldDef) {
  if (!fieldDef?.key) return "";
  if (fieldDef.key === "label") return clean(student?.label);
  return getByPath(student, fieldDef.key);
}

function filterStudent(student, rawFilter) {
  const fieldDef = findFieldDefinition(rawFilter?.field);
  if (!fieldDef?.key) return true;

  const operator = clean(rawFilter?.operator || "contains").toLowerCase();
  const actual = extractComparableValue(student, fieldDef);
  const expected = Array.isArray(rawFilter?.value)
    ? rawFilter.value.map((value) => fieldDef.enum ? normalizeEnumValue(fieldDef.enum, value) : value)
    : (fieldDef.enum ? normalizeEnumValue(fieldDef.enum, rawFilter?.value) : rawFilter?.value);

  if (Array.isArray(actual)) {
    return actual.some((item) => compareValues(item, operator, expected));
  }

  if (fieldDef.enum) {
    if (compareValues(actual, operator, expected)) return true;
    return compareValues(enumLabel(fieldDef.enum, actual), operator, rawFilter?.value);
  }

  return compareValues(actual, operator, expected);
}

export function buildStudentCardUrl(studentId) {
  const id = encodeURIComponent(clean(studentId));
  return `/neon/students/${id}`;
}

function getFieldDisplayLabel(fieldKey) {
  const fieldDef = findFieldDefinition(fieldKey);
  if (fieldDef?.label) return fieldDef.label;
  if (fieldKey === "label") return "שם";
  return fieldKey;
}

export function buildStudentSummary(student) {
  if (!student?.id) return null;
  const storedAge = Number(student?.ageYears);
  const resolvedAge = Number.isFinite(storedAge) && storedAge >= 0 ? storedAge : ageOf(student?.dateofbirth);
  return {
    id: student.id,
    name: clean(student.label) || clean(student.name) || "ללא שם",
    studentCardUrl: buildStudentCardUrl(student.id),
    age: Number.isFinite(resolvedAge) ? resolvedAge : null,
    tznum: clean(student?.tznum) || null,
    currentInstitution: clean(student?.currentInstitution) || null,
    currentInstitutionLabel: clean(student?.currentInstitution) ? enumLabel("currentInstitution", student.currentInstitution) : null,
    class: clean(student?.class) || null,
    classLabel: clean(student?.class) ? enumLabel("class", student.class) : null,
    registration: clean(student?.registration) || null,
    registrationLabel: clean(student?.registration) ? enumLabel("registration", student.registration) : null,
    city: clean(student?.adders?.addressCity) || null,
    addressStreet1: clean(student?.adders?.addressStreet1) || null,
    primaryEmail: clean(student?.email?.primaryEmail) || null,
    fatherEmail: clean(student?.fatherEmail?.primaryEmail) || null,
    motherEmail: clean(student?.motherEmail?.primaryEmail) || null,
    studentPhone: phoneText(student?.phone) || null,
    dadPhone: phoneText(student?.dadPhone) || null,
    momPhone: phoneText(student?.momPhone) || null,
    matchScore: Number.isFinite(Number(student?._matchScore)) ? Number(student._matchScore) : null
  };
}

export function buildStudentCardLines(summary) {
  const student = summary || {};
  const lines = [clean(student.name) || "ללא שם"];

  const identityRow = [
    Number.isFinite(Number(student.age)) ? `גיל: ${Number(student.age)}` : "",
    clean(student.tznum) ? `ת"ז: ${clean(student.tznum)}` : ""
  ].filter(Boolean).join(" | ");
  if (identityRow) lines.push(identityRow);

  if (clean(student.studentPhone)) lines.push(`טלפון תלמיד: ${clean(student.studentPhone)}`);
  if (clean(student.dadPhone)) lines.push(`טלפון אב: ${clean(student.dadPhone)}`);
  if (clean(student.momPhone)) lines.push(`טלפון אם: ${clean(student.momPhone)}`);

  return lines;
}

function findRelevantFieldsForQuery(student, query = "", maxFields = 6) {
  const normalizedQuery = normalizeText(query);
  const fields = [];

  const alwaysUsefulFields = [
    "fullName.firstName",
    "fullName.lastName",
    "tznum",
    "currentInstitution",
    "class",
    "registration",
    "adders.addressCity",
    "adders.addressStreet1",
    "email.primaryEmail",
    "phone.primaryPhoneNumber"
  ];

  for (const fieldKey of alwaysUsefulFields) {
    const fieldDef = findFieldDefinition(fieldKey);
    if (!fieldDef) continue;
    const displayValue = formatFieldValue(student, fieldKey);
    if (!displayValue || displayValue === "-") continue;
    const comparable = normalizeText(displayValue);
    const score = !normalizedQuery
      ? 0.1
      : comparable.includes(normalizedQuery) || normalizedQuery.includes(comparable)
        ? 1
        : 0;
    fields.push({
      field: fieldKey,
      label: fieldDef.label,
      displayValue,
      score
    });
  }

  return fields
    .sort((left, right) => right.score - left.score || left.label.localeCompare(right.label, "he"))
    .slice(0, maxFields)
    .map(({ score, ...field }) => field);
}

export function getStudentSchemaCatalog() {
  return FIELD_SECTIONS.map((section) => ({
    title: section.title,
    fields: section.fields.map((field) => ({
      key: field.key,
      label: field.label,
      type: field.type || (field.isList ? "list" : "string"),
      enumName: field.enum || null,
      enumOptions: field.enum
        ? Object.entries(ENUM_LABELS[field.enum] || {}).map(([value, label]) => ({ value, label }))
        : []
    }))
  }));
}

export async function findStudentsForAgent({ query = "", filters = [], minScore = 0.4 } = {}) {
  const normalizedQuery = normalizeSearchQuery(query);
  const safeFilters = Array.isArray(filters) ? filters.filter((item) => item && typeof item === "object") : [];
  const inferredFilters = inferEnumFiltersFromQuery(query);
  const effectiveFilters = [...safeFilters];

  for (const inferredFilter of inferredFilters) {
    const alreadyExists = effectiveFilters.some((filter) => clean(filter?.field) === inferredFilter.field);
    if (!alreadyExists) effectiveFilters.push(inferredFilter);
  }

  let students;
  if (effectiveFilters.length) {
    students = await listAllNeonStudents();
  } else if (clean(normalizedQuery)) {
    students = await searchNeonStudents({ q: normalizedQuery, minScore });
  } else {
    students = await listAllNeonStudents();
  }

  const filtered = effectiveFilters.length
    ? students.filter((student) => effectiveFilters.every((filter) => filterStudent(student, filter)))
    : students;

  return {
    students: filtered,
    effectiveFilters
  };
}

export function buildExportUrlForFilters(filters = [], options = {}) {
  const missingType = clean(options?.missingType).toLowerCase();
  const params = new URLSearchParams();
  params.set("source", "neon");
  params.append("cols", "name");
  params.append("cols", "tznum");
  params.append("cols", "field:dateofbirth");
  if (["contact", "identity"].includes(missingType)) {
    params.set("missingType", missingType);
  }
  appendFilterParams(params, filters);
  return `/api/export/institution?${params.toString()}`;
}

export function buildInstitutionPdfUrlForFilters(filters = [], options = {}) {
  const missingType = clean(options?.missingType).toLowerCase();
  const params = new URLSearchParams();
  params.set("source", "neon");
  params.append("cols", "name");
  params.append("cols", "tznum");
  params.append("cols", "field:dateofbirth");
  if (["contact", "identity"].includes(missingType)) {
    params.set("missingType", missingType);
  }
  appendFilterParams(params, filters);
  return `/api/export/institution-pdf?${params.toString()}`;
}

export function buildNeonViewUrlForAgent({ query = "", filters = [], missingType = "" } = {}) {
  const params = new URLSearchParams();
  const safeFilters = Array.isArray(filters) ? filters : [];
  const normalizedQuery = normalizeSearchQuery(query);
  const normalizedMissingType = clean(missingType).toLowerCase();

  if (safeFilters.length) {
    params.set("mode", "institution");
    if (["contact", "identity"].includes(normalizedMissingType)) {
      params.set("missingType", normalizedMissingType);
    }
    for (const filter of safeFilters) {
      const field = clean(filter?.field);
      const operator = toExportOperator(filter?.operator);
      const values = Array.isArray(filter?.value)
        ? filter.value.map((item) => clean(item)).filter(Boolean)
        : [clean(filter?.value)].filter(Boolean);
      const value = values[0] || "";

      if (field === "currentInstitution" && (operator === "equals" || operator === "in") && values.length) {
        params.delete("institution");
        values.forEach((item) => params.append("institution", item));
        continue;
      }
      if (field === "class" && (operator === "equals" || operator === "in") && values.length) {
        params.delete("quickClass");
        values.forEach((item) => params.append("quickClass", item));
        continue;
      }
      if (field === "registration" && (operator === "equals" || operator === "in") && values.length) {
        params.delete("quickRegistration");
        values.forEach((item) => params.append("quickRegistration", item));
        continue;
      }
      if (field === "famliystatus" && (operator === "equals" || operator === "in") && values.length) {
        params.delete("quickFamilyStatus");
        values.forEach((item) => params.append("quickFamilyStatus", item));
        continue;
      }

      const viewField = ["institution", "class", "registration", "missing"].includes(field)
        ? field
        : `field:${field}`;
      if (operator === "in" && values.length) {
        values.forEach((item, index) => {
          params.append("ff", viewField);
          params.append("fo", "equals");
          params.append("fv", item);
          params.append("fj", "AND");
          params.append("fg", `group-in-${field}`);
          params.append("gj", index === values.length - 1 ? "AND" : "OR");
        });
        continue;
      }
      params.append("ff", viewField);
      params.append("fo", operator);
      params.append("fv", value);
      params.append("fj", "AND");
      params.append("fg", "group-1");
      params.append("gj", "AND");
    }
  } else if (normalizedQuery) {
    params.set("mode", "search");
    params.set("q", normalizedQuery);
  } else if (["contact", "identity"].includes(normalizedMissingType)) {
    params.set("mode", "institution");
    params.set("missingType", normalizedMissingType);
  } else {
    return "/neon";
  }

  return `/neon?${params.toString()}`;
}

export function describeAgentFilters(filters = []) {
  const safeFilters = Array.isArray(filters) ? filters : [];
  return safeFilters.map((filter) => {
    const fieldKey = clean(filter?.field);
    const fieldDef = findFieldDefinition(fieldKey);
    const operator = clean(filter?.operator || "equals");
    const rawValue = clean(filter?.value);
    const displayValue = fieldDef?.enum ? enumLabel(fieldDef.enum, normalizeEnumValue(fieldDef.enum, rawValue)) : rawValue;
    const operatorLabel = {
      equals: "שווה ל",
      in: "אחד מתוך",
      contains: "מכיל",
      starts_with: "מתחיל ב",
      ends_with: "מסתיים ב",
      empty: "ריק",
      not_empty: "לא ריק"
    }[operator] || operator;

    if (operator === "empty" || operator === "not_empty") {
      return `${getFieldDisplayLabel(fieldKey)} ${operatorLabel}`;
    }

    if (operator === "in" && Array.isArray(filter?.value)) {
      const joined = filter.value
        .map((item) => fieldDef?.enum ? enumLabel(fieldDef.enum, normalizeEnumValue(fieldDef.enum, item)) : clean(item))
        .filter(Boolean)
        .join(" / ");
      return `${getFieldDisplayLabel(fieldKey)} ${operatorLabel} ${joined}`;
    }

    return `${getFieldDisplayLabel(fieldKey)} ${operatorLabel} ${displayValue}`;
  });
}

export async function searchStudentsForAgent({ query = "", filters = [], limit = 10, minScore = 0.4 } = {}) {
  const normalizedLimit = Math.max(1, Math.min(Number(limit) || 10, 200));
  const { students } = await findStudentsForAgent({ query, filters, minScore });

  return students.slice(0, normalizedLimit).map((student) => {
    return {
      summary: buildStudentSummary(student),
      matchedFields: findRelevantFieldsForQuery(student, query),
      missing: buildMissingState(student)
    };
  });
}

export async function getStudentForAgent(studentId) {
  const student = await getNeonStudentById(studentId);
  if (!student) return null;

  const fields = {};
  for (const section of FIELD_SECTIONS) {
    for (const field of section.fields) {
      const value = getByPath(student, field.key);
      if (value === null || value === undefined || value === "") continue;
      fields[field.key] = {
        label: field.label,
        value,
        displayValue: formatFieldValue(student, field.key)
      };
    }
  }

  return {
    summary: buildStudentSummary(student),
    fields
  };
}

export async function findStudentsMissingDataForAgent({ type = "contact", query = "", filters = [], limit = 20 } = {}) {
  const normalizedLimit = Math.max(1, Math.min(Number(limit) || 20, 200));
  const { students, effectiveFilters } = await findStudentsForAgent({ query, filters, minScore: 0.4 });
  const filtered = students.filter((student) => buildMissingState(student)?.flags?.[type]);

  return {
    count: filtered.length,
    students: filtered.slice(0, normalizedLimit).map((student) => buildStudentSummary(student)),
    effectiveFilters
  };
}
