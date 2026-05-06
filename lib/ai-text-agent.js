import {
  createAiChatMessage,
  listRecentAiChatMessagesByUser,
  getAiChatMessageById,
  clearAiChatMessagePendingAction
} from "./ai-chat-history";
import { createStudentDocumentFromStoredObject } from "./student-documents";
import { getStudentDocumentsStats } from "./student-documents";
import { createNeonStudentViaTwenty, updateNeonStudentViaTwenty } from "./neon-students";
import { FIELD_SECTIONS, normalizeStudentInput } from "./student-fields";
import {
  buildStudentSummary,
  buildExportUrlForFilters,
  buildInstitutionPdfUrlForFilters,
  buildNeonViewUrlForAgent,
  describeAgentFilters,
  findStudentsForAgent,
  findStudentsMissingDataForAgent,
  getStudentForAgent,
  getStudentSchemaCatalog,
  inferEnumFiltersFromQuery,
  searchStudentsForAgent
} from "./student-agent";

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const OPENAI_MODEL = process.env.OPENAI_MODEL || "gpt-4.1-mini";
export const CRM_SCOPE_MESSAGE = "אני כאן כדי לעזור רק בנושאי ה-CRM: תלמידים, שדות, סטטוסים, מסמכים ופעולות עבודה במערכת. אם תרצה, אפשר פשוט לנסח את השאלה מחדש בהקשר של תלמידים או CRM.";
const CONVERSATION_RESET_REPLY = "סגרתי את השיחה הקודמת ואיפסתי את ההקשר. אפשר להתחיל עכשיו שיחה נקייה.";
const LOOP_GUARD_REPLY = "נראה שנשלחה כאן תשובה קודמת של הבוט או טקסט מערכת, ולכן עצרתי כדי לא להיכנס ללופ. אפשר לכתוב עכשיו בקשה חדשה, או לשלוח `סגור שיחה` כדי להתחיל נקי.";

function clean(value) {
  return String(value || "").trim();
}

function normalizeLoopText(value) {
  return clean(value)
    .normalize("NFKC")
    .replace(/\s+/g, " ")
    .trim();
}

function isConversationResetCommand(text) {
  const raw = clean(text);
  if (!raw) return false;
  return [
    "סגור שיחה",
    "אפס שיחה",
    "איפוס שיחה",
    "שיחה חדשה",
    "התחל שיחה חדשה",
    "תתחיל שיחה חדשה",
    "נקה הקשר",
    "אפס הקשר"
  ].some((pattern) => raw === pattern);
}

function looksLikeAssistantEcho(text, historyMessages) {
  const raw = clean(text);
  if (!raw || raw.length < 25) return false;
  if (
    /^נמצאו\s+\d+\s+תלמידים[.:]?/u.test(raw)
    || /^הצעתי\s+(?:עדכון|יצירת)\s+תלמיד/u.test(raw)
    || /^כרטיס תלמיד\s+\d+:/u.test(raw)
    || raw.includes("איך חיפשתי:")
    || raw.includes("אפשר לפתוח את המסך המלא")
    || raw.includes("עדיין לא בוצע שום שינוי. אפשר לאשר או לסרב.")
  ) {
    return true;
  }

  const normalizedIncoming = normalizeLoopText(raw);
  const history = Array.isArray(historyMessages) ? historyMessages : [];
  for (let index = history.length - 1; index >= 0; index -= 1) {
    const item = history[index];
    if (item?.role !== "assistant") continue;
    const assistantText = normalizeLoopText(item?.content);
    if (!assistantText || assistantText.length < 25) continue;
    if (normalizedIncoming === assistantText) return true;
    if (
      normalizedIncoming.length > 80
      && assistantText.length > 80
      && (
        normalizedIncoming.startsWith(assistantText.slice(0, 120))
        || assistantText.startsWith(normalizedIncoming.slice(0, 120))
      )
    ) {
      return true;
    }
  }

  return false;
}

const DEFAULT_TELEGRAM_EXPORT_COLUMNS = ["name", "class"];

function hasFollowUpReference(text) {
  const raw = clean(text);
  if (!raw) return false;
  return [
    "שלהם",
    "שלהן",
    "להם",
    "להן",
    "מהם",
    "מהן",
    "אותו",
    "אותה",
    "מתוכם",
    "מתוכן",
    "אותם",
    "אותן",
    "זה",
    "זו",
    "המסמך",
    "האחרון",
    "האחרונה",
    "הקודמים",
    "הקודמות",
    "האלה",
    "האלו",
    "הם גרים",
    "הן גרות",
    "ומה לגבי",
    "ומה מקור"
  ].some((pattern) => raw.includes(pattern));
}

function isCityBreakdownQuery(text) {
  const raw = clean(text);
  if (!raw) return false;
  return [
    "מאיזה עיר",
    "מאילו ערים",
    "מקור העיר",
    "ערי המוצא",
    "ערי מקור",
    "חלוקה לפי עיר",
    "פירוט לפי עיר",
    "איזה ערים",
    "מה העיר שלהם",
    "מה מקור העיר שלהם"
  ].some((pattern) => raw.includes(pattern));
}

function isStudentCityListQuery(text) {
  const raw = clean(text);
  if (!raw) return false;
  return [
    "איפה גרים",
    "איפה גר",
    "עיר מגורים",
    "עיר המגורים",
    "איפה הם גרים",
    "איפה הן גרות",
    "לא שלחת לי את העיר",
    "מה העיר שלהם",
    "תשלח לי את העיר",
    "עם העיר"
  ].some((pattern) => raw.includes(pattern));
}

function normalizeFilterField(field) {
  const raw = clean(field);
  if (raw === "institution") return "currentInstitution";
  if (raw === "familystatus") return "famliystatus";
  return raw;
}

function parseFiltersFromExportUrl(exportUrl) {
  const raw = clean(exportUrl);
  if (!raw) return [];

  const url = new URL(raw, "https://internal.local");
  const filters = [];
  const institution = clean(url.searchParams.get("institution"));
  const quickClass = clean(url.searchParams.get("quickClass"));
  const quickRegistration = clean(url.searchParams.get("quickRegistration"));
  const quickFamilyStatus = clean(url.searchParams.get("quickFamilyStatus"));

  if (institution) filters.push({ field: "currentInstitution", operator: "equals", value: institution });
  if (quickClass) filters.push({ field: "class", operator: "equals", value: quickClass });
  if (quickRegistration) filters.push({ field: "registration", operator: "equals", value: quickRegistration });
  if (quickFamilyStatus) filters.push({ field: "famliystatus", operator: "equals", value: quickFamilyStatus });

  const ff = url.searchParams.getAll("ff");
  const fo = url.searchParams.getAll("fo");
  const fv = url.searchParams.getAll("fv");
  for (let index = 0; index < ff.length; index += 1) {
    const rawField = clean(ff[index]).replace(/^field:/, "");
    const field = normalizeFilterField(rawField);
    const operator = clean(fo[index] || "contains");
    const value = clean(fv[index]);
    if (!field) continue;
    filters.push({ field, operator, value });
  }

  return filters;
}

function getScopedContextFilters(recentHistory) {
  const history = Array.isArray(recentHistory) ? recentHistory : [];
  for (let index = history.length - 1; index >= 0; index -= 1) {
    const item = history[index];
    if (item?.role !== "assistant") continue;
    const filters = parseFiltersFromExportUrl(item?.exportUrl || item?.viewUrl || "");
    if (filters.length) return filters;
  }
  return [];
}

function buildCityBreakdownReply(students) {
  const counts = new Map();
  for (const student of students) {
    const city = clean(student?.adders?.addressCity) || "ללא עיר";
    counts.set(city, (counts.get(city) || 0) + 1);
  }

  const rows = Array.from(counts.entries())
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0], "he", { sensitivity: "base" }));

  return [
    `נמצאו ${students.length} תלמידים.`,
    ...rows.map(([city, count], index) => `${index + 1}. ${city}: ${count}`)
  ].join("\n");
}

function buildStudentCityReply(students, requestedLimit = null) {
  const limit = Number.isFinite(Number(requestedLimit))
    ? Math.min(Number(requestedLimit), students.length)
    : students.length;
  const visibleStudents = students.slice(0, limit);
  const rows = visibleStudents.map((student, index) => {
    const city = clean(student?.adders?.addressCity) || "ללא עיר";
    const street = clean(student?.adders?.address);
    const building = clean(student?.adders?.buildingNum);
    const apartment = clean(student?.adders?.apartmentNum);
    const addressParts = [street, building, apartment ? `דירה ${apartment}` : ""].filter(Boolean);
    const addressText = addressParts.length ? `, ${addressParts.join(" ")}` : "";
    return `${index + 1}. ${student.displayName}${student.tznum ? ` (${student.tznum})` : ""}: ${city}${addressText}`;
  });

  const hiddenCount = students.length - visibleStudents.length;
  return [
    `נמצאו ${students.length} תלמידים.`,
    ...rows,
    hiddenCount > 0 ? `ועוד ${hiddenCount} תלמידים. מומלץ לפתוח את התצוגה הגדולה או להוריד אקסל/PDF כדי לראות הכל מסודר.` : ""
  ].filter(Boolean).join("\n");
}

function extractLastUserMessage(messages) {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index]?.role === "user") return clean(messages[index].content);
  }
  return "";
}

function extractRequestedLimit(text) {
  const raw = clean(text);
  if (!raw) return null;
  const digitMatch = raw.match(/(?:עד|רק|תן לי|תביא לי|הצג|רשימה של)?\s*(\d{1,3})\s*(?:תלמידים|שמות|אנשים|רשומות)?/);
  if (digitMatch) {
    const value = Number(digitMatch[1]);
    if (Number.isFinite(value) && value > 0) return Math.min(value, 100);
  }
  return null;
}

function isQuantitativeListRequest(text) {
  const raw = clean(text);
  if (!raw) return false;
  return [
    "כמה",
    "איזה",
    "רשימה",
    "רשומים",
    "רשומות",
    "מי זה",
    "מי זאת",
    "מי לומד",
    "מי גר",
    "תן לי",
    "תביא לי",
    "הצג",
    "שמות"
  ].some((pattern) => raw.includes(pattern));
}

function isChoiceFieldQuery(text) {
  const raw = clean(text);
  if (!raw) return false;
  return ["מוסד", "לומד ב", "לומדים ב", "נשוי", "נשואים", "רווק", "גרוש", "רישום", "דתות", "משרד החינוך", "שיעור", "כיתה", "סטטוס"].some((pattern) => raw.includes(pattern));
}

