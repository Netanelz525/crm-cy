import { ENUM_LABELS, FIELD_SECTIONS, getByPath } from "./student-fields";

export const INSTITUTIONS = {
  YR: "יחי ראובן",
  OE: "אור אפרים",
  CY: "חכמי ירושלים",
  BOGER: "בוגר",
  BOGERNCONTACT: "בוגר ללא יצירת קשר",
  TEST: "טסט"
};

export const CLASS_LABELS = {
  Z: "אברך",
  A: "שיעור א",
  B: "שיעור ב",
  C: "שיעור ג",
  D: "שיעור ד",
  E: "שיעור ה",
  X: "קיבוץ",
  TEAM: "צוות"
};

export const CLASS_ORDER = {
  A: 1,
  B: 2,
  C: 3,
  D: 4,
  E: 5,
  X: 6,
  Z: 7,
  TEAM: 8
};

export const INSTITUTION_COLUMNS = [
  { key: "name", label: "שם", defaultSelected: true },
  { key: "class", label: "שיעור", defaultSelected: true },
  { key: "tznum", label: 'ת"ז', defaultSelected: true },
  { key: "age", label: "גיל", defaultSelected: true },
  { key: "studentPhone", label: "טלפון תלמיד", defaultSelected: true },
  { key: "dadPhone", label: "טלפון אב", defaultSelected: true },
  { key: "momPhone", label: "טלפון אם", defaultSelected: true },
  { key: "studentEmail", label: "אימייל תלמיד", defaultSelected: false },
  { key: "fatherEmail", label: "אימייל אב", defaultSelected: false },
  { key: "motherEmail", label: "אימייל אם", defaultSelected: false },
  { key: "institution", label: "מוסד", defaultSelected: false },
  { key: "registration", label: "רישום", defaultSelected: false },
  { key: "macAddress", label: "macAddress", defaultSelected: false },
  { key: "missing", label: "חוסרים", defaultSelected: true }
];

export const SYSTEM_FIELDS = FIELD_SECTIONS.flatMap((section) => section.fields);
export const FIELD_DEF_MAP = Object.fromEntries(SYSTEM_FIELDS.map((field) => [field.key, field]));
export const SYSTEM_FIELD_COLUMNS = SYSTEM_FIELDS.map((field) => ({
  key: `field:${field.key}`,
  label: field.label,
  defaultSelected: false
}));

export const INSTITUTION_COLUMNS_FULL = [
  ...INSTITUTION_COLUMNS,
  ...SYSTEM_FIELD_COLUMNS.filter((col) => !INSTITUTION_COLUMNS.some((base) => base.key === col.key))
];

export const INSTITUTION_COLUMN_MAP = Object.fromEntries(INSTITUTION_COLUMNS_FULL.map((c) => [c.key, c]));
export const DEFAULT_INSTITUTION_COLUMN_KEYS = INSTITUTION_COLUMNS_FULL.filter((c) => c.defaultSelected).map((c) => c.key);

export const FILTER_OPERATORS = {
  contains: "מכיל",
  equals: "שווה ל",
  starts: "מתחיל ב",
  ends: "מסתיים ב",
  empty: "ריק",
  not_empty: "לא ריק"
};

export const FILTERABLE_FIELDS = [
  { key: "name", label: "שם" },
  { key: "class", label: "שיעור" },
  { key: "tznum", label: 'ת"ז' },
  { key: "age", label: "גיל" },
  { key: "studentPhone", label: "טלפון תלמיד" },
  { key: "dadPhone", label: "טלפון אב" },
  { key: "momPhone", label: "טלפון אם" },
  { key: "studentEmail", label: "אימייל תלמיד" },
  { key: "fatherEmail", label: "אימייל אב" },
  { key: "motherEmail", label: "אימייל אם" },
  { key: "institution", label: "מוסד" },
  { key: "registration", label: "רישום" },
  { key: "missing", label: "חוסרים" },
  ...SYSTEM_FIELD_COLUMNS
];

export const SORT_OPTIONS = [
  { key: "name", label: "שם" },
  { key: "class", label: "שיעור" },
  { key: "tznum", label: 'ת"ז' },
  { key: "age", label: "גיל" },
  { key: "institution", label: "מוסד" },
  { key: "registration", label: "רישום" },
  { key: "missing", label: "חוסרים" },
  ...SYSTEM_FIELD_COLUMNS
];

function enumOptions(enumName) {
  return Object.values(ENUM_LABELS?.[enumName] || {}).map((label) => ({ value: label, label }));
}

