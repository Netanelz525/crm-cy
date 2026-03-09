export const FIELD_SECTIONS = [
  {
    title: "מידע תלמיד ורישום",
    fields: [
      { key: "fullName.firstName", label: "שם פרטי" },
      { key: "fullName.lastName", label: "שם משפחה" },
      { key: "famliystatus", label: "סטטוס משפחתי", enum: "familystatus" },
      { key: "tznum", label: "ת\"ז" },
      { key: "dateofbirth", label: "תאריך לידה", type: "date" },
      { key: "healthInsurance", label: "בריאות - קופה", enum: "healthInsurance" },
      { key: "currentInstitution", label: "מוסד נוכחי", enum: "currentInstitution" },
      { key: "class", label: "כיתה", enum: "class" },
      { key: "registration", label: "רישום", enum: "registration" },
      { key: "macAddress", label: "macAddress" },
      { key: "phone.primaryPhoneNumber", label: "טלפון תלמיד - מספר" },
      { key: "phone.primaryPhoneCountryCode", label: "טלפון תלמיד - קוד מדינה" },
      { key: "phone.primaryPhoneCallingCode", label: "טלפון תלמיד - קידומת חיוג" },
      { key: "phone.additionalPhones", label: "טלפונים נוספים לתלמיד", isList: true },
      { key: "email.primaryEmail", label: "אימייל תלמיד" },
      { key: "email.additionalEmails", label: "אימיילים נוספים תלמיד", isList: true },
      { key: "note", label: "הערה חופשית" }
    ]
  },
  {
    title: "מידע הורים",
    fields: [
      { key: "shmHb", label: "שם אב (עברית)" },
      { key: "shmHm", label: "שם אם (עברית)" },
      { key: "tzMotherNum", label: "ת\"ז אם" },
      { key: "tzaba", label: "ת\"ז אבא" },
      { key: "fatherDatebirth", label: "תאריך לידת האב", type: "date" },
      { key: "motherDateBirth", label: "תאריך לידת האם", type: "date" },
      { key: "dadPhone.primaryPhoneNumber", label: "טלפון אב - מספר" },
      { key: "dadPhone.primaryPhoneCountryCode", label: "טלפון אב - קוד מדינה" },
      { key: "dadPhone.primaryPhoneCallingCode", label: "טלפון אב - קידומת חיוג" },
      { key: "dadPhone.additionalPhones", label: "טלפונים נוספים לאב", isList: true },
      { key: "momPhone.primaryPhoneNumber", label: "טלפון אם - מספר" },
      { key: "momPhone.primaryPhoneCountryCode", label: "טלפון אם - קוד מדינה" },
      { key: "momPhone.primaryPhoneCallingCode", label: "טלפון אם - קידומת חיוג" },
      { key: "momPhone.additionalPhones", label: "טלפונים נוספים לאם", isList: true },
      { key: "motherEmail.primaryEmail", label: "אימייל אם" },
      { key: "motherEmail.additionalEmails", label: "אימיילים נוספים אם", isList: true },
      { key: "fatherEmail.primaryEmail", label: "אימייל אב" },
      { key: "fatherEmail.additionalEmails", label: "אימיילים נוספים אב", isList: true }
    ]
  },
  {
    title: "כתובת",
    fields: [
      { key: "adders.addressStreet1", label: "רחוב 1" },
      { key: "adders.addressStreet2", label: "רחוב 2" },
      { key: "adders.addressCity", label: "עיר" },
      { key: "adders.addressPostcode", label: "מיקוד" },
      { key: "adders.addressState", label: "מחוז/מדינה" },
      { key: "adders.addressCountry", label: "מדינה" },
      { key: "adders.addressLat", label: "קו רוחב" },
      { key: "adders.addressLng", label: "קו אורך" }
    ]
  },
  {
    title: "פרטי בנק",
    fields: [
      { key: "senif", label: "סניף" },
      { key: "bankNum", label: "מספר בנק" },
      { key: "accountNum", label: "מספר חשבון" }
    ]
  }
];

export const ENUM_LABELS = {
  healthInsurance: {
    MACCABI: "מכבי",
    MEUHEDET: "מאוחדת",
    MEUHEDDET: "מאוחדת",
    CLALIT: "כללית",
    LEUMIT: "לאומית"
  },
  class: {
    Z: "אברך",
    A: "שיעור א",
    B: "שיעור ב",
    C: "שיעור ג",
    D: "שיעור ד",
    E: "שיעור ה",
    X: "קיבוץ",
    TEAM: "צוות"
  },
  currentInstitution: {
    YR: "יחי ראובן",
    OE: "אור אפרים",
    CY: "חכמי ירושלים",
    BOGER: "בוגר",
    BOGERNCONTACT: "בוגר ללא יצירת קשר",
    TEST: "טסט"
  },
  registration: {
    MINISTRY_OF_EDUCATION: "משרד החינוך",
    DATOT: "דתות",
    NOT_ELIGIBLE: "לא זכאי",
    UPDATE_DATOT: "לעדכן דתות",
    UPDATE_EDUCATION: "לעדכן חינוך"
  },
  familystatus: {
    SINGLE: "רווק",
    MARRIED: "נשוי",
    DIVORCED: "גרוש",
    WIDOWED: "אלמן"
  }
};