const MISSING_FIELD_EXTRA_ALIASES = {
  tznum: ['ת"ז', "תז", "מספר זהות", "מס זהות", "תעודת זהות", "שדה תז", "שדה תעודת זהות"],
  dateofbirth: ["תאריך לידה", "ת. לידה", "לידה"],
  "phone.primaryPhoneNumber": ["טלפון תלמיד", "טלפון של התלמיד", "שדה הטלפון", "טלפון", "נייד", "פלאפון"],
  "dadPhone.primaryPhoneNumber": ["טלפון אב", "טלפון אבא", "טלפון של האבא", "טלפון של אב"],
  "momPhone.primaryPhoneNumber": ["טלפון אם", "טלפון אמא", "טלפון של האמא", "טלפון של אם"],
  "email.primaryEmail": ["אימייל תלמיד", "מייל תלמיד", "אימייל", "מייל"],
  "fatherEmail.primaryEmail": ["אימייל אב", "מייל אב", "אימייל אבא", "מייל אבא"],
  "motherEmail.primaryEmail": ["אימייל אם", "מייל אם", "אימייל אמא", "מייל אמא"],
  "adders.addressStreet1": ["כתובת", "הכתובת", "כתובת מלאה", "מידע כתובת", "שדה הכתובת", "רחוב", "כתובת מגורים"],
  "adders.addressCity": ["עיר", "עיר מגורים"],
  currentInstitution: ["מוסד", "מוסד לימודים", "מוסד נוכחי"],
  class: ["שיעור", "כיתה"],
  registration: ["רישום", "סטטוס רישום"],
  famliystatus: ["סטטוס משפחתי", "מצב משפחתי"],
  bankNum: ["מספר בנק", "בנק"],
  senif: ["סניף", "מספר סניף"],
  accountNum: ["מספר חשבון", "חשבון"]
};

const MISSING_FIELD_QUERY_CANDIDATES = FIELD_SECTIONS
  .flatMap((section) => section.fields.map((field) => {
    const patterns = [
      field.label,
      `שדה ${field.label}`,
      `שדה ה${field.label}`,
      ...(MISSING_FIELD_EXTRA_ALIASES[field.key] || [])
    ]
      .map((pattern) => clean(pattern))
      .filter(Boolean);

    return {
      field: field.key,
      label: field.label,
      patterns
    };
  }))
  .map((candidate) => ({
    ...candidate,
    normalizedPatterns: Array.from(new Set(candidate.patterns.map((pattern) => normalizeContextText(pattern)).filter(Boolean)))
  }))
  .sort((left, right) => {
    const leftLongest = Math.max(...left.normalizedPatterns.map((pattern) => pattern.length), 0);
    const rightLongest = Math.max(...right.normalizedPatterns.map((pattern) => pattern.length), 0);
    return rightLongest - leftLongest;
  });

function getMissingFieldQueryInfo(text) {
  const raw = clean(text);
  if (!raw || !/(?:חסר|חסרה|חסרים|חסרות|אין|בלי)/u.test(raw) || !/(?:כמה|לכמה|איזה|לאיזה)/u.test(raw)) return null;

  const normalizedQuery = normalizeContextText(raw);
  for (const candidate of MISSING_FIELD_QUERY_CANDIDATES) {
    if (candidate.normalizedPatterns.some((pattern) => normalizedQuery.includes(pattern))) {
      return { field: candidate.field, label: candidate.label };
    }
  }

  return null;
}

function isMissingFieldListQuery(text) {
  const raw = clean(text);
  if (!raw) return false;
  return /(?:איזה|לאיזה)\s+תלמיד/u.test(raw);
}

function isCrmRelevant(text) {
  const raw = clean(text);
  if (!raw) return false;
  return [
    "crm", "תלמיד", "תלמידים", "בן אדם", "אדם", "איש", "בחור", "מי זה", "מי זאת", "של מי", "שם",
    "תמצא", "תחפש", "חפש", "מצא", "מוסד", "לומד", "לומדים", "לומדות", "רישום", "סטטוס", "נשוי",
    "רווק", "שיעור", "כיתה", "עיר", "כתובת", "טלפון", "אימייל", "מייל", "תז", "ת.ז", "זהות",
    "הורים", "ההורים", "אבא", "אמא", "אבא של", "אמא של", "אמא שלו", "אבא שלו", "אמא שלה", "אבא שלה",
    "מספר טלפון", "מספר של", "נייד", "פלאפון", "יצירת קשר", "מספר הזהות", "מס זהות",
    "מסמך", "צילום", "אקסל", "כרטיס", "עדכן", "תעדכן", "צור", "תיצור", "הוסף תלמיד", "יצירת תלמיד", "ליצור תלמיד", "פתיחת תלמיד", "לפתוח תלמיד"
  ].some((pattern) => raw.includes(pattern));
}

function extractIdentityNumber(text) {
  const raw = clean(text);
  if (!raw) return "";
  const match = raw.match(/(?:מספר\s*זהות|מס(?:פר)?\s*זהות|ת\.?ז\.?|תז|זהות)\D*(\d{5,10})/u);
  return clean(match?.[1]);
}

function extractPhoneDigits(text) {
  const raw = clean(text);
  if (!raw) return "";
  const match = raw.match(/((?:\+?972|0)?[\d\-\s]{8,})/u);
  const digits = clean(match?.[1]).replace(/\D/g, "");
  return digits.length >= 8 ? digits : "";
}

function buildExactFieldLookupReply(query, students, emptyReply, { field, value, label }) {
  if (!students.length) {
    return {
      reply: emptyReply,
      studentCards: [],
      exportUrl: "",
      viewUrl: "",
      pendingAction: null,
      searchSummary: buildSearchSummary({
        path: "deterministic",
        query,
        filters: [{ field, operator: "equals", value }],
        resultCount: 0
      })
    };
  }

  const finalStudentCards = students.slice(0, 7).map((student) => buildStudentSummary(student)).filter(Boolean);
  const viewUrl = buildNeonViewUrlForAgent({ filters: [{ field, operator: "equals", value }] });
  const exportUrl = buildExportUrlForFilters([{ field, operator: "equals", value }]);
  const sortLevels = defaultReportSortLevels();
  const names = students
    .slice(0, 5)
    .map((student) => student?.label || student?.name || "ללא שם");
  const reply = students.length === 1
    ? `${label} ${value} שייך ל-${names[0]}.`
    : `${label} ${value} שייך ל-${students.length} תלמידים: ${names.join(", ")}.`;

  return {
    reply,
    studentCards: finalStudentCards,
    exportUrl,
    sortLevels,
    viewUrl,
    pendingAction: null,
    searchSummary: buildSearchSummary({
      path: "deterministic",
      query,
      filters: [{ field, operator: "equals", value }],
      resultCount: students.length
    })
  };
}

function buildRecentConversationMessages(historyMessages) {
  return historyMessages
    .filter((item) => clean(item?.content))
    .map((item) => ({
      role: item.role === "assistant" ? "assistant" : "user",
      content: clean(item.content)
    }));
}