export const FILTER_VALUE_OPTIONS = {
  class: enumOptions("class"),
  institution: enumOptions("currentInstitution"),
  registration: enumOptions("registration"),
  "field:class": enumOptions("class"),
  "field:currentInstitution": enumOptions("currentInstitution"),
  "field:registration": enumOptions("registration"),
  "field:healthInsurance": enumOptions("healthInsurance"),
  "field:famliystatus": enumOptions("familystatus")
};

export function clean(v) {
  return String(v || "").trim();
}

export function normalizeDigits(v) {
  return clean(v).replace(/[^\d]/g, "");
}

export function parseListParam(value) {
  if (Array.isArray(value)) return value.map(clean).filter(Boolean);
  const raw = clean(value);
  if (!raw) return [];
  if (raw.includes(",")) return raw.split(",").map(clean).filter(Boolean);
  return [raw];
}

export function parseSortLevels(params) {
  const sortBys = parseListParam(params?.sby);
  const sortDirs = parseListParam(params?.sdir);

  if (sortBys.length) {
    return sortBys.map((sortBy, index) => ({
      sortBy: clean(sortBy) || "class",
      sortDir: clean(sortDirs[index]).toLowerCase() === "desc" ? "desc" : "asc"
    })).filter((item) => item.sortBy);
  }

  const fallbackSortBy = clean(params?.sortBy) || "class";
  const fallbackSortDir = clean(params?.sortDir).toLowerCase() === "desc" ? "desc" : "asc";
  return [{ sortBy: fallbackSortBy, sortDir: fallbackSortDir }];
}

function hasPhone(obj) {
  return Boolean(clean(obj?.primaryPhoneNumber));
}

function hasEmail(obj) {
  return Boolean(clean(obj?.primaryEmail));
}

function hasCompleteParentContact(student) {
  const dadComplete = hasPhone(student?.dadPhone) && hasEmail(student?.fatherEmail);
  const momComplete = hasPhone(student?.momPhone) && hasEmail(student?.motherEmail);
  return dadComplete || momComplete;
}

export function buildMissingState(student) {
  const hasContactMissing = !hasCompleteParentContact(student);
  const hasIdentityMissing = !clean(student?.tznum) || !clean(student?.dateofbirth);
  const items = [];
  if (hasContactMissing) items.push("חסר הורה עם טלפון+אימייל");
  if (hasIdentityMissing) items.push('חסר ת"ז או תאריך לידה');
  return {
    items,
    flags: {
      contact: hasContactMissing,
      identity: hasIdentityMissing
    }
  };
}

export function matchesMissingFilter(missingState, missingType) {
  if (!missingType) return true;
  return Boolean(missingState?.flags?.[missingType]);
}

export function phoneText(phoneObj) {
  if (!phoneObj?.primaryPhoneNumber) return "-";
  return [clean(phoneObj.primaryPhoneCallingCode), clean(phoneObj.primaryPhoneNumber)].filter(Boolean).join(" ");
}

export function phoneHref(phoneObj) {
  const number = normalizeDigits(phoneObj?.primaryPhoneNumber);
  if (!number) return "";
  const calling = clean(phoneObj?.primaryPhoneCallingCode).replace(/[^\d+]/g, "");
  const prefix = calling || "+";
  return `tel:${prefix}${number}`.replace(/\s+/g, "");
}

export function ageOf(dateValue) {
  if (!dateValue) return null;
  const d = new Date(dateValue);
  if (Number.isNaN(d.getTime())) return null;
  const now = new Date();
  let age = now.getFullYear() - d.getFullYear();
  const m = now.getMonth() - d.getMonth();
  const day = now.getDate() - d.getDate();
  if (m < 0 || (m === 0 && day < 0)) age -= 1;
  return age >= 0 ? age : null;
}

export function getLastName(student) {
  const fromFullName = clean(student?.fullName?.lastName);
  if (fromFullName) return fromFullName;
  const label = clean(student?.label);
  if (!label) return "";
  const parts = label.split(/\s+/).filter(Boolean);
  return clean(parts[parts.length - 1]);
}

export function classLabel(value) {
  const key = clean(value).toUpperCase();
  return CLASS_LABELS[key] || (value || "-");
}

export function enumLabel(enumName, value) {
  const key = clean(value);
  if (!key) return "-";
  return ENUM_LABELS?.[enumName]?.[key] || key;
}

export function formatDate(value) {
  const raw = clean(value);
  if (!raw) return "-";
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return raw;
  return d.toLocaleDateString("he-IL");
}