export function cleanString(value) {
  return String(value || "").trim();
}

export function getByPath(obj, path) {
  return String(path)
    .split(".")
    .reduce((acc, part) => (acc && acc[part] !== undefined ? acc[part] : undefined), obj);
}

function setNested(target, path, value) {
  const parts = String(path).split(".");
  let current = target;
  for (let i = 0; i < parts.length - 1; i += 1) {
    const part = parts[i];
    if (!current[part] || typeof current[part] !== "object") current[part] = {};
    current = current[part];
  }
  current[parts[parts.length - 1]] = value;
}

function parseListValue(value) {
  return cleanString(value)
    .split(/[\n,]/)
    .map((v) => cleanString(v))
    .filter(Boolean);
}

function pruneEmpty(value) {
  if (Array.isArray(value)) {
    const out = value.map(pruneEmpty).filter((v) => v !== undefined);
    return out.length ? out : undefined;
  }
  if (value && typeof value === "object") {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      const cleaned = pruneEmpty(v);
      if (cleaned !== undefined) out[k] = cleaned;
    }
    return Object.keys(out).length ? out : undefined;
  }
  if (value === null || value === undefined) return undefined;
  if (typeof value === "string" && value.trim() === "") return undefined;
  return value;
}

export function hasDisplayValue(value) {
  if (value === null || value === undefined) return false;
  if (typeof value === "string") return value.trim() !== "";
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === "object") return Object.values(value).some(hasDisplayValue);
  return true;
}

function toDateInputValue(value) {
  const raw = cleanString(value);
  if (!raw) return "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return "";
  return d.toISOString().slice(0, 10);
}

function toDateStorageValue(dateInput) {
  const raw = cleanString(dateInput);
  if (!raw) return "";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  return `${raw}T00:00:00.000Z`;
}

export function studentToFormValues(student) {
  const values = {};
  for (const section of FIELD_SECTIONS) {
    for (const field of section.fields) {
      const value = getByPath(student, field.key);
      if (value === null || value === undefined) continue;
      if (Array.isArray(value)) {
        values[field.key] = value.join(", ");
      } else if (field.type === "date") {
        values[field.key] = toDateInputValue(value);
      } else {
        values[field.key] = String(value);
      }
    }
  }
  return values;
}

export function toFormData(rawForm) {
  const firstName = cleanString(rawForm["fullName.firstName"] || rawForm.firstName);
  const lastName = cleanString(rawForm["fullName.lastName"] || rawForm.lastName);
  const fullNameText = `${firstName} ${lastName}`.trim();

  const data = {};

  for (const section of FIELD_SECTIONS) {
    for (const field of section.fields) {
      const rawValue = rawForm[field.key];
      if (rawValue === undefined) continue;
      let value;
      if (field.isList) {
        value = parseListValue(rawValue);
      } else if (field.type === "date") {
        value = toDateStorageValue(rawValue);
      } else {
        value = cleanString(rawValue);
      }

      if ((Array.isArray(value) && value.length === 0) || (!Array.isArray(value) && cleanString(value) === "")) {
        continue;
      }

      setNested(data, field.key, value);
    }
  }

  if (firstName || lastName) {
    data.fullName = { firstName, lastName };
    data.name = fullNameText;
  }

  for (const phoneKey of ["phone", "dadPhone", "momPhone"]) {
    const phoneObj = data[phoneKey];
    if (phoneObj?.primaryPhoneNumber) {
      if (!phoneObj.primaryPhoneCountryCode) phoneObj.primaryPhoneCountryCode = "IL";
      if (!phoneObj.primaryPhoneCallingCode) phoneObj.primaryPhoneCallingCode = "+972";
      if (!Array.isArray(phoneObj.additionalPhones)) phoneObj.additionalPhones = [];
    }
  }

  for (const emailKey of ["email", "fatherEmail", "motherEmail"]) {
    const emailObj = data[emailKey];
    if (emailObj?.primaryEmail && !Array.isArray(emailObj.additionalEmails)) {
      emailObj.additionalEmails = [];
    }
  }

  if (data.adders && !data.adders.addressCountry) {
    data.adders.addressCountry = "Israel";
  }

  return pruneEmpty(data) || {};
}