function normalizeContextText(value) {
  return clean(value)
    .normalize("NFKC")
    .replace(/["'`׳״.,:;!?()[\]{}<>/_\\-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function getRecentStudentMentionContext(historyMessages, text) {
  const normalizedQuery = normalizeContextText(text);
  if (!normalizedQuery) return null;

  const queryTokens = normalizedQuery.split(" ").filter(Boolean);
  const history = Array.isArray(historyMessages) ? historyMessages : [];

  for (let index = history.length - 1; index >= 0; index -= 1) {
    const item = history[index];
    if (item?.role !== "assistant") continue;
    const cards = Array.isArray(item?.studentCards) ? item.studentCards : [];
    for (const card of cards) {
      const studentId = clean(card?.id);
      const studentName = clean(card?.name);
      const normalizedName = normalizeContextText(studentName);
      if (!studentId || !normalizedName) continue;

      const fullMatch = normalizedQuery.includes(normalizedName);
      const nameTokens = normalizedName.split(" ").filter(Boolean);
      const tokenMatch = nameTokens.length >= 2 && nameTokens.every((token) => queryTokens.includes(token));
      if (!fullMatch && !tokenMatch) continue;

      return { studentId, studentName };
    }
  }

  return null;
}

function getRecentSingleStudentContext(historyMessages) {
  const history = Array.isArray(historyMessages) ? historyMessages : [];
  for (let index = history.length - 1; index >= 0; index -= 1) {
    const item = history[index];
    if (item?.role !== "assistant") continue;
    const cards = Array.isArray(item?.studentCards) ? item.studentCards : [];
    if (cards.length !== 1 || !clean(cards[0]?.id)) continue;
    return {
      studentId: clean(cards[0].id),
      studentName: clean(cards[0].name)
    };
  }
  return null;
}

function getRecentFocusedStudentContext(historyMessages) {
  const history = Array.isArray(historyMessages) ? historyMessages : [];
  for (let index = history.length - 1; index >= 0; index -= 1) {
    const item = history[index];
    if (item?.role !== "assistant") continue;
    const cards = Array.isArray(item?.studentCards) ? item.studentCards : [];
    if (!cards.length) continue;
    if (cards.length === 1 && clean(cards[0]?.id)) {
      return {
        studentId: clean(cards[0].id),
        studentName: clean(cards[0].name)
      };
    }

    const normalizedContent = normalizeContextText(item?.content);
    for (const card of cards) {
      const studentId = clean(card?.id);
      const studentName = clean(card?.name);
      const normalizedName = normalizeContextText(studentName);
      if (!studentId || !normalizedName) continue;
      if (normalizedContent.includes(normalizedName)) {
        return { studentId, studentName };
      }
    }

    if (/(?:יש תלמיד בשם|מצאתי תלמיד בשם|כרטיס תלמיד|התלמיד הוא)/u.test(clean(item?.content))) {
      const firstCard = cards.find((card) => clean(card?.id));
      if (firstCard) {
        return {
          studentId: clean(firstCard.id),
          studentName: clean(firstCard.name)
        };
      }
    }
  }

  return null;
}

function defaultReportSortLevels() {
  return [{ sortBy: "class", sortDir: "asc" }];
}

function classifyIntent({ text = "", hasChoiceFilters = false } = {}) {
  const raw = clean(text);
  if (!raw) return "empty";
  if (/צור|תיצור|ליצור|יצירת|פתח תלמיד|תפתח תלמיד|פתיחת תלמיד|לפתוח תלמיד|הוסף תלמיד|תוסיף תלמיד|חדש תלמיד|תלמיד חדש|כרטיס חדש|פתח כרטיס|תפתח כרטיס/.test(raw)) return "create_request";
  if (hasChoiceFilters && isQuantitativeListRequest(raw)) return "choice_filter";
  if (/עדכן|תעדכן|לשנות|שנה|לתקן|תקן/.test(raw)) return "update_request";
  if (hasChoiceFilters) return "choice_filter";
  if (/מסמך|קובץ|תעודה/.test(raw)) return "document_query";
  if (/כמה|לכמה|חלוקה/.test(raw)) return "count_or_summary";
  if (/תמצא|תחפש|מי זה|מי זאת|בשם|של מי/.test(raw)) return "specific_lookup";
  return "general_crm";
}

const FIELD_LABELS = Object.fromEntries(
  FIELD_SECTIONS.flatMap((section) => section.fields.map((field) => [field.key, field.label]))
);

function flattenStudentData(data, prefix = "") {
  if (!data || typeof data !== "object" || Array.isArray(data)) return [];
  const items = [];
  for (const [key, value] of Object.entries(data)) {
    const nextKey = prefix ? `${prefix}.${key}` : key;
    if (value && typeof value === "object" && !Array.isArray(value)) {
      items.push(...flattenStudentData(value, nextKey));
      continue;
    }
    if (Array.isArray(value)) {
      if (value.length) items.push({ field: nextKey, value: value.join(", ") });
      continue;
    }
    const cleaned = clean(value);
    if (!cleaned) continue;
    items.push({ field: nextKey, value: cleaned });
  }
  return items;
}

function buildStudentActionPreview(data) {
  return flattenStudentData(data)
    .slice(0, 12)
    .map((item) => ({
      field: item.field,
      label: FIELD_LABELS[item.field] || item.field,
      value: item.value
    }));
}

function buildPendingActionReply({ title, intro, previewFields, studentName = "" }) {
  const lines = [];
  if (title) lines.push(title);
  if (intro) lines.push(intro);
  if (studentName) lines.push(`תלמיד: ${studentName}`);
  lines.push("מה עומד להתבצע:");
  if (previewFields.length) {
    previewFields.forEach((field, index) => {
      lines.push(`${index + 1}. ${field.label}: ${field.value}`);
    });
  } else {
    lines.push("-");
  }
  lines.push("עדיין לא בוצע שום שינוי. אפשר לאשר או לסרב.");
  return lines.join("\n");
}

function buildSearchSummary({ path = "", query = "", filters = [], minScore = null, tools = [], resultCount = null } = {}) {
  const parts = [];
  const describedFilters = describeAgentFilters(filters);

  if (path === "deterministic") {
    parts.push("בוצע סינון מערכת דטרמיניסטי");
    if (describedFilters.length) parts.push(`לפי: ${describedFilters.join(" | ")}`);
  } else if (path === "tool") {
    const safeQuery = clean(query);
    if (safeQuery) parts.push(`בוצע חיפוש משוער לפי: "${safeQuery}"`);
    if (Number.isFinite(Number(minScore))) parts.push(`סף התאמה ${Math.round(Number(minScore) * 100)}%`);
    if (describedFilters.length) parts.push(`עם מסננים: ${describedFilters.join(" | ")}`);
    if (tools.length) parts.push(`כלים: ${tools.join(", ")}`);
  }

  if (Number.isFinite(Number(resultCount))) {
    parts.push(`נמצאו ${Number(resultCount)} תוצאות`);
  }

  return parts.join(" | ");
}

function buildStudentContextReply(studentItem) {
  const summary = studentItem?.summary || {};
  const lines = [`הנה המידע שיש לי על ${summary.name || "התלמיד"}:`];

  if (summary.tznum) lines.push(`תעודת זהות: ${summary.tznum}`);
  if (summary.currentInstitutionLabel) lines.push(`מוסד: ${summary.currentInstitutionLabel}`);
  if (summary.classLabel) lines.push(`שיעור: ${summary.classLabel}`);
  if (summary.registrationLabel) lines.push(`סטטוס רישום: ${summary.registrationLabel}`);

  const addressParts = [clean(summary.city), clean(summary.addressStreet1)].filter(Boolean);
  if (addressParts.length) lines.push(`כתובת: ${addressParts.join(", ")}`);

  if (summary.studentPhone) lines.push(`טלפון תלמיד: ${summary.studentPhone}`);
  if (summary.primaryEmail) lines.push(`אימייל תלמיד: ${summary.primaryEmail}`);
  if (summary.dadPhone) lines.push(`טלפון אב: ${summary.dadPhone}`);
  if (summary.momPhone) lines.push(`טלפון אם: ${summary.momPhone}`);
  if (summary.fatherEmail) lines.push(`אימייל אב: ${summary.fatherEmail}`);
  if (summary.motherEmail) lines.push(`אימייל אם: ${summary.motherEmail}`);

  return lines.join("\n");
}

function isStudentInfoFollowUpQuery(text) {
  const raw = clean(text);
  if (!raw) return false;
  return [
    "איזה מידע",
    "איזה פרטים",
    "תציג לי",
    "הצג לי",
    "תן לי מידע",
    "תן לי פרטים",
    "מה יש לך על",
    "פרטים על",
    "מידע על",
    "כרטיס"
  ].some((pattern) => raw.includes(pattern));
}

function buildQuantitativeReply({ students, requestedLimit, viewUrl }) {
  const total = students.length;
  if (!total) return "לא נמצאו תלמידים מתאימים.";
  const displayLimit = requestedLimit || Math.min(total, 200);
  const displayed = students.slice(0, displayLimit);
  const lines = [
    `נמצאו ${total} תלמידים.`,
    ...displayed.map((student, index) => `${index + 1}. ${student?.label || student?.name || "ללא שם"}`)
  ];
  if (!requestedLimit && viewUrl) {
    lines.push("אפשר לפתוח את המסך המלא כדי לבחור תלמידים, לעדכן שדות בצורה מרוכזת או לייצא לאקסל.");
  }
  if (displayed.length < total) {
    lines.push(`כרגע מופיעים בטקסט ${displayed.length} מתוך ${total} כדי לשמור על תשובה שימושית.`);
  }
  return lines.join("\n");
}

function isInstitutionLevelQuery({ query = "", filters = [] } = {}) {
  const raw = clean(query);
  const safeFilters = Array.isArray(filters) ? filters : [];
  if (safeFilters.some((filter) => clean(filter?.field) === "currentInstitution")) return true;
  return ["מוסד", "לומד", "לומדים", "ישיבה", "במוסד"].some((pattern) => raw.includes(pattern));
}

function collectStudentCards(target, payload) {
  const candidates = [];
  if (Array.isArray(payload?.items)) candidates.push(...payload.items);
  if (payload?.item) candidates.push(payload.item);
  if (payload?.summary) candidates.push(payload);
  for (const item of candidates) {
    const summary = item?.summary || item;
    if (!summary?.id || !summary?.studentCardUrl) continue;
    target.set(summary.id, summary);
  }
}

function collectPendingAction(payload) {
  return payload?.pendingAction && typeof payload.pendingAction === "object"
    ? payload.pendingAction
    : null;
}

async function callOpenAI(messages, tools, options = {}) {
  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${OPENAI_API_KEY}`
    },
    body: JSON.stringify({
      model: OPENAI_MODEL,
      temperature: options.temperature ?? 0.2,
      messages,
      tools,
      tool_choice: options.toolChoice || "auto"
    })
  });
  const data = await response.json().catch(() => null);
  if (!response.ok) throw new Error(data?.error?.message || "OpenAI request failed");
  return data?.choices?.[0]?.message || null;
}

function extractLabeledValue(text, labels) {
  const raw = clean(text);
  if (!raw || !Array.isArray(labels) || !labels.length) return "";
  const pattern = labels
    .map((label) => label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .join("|");
  const regex = new RegExp(`(?:^|[\\n,])\\s*(?:${pattern})\\s*[:=-]\\s*([^\\n,]+)`, "iu");
  const match = raw.match(regex);
  return clean(match?.[1]);
}

function extractLooseLabeledValue(text, labels) {
  const raw = clean(text);
  if (!raw || !Array.isArray(labels) || !labels.length) return "";
  const pattern = labels
    .map((label) => label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .join("|");
  const regex = new RegExp(`(?:${pattern})\\s*[:=-]?\\s*([^\\n,;]+)`, "iu");
  const match = raw.match(regex);
  return clean(match?.[1]);
}

function extractStudentNameFromCreateText(text) {
  const raw = clean(text);
  if (!raw) return { firstName: "", lastName: "" };

  const normalized = raw.replace(/(?:צור|תיצור|ליצור|יצירת|הוסף|תוסיף|חדש|פתח|תפתח|לפתוח)\s+(?:לי\s+)?(?:תלמיד(?:ה)?|כרטיס(?:\s+תלמיד)?)?/gu, " ");
  const commaSegments = normalized
    .split(/[,\n;]/)
    .map((segment) => clean(segment))
    .filter(Boolean);
  for (const segment of commaSegments) {
    if (/(?:מוסד|ישיבה|שיעור|כיתה|סטטוס|רישום|טלפון|נייד|פלאפון|אימייל|מייל|ת(?:\.|)ז|זהות|תאריך|הערה)/iu.test(segment)) continue;
    if (inferEnumFiltersFromQuery(segment).some((filter) => ["currentInstitution", "class", "registration", "famliystatus"].includes(filter?.field))) continue;
    const words = segment.match(/[א-תA-Za-z'`"׳״.-]+/gu) || [];
    if (words.length >= 2) {
      return {
        firstName: sanitizeStudentNamePart(words[0], "first"),
        lastName: sanitizeStudentNamePart(words.slice(1).join(" "), "last")
      };
    }
  }

  const patterns = [
    /(?:צור|תיצור|ליצור|יצירת|הוסף|תוסיף|חדש|פתח|תפתח|לפתוח)\s+(?:לי\s+)?(?:תלמיד(?:ה)?|כרטיס(?:\s+תלמיד)?)\s+(?:חדש\s+)?(?:בשם\s+)?([א-תA-Za-z'`"׳״.-]+)\s+([א-תA-Za-z'`"׳״.\- ]{1,40})/u,
    /(?:תלמיד(?:ה)?|כרטיס(?:\s+תלמיד)?)\s+(?:בשם\s+)?([א-תA-Za-z'`"׳״.-]+)\s+([א-תA-Za-z'`"׳״.\- ]{1,40})/u,
    /(?:שם\s+מלא|שם)\s*[:=-]?\s*([א-תA-Za-z'`"׳״.-]+)\s+([א-תA-Za-z'`"׳״.\- ]{1,40})/u
  ];

  for (const pattern of patterns) {
    const match = raw.match(pattern);
    if (match) {
      return {
        firstName: sanitizeStudentNamePart(match[1], "first"),
        lastName: sanitizeStudentNamePart(match[2], "last")
      };
    }
  }

  return { firstName: "", lastName: "" };
}

function hasCreateStudentCoreData(data) {
  const firstName = clean(data?.fullName?.firstName);
  const lastName = clean(data?.fullName?.lastName);
  return Boolean(firstName && lastName);
}

function sanitizeStudentNamePart(value, type = "last") {
  const raw = clean(value).replace(/\s{2,}/g, " ").replace(/[,:;]+$/g, "").trim();
  if (!raw) return "";
  const stopPattern = /\s+(?:במוסד|מוסד|ישיבה|שיעור|כיתה|סטטוס|רישום|עיר|רחוב|כתובת|טלפון|נייד|פלאפון|אימייל|מייל|ת(?:\.|)ז|תאריך|הערה)\b.*$/iu;
  const cleaned = raw.replace(stopPattern, "").trim();
  if (type === "first") return cleaned.split(/\s+/).filter(Boolean)[0] || "";
  return cleaned;
}

function extractStudentCreateDataFromText(text) {
  const raw = clean(text);
  if (!raw) return {};

  const fullNameText = extractLabeledValue(raw, ["שם מלא", "שם"]) || extractLooseLabeledValue(raw, ["שם מלא", "שם"]);
  const firstName = extractLabeledValue(raw, ["שם פרטי", "פרטי"]) || extractLooseLabeledValue(raw, ["שם פרטי", "פרטי"]);
  const lastName = extractLabeledValue(raw, ["שם משפחה", "משפחה"]) || extractLooseLabeledValue(raw, ["שם משפחה", "משפחה"]);
  const inferredName = extractStudentNameFromCreateText(raw);
  const fullNameParts = clean(fullNameText).split(/\s+/).filter(Boolean);
  const derivedFirstName = fullNameParts[0] || "";
  const derivedLastName = fullNameParts.slice(1).join(" ");

  const enumDefaults = {};
  for (const filter of inferEnumFiltersFromQuery(raw)) {
    if (filter?.operator !== "equals" || !filter?.field || !filter?.value) continue;
    if (["currentInstitution", "class", "registration", "famliystatus"].includes(filter.field)) {
      enumDefaults[filter.field] = filter.value;
    }
  }

  return normalizeStudentInput({
    "fullName.firstName": sanitizeStudentNamePart(firstName || inferredName.firstName || derivedFirstName, "first"),
    "fullName.lastName": sanitizeStudentNamePart(lastName || inferredName.lastName || derivedLastName, "last"),
    tznum: extractLabeledValue(raw, ['ת"ז', "תז", "מספר זהות", "מס זהות"]) || extractIdentityNumber(raw),
    dateofbirth: extractLabeledValue(raw, ["תאריך לידה", "ת. לידה"]) || extractLooseLabeledValue(raw, ["תאריך לידה", "ת. לידה"]),
    "phone.primaryPhoneNumber": extractLabeledValue(raw, ["טלפון", "נייד", "פלאפון"]) || extractPhoneDigits(raw),
    "email.primaryEmail": extractLabeledValue(raw, ["אימייל", "מייל", "email"]) || extractLooseLabeledValue(raw, ["אימייל", "מייל", "email"]),
    currentInstitution: extractLabeledValue(raw, ["מוסד נוכחי", "מוסד", "ישיבה"]) || extractLooseLabeledValue(raw, ["מוסד נוכחי", "מוסד", "ישיבה"]) || enumDefaults.currentInstitution,
    class: extractLabeledValue(raw, ["כיתה", "שיעור"]) || extractLooseLabeledValue(raw, ["כיתה", "שיעור"]) || enumDefaults.class,
    registration: extractLabeledValue(raw, ["רישום"]) || extractLooseLabeledValue(raw, ["רישום"]) || enumDefaults.registration,
    famliystatus: extractLabeledValue(raw, ["סטטוס משפחתי", "מצב משפחתי"]) || extractLooseLabeledValue(raw, ["סטטוס משפחתי", "מצב משפחתי"]) || enumDefaults.famliystatus,
    "adders.addressCity": extractLabeledValue(raw, ["עיר"]) || extractLooseLabeledValue(raw, ["עיר"]),
    "adders.addressStreet1": extractLabeledValue(raw, ["רחוב", "כתובת"]) || extractLooseLabeledValue(raw, ["רחוב", "כתובת"]),
    note: extractLabeledValue(raw, ["הערה", "הערות"]) || extractLooseLabeledValue(raw, ["הערה", "הערות"])
  });
}

function extractFreeformAddressParts(value) {
  const raw = clean(value)
    .replace(/[.]+$/g, "")
    .replace(/\s{2,}/g, " ");
  if (!raw) return { street1: "", city: "" };

  const multiWordCityCandidates = [
    "בית שמש",
    "בני ברק",
    "מודיעין עילית",
    "ביתר עילית",
    "תל אביב",
    "פתח תקווה",
    "ראש העין",
    "אור יהודה",
    "קרית גת",
    "קרית ספר",
    "קרית יערים",
    "ראשון לציון",
    "רמת גן",
    "כפר חבד",
    "כפר חב\"ד"
  ];
  const singleWordCityCandidates = [
    "ירושלים",
    "כרמיאל",
    "אלעד",
    "צפת",
    "חיפה",
    "אשדוד",
    "אשקלון",
    "נתיבות",
    "נתניה",
    "רחובות",
    "חולון",
    "טבריה",
    "רכסים",
    "ביתר",
    "מודיעין"
  ];

  for (const candidate of multiWordCityCandidates) {
    if (!raw.endsWith(candidate)) continue;
    const street1 = clean(raw.slice(0, raw.length - candidate.length));
    if (street1 && /\d/.test(street1)) {
      return { street1, city: candidate };
    }
  }

  const parts = raw.split(/\s+/).filter(Boolean);
  if (parts.length < 3 || !/\d/.test(raw)) return { street1: raw, city: "" };

  const lastWord = parts[parts.length - 1];
  if (singleWordCityCandidates.includes(lastWord)) {
    const street1 = clean(parts.slice(0, -1).join(" "));
    if (street1 && /\d/.test(street1)) {
      return { street1, city: lastWord };
    }
  }

  return { street1: raw, city: "" };
}

function extractAddressUpdateValue(text) {
  const raw = clean(text);
  if (!raw) return "";

  const sanitizeAddressValue = (value) => clean(value)
    .replace(/^(?:שלו|שלה|של\s+התלמיד|לתלמיד|עבור\s+התלמיד)\s+/iu, "")
    .replace(/^(?:המגורים|כתובת\s+המגורים|כתבות\s+המגורים|כתובת\s+מגורים|כתבות\s+מגורים)\s+/iu, "")
    .replace(/^ל\s+/iu, "")
    .replace(/^(?:היא|זה|זאת|זו|הכתובת|הכתבות|כתובת|כתבות)\s+/iu, "")
    .replace(/\s+(?:שלו|שלה|של\s+התלמיד)\s*$/iu, "")
    .replace(/[.]+$/g, "");

  const explicit = extractLabeledValue(raw, ["כתובת", "רחוב"]) || extractLooseLabeledValue(raw, ["כתובת", "רחוב"]);
  if (explicit) return sanitizeAddressValue(explicit);

  const patterns = [
    /(?:תעדכן|עדכן)\s+(?:לו|לה|לו את|לה את|את)?\s*(?:ה(?:כתובת|כתבות)|כתובת|כתבות)(?:\s+(?:ה)?מגורים)?(?:\s+שלו|\s+שלה|\s+של\s+התלמיד)?\s+ל(.*)$/iu,
    /^(.*?)\s+(?:תעדכן|עדכן|תשנה|שנה|תתקן|תקן)\s+(?:(?:שזו|שזה|שזאת|שזוהי|זאת|זו|זה)\s+)?(?:ה(?:כתובת|כתבות)|כתובת|כתבות)(?:\s+(?:ה)?מגורים)?(?:\s+שלו|\s+שלה|\s+של\s+התלמיד)?$/iu,
    /(?:תעדכן|עדכן)\s+(?:לו|לה|לו את|לה את|את)?\s*(?:ה(?:כתובת|כתבות)|כתובת|כתבות)(?:\s+(?:ה)?מגורים)?\s+(.*)$/iu,
    /(?:שדה\s+ה(?:כתובת|כתבות)(?:\s+(?:ה)?מגורים)?(?:\s+שלו|\s+שלה|\s+של\s+התלמיד)?|(?:ה)?(?:כתובת|כתבות)(?:\s+(?:ה)?מגורים)?(?:\s+שלו|\s+שלה|\s+של\s+התלמיד)?|רחוב)\s+(.*)$/iu
  ];

  for (const pattern of patterns) {
    const match = raw.match(pattern);
    const value = sanitizeAddressValue(match?.[1]);
    if (value) return value;
  }

  return "";
}

function extractStudentUpdateDataFromText(text) {
  const raw = clean(text);
  if (!raw) return {};

  const enumDefaults = {};
  for (const filter of inferEnumFiltersFromQuery(raw)) {
    if (filter?.operator !== "equals" || !filter?.field || !filter?.value) continue;
    if (["currentInstitution", "class", "registration", "famliystatus"].includes(filter.field)) {
      enumDefaults[filter.field] = filter.value;
    }
  }

  const studentPhone = /(טלפון\s+תלמיד|טלפון\s+שלו|הטלפון\s+שלו|נייד\s+שלו|פלאפון\s+שלו|המספר\s+שלו|מספר\s+שלו|המספר\s+של\s+התלמיד|מספר\s+של\s+התלמיד|טלפון)/u.test(raw)
    ? extractLabeledValue(raw, ["טלפון תלמיד", "טלפון", "נייד", "פלאפון"]) || extractPhoneDigits(raw)
    : "";
  const dadPhone = /(טלפון\s+אב|טלפון\s+האבא|טלפון\s+של\s+האבא|טלפון\s+של\s+אבא|אבא\s+שלו|אבא\s+שלה|המספר\s+של\s+אבא|מספר\s+של\s+אבא|המספר\s+של\s+האבא|מספר\s+של\s+האבא|המספר\s+של\s+אבא\s+שלו|מספר\s+של\s+אבא\s+שלו)/u.test(raw)
    ? extractLabeledValue(raw, ["טלפון אב", "טלפון האבא", "טלפון אבא"]) || extractPhoneDigits(raw)
    : "";
  const momPhone = /(טלפון\s+אם|טלפון\s+האמא|טלפון\s+של\s+האמא|טלפון\s+של\s+אמא|אמא\s+שלו|אמא\s+שלה|המספר\s+של\s+אמא|מספר\s+של\s+אמא|המספר\s+של\s+האמא|מספר\s+של\s+האמא|המספר\s+של\s+אמא\s+שלו|מספר\s+של\s+אמא\s+שלו)/u.test(raw)
    ? extractLabeledValue(raw, ["טלפון אם", "טלפון האמא", "טלפון אמא"]) || extractPhoneDigits(raw)
    : "";
  const extractedAddressValue = extractAddressUpdateValue(raw);
  const extractedAddressParts = extractFreeformAddressParts(extractedAddressValue);
  const explicitCity = extractLabeledValue(raw, ["עיר"]) || extractLooseLabeledValue(raw, ["עיר"]);

  const normalized = normalizeStudentInput({
    "phone.primaryPhoneNumber": studentPhone,
    "dadPhone.primaryPhoneNumber": dadPhone,
    "momPhone.primaryPhoneNumber": momPhone,
    "email.primaryEmail": /(אימייל\s+תלמיד|מייל\s+תלמיד|אימייל\s+שלו|מייל\s+שלו|אימייל|מייל)/u.test(raw)
      ? extractLabeledValue(raw, ["אימייל תלמיד", "מייל תלמיד", "אימייל", "מייל", "email"]) || extractLooseLabeledValue(raw, ["אימייל תלמיד", "מייל תלמיד", "אימייל", "מייל", "email"])
      : "",
    "fatherEmail.primaryEmail": /(אימייל\s+אב|מייל\s+אב|אימייל\s+אבא|מייל\s+אבא)/u.test(raw)
      ? extractLabeledValue(raw, ["אימייל אב", "מייל אב", "אימייל אבא", "מייל אבא"]) || extractLooseLabeledValue(raw, ["אימייל אב", "מייל אב", "אימייל אבא", "מייל אבא"])
      : "",
    "motherEmail.primaryEmail": /(אימייל\s+אם|מייל\s+אם|אימייל\s+אמא|מייל\s+אמא)/u.test(raw)
      ? extractLabeledValue(raw, ["אימייל אם", "מייל אם", "אימייל אמא", "מייל אמא"]) || extractLooseLabeledValue(raw, ["אימייל אם", "מייל אם", "אימייל אמא", "מייל אמא"])
      : "",
    currentInstitution: extractLabeledValue(raw, ["מוסד", "ישיבה"]) || extractLooseLabeledValue(raw, ["מוסד", "ישיבה"]) || enumDefaults.currentInstitution,
    class: extractLabeledValue(raw, ["כיתה", "שיעור"]) || extractLooseLabeledValue(raw, ["כיתה", "שיעור"]) || enumDefaults.class,
    registration: extractLabeledValue(raw, ["רישום", "סטטוס רישום"]) || extractLooseLabeledValue(raw, ["רישום", "סטטוס רישום"]) || enumDefaults.registration,
    famliystatus: extractLabeledValue(raw, ["סטטוס משפחתי", "מצב משפחתי"]) || extractLooseLabeledValue(raw, ["סטטוס משפחתי", "מצב משפחתי"]) || enumDefaults.famliystatus,
    "adders.addressStreet1": extractedAddressParts.street1 || extractedAddressValue,
    "adders.addressCity": explicitCity || extractedAddressParts.city,
    note: extractLabeledValue(raw, ["הערה", "הערות", "הערת"]) || extractLooseLabeledValue(raw, ["הערה", "הערות", "הערת"])
  });

  if (normalized?.adders && !/(?:מדינה|country)/iu.test(raw)) {
    delete normalized.adders.addressCountry;
    if (!Object.keys(normalized.adders).length) delete normalized.adders;
  }

  return normalized;
}

async function attemptCreateStudentProposal({ lastUserMessage, recentConversation }) {
  const useContext = hasFollowUpReference(lastUserMessage);
  const proposalTool = buildTools().filter((tool) => tool?.function?.name === "propose_create_student");
  const assistantMessage = await callOpenAI([
    {
      role: "system",
      content: [
        "המשתמש מבקש ליצור תלמיד חדש ב-CRM.",
        "אם יש מספיק פרטים כדי להכין הצעת יצירה, חובה לקרוא ל-tool propose_create_student.",
        "אם חסרים פרטי ליבה כמו שם פרטי ושם משפחה, אל תקרא ל-tool ובקש רק את השדות החסרים בקצרה.",
        useContext
          ? "מותר להשתמש בהקשר השיחה הקרוב רק כי ההודעה הנוכחית מנוסחת כשאלת המשך מפורשת."
          : "אל תשתמש בפרטים מהודעות קודמות. חלץ פרטי יצירה רק מההודעה האחרונה.",
        "אל תענה תשובה כללית על יכולות המערכת כשכבר ברור שמדובר בבקשת יצירה."
      ].join(" ")
    },
    ...(useContext ? recentConversation.slice(-4) : []),
    { role: "user", content: lastUserMessage }
  ], proposalTool, { temperature: 0 });

  if (!assistantMessage) return null;
  if (Array.isArray(assistantMessage.tool_calls) && assistantMessage.tool_calls.length) {
    for (const toolCall of assistantMessage.tool_calls) {
      if (toolCall?.function?.name !== "propose_create_student") continue;
      const result = await executeToolCall(toolCall, { lastUserMessage, intentType: "create_request" });
      if (result?.pendingAction) return result;
    }
  }

  return { reply: clean(assistantMessage.content) };
}

async function executeToolCall(toolCall, context = {}) {
  const name = toolCall?.function?.name;
  const rawArguments = toolCall?.function?.arguments || "{}";
  let args = {};
  try { args = JSON.parse(rawArguments); } catch {}

  if (name === "get_schema_catalog") return { ok: true, tool: name, catalog: getStudentSchemaCatalog() };

  if (name === "search_students") {
    const items = await searchStudentsForAgent({ query: args?.query, filters: args?.filters, limit: args?.limit });
    return { ok: true, tool: name, count: items.length, items };
  }

  if (name === "count_student_documents") {
    const result = await findStudentsForAgent({ query: args?.query, filters: args?.filters, minScore: 0.4 });
    const targetIds = result.effectiveFilters.length || clean(args?.query) ? result.students.map((student) => student.id) : [];
    const stats = await getStudentDocumentsStats({ studentIds: targetIds });
    return { ok: true, tool: name, ...stats, studentCount: targetIds.length || null };
  }

  if (name === "find_students_missing_data") {
    const result = await findStudentsMissingDataForAgent({
      type: clean(args?.type) === "identity" ? "identity" : "contact",
      query: args?.query,
      filters: args?.filters,
      limit: args?.limit
    });
    return { ok: true, tool: name, count: result.count, items: result.students };
  }

  if (name === "propose_create_student") {
    const directCreateData = context?.intentType === "create_request" && !hasFollowUpReference(context?.lastUserMessage)
      ? extractStudentCreateDataFromText(context.lastUserMessage)
      : {};
    const data = normalizeStudentInput(hasCreateStudentCoreData(directCreateData) ? directCreateData : (args?.data || {}));
    const previewFields = buildStudentActionPreview(data);
    if (!Object.keys(data).length) return { ok: false, tool: name, error: "אין מספיק שדות תקינים להצעת יצירת תלמיד." };
    return {
      ok: true,
      tool: name,
      pendingAction: {
        id: crypto.randomUUID(),
        type: "create_student_manual",
        createStudentData: data,
        previewFields
      },
      reply: buildPendingActionReply({
        title: "הצעתי יצירת תלמיד חדש",
        intro: "זיהיתי בקשה ליצירת תלמיד.",
        previewFields
      })
    };
  }

  if (name === "propose_update_student") {
    const studentId = clean(args?.studentId || context?.recentStudentId);
    const existingStudent = await getStudentForAgent(studentId);
    if (!existingStudent?.summary?.id) return { ok: false, tool: name, error: "לא נמצא תלמיד לעדכון." };
    const data = normalizeStudentInput(args?.data || {});
    const previewFields = buildStudentActionPreview(data);
    if (!Object.keys(data).length) return { ok: false, tool: name, error: "אין שדות תקינים לעדכון." };
    return {
      ok: true,
      tool: name,
      item: existingStudent,
      pendingAction: {
        id: crypto.randomUUID(),
        type: "update_student",
        studentId,
        updateStudentData: data,
        previewFields
      },
      reply: buildPendingActionReply({
        title: "הצעתי עדכון תלמיד",
        intro: "זיהיתי בקשה לעדכון שדות בכרטיס תלמיד.",
        previewFields,
        studentName: existingStudent.summary.name
      })
    };
  }

  if (name === "get_student") {
    const item = await getStudentForAgent(args?.studentId);
    return { ok: Boolean(item), tool: name, item };
  }

  return { ok: false, tool: name, error: `Unsupported tool: ${name || "unknown"}` };
}

function buildTools() {
  return [
    { type: "function", function: { name: "get_schema_catalog", description: "Return all CRM student fields, labels, and enum values such as CY=חכמי ירושלים.", parameters: { type: "object", properties: {} } } },
    { type: "function", function: { name: "search_students", description: "Search CRM students by free text and/or field filters. Returns concise student summaries and matched fields only.", parameters: { type: "object", properties: { query: { type: "string" }, limit: { type: "number" }, filters: { type: "array", items: { type: "object", properties: { field: { type: "string" }, operator: { type: "string", enum: ["contains", "equals", "starts_with", "ends_with", "empty", "not_empty"] }, value: { type: "string" } }, required: ["field", "operator"] } } } } } },
    { type: "function", function: { name: "count_student_documents", description: "Count attached student documents, optionally within a filtered student set.", parameters: { type: "object", properties: { query: { type: "string" }, filters: { type: "array", items: { type: "object", properties: { field: { type: "string" }, operator: { type: "string", enum: ["contains", "equals", "starts_with", "ends_with", "empty", "not_empty"] }, value: { type: "string" } }, required: ["field", "operator"] } } } } } },
    { type: "function", function: { name: "find_students_missing_data", description: "Find students with missing contact or identity data.", parameters: { type: "object", properties: { type: { type: "string", enum: ["contact", "identity"] }, query: { type: "string" }, limit: { type: "number" }, filters: { type: "array", items: { type: "object", properties: { field: { type: "string" }, operator: { type: "string", enum: ["contains", "equals", "starts_with", "ends_with", "empty", "not_empty"] }, value: { type: "string" } }, required: ["field", "operator"] } } } } } },
    { type: "function", function: { name: "propose_create_student", description: "Prepare a student creation proposal. Do not create immediately. Use when the user explicitly asks to create a student.", parameters: { type: "object", properties: { data: { type: "object", description: "Student fields to create" } }, required: ["data"] } } },
    { type: "function", function: { name: "propose_update_student", description: "Prepare a student update proposal. Do not update immediately. Use only when the user explicitly asks to update a known student.", parameters: { type: "object", properties: { studentId: { type: "string" }, data: { type: "object", description: "Student fields to update" } }, required: ["studentId", "data"] } } },
    { type: "function", function: { name: "get_student", description: "Get one student by exact CRM student id.", parameters: { type: "object", properties: { studentId: { type: "string" } }, required: ["studentId"] } } }
  ];
}

export async function processTextAiMessage({ user, messageText, source = "web" }) {
  const lastUserMessage = clean(messageText);
  const recentHistory = await listRecentAiChatMessagesByUser(user.clerk_user_id, { limit: 5, withinMinutes: 180 });
  if (isConversationResetCommand(lastUserMessage)) {
    await createAiChatMessage({
      clerkUserId: user.clerk_user_id,
      role: "user",
      content: lastUserMessage,
      metadata: { source, conversationReset: true, path: "reset", intentType: "reset_conversation" }
    });
    const assistantSaved = await createAiChatMessage({
      clerkUserId: user.clerk_user_id,
      role: "assistant",
      content: CONVERSATION_RESET_REPLY,
      metadata: {
        source,
        conversationReset: true,
        path: "reset",
        intentType: "reset_conversation",
        studentCards: [],
        exportUrl: "",
        pdfUrl: "",
        viewUrl: "",
        searchSummary: "השיחה אופסה לפי בקשת המשתמש"
      }
    });
    return {
      ...assistantSaved,
      reply: CONVERSATION_RESET_REPLY,
      studentCards: [],
      exportUrl: "",
      pdfUrl: "",
      viewUrl: "",
      searchSummary: "השיחה אופסה לפי בקשת המשתמש",
      pendingAction: null
    };
  }
  if (looksLikeAssistantEcho(lastUserMessage, recentHistory)) {
    await createAiChatMessage({
      clerkUserId: user.clerk_user_id,
      role: "user",
      content: lastUserMessage,
      metadata: { source, path: "loop_guard", intentType: "echoed_assistant_text" }
    });
    const assistantSaved = await createAiChatMessage({
      clerkUserId: user.clerk_user_id,
      role: "assistant",
      content: LOOP_GUARD_REPLY,
      metadata: {
        source,
        path: "loop_guard",
        intentType: "echoed_assistant_text",
        studentCards: [],
        exportUrl: "",
        pdfUrl: "",
        viewUrl: "",
        searchSummary: "זוהה טקסט שחוזר על תשובת בוט קודמת, והמערכת עצרה כדי למנוע לופ"
      }
    });
    return {
      ...assistantSaved,
      reply: LOOP_GUARD_REPLY,
      studentCards: [],
      exportUrl: "",
      pdfUrl: "",
      viewUrl: "",
      searchSummary: "זוהה טקסט שחוזר על תשובת בוט קודמת, והמערכת עצרה כדי למנוע לופ",
      pendingAction: null
    };
  }
  if (!OPENAI_API_KEY) throw new Error("Missing OPENAI_API_KEY");
  const recentConversation = buildRecentConversationMessages(recentHistory);
  const recentStudentContext = getRecentSingleStudentContext(recentHistory);
  const recentFocusedStudentContext = getRecentFocusedStudentContext(recentHistory);
  const recentMentionedStudentContext = getRecentStudentMentionContext(recentHistory, lastUserMessage);
  const inferredChoiceFilters = inferEnumFiltersFromQuery(lastUserMessage);
  const intentType = classifyIntent({ text: lastUserMessage, hasChoiceFilters: inferredChoiceFilters.length > 0 });
  if (!isCrmRelevant(lastUserMessage) && !inferredChoiceFilters.length && !recentMentionedStudentContext) {
    return { reply: CRM_SCOPE_MESSAGE, studentCards: [] };
  }

  const requestedLimit = extractRequestedLimit(lastUserMessage);
  const quantitativeListRequest = isQuantitativeListRequest(lastUserMessage);
  const choiceFieldQuery = isChoiceFieldQuery(lastUserMessage) || inferredChoiceFilters.length > 0;
  const exactIdentityNumber = extractIdentityNumber(lastUserMessage);
  const exactPhoneDigits = extractPhoneDigits(lastUserMessage);
  const contextualFilters = hasFollowUpReference(lastUserMessage) ? getScopedContextFilters(recentHistory) : [];
  const contextualUpdateStudentId = clean(recentMentionedStudentContext?.studentId || recentFocusedStudentContext?.studentId || recentStudentContext?.studentId);
  const missingFieldQuery = getMissingFieldQueryInfo(lastUserMessage);

  if (recentMentionedStudentContext && isStudentInfoFollowUpQuery(lastUserMessage)) {
    const studentItem = await getStudentForAgent(recentMentionedStudentContext.studentId);
    if (studentItem?.summary?.id) {
      const reply = buildStudentContextReply(studentItem);
      const searchSummary = buildSearchSummary({
        path: "deterministic",
        query: lastUserMessage,
        tools: ["recent_student_context"],
        resultCount: 1
      });
      await createAiChatMessage({
        clerkUserId: user.clerk_user_id,
        role: "user",
        content: lastUserMessage,
        metadata: { intentType, path: "recent_context", source }
      });
      const assistantSaved = await createAiChatMessage({
        clerkUserId: user.clerk_user_id,
        role: "assistant",
        content: reply,
        metadata: {
          studentCards: [studentItem.summary],
          exportUrl: "",
          pdfUrl: "",
          viewUrl: "",
          intentType,
          path: "recent_context",
          resultCount: 1,
          searchSummary,
          source
        }
      });

      return {
        ...assistantSaved,
        reply,
        studentCards: [studentItem.summary],
        exportUrl: "",
        pdfUrl: "",
        viewUrl: "",
        searchSummary,
        pendingAction: null
      };
    }
  }

  if (intentType === "create_request") {
    const directCreateData = extractStudentCreateDataFromText(lastUserMessage);
    if (hasCreateStudentCoreData(directCreateData)) {
      const previewFields = buildStudentActionPreview(directCreateData);
      const pendingAction = {
        id: crypto.randomUUID(),
        type: "create_student_manual",
        createStudentData: directCreateData,
        previewFields
      };
      const reply = buildPendingActionReply({
        title: "הצעתי יצירת תלמיד חדש",
        intro: "זיהיתי בקשה ליצירת תלמיד מתוך ההודעה הנוכחית.",
        previewFields
      });
      const searchSummary = buildSearchSummary({ path: "tool", query: lastUserMessage, tools: ["direct_create_parser"], resultCount: 0 });
      await createAiChatMessage({ clerkUserId: user.clerk_user_id, role: "user", content: lastUserMessage, metadata: { intentType, path: "tool", source } });
      const assistantSaved = await createAiChatMessage({
        clerkUserId: user.clerk_user_id,
        role: "assistant",
        content: reply,
        metadata: { studentCards: [], exportUrl: "", pdfUrl: "", viewUrl: "", intentType, path: "tool", resultCount: 0, searchSummary, pendingAction, source }
      });
      return {
        ...assistantSaved,
        reply,
        studentCards: [],
        exportUrl: "",
        pdfUrl: "",
        viewUrl: "",
        searchSummary,
        pendingAction
      };
    }
  }

  if (intentType === "update_request" && contextualUpdateStudentId) {
    const directUpdateData = extractStudentUpdateDataFromText(lastUserMessage);
    if (Object.keys(directUpdateData).length) {
      const existingStudent = await getStudentForAgent(contextualUpdateStudentId);
      if (existingStudent?.summary?.id) {
        const previewFields = buildStudentActionPreview(directUpdateData);
        const pendingAction = {
          id: crypto.randomUUID(),
          type: "update_student",
          studentId: contextualUpdateStudentId,
          updateStudentData: directUpdateData,
          previewFields
        };
        const reply = buildPendingActionReply({
          title: "הצעתי עדכון תלמיד",
          intro: "זיהיתי בקשת עדכון על התלמיד מהשיחה האחרונה.",
          previewFields,
          studentName: existingStudent.summary.name
        });
        const searchSummary = buildSearchSummary({
          path: "deterministic",
          query: lastUserMessage,
          tools: ["recent_student_update_parser"],
          resultCount: 1
        });
        await createAiChatMessage({ clerkUserId: user.clerk_user_id, role: "user", content: lastUserMessage, metadata: { intentType, path: "recent_update", source } });
        const assistantSaved = await createAiChatMessage({
          clerkUserId: user.clerk_user_id,
          role: "assistant",
          content: reply,
          metadata: {
            studentCards: [existingStudent.summary],
            exportUrl: "",
            pdfUrl: "",
            viewUrl: "",
            intentType,
            path: "recent_update",
            resultCount: 1,
            searchSummary,
            pendingAction,
            source
          }
        });
        return {
          ...assistantSaved,
          reply,
          studentCards: [existingStudent.summary],
          exportUrl: "",
          pdfUrl: "",
          viewUrl: "",
          searchSummary,
          pendingAction
        };
      }
    }

    await createAiChatMessage({ clerkUserId: user.clerk_user_id, role: "user", content: lastUserMessage, metadata: { intentType, path: "recent_update_missing_fields", source } });
    const assistantSaved = await createAiChatMessage({
      clerkUserId: user.clerk_user_id,
      role: "assistant",
      content: "זיהיתי שזה עדכון על התלמיד האחרון שמצאתי, אבל חסר לי הערך המדויק לעדכון. אפשר לכתוב למשל: תעדכן כתובת אגסי 64 הר נוף, או תעדכן טלפון תלמיד 050..., או תעדכן רישום דתות.",
      metadata: {
        studentCards: [],
        exportUrl: "",
        pdfUrl: "",
        viewUrl: "",
        intentType,
        path: "recent_update_missing_fields",
        resultCount: 0,
        searchSummary: "זוהתה בקשת עדכון על תלמיד מהשיחה האחרונה, אבל לא זוהה ערך עדכון תקין",
        source
      }
    });
    return {
      ...assistantSaved,
      reply: assistantSaved.content,
      studentCards: [],
      exportUrl: "",
      pdfUrl: "",
      viewUrl: "",
      searchSummary: assistantSaved.searchSummary,
      pendingAction: null
    };
  }

  if (exactIdentityNumber) {
    const { students } = await findStudentsForAgent({
      filters: [{ field: "tznum", operator: "equals", value: exactIdentityNumber }]
    });
    const exactResult = buildExactFieldLookupReply(
      lastUserMessage,
      students,
      `מספר הזהות ${exactIdentityNumber} לא נמצא במערכת.`,
      { field: "tznum", value: exactIdentityNumber, label: "מספר הזהות" }
    );

    await createAiChatMessage({ clerkUserId: user.clerk_user_id, role: "user", content: lastUserMessage, metadata: { intentType, path: "deterministic_exact", source } });
    const assistantSaved = await createAiChatMessage({
      clerkUserId: user.clerk_user_id,
      role: "assistant",
      content: exactResult.reply,
      metadata: {
        studentCards: exactResult.studentCards,
        exportUrl: exactResult.exportUrl,
        viewUrl: exactResult.viewUrl,
        intentType,
        path: "deterministic_exact",
        resultCount: exactResult.studentCards.length,
        searchSummary: exactResult.searchSummary,
        source
      }
    });

    return {
      ...assistantSaved,
      ...exactResult,
      id: assistantSaved.id
    };
  }

  if (exactPhoneDigits && /(של מי|של\s*מי|למי|מי.*המספר|מספר.*של מי)/u.test(lastUserMessage)) {
    const phoneFields = [
      "phone.primaryPhoneNumber",
      "dadPhone.primaryPhoneNumber",
      "momPhone.primaryPhoneNumber"
    ];

    let students = [];
    let matchedField = "";
    for (const field of phoneFields) {
      const result = await findStudentsForAgent({
        filters: [{ field, operator: "contains", value: exactPhoneDigits }]
      });
      if (result.students.length) {
        students = result.students;
        matchedField = field;
        break;
      }
    }

    const exactResult = buildExactFieldLookupReply(
      lastUserMessage,
      students,
      `לא נמצא תלמיד עם המספר ${exactPhoneDigits}.`,
      { field: matchedField || "phone.primaryPhoneNumber", value: exactPhoneDigits, label: "המספר" }
    );

    await createAiChatMessage({ clerkUserId: user.clerk_user_id, role: "user", content: lastUserMessage, metadata: { intentType, path: "deterministic_exact", source } });
    const assistantSaved = await createAiChatMessage({
      clerkUserId: user.clerk_user_id,
      role: "assistant",
      content: exactResult.reply,
      metadata: {
        studentCards: exactResult.studentCards,
        exportUrl: exactResult.exportUrl,
        viewUrl: exactResult.viewUrl,
        intentType,
        path: "deterministic_exact",
        resultCount: exactResult.studentCards.length,
        searchSummary: exactResult.searchSummary,
        source
      }
    });

    return {
      ...assistantSaved,
      ...exactResult,
      id: assistantSaved.id
    };
  }

  if (missingFieldQuery) {
    const missingFilters = [
      ...inferredChoiceFilters,
      { field: missingFieldQuery.field, operator: "empty", value: "" }
    ];
    const { students, effectiveFilters } = await findStudentsForAgent({ filters: missingFilters });
    const exportUrl = effectiveFilters.length ? buildExportUrlForFilters(effectiveFilters) : "";
    const pdfUrl = effectiveFilters.length && isInstitutionLevelQuery({ query: lastUserMessage, filters: effectiveFilters })
      ? buildInstitutionPdfUrlForFilters(effectiveFilters)
      : "";
    const sortLevels = exportUrl || pdfUrl ? defaultReportSortLevels() : [];
    const viewUrl = buildNeonViewUrlForAgent({ filters: effectiveFilters });
    const describedFilters = describeAgentFilters(effectiveFilters.filter((filter) => !(clean(filter?.field) === missingFieldQuery.field && clean(filter?.operator) === "empty")));
    const scopeText = describedFilters.length ? ` מתוך הסינון: ${describedFilters.join(" | ")}` : "";
    const wantsList = isMissingFieldListQuery(lastUserMessage);
    const reply = wantsList
      ? buildQuantitativeReply({ students, requestedLimit, viewUrl })
      : `ל-${students.length} תלמידים חסר השדה ${missingFieldQuery.label}${scopeText}.`;
    const searchSummary = buildSearchSummary({
      path: "deterministic",
      query: lastUserMessage,
      filters: effectiveFilters,
      resultCount: students.length
    });
    await createAiChatMessage({ clerkUserId: user.clerk_user_id, role: "user", content: lastUserMessage, metadata: { intentType, path: "deterministic_missing_field", source } });
    const assistantMessage = await createAiChatMessage({
      clerkUserId: user.clerk_user_id,
      role: "assistant",
      content: reply,
      metadata: {
        studentCards: [],
        exportUrl,
        pdfUrl,
        exportColumns: exportUrl ? DEFAULT_TELEGRAM_EXPORT_COLUMNS : [],
        sortLevels,
        viewUrl,
        intentType,
        path: "deterministic_missing_field",
        resultCount: students.length,
        searchSummary,
        source
      }
    });

    return { ...assistantMessage, reply, exportUrl, pdfUrl, sortLevels, viewUrl, searchSummary, pendingAction: null };
  }

  if (intentType !== "create_request" && intentType !== "update_request" && (quantitativeListRequest || choiceFieldQuery || contextualFilters.length)) {
    const baseQuery = contextualFilters.length && !choiceFieldQuery ? "" : lastUserMessage;
    const { students, effectiveFilters } = await findStudentsForAgent({ query: baseQuery, filters: contextualFilters, minScore: 0.4 });
    const textOnlyChoiceResponse = choiceFieldQuery && students.length > 1;
    const finalStudentCards = textOnlyChoiceResponse
      ? []
      : students.slice(0, 7).map((student) => buildStudentSummary(student)).filter(Boolean);
    const exportUrl = effectiveFilters.length ? buildExportUrlForFilters(effectiveFilters) : "";
    const pdfUrl = effectiveFilters.length && isInstitutionLevelQuery({ query: lastUserMessage, filters: effectiveFilters })
      ? buildInstitutionPdfUrlForFilters(effectiveFilters)
      : "";
    const sortLevels = exportUrl || pdfUrl ? defaultReportSortLevels() : [];
    const viewUrl = buildNeonViewUrlForAgent({ query: lastUserMessage, filters: effectiveFilters });
    const reply = isStudentCityListQuery(lastUserMessage)
      ? buildStudentCityReply(students, requestedLimit)
      : isCityBreakdownQuery(lastUserMessage)
        ? buildCityBreakdownReply(students)
        : buildQuantitativeReply({ students, requestedLimit, viewUrl });
    const searchSummary = buildSearchSummary({ path: "deterministic", query: lastUserMessage, filters: effectiveFilters, resultCount: students.length });
    await createAiChatMessage({ clerkUserId: user.clerk_user_id, role: "user", content: lastUserMessage, metadata: { intentType, path: "deterministic", source } });
    const assistantMessage = await createAiChatMessage({
      clerkUserId: user.clerk_user_id,
      role: "assistant",
      content: reply,
      metadata: {
        studentCards: finalStudentCards,
        exportUrl,
        pdfUrl,
        exportColumns: exportUrl ? DEFAULT_TELEGRAM_EXPORT_COLUMNS : [],
        sortLevels,
        viewUrl,
        intentType,
        path: "deterministic",
        resultCount: students.length,
        searchSummary,
        source
      }
    });

    return { ...assistantMessage, reply, exportUrl, pdfUrl, sortLevels, viewUrl, searchSummary, pendingAction: null };
  }

  const systemPrompt = {
    role: "system",
    content: [
      "אתה סוכן פנימי של מערכת CRM תלמידים.",
      "המטרה שלך היא לעזור למשתמש במהירות ובשפה טבעית, בלי ניסוחים רובוטיים מיותרים.",
      "אתה עונה רק על בסיס כלי המערכת והמידע שהוחזר מהם.",
      "כאשר נשאלת שאלה על תלמיד או רשימת תלמידים, השתמש בכלי החיפוש לפני מתן תשובה.",
      "כאשר המשתמש מבקש ליצור תלמיד או לעדכן שדות, לעולם אל תבצע פעולה ישירה. השתמש רק בכלי proposal כדי להציע פעולה ממתינה לאישור.",
      "כאשר המשתמש מבקש ליצור תלמיד ויש מספיק פרטים, עבור ישר להצעת יצירה. אל תסביר מה אפשר לעשות ואל תתחמק.",
      recentMentionedStudentContext
        ? `בהודעה הנוכחית המשתמש מזכיר במפורש תלמיד מהרשימה האחרונה: ${recentMentionedStudentContext.studentName} (${recentMentionedStudentContext.studentId}). התייחס לזה כהמשך שיחה ב-CRM.`
        : "",
      recentFocusedStudentContext && intentType === "update_request" && !recentMentionedStudentContext
        ? `התלמיד האחרון שהיה במוקד התשובה הקודמת הוא ${recentFocusedStudentContext.studentName} (${recentFocusedStudentContext.studentId}). אם המשתמש כתב תעדכן/שנה בלי שם חדש, ברירת המחדל היא שזה עליו.`
        : "",
      contextualUpdateStudentId && intentType === "update_request"
        ? `המשתמש מבקש לעדכן את התלמיד האחרון שזוהה בשיחה: ${clean(recentMentionedStudentContext?.studentName || recentFocusedStudentContext?.studentName || recentStudentContext?.studentName)} (${contextualUpdateStudentId}). אם יש מספיק פרטי עדכון, עבור ישר ל-propose_update_student.`
        : "",
      recentStudentContext && intentType === "update_request" && hasFollowUpReference(lastUserMessage)
        ? `בשאלת ההמשך הנוכחית הכינוי מתייחס לתלמיד האחרון שהוצג: ${recentStudentContext.studentName} (${recentStudentContext.studentId}).`
        : "",
      "כאשר המשתמש כותב בן אדם, אדם, איש, בחור, מי זה או מי זאת בהקשר חיפוש, הכוונה היא לתלמיד במערכת.",
      "כאשר המשתמש שואל על שם, על מי זה, של מי השם, או מזכיר שם של אדם בלי הקשר אחר, ברירת המחדל היא שמדובר בתלמיד במערכת.",
      "חיפוש שמות חייב להיות משוער לפי ציון התאמה ולא התאמה מדויקת בלבד. גם אם יש שגיאת כתיב בשם, השתמש בכלי search_students עם טקסט השם.",
      "אל תכתוב כתובות URL של כרטיסי תלמיד בגוף התשובה. אם יש כרטיס תלמיד, המערכת תציג קישור נפרד.",
      "כאשר השאלה עוסקת במוסד, שיעור, רישום או סטטוס משפחתי, העדף search_students עם filters על שדות enum ולא רק query חופשי.",
      "אם המשתמש כתב שם אנושי של ערך בחירה כמו חכמי ירושלים, התאם אותו לערך המערכת המתאים כמו CY.",
      "אם יש יותר מתוצאה אחת, ציין זאת בצורה ברורה ונעימה. ברשימות, כל תלמיד בשורה נפרדת.",
      requestedLimit ? `המשתמש ביקש במפורש מספר תוצאות. השתמש לכל היותר ב-${requestedLimit} תוצאות אלא אם ביקש אחרת.` : "",
      "אם אין מספיק מידע, בקש הבהרה קצרה.",
      "ענה בעברית, קצר, ברור, ענייני וטבעי."
    ].filter(Boolean).join(" ")
  };

  const conversationForModel = intentType === "create_request" && !hasFollowUpReference(lastUserMessage)
    ? []
    : recentConversation;
  const messages = [systemPrompt, ...conversationForModel, { role: "user", content: lastUserMessage }];
  const tools = buildTools();
  const referencedStudents = new Map();
  const usedTools = [];
  let finalPendingAction = null;
  let finalMessage = "";

  for (let iteration = 0; iteration < 5; iteration += 1) {
    const assistantMessage = await callOpenAI(messages, tools);
    if (!assistantMessage) break;
    if (Array.isArray(assistantMessage.tool_calls) && assistantMessage.tool_calls.length) {
      messages.push({ role: "assistant", content: assistantMessage.content || "", tool_calls: assistantMessage.tool_calls });
      for (const toolCall of assistantMessage.tool_calls) {
        const result = await executeToolCall(toolCall, {
          lastUserMessage,
          intentType,
          recentStudentId: recentMentionedStudentContext?.studentId || recentFocusedStudentContext?.studentId || recentStudentContext?.studentId || ""
        });
        if (toolCall?.function?.name) usedTools.push(toolCall.function.name);
        collectStudentCards(referencedStudents, result);
        finalPendingAction = collectPendingAction(result) || finalPendingAction;
        messages.push({ role: "tool", tool_call_id: toolCall.id, content: JSON.stringify(result) });
      }
      continue;
    }
    finalMessage = clean(assistantMessage.content);
    break;
  }

  const finalStudentCards = Array.from(referencedStudents.values()).slice(0, 7);
  if (intentType === "create_request" && !finalPendingAction) {
    const createContextText = hasFollowUpReference(lastUserMessage)
      ? [...recentConversation.map((item) => item.content), lastUserMessage].filter(Boolean).join("\n")
      : lastUserMessage;
    const directCreateData = extractStudentCreateDataFromText(createContextText);
    if (hasCreateStudentCoreData(directCreateData)) {
      const previewFields = buildStudentActionPreview(directCreateData);
      finalPendingAction = {
        id: crypto.randomUUID(),
        type: "create_student_manual",
        createStudentData: directCreateData,
        previewFields
      };
      finalMessage = buildPendingActionReply({
        title: "הצעתי יצירת תלמיד חדש",
        intro: "זיהיתי בקשה ליצירת תלמיד.",
        previewFields
      });
    } else {
      const retriedProposal = await attemptCreateStudentProposal({ lastUserMessage, recentConversation });
      if (retriedProposal?.pendingAction) {
        finalPendingAction = retriedProposal.pendingAction;
        finalMessage = clean(retriedProposal.reply) || buildPendingActionReply({
          title: "הצעתי יצירת תלמיד חדש",
          intro: "זיהיתי בקשה ליצירת תלמיד.",
          previewFields: retriedProposal.pendingAction.previewFields || []
        });
      } else if (clean(retriedProposal?.reply)) {
        finalMessage = clean(retriedProposal.reply);
      } else {
        finalMessage = "כדי להכין יצירת תלמיד אני צריך לפחות שם פרטי ושם משפחה. אפשר לכתוב למשל: צור תלמיד בשם ישראל כהן, ת\"ז 123456789, מוסד חכמי ירושלים.";
      }
    }
  }

  const searchSummary = buildSearchSummary({ path: "tool", query: lastUserMessage, minScore: 0.4, tools: Array.from(new Set(usedTools)), resultCount: finalStudentCards.length });
  const exportUrl = "";
  const pdfUrl = "";
  const sortLevels = [];
  const viewUrl = "";

  await createAiChatMessage({ clerkUserId: user.clerk_user_id, role: "user", content: lastUserMessage, metadata: { intentType, path: "tool", source } });
  const assistantSaved = await createAiChatMessage({
    clerkUserId: user.clerk_user_id,
    role: "assistant",
    content: finalMessage || "לא הצלחתי להשלים תשובה.",
    metadata: { studentCards: finalStudentCards, exportUrl, pdfUrl, sortLevels, viewUrl, intentType, path: "tool", resultCount: finalStudentCards.length, searchSummary, pendingAction: finalPendingAction, source }
  });

  return {
    ...assistantSaved,
    reply: finalMessage || "לא הצלחתי להשלים תשובה.",
    studentCards: finalStudentCards,
    exportUrl,
    pdfUrl,
    sortLevels,
    viewUrl,
    searchSummary,
    pendingAction: finalPendingAction
  };
}

export async function handleApprovedAiAction({ user, decision, pendingAction, messageId = "" }) {
  if (!pendingAction || typeof pendingAction !== "object") throw new Error("Missing pending action");
  const finalizePendingAction = async () => {
    if (!clean(messageId)) return;
    await clearAiChatMessagePendingAction({
      messageId,
      clerkUserId: user.clerk_user_id
    });
  };
  if (decision === "reject") {
    const reply = "הפעולה נדחתה. לא בוצע שום שינוי.";
    await finalizePendingAction();
    await createAiChatMessage({ clerkUserId: user.clerk_user_id, role: "assistant", content: reply, metadata: { searchSummary: "הפעולה נדחתה על ידי המשתמש" } });
    return { reply, studentCards: [], searchSummary: "הפעולה נדחתה על ידי המשתמש" };
  }
  if (decision !== "approve") throw new Error("Invalid decision");

  if (pendingAction.type === "update_student") {
    const updatedStudent = await updateNeonStudentViaTwenty(clean(pendingAction.studentId), pendingAction.updateStudentData || {});
    if (!updatedStudent?.id) throw new Error("עדכון התלמיד נכשל.");
    const reply = `העדכון בוצע בכרטיס התלמיד: ${updatedStudent.label || updatedStudent.name || updatedStudent.id}.`;
    await finalizePendingAction();
    await createAiChatMessage({ clerkUserId: user.clerk_user_id, role: "assistant", content: reply, metadata: { studentCards: [buildStudentSummary(updatedStudent)], searchSummary: "בוצע עדכון תלמיד אחרי אישור מפורש" } });
    return { reply, studentCards: [buildStudentSummary(updatedStudent)], searchSummary: "בוצע עדכון תלמיד אחרי אישור מפורש" };
  }

  if (pendingAction.type === "create_student_manual") {
    try {
      const createdStudent = await createNeonStudentViaTwenty(pendingAction.createStudentData || {});
      const reply = `נוצר תלמיד חדש: ${createdStudent?.label || createdStudent?.name || createdStudent?.id || "-"}.`;
      const followUpHint = ' האם תרצה לעדכן מידע נוסף? אפשר לכתוב למשל: "תעדכן לו טלפון 050..." או "תעדכן כתובת".';
      await finalizePendingAction();
      await createAiChatMessage({ clerkUserId: user.clerk_user_id, role: "assistant", content: `${reply}${followUpHint}`, metadata: { studentCards: createdStudent ? [buildStudentSummary(createdStudent)] : [], searchSummary: "בוצעה יצירת תלמיד אחרי אישור מפורש" } });
      return { reply: `${reply}${followUpHint}`, studentCards: createdStudent ? [buildStudentSummary(createdStudent)] : [], searchSummary: "בוצעה יצירת תלמיד אחרי אישור מפורש" };
    } catch (error) {
      if (error?.code === "DUPLICATE_STUDENT") {
        const existingStudent = error?.student || null;
        const reply = `לא נוצר תלמיד חדש כי נמצאה כפילות: ${error?.message || "כבר קיים תלמיד דומה במערכת."}`;
        await finalizePendingAction();
        await createAiChatMessage({
          clerkUserId: user.clerk_user_id,
          role: "assistant",
          content: reply,
          metadata: {
            studentCards: existingStudent ? [buildStudentSummary(existingStudent)].filter(Boolean) : [],
            searchSummary: "נמנעה יצירת תלמיד כפול"
          }
        });
        return {
          reply,
          studentCards: existingStudent ? [buildStudentSummary(existingStudent)].filter(Boolean) : [],
          searchSummary: "נמנעה יצירת תלמיד כפול"
        };
      }
      throw error;
    }
  }

  let studentId = clean(pendingAction.suggestedStudentId);
  let createdStudent = null;
  if (pendingAction.type === "create_student") {
    const data = pendingAction.createStudentData || {};
    if (!Object.keys(data).length) throw new Error("אין מספיק פרטים ליצירת תלמיד.");
    try {
      createdStudent = await createNeonStudentViaTwenty(data);
    } catch (error) {
      if (error?.code === "DUPLICATE_STUDENT") {
        const existingStudent = error?.student || null;
        const reply = `לא נוצר תלמיד חדש כי נמצאה כפילות: ${error?.message || "כבר קיים תלמיד דומה במערכת."}`;
        await finalizePendingAction();
        await createAiChatMessage({
          clerkUserId: user.clerk_user_id,
          role: "assistant",
          content: reply,
          metadata: {
            studentCards: existingStudent ? [buildStudentSummary(existingStudent)].filter(Boolean) : [],
            searchSummary: "נמנעה יצירת תלמיד כפול"
          }
        });
        return {
          reply,
          studentCards: existingStudent ? [buildStudentSummary(existingStudent)].filter(Boolean) : [],
          searchSummary: "נמנעה יצירת תלמיד כפול"
        };
      }
      throw error;
    }
    studentId = clean(createdStudent?.id);
    if (!studentId) throw new Error("יצירת התלמיד נכשלה.");
  }

  if (pendingAction.type === "attach_document" || pendingAction.type === "create_student") {
    if (!studentId) throw new Error("Missing student id for document attachment.");
    const existingStudentItem = createdStudent ? null : await getStudentForAgent(studentId);
    const existingStudentSummary = existingStudentItem?.summary || null;
    const documentInfo = pendingAction.documentInfo || {};
    const storedDocument = pendingAction.storedDocument || {};
    const document = await createStudentDocumentFromStoredObject({
      studentId,
      uploadedByUserId: user.clerk_user_id,
      fileName: storedDocument.fileName,
      displayName: documentInfo.documentName || storedDocument.fileName,
      noteText: documentInfo.documentSummary,
      contentType: storedDocument.contentType,
      objectKey: storedDocument.objectKey,
      sizeBytes: storedDocument.sizeBytes,
      documentKind: "id"
    });

    const reply = createdStudent
      ? `נוצר תלמיד חדש והמסמך שויך לכרטיס: ${createdStudent.label || createdStudent.name || studentId}.`
      : "המסמך שויך לכרטיס התלמיד.";
    const followUpHint = createdStudent
      ? ' האם תרצה לעדכן מידע נוסף? אפשר לכתוב למשל: "תעדכן לו טלפון 050..." או "תעדכן כתובת".'
      : "";
    await finalizePendingAction();
    await createAiChatMessage({
      clerkUserId: user.clerk_user_id,
      role: "assistant",
      content: `${reply}${followUpHint}`,
      metadata: {
        attachedDocumentId: document.id,
        studentCards: createdStudent
          ? [buildStudentSummary(createdStudent)].filter(Boolean)
          : existingStudentSummary ? [existingStudentSummary] : [],
        searchSummary: createdStudent ? "נוצר תלמיד חדש והמסמך שויך אחרי אישור מפורש" : "המסמך שויך אחרי אישור מפורש"
      }
    });
    return {
      reply: `${reply}${followUpHint}`,
      studentCards: createdStudent
        ? [buildStudentSummary(createdStudent)].filter(Boolean)
        : existingStudentSummary ? [existingStudentSummary] : [],
      searchSummary: createdStudent ? "נוצר תלמיד חדש והמסמך שויך אחרי אישור מפורש" : "המסמך שויך אחרי אישור מפורש"
    };
  }

  throw new Error("Unsupported pending action for this channel.");
}

export async function getPendingActionForMessage({ clerkUserId, messageId }) {
  const message = await getAiChatMessageById({ clerkUserId, messageId });
  if (!message?.pendingAction) return null;
  const createdAt = new Date(message.createdAt || 0).getTime();
  const maxAgeMs = 3 * 60 * 60 * 1000;
  if (!Number.isFinite(createdAt) || Date.now() - createdAt > maxAgeMs) {
    await clearAiChatMessagePendingAction({ clerkUserId, messageId }).catch(() => null);
    return null;
  }
  return message.pendingAction;
}