export function formatFieldValue(student, fieldKey) {
  const fieldDef = FIELD_DEF_MAP[fieldKey];
  if (!fieldDef) return "-";
  const raw = getByPath(student, fieldKey);
  if (raw === null || raw === undefined || raw === "") return "-";

  if (fieldDef.key.endsWith(".primaryPhoneNumber")) {
    const phoneRoot = fieldDef.key.slice(0, -".primaryPhoneNumber".length);
    const number = clean(raw);
    const calling = clean(getByPath(student, `${phoneRoot}.primaryPhoneCallingCode`));
    return [calling, number].filter(Boolean).join(" ") || number || "-";
  }

  if (fieldDef.isList) {
    if (!Array.isArray(raw) || raw.length === 0) return "-";
    return raw.map((v) => clean(v)).filter(Boolean).join(", ") || "-";
  }

  if (fieldDef.type === "date") return formatDate(raw);
  if (fieldDef.enum) return enumLabel(fieldDef.enum, raw);
  if (typeof raw === "object") return JSON.stringify(raw);
  return clean(raw) || "-";
}

export function columnText(student, columnKey) {
  if (columnKey.startsWith("field:")) {
    return formatFieldValue(student, columnKey.slice("field:".length));
  }

  switch (columnKey) {
    case "name":
      return clean(student?.label) || "-";
    case "class":
      return classLabel(student?.class);
    case "tznum":
      return clean(student?.tznum) || "-";
    case "age":
      return String(ageOf(student?.dateofbirth) ?? "-");
    case "studentPhone":
      return phoneText(student?.phone);
    case "dadPhone":
      return phoneText(student?.dadPhone);
    case "momPhone":
      return phoneText(student?.momPhone);
    case "studentEmail":
      return clean(student?.email?.primaryEmail) || "-";
    case "fatherEmail":
      return clean(student?.fatherEmail?.primaryEmail) || "-";
    case "motherEmail":
      return clean(student?.motherEmail?.primaryEmail) || "-";
    case "institution":
      return enumLabel("currentInstitution", student?.currentInstitution);
    case "registration":
      return enumLabel("registration", student?.registration);
    case "macAddress":
      return clean(student?.macAddress) || "-";
    case "missing":
      return (student?.missingItems || []).length ? student.missingItems.join(", ") : "-";
    default:
      return "-";
  }
}

function comparableValue(student, sortBy) {
  if (sortBy === "class") return CLASS_ORDER[clean(student?.class).toUpperCase()] ?? 999;
  if (sortBy === "age") return ageOf(student?.dateofbirth) ?? -1;
  if (sortBy === "missing") return Array.isArray(student?.missingItems) ? student.missingItems.length : 0;
  return clean(columnText(student, sortBy)).toLowerCase();
}

function compareSingleSort(a, b, sortBy, sortDir = "asc") {
  const direction = clean(sortDir).toLowerCase() === "desc" ? -1 : 1;
  const nextSortBy = clean(sortBy) || "class";

  if (!sortBy || nextSortBy === "class") {
    const aRank = CLASS_ORDER[clean(a.class).toUpperCase()] ?? 999;
    const bRank = CLASS_ORDER[clean(b.class).toUpperCase()] ?? 999;
    if (aRank !== bRank) return (aRank - bRank) * direction;
    const lastCmp = getLastName(a).localeCompare(getLastName(b), "he", { sensitivity: "base" });
    if (lastCmp !== 0) return lastCmp * direction;
    return clean(a.label).localeCompare(clean(b.label), "he", { sensitivity: "base" }) * direction;
  }

  const av = comparableValue(a, nextSortBy);
  const bv = comparableValue(b, nextSortBy);
  if (typeof av === "number" && typeof bv === "number") {
    if (av !== bv) return (av - bv) * direction;
  } else {
    const cmp = String(av).localeCompare(String(bv), "he", { sensitivity: "base", numeric: true });
    if (cmp !== 0) return cmp * direction;
  }

  return 0;
}

