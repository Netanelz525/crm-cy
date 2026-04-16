import { ENUM_LABELS, FIELD_SECTIONS, getByPath } from "./student-fields";
import { enumLabel, formatFieldValue } from "./student-view";
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
    Z: ["אברך", "אברכים", "אברכי כולל"],
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
  }
};

function enumOptionTexts(enumName, value, label) {
  return [
    value,
    label,
    ...(ENUM_VALUE_ALIASES?.[enumName]?.[value] || [])
  ].map(normalizeText).filter(Boolean);
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

    for (const [value, label] of entries) {
      const optionTexts = enumOptionTexts(enumField.enumName, value, label)
        .sort((left, right) => right.length - left.length);
      if (!queryText) continue;
      const matched = optionTexts.some((optionText) => {
        const optionMentioned = optionText.length >= 2 && (queryText === optionText || queryText.includes(optionText));
        const codeMentioned = optionText.length >= 2 && new RegExp(`(^|\\s)${optionText.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}($|\\s)`).test(queryText);
        return optionMentioned || codeMentioned;
      });
      if (matched) {
        inferred.push({
          field: enumField.field,
          operator: "equals",
          value
        });
        break;
      }
    }
  }

  return inferred;
}

function toExportOperator(operator) {
  const raw = clean(operator).toLowerCase();
  if (raw === "starts_with") return "starts";
  if (raw === "ends_with") return "ends";
  return raw || "contains";
}

function compareValues(actual, operator, expected) {
  const left = normalizeText(actual);
  const right = normalizeText(expected);

  if (operator === "empty") return !left;
  if (operator === "not_empty") return Boolean(left);
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
  const expected = fieldDef.enum ? normalizeEnumValue(fieldDef.enum, rawFilter?.value) : rawFilter?.value;

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

export function buildStudentSummary(student) {
  if (!student?.id) return null;
  return {
    id: student.id,
    name: clean(student.label) || clean(student.name) || "ללא שם",
    studentCardUrl: buildStudentCardUrl(student.id),
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
    studentPhone: clean(student?.phone?.primaryPhoneNumber) || null,
    dadPhone: clean(student?.dadPhone?.primaryPhoneNumber) || null,
    momPhone: clean(student?.momPhone?.primaryPhoneNumber) || null,
    matchScore: Number.isFinite(Number(student?._matchScore)) ? Number(student._matchScore) : null
  };
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

export function buildExportUrlForFilters(filters = []) {
  const params = new URLSearchParams();
  params.set("source", "neon");
  params.append("cols", "name");
  params.append("cols", "tznum");
  params.append("cols", "field:dateofbirth");

  for (const filter of filters) {
    const field = clean(filter?.field);
    const operator = toExportOperator(filter?.operator);
    const value = clean(filter?.value);

    if (field === "currentInstitution" && operator === "equals" && value) {
      params.set("institution", value);
      continue;
    }
    if (field === "class" && operator === "equals" && value) {
      params.set("quickClass", value);
      continue;
    }
    if (field === "registration" && operator === "equals" && value) {
      params.set("quickRegistration", value);
      continue;
    }
    if (field === "famliystatus" && operator === "equals" && value) {
      params.set("quickFamilyStatus", value);
      continue;
    }

    const exportField = ["institution", "class", "registration", "missing"].includes(field)
      ? field
      : `field:${field}`;
    params.append("ff", exportField);
    params.append("fo", operator);
    params.append("fv", value);
    params.append("fj", "AND");
    params.append("fg", "group-1");
    params.append("gj", "AND");
  }

  return `/api/export/institution?${params.toString()}`;
}

export function buildNeonViewUrlForAgent({ query = "", filters = [] } = {}) {
  const params = new URLSearchParams();
  const safeFilters = Array.isArray(filters) ? filters : [];
  const normalizedQuery = normalizeSearchQuery(query);

  if (safeFilters.length) {
    params.set("mode", "institution");
    for (const filter of safeFilters) {
      const field = clean(filter?.field);
      const operator = toExportOperator(filter?.operator);
      const value = clean(filter?.value);

      if (field === "currentInstitution" && operator === "equals" && value) {
        params.set("institution", value);
        continue;
      }
      if (field === "class" && operator === "equals" && value) {
        params.set("quickClass", value);
        continue;
      }
      if (field === "registration" && operator === "equals" && value) {
        params.set("quickRegistration", value);
        continue;
      }
      if (field === "famliystatus" && operator === "equals" && value) {
        params.set("quickFamilyStatus", value);
        continue;
      }

      const viewField = ["institution", "class", "registration", "missing"].includes(field)
        ? field
        : `field:${field}`;
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
  } else {
    return "/neon";
  }

  return `/neon?${params.toString()}`;
}

export async function searchStudentsForAgent({ query = "", filters = [], limit = 10, minScore = 0.4 } = {}) {
  const normalizedLimit = Math.max(1, Math.min(Number(limit) || 10, 200));
  const { students } = await findStudentsForAgent({ query, filters, minScore });

  return students.slice(0, normalizedLimit).map((student) => {
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