export function sortStudents(students, sortInput, sortDir = "asc") {
  const levels = Array.isArray(sortInput)
    ? sortInput.filter((item) => clean(item?.sortBy)).map((item) => ({ sortBy: clean(item.sortBy), sortDir: clean(item.sortDir).toLowerCase() === "desc" ? "desc" : "asc" }))
    : [{ sortBy: clean(sortInput) || "class", sortDir: clean(sortDir).toLowerCase() === "desc" ? "desc" : "asc" }];

  const effectiveLevels = levels.length ? levels : [{ sortBy: "class", sortDir: "asc" }];

  return [...students].sort((a, b) => {
    for (const level of effectiveLevels) {
      const cmp = compareSingleSort(a, b, level.sortBy, level.sortDir);
      if (cmp !== 0) return cmp;
    }

    const lastCmp = getLastName(a).localeCompare(getLastName(b), "he", { sensitivity: "base" });
    if (lastCmp !== 0) return lastCmp;
    return clean(a.label).localeCompare(clean(b.label), "he", { sensitivity: "base" });
  });
}

export function parseAdvancedFilters(params) {
  const fields = Array.isArray(params?.ff) ? params.ff : [params?.ff];
  const operators = Array.isArray(params?.fo) ? params.fo : [params?.fo];
  const values = Array.isArray(params?.fv) ? params.fv : [params?.fv];
  const joins = Array.isArray(params?.fj) ? params.fj : [params?.fj];
  const groups = Array.isArray(params?.fg) ? params.fg : [params?.fg];
  const groupJoiners = Array.isArray(params?.gj) ? params.gj : [params?.gj];

  return Array.from({ length: Math.max(fields.length, operators.length, values.length, joins.length, groups.length, groupJoiners.length, 0) })
    .map((_, index) => ({
      joiner: clean(joins[index]).toUpperCase() === "OR" ? "OR" : "AND",
      field: clean(fields[index]),
      operator: clean(operators[index]) || "contains",
      value: clean(values[index]),
      groupId: clean(groups[index]) || "group-1",
      groupJoiner: clean(groupJoiners[index]).toUpperCase() === "OR" ? "OR" : "AND"
    }))
    .filter((item) => item.field && (["empty", "not_empty"].includes(item.operator) || item.value));
}

export function groupAdvancedFilters(filters) {
  const orderedGroups = [];
  const groupMap = new Map();

  filters.forEach((filter) => {
    const groupId = clean(filter.groupId) || "group-1";
    if (!groupMap.has(groupId)) {
      const nextGroup = {
        id: groupId,
        groupJoiner: clean(filter.groupJoiner).toUpperCase() === "OR" ? "OR" : "AND",
        filters: []
      };
      groupMap.set(groupId, nextGroup);
      orderedGroups.push(nextGroup);
    }

    groupMap.get(groupId).filters.push({
      ...filter,
      groupId
    });
  });

  return orderedGroups;
}

function matchesOperator(value, operator, expected) {
  const left = clean(value).toLowerCase();
  const right = clean(expected).toLowerCase();
  if (operator === "empty") return !left || left === "-";
  if (operator === "not_empty") return Boolean(left && left !== "-");
  if (!left) return false;
  if (operator === "equals") return left === right;
  if (operator === "starts") return left.startsWith(right);
  if (operator === "ends") return left.endsWith(right);
  return left.includes(right);
}

export function applyAdvancedFilters(students, filters) {
  if (!filters.length) return students;
  const groups = groupAdvancedFilters(filters);

  return students.filter((student) => {
    let finalResult = null;

    for (let groupIndex = 0; groupIndex < groups.length; groupIndex += 1) {
      const group = groups[groupIndex];
      let groupResult = null;

      for (let filterIndex = 0; filterIndex < group.filters.length; filterIndex += 1) {
        const filter = group.filters[filterIndex];
        const matches = matchesOperator(columnText(student, filter.field), filter.operator, filter.value);
        if (groupResult === null) {
          groupResult = matches;
          continue;
        }

        groupResult = filter.joiner === "OR" ? (groupResult || matches) : (groupResult && matches);
      }

      if (finalResult === null) {
        finalResult = groupResult;
        continue;
      }

      finalResult = group.groupJoiner === "OR" ? (finalResult || groupResult) : (finalResult && groupResult);
    }

    return Boolean(finalResult);
  });
}

export function findInstitutionCode(value) {
  const normalized = clean(value).toLowerCase();
  if (!normalized) return "";
  for (const [code, label] of Object.entries(INSTITUTIONS)) {
    if (clean(code).toLowerCase() === normalized || clean(label).toLowerCase() === normalized) return code;
  }
  return "";
}

export function sanitizeQueryString(rawQueryString) {
  const params = new URLSearchParams(clean(rawQueryString));
  ["saved", "updated", "deleted", "savedViewId"].forEach((key) => params.delete(key));
  return params.toString();
}

export { getByPath };


