const http = require('node:http');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { URL } = require('node:url');

loadDotEnv();

const PORT = process.env.PORT || 3000;
const API_URL = 'https://api.twenty.com/graphql';
const API_TOKEN = process.env.TWENTY_API_TOKEN;
const TELEGRAM_TOKEN = process.env.TELG2ARM_TOKEN || process.env.TELEGRAM_TOKEN;
const TELEGRAM_ADMIN_ID = process.env.ADMIN_ID;
const WEBHOOK_URL = process.env.WEBHOOK;
const TWENTY_LINK = process.env.TWENTY_LINK || '';
const CRM_BASE_URL = process.env.CRM_BASE_URL || process.env.APP_BASE_URL || '';
const AUTH_SETUP_PASSWORD = process.env.AUTH_SETUP_PASSWORD || 'A1235';
const AUTH_ISSUER = process.env.AUTH_ISSUER || 'CRM Students';
const AUTH_PASSKEY_RP_ID = cleanString(process.env.AUTH_PASSKEY_RP_ID);
const AUTH_PASSKEY_ALLOWED_ORIGINS = cleanString(process.env.AUTH_PASSKEY_ALLOWED_ORIGINS);
const SESSION_TTL_MS = 2 * 24 * 60 * 60 * 1000;
const SESSION_COOKIE_NAME = 'crm_session';
const USERS_DB_PATH = path.join(process.cwd(), 'users.local.json');
const SESSIONS_DB_PATH = path.join(process.cwd(), 'sessions.local.json');
const INTERNAL_STUDENTS_DB_PATH = path.join(process.cwd(), 'students.internal.local.json');
const PASSKEY_CHALLENGE_TTL_MS = 5 * 60 * 1000;
const passkeyChallenges = new Map();

const SEARCH_QUERY = `
query Search($searchInput: String!, $limit: Int!, $after: String, $excludedObjectNameSingulars: [String!], $includedObjectNameSingulars: [String!], $filter: ObjectRecordFilterInput) {
  search(
    searchInput: $searchInput
    limit: $limit
    after: $after
    excludedObjectNameSingulars: $excludedObjectNameSingulars
    includedObjectNameSingulars: $includedObjectNameSingulars
    filter: $filter
  ) {
    edges {
      node {
        recordId
        objectNameSingular
        label
        imageUrl
        tsRankCD
        tsRank
        __typename
      }
      cursor
      __typename
    }
    pageInfo {
      hasNextPage
      endCursor
      __typename
    }
    __typename
  }
}
`;

const STUDENTS_BY_INSTITUTION_QUERY = `
query StudentsByInstitution($currentInstitution: StudentCurrentInstitutionEnum!, $first: Int!, $after: String) {
  students(first: $first, after: $after, filter: { currentInstitution: { eq: $currentInstitution } }) {
    edges {
      node {
        id
        name
        fullName {
          firstName
          lastName
        }
        dateofbirth
        class
        phone {
          primaryPhoneNumber
          primaryPhoneCountryCode
          primaryPhoneCallingCode
        }
        dadPhone {
          primaryPhoneNumber
          primaryPhoneCountryCode
          primaryPhoneCallingCode
        }
        momPhone {
          primaryPhoneNumber
          primaryPhoneCountryCode
          primaryPhoneCallingCode
        }
        currentInstitution
      }
    }
    pageInfo {
      hasNextPage
      endCursor
    }
  }
}
`;

const STUDENT_DETAILS_QUERY = `
query StudentById($id: UUID!) {
  student(filter: { id: { eq: $id } }) {
    id
    createdAt
    updatedAt
    shmPrty
    fullName {
      firstName
      lastName
    }
    shmHb
    shmHm
    famliystatus
    tznum
    tzMotherNum
    tzaba
    dateofbirth
    healthInsurance
    note
    fatherDatebirth
    motherDateBirth
    dadPhone {
      primaryPhoneNumber
      primaryPhoneCountryCode
      primaryPhoneCallingCode
      additionalPhones
    }
    momPhone {
      primaryPhoneNumber
      primaryPhoneCountryCode
      primaryPhoneCallingCode
      additionalPhones
    }
    motherEmail {
      primaryEmail
      additionalEmails
    }
    fatherEmail {
      primaryEmail
      additionalEmails
    }
    phone {
      primaryPhoneNumber
      primaryPhoneCountryCode
      primaryPhoneCallingCode
      additionalPhones
    }
    email {
      primaryEmail
      additionalEmails
    }
    adders {
      addressStreet1
      addressStreet2
      addressCity
      addressPostcode
      addressState
      addressCountry
      addressLat
      addressLng
    }
    currentInstitution
    class
    registration
    senif
    bankNum
    accountNum
  }
}
`;

const STUDENTS_BY_TZ_QUERY = `
query StudentsByTz($tznum: String!, $first: Int!) {
  students(first: $first, filter: { tznum: { eq: $tznum } }) {
    edges {
      node {
        id
        name
        fullName {
          firstName
          lastName
        }
        class
        dateofbirth
        phone {
          primaryPhoneNumber
          primaryPhoneCountryCode
          primaryPhoneCallingCode
        }
      }
    }
  }
}
`;

const CREATE_STUDENT_MUTATION = `
mutation CreateStudent($data: StudentCreateInput!) {
  createStudent(data: $data) {
    id
    name
    fullName {
      firstName
      lastName
    }
  }
}
`;

const UPDATE_STUDENT_MUTATION = `
mutation UpdateStudent($id: UUID!, $data: StudentUpdateInput!) {
  updateStudent(id: $id, data: $data) {
    id
  }
}
`;

const FIELD_SECTIONS = [
  {
    title: 'מידע תלמיד ורישום',
    fields: [
      { key: 'fullName.firstName', label: 'שם פרטי' },
      { key: 'fullName.lastName', label: 'שם משפחה' },
      { key: 'famliystatus', label: 'סטטוס משפחתי', enum: 'familystatus' },
      { key: 'tznum', label: 'ת"ז' },
      { key: 'dateofbirth', label: 'תאריך לידה', type: 'date' },
      { key: 'healthInsurance', label: 'בריאות - קופה', enum: 'healthInsurance' },
      { key: 'currentInstitution', label: 'מוסד נוכחי', enum: 'currentInstitution' },
      { key: 'class', label: 'כיתה', enum: 'class' },
      { key: 'registration', label: 'רישום', enum: 'registration' },
      { key: 'phone.primaryPhoneNumber', label: 'טלפון תלמיד - מספר' },
      { key: 'phone.primaryPhoneCountryCode', label: 'טלפון תלמיד - קוד מדינה' },
      { key: 'phone.primaryPhoneCallingCode', label: 'טלפון תלמיד - קידומת חיוג' },
      { key: 'phone.additionalPhones', label: 'טלפונים נוספים לתלמיד' },
      { key: 'email.primaryEmail', label: 'אימייל תלמיד' },
      { key: 'email.additionalEmails', label: 'אימיילים נוספים תלמיד' },
      { key: 'note', label: 'הערה חופשית' }
    ]
  },
  {
    title: 'מידע הורים',
    fields: [
      { key: 'shmHb', label: 'שם אב (עברית)' },
      { key: 'shmHm', label: 'שם אם (עברית)' },
      { key: 'tzMotherNum', label: 'ת"ז אם' },
      { key: 'tzaba', label: 'ת"ז אבא' },
      { key: 'fatherDatebirth', label: 'תאריך לידת האב', type: 'date' },
      { key: 'motherDateBirth', label: 'תאריך לידת האם', type: 'date' },
      { key: 'dadPhone.primaryPhoneNumber', label: 'טלפון אב - מספר' },
      { key: 'dadPhone.primaryPhoneCountryCode', label: 'טלפון אב - קוד מדינה' },
      { key: 'dadPhone.primaryPhoneCallingCode', label: 'טלפון אב - קידומת חיוג' },
      { key: 'dadPhone.additionalPhones', label: 'טלפונים נוספים לאב' },
      { key: 'momPhone.primaryPhoneNumber', label: 'טלפון אם - מספר' },
      { key: 'momPhone.primaryPhoneCountryCode', label: 'טלפון אם - קוד מדינה' },
      { key: 'momPhone.primaryPhoneCallingCode', label: 'טלפון אם - קידומת חיוג' },
      { key: 'momPhone.additionalPhones', label: 'טלפונים נוספים לאם' },
      { key: 'motherEmail.primaryEmail', label: 'אימייל אם' },
      { key: 'motherEmail.additionalEmails', label: 'אימיילים נוספים אם' },
      { key: 'fatherEmail.primaryEmail', label: 'אימייל אב' },
      { key: 'fatherEmail.additionalEmails', label: 'אימיילים נוספים אב' }
    ]
  },
  {
    title: 'כתובת',
    fields: [
      { key: 'adders.addressStreet1', label: 'רחוב 1' },
      { key: 'adders.addressStreet2', label: 'רחוב 2' },
      { key: 'adders.addressCity', label: 'עיר' },
      { key: 'adders.addressPostcode', label: 'מיקוד' },
      { key: 'adders.addressState', label: 'מחוז/מדינה' },
      { key: 'adders.addressCountry', label: 'מדינה' },
      { key: 'adders.addressLat', label: 'קו רוחב' },
      { key: 'adders.addressLng', label: 'קו אורך' }
    ]
  },
  {
    title: 'פרטי בנק',
    fields: [
      { key: 'senif', label: 'סניף' },
      { key: 'bankNum', label: 'מספר בנק' },
      { key: 'accountNum', label: 'מספר חשבון' }
    ]
  }
];

const ENUM_LABELS = {
  healthInsurance: {
    MACCABI: 'מכבי',
    MEUHEDET: 'מאוחדת',
    MEUHEDDET: 'מאוחדת',
    CLALIT: 'כללית',
    LEUMIT: 'לאומית'
  },
  class: {
    Z: 'אברך',
    A: 'שיעור א',
    B: 'שיעור ב',
    C: 'שיעור ג',
    D: 'שיעור ד',
    E: 'שיעור ה',
    X: 'קיבוץ',
    TEAM: 'צוות'
  },
  currentInstitution: {
    YR: 'יחי ראובן',
    OE: 'אור אפרים',
    CY: 'חכמי ירושלים',
    BOGER: 'בוגר',
    BOGERNCONTACT: 'בוגר ללא יצירת קשר',
    TEST: 'טסט'
  },
  registration: {
    MINISTRY_OF_EDUCATION: 'משרד החינוך',
    DATOT: 'דתות',
    NOT_ELIGIBLE: 'לא זכאי',
    UPDATE_DATOT: 'לעדכן דתות',
    UPDATE_EDUCATION: 'לעדכן חינוך'
  },
  familystatus: {
    SINGLE: 'רווק',
    MARRIED: 'נשוי',
    DIVORCED: 'גרוש',
    WIDOWED: 'אלמן'
  }
};

const INTERNAL_NOTE_STATUS_LABELS = {
  NOT_RELEVANT: 'לא רלוונטי',
  OTHER: 'אחר',
  CONTACTED: 'דיברו'
};

function loadDotEnv() {
  const envPath = path.join(process.cwd(), '.env');
  if (!fs.existsSync(envPath)) return;

  const content = fs.readFileSync(envPath, 'utf8');
  const lines = content.split(/\r?\n/);

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    const eqIndex = trimmed.indexOf('=');
    if (eqIndex <= 0) continue;

    const key = trimmed.slice(0, eqIndex).trim();
    let value = trimmed.slice(eqIndex + 1).trim();

    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }

    if (!(key in process.env)) {
      process.env[key] = value;
    }
  }
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function normalizeValue(value) {
  if (value === null || value === undefined) return '—';
  if (typeof value === 'string' && value.trim() === '') return '—';

  if (typeof value === 'object') {
    try {
      return JSON.stringify(value, null, 2);
    } catch {
      return String(value);
    }
  }

  return String(value);
}

function getByPath(obj, path) {
  return path.split('.').reduce((acc, part) => (acc && acc[part] !== undefined ? acc[part] : undefined), obj);
}

function formatDateValue(value) {
  if (!value) return normalizeValue(value);
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return normalizeValue(value);
  const day = String(date.getDate()).padStart(2, '0');
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const year = String(date.getFullYear());
  return `${day}/${month}/${year}`;
}

function calculateAge(dateValue) {
  if (!dateValue) return null;
  const birthDate = new Date(dateValue);
  if (Number.isNaN(birthDate.getTime())) return null;

  const now = new Date();
  let age = now.getFullYear() - birthDate.getFullYear();
  const monthDiff = now.getMonth() - birthDate.getMonth();
  const dayDiff = now.getDate() - birthDate.getDate();

  if (monthDiff < 0 || (monthDiff === 0 && dayDiff < 0)) {
    age -= 1;
  }

  return age >= 0 ? age : null;
}

function formatFieldValue(field, rawValue) {
  if (field.type === 'date') return formatDateValue(rawValue);
  if (field.enum && rawValue) {
    const label = ENUM_LABELS[field.enum]?.[rawValue];
    return label ? `${label} (${rawValue})` : String(rawValue);
  }
  return normalizeValue(rawValue);
}

function normalizeDialNumber(callingCode, phoneNumber) {
  let digits = cleanString(phoneNumber).replace(/[^\d]/g, '');
  const dialCode = cleanString(callingCode);
  if (!digits) return '';
  if (dialCode === '+972' && digits.startsWith('0')) digits = digits.slice(1);
  return `${dialCode}${digits}`.replace(/[^\d+]/g, '');
}

function renderPhoneLink(phoneObj) {
  const number = cleanString(phoneObj?.primaryPhoneNumber);
  if (!number) return '—';

  const countryCode = cleanString(phoneObj?.primaryPhoneCountryCode);
  const callingCode = cleanString(phoneObj?.primaryPhoneCallingCode);
  const display = [callingCode, number].filter(Boolean).join(' ').trim() || number;
  const dial = normalizeDialNumber(callingCode, number);
  const countrySuffix = countryCode ? ` <span class="muted">(${escapeHtml(countryCode)})</span>` : '';

  if (!dial) return `${escapeHtml(display)}${countrySuffix}`;
  return `<a href="tel:${escapeHtml(dial)}">${escapeHtml(display)}</a>${countrySuffix}`;
}

function renderEmailLink(emailValue) {
  const email = cleanString(emailValue);
  if (!email) return '—';
  return `<a href="mailto:${escapeHtml(email)}">${escapeHtml(email)}</a>`;
}

function renderEmailList(emailValues) {
  if (!Array.isArray(emailValues) || emailValues.length === 0) return '—';
  const items = emailValues.map((email) => renderEmailLink(email)).filter((v) => v !== '—');
  return items.length ? items.join('<br />') : '—';
}

function formatInternalStatus(statusValue) {
  const key = cleanString(statusValue);
  return INTERNAL_NOTE_STATUS_LABELS[key] || '—';
}

function normalizeDirectDebitValue(rawValue) {
  if (rawValue === true || cleanString(rawValue) === 'true') return 'true';
  if (rawValue === false || cleanString(rawValue) === 'false') return 'false';
  return '';
}

function formatDirectDebitValue(rawValue) {
  const normalized = normalizeDirectDebitValue(rawValue);
  if (normalized === 'true') return 'כן';
  if (normalized === 'false') return 'לא';
  return '—';
}

function isDirectDebitActive(rawValue) {
  return normalizeDirectDebitValue(rawValue) === 'true';
}

function appendQueryToPath(pathWithQuery, key, value) {
  const safePath = cleanString(pathWithQuery) || '/';
  const url = new URL(safePath, 'http://local');
  url.searchParams.set(key, value);
  return `${url.pathname}${url.search}`;
}

function buildSectionFields(section, properties, edit) {
  if (edit) {
    return section.fields
      .map((field) => {
        const value = getByPath(properties, field.key);
        if (!hasDisplayValue(value) && !edit) return null;
        return {
          label: field.label,
          html: escapeHtml(formatFieldValue(field, value))
        };
      })
      .filter(Boolean);
  }

  if (section.title === 'מידע הורים') {
    return [
      { label: 'תאריך לידת האב', html: escapeHtml(formatDateValue(properties.fatherDatebirth)) },
      { label: 'תאריך לידת האם', html: escapeHtml(formatDateValue(properties.motherDateBirth)) },
      { label: 'טלפון אב', html: renderPhoneLink(properties.dadPhone) },
      {
        label: 'טלפונים נוספים לאב',
        html: escapeHtml(
          Array.isArray(properties?.dadPhone?.additionalPhones) && properties.dadPhone.additionalPhones.length
            ? properties.dadPhone.additionalPhones.join(', ')
            : '—'
        )
      },
      { label: 'טלפון אם', html: renderPhoneLink(properties.momPhone) },
      {
        label: 'טלפונים נוספים לאם',
        html: escapeHtml(
          Array.isArray(properties?.momPhone?.additionalPhones) && properties.momPhone.additionalPhones.length
            ? properties.momPhone.additionalPhones.join(', ')
            : '—'
        )
      },
      { label: 'אימייל אם', html: renderEmailLink(properties?.motherEmail?.primaryEmail) },
      { label: 'אימיילים נוספים אם', html: renderEmailList(properties?.motherEmail?.additionalEmails) },
      { label: 'אימייל אב', html: renderEmailLink(properties?.fatherEmail?.primaryEmail) },
      { label: 'אימיילים נוספים אב', html: renderEmailList(properties?.fatherEmail?.additionalEmails) }
    ].filter((item) => hasDisplayValue(item.html === '—' ? '' : item.html));
  }

  if (section.title === 'מידע תלמיד ורישום') {
    const calculatedAge = calculateAge(properties?.dateofbirth);
    const regularItems = [
      { label: 'שם פרטי', html: escapeHtml(normalizeValue(properties?.fullName?.firstName)) },
      { label: 'שם משפחה', html: escapeHtml(normalizeValue(properties?.fullName?.lastName)) },
      { label: 'סטטוס משפחתי', html: escapeHtml(formatFieldValue({ enum: 'familystatus' }, properties?.famliystatus)) },
      { label: 'ת"ז', html: escapeHtml(normalizeValue(properties?.tznum)) },
      { label: 'תאריך לידה', html: escapeHtml(formatDateValue(properties?.dateofbirth)) },
      { label: 'גיל', html: escapeHtml(calculatedAge === null ? '—' : `${calculatedAge}`) },
      { label: 'בריאות - קופה', html: escapeHtml(formatFieldValue({ enum: 'healthInsurance' }, properties?.healthInsurance)) },
      { label: 'מוסד נוכחי', html: escapeHtml(formatFieldValue({ enum: 'currentInstitution' }, properties?.currentInstitution)) },
      { label: 'כיתה', html: escapeHtml(formatFieldValue({ enum: 'class' }, properties?.class)) },
      { label: 'רישום', html: escapeHtml(formatFieldValue({ enum: 'registration' }, properties?.registration)) },
      { label: 'הערה חופשית', html: escapeHtml(normalizeValue(properties?.note)) }
    ];

    return [
      ...regularItems,
      { label: 'טלפון תלמיד', html: renderPhoneLink(properties.phone) },
      {
        label: 'טלפונים נוספים לתלמיד',
        html: escapeHtml(
          Array.isArray(properties?.phone?.additionalPhones) && properties.phone.additionalPhones.length
            ? properties.phone.additionalPhones.join(', ')
            : '—'
        )
      },
      { label: 'אימייל תלמיד', html: renderEmailLink(properties?.email?.primaryEmail) },
      { label: 'אימיילים נוספים תלמיד', html: renderEmailList(properties?.email?.additionalEmails) }
    ].filter((item) => hasDisplayValue(item.html === '—' ? '' : item.html));
  }

  return section.fields
    .map((field) => {
      const value = getByPath(properties, field.key);
      if (!hasDisplayValue(value)) return null;

      const isPrimaryEmail = field.key.endsWith('.primaryEmail');
      const isAdditionalEmails = field.key.endsWith('.additionalEmails');

      return {
        label: field.label,
        html: isPrimaryEmail
          ? renderEmailLink(value)
          : isAdditionalEmails
            ? renderEmailList(value)
            : escapeHtml(formatFieldValue(field, value))
      };
    })
    .filter(Boolean);
}

function buildStudentLabel(student) {
  const firstName = cleanString(student?.fullName?.firstName);
  const lastName = cleanString(student?.fullName?.lastName);
  const fullName = `${firstName} ${lastName}`.trim();
  return fullName || cleanString(student?.name) || 'ללא שם';
}

function formatPhone(value) {
  const phone = cleanString(value);
  return phone || '—';
}

function toSearchEdgesFromStudentConnection(studentEdges) {
  return (studentEdges || []).map(({ node }) => ({
    node: {
      recordId: node.id,
      objectNameSingular: 'student',
      label: buildStudentLabel(node),
      fullName: node.fullName,
      dateofbirth: node.dateofbirth,
      class: node.class,
      phone: node.phone,
      dadPhone: node.dadPhone,
      momPhone: node.momPhone
    }
  }));
}

const CLASS_SORT_ORDER = {
  A: 1,
  B: 2,
  C: 3,
  D: 4,
  E: 5,
  X: 6,
  Z: 7,
  TEAM: 8
};

function getClassSortValue(classValue) {
  return CLASS_SORT_ORDER[classValue] ?? 999;
}

function compareStudentsForInstitution(a, b) {
  const classDiff = getClassSortValue(a?.node?.class) - getClassSortValue(b?.node?.class);
  if (classDiff !== 0) return classDiff;

  const aLastName = cleanString(a?.node?.fullName?.lastName).toLowerCase();
  const bLastName = cleanString(b?.node?.fullName?.lastName).toLowerCase();
  if (aLastName !== bLastName) return aLastName.localeCompare(bLastName, 'he');

  const aFirstName = cleanString(a?.node?.fullName?.firstName).toLowerCase();
  const bFirstName = cleanString(b?.node?.fullName?.firstName).toLowerCase();
  return aFirstName.localeCompare(bFirstName, 'he');
}

function compareStudentsByAge(a, b) {
  const ageA = calculateAge(a?.node?.dateofbirth);
  const ageB = calculateAge(b?.node?.dateofbirth);
  const safeAgeA = ageA === null ? -1 : ageA;
  const safeAgeB = ageB === null ? -1 : ageB;
  if (safeAgeA !== safeAgeB) return safeAgeB - safeAgeA;
  return compareStudentsForInstitution(a, b);
}

function compareStudentsByInternalUpdated(a, b) {
  const aTs = Date.parse(a?.node?.internalData?.updatedAt || '') || 0;
  const bTs = Date.parse(b?.node?.internalData?.updatedAt || '') || 0;
  if (aTs !== bTs) return bTs - aTs;
  return compareStudentsForInstitution(a, b);
}

function compareStudentsBySigner(a, b) {
  const aSigner = cleanString(a?.node?.internalData?.signedByDisplayName || a?.node?.internalData?.signedByEmail).toLowerCase();
  const bSigner = cleanString(b?.node?.internalData?.signedByDisplayName || b?.node?.internalData?.signedByEmail).toLowerCase();
  if (aSigner !== bSigner) return aSigner.localeCompare(bSigner, 'he');
  return compareStudentsForInstitution(a, b);
}

function compareStudentsByInternalStatus(a, b) {
  const aStatus = cleanString(a?.node?.internalData?.noteStatus);
  const bStatus = cleanString(b?.node?.internalData?.noteStatus);
  if (aStatus !== bStatus) return aStatus.localeCompare(bStatus, 'he');
  return compareStudentsForInstitution(a, b);
}

function compareStudentsByDirectDebit(a, b) {
  const mapVal = (v) => {
    const normalized = normalizeDirectDebitValue(v);
    if (normalized === 'true') return 2;
    if (normalized === 'false') return 1;
    return 0;
  };
  const aVal = mapVal(a?.node?.internalData?.directDebitActive);
  const bVal = mapVal(b?.node?.internalData?.directDebitActive);
  if (aVal !== bVal) return bVal - aVal;
  return compareStudentsForInstitution(a, b);
}

function ensurePhoneWithDefaults(phoneObj) {
  const number = cleanString(phoneObj?.primaryPhoneNumber);
  if (!number) return null;
  return {
    primaryPhoneNumber: number,
    primaryPhoneCountryCode: cleanString(phoneObj?.primaryPhoneCountryCode) || 'IL',
    primaryPhoneCallingCode: cleanString(phoneObj?.primaryPhoneCallingCode) || '+972'
  };
}

function getInputValue(values, key) {
  return escapeHtml(values?.[key] || '');
}

function renderSelect(name, options, selectedValue, placeholder) {
  const optionsHtml = Object.entries(options)
    .map(([value, label]) => {
      const selected = value === selectedValue ? ' selected' : '';
      return `<option value="${escapeHtml(value)}"${selected}>${escapeHtml(label)}</option>`;
    })
    .join('');

  return `
    <select name="${escapeHtml(name)}">
      <option value="">${escapeHtml(placeholder)}</option>
      ${optionsHtml}
    </select>
  `;
}

function cleanString(value) {
  return String(value || '').trim();
}

function setNested(target, dottedPath, value) {
  const parts = dottedPath.split('.');
  let current = target;
  for (let i = 0; i < parts.length - 1; i += 1) {
    const part = parts[i];
    if (!current[part] || typeof current[part] !== 'object') {
      current[part] = {};
    }
    current = current[part];
  }
  current[parts[parts.length - 1]] = value;
}

function parseListValue(value) {
  return cleanString(value)
    .split(/[\n,]/)
    .map((v) => v.trim())
    .filter(Boolean);
}

function pruneEmpty(value) {
  if (Array.isArray(value)) {
    const items = value.map(pruneEmpty).filter((v) => v !== undefined);
    return items.length ? items : undefined;
  }

  if (value && typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      const cleaned = pruneEmpty(v);
      if (cleaned !== undefined) out[k] = cleaned;
    }
    return Object.keys(out).length ? out : undefined;
  }

  if (value === null || value === undefined) return undefined;
  if (typeof value === 'string' && value.trim() === '') return undefined;
  return value;
}

function hasDisplayValue(value) {
  if (value === null || value === undefined) return false;
  if (typeof value === 'string') return value.trim() !== '';
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === 'object') return Object.values(value).some(hasDisplayValue);
  return true;
}

function toDateInputValue(value) {
  const v = cleanString(value);
  if (!v) return '';
  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return v;
  const date = new Date(v);
  if (Number.isNaN(date.getTime())) return '';
  return date.toISOString().slice(0, 10);
}

function studentToFormValues(student) {
  const values = {};
  for (const section of FIELD_SECTIONS) {
    for (const field of section.fields) {
      const value = getByPath(student, field.key);
      if (value === null || value === undefined) continue;
      if (Array.isArray(value)) {
        values[field.key] = value.join(', ');
      } else if (field.type === 'date') {
        values[field.key] = toDateInputValue(value);
      } else {
        values[field.key] = String(value);
      }
    }
  }
  return values;
}

function getStudentCardUrl(studentId, req) {
  const safeId = encodeURIComponent(studentId);
  let twentyBase = cleanString(process.env.TWENTY_LINK || TWENTY_LINK);
  if (twentyBase && !/^https?:\/\//i.test(twentyBase)) {
    twentyBase = `https://${twentyBase}`;
  }
  if (twentyBase) {
    try {
      const withSlash = twentyBase.endsWith('/') ? twentyBase : `${twentyBase}/`;
      return new URL(safeId, withSlash).toString();
    } catch {
      // Fall through to other URL builders
    }
  }

  const configuredBase = cleanString(CRM_BASE_URL).replace(/\/+$/, '');
  if (configuredBase) {
    return `${configuredBase}/student/student/${safeId}`;
  }

  const forwardedProto = cleanString((req.headers['x-forwarded-proto'] || '').split(',')[0]);
  const protocol = forwardedProto || 'http';
  const forwardedHost = cleanString((req.headers['x-forwarded-host'] || '').split(',')[0]);
  const host = forwardedHost || cleanString(req.headers.host) || `localhost:${PORT}`;
  return `${protocol}://${host}/student/student/${safeId}`;
}

function isPublicHttpUrl(rawUrl) {
  try {
    const u = new URL(rawUrl);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return false;
    const host = u.hostname.toLowerCase();
    if (host === 'localhost' || host === '127.0.0.1' || host === '::1') return false;
    if (host.endsWith('.local')) return false;
    return true;
  } catch {
    return false;
  }
}

function buildStudentSummaryLines(studentId, data, studentUrl) {
  const firstName = cleanString(data?.fullName?.firstName);
  const lastName = cleanString(data?.fullName?.lastName);
  const fullName = `${firstName} ${lastName}`.trim() || cleanString(data?.name) || 'ללא שם';
  const institution = data?.currentInstitution ? (ENUM_LABELS.currentInstitution[data.currentInstitution] || data.currentInstitution) : '—';
  const studentClass = data?.class ? (ENUM_LABELS.class[data.class] || data.class) : '—';
  const phone = cleanString(data?.phone?.primaryPhoneNumber) || '—';
  const email = cleanString(data?.email?.primaryEmail) || '—';
  const tz = cleanString(data?.tznum) || '—';

  return [
    'תלמיד חדש נוצר במערכת',
    `ID: ${studentId}`,
    `שם: ${fullName}`,
    `ת"ז: ${tz}`,
    `מוסד: ${institution}`,
    `שיעור: ${studentClass}`,
    `טלפון תלמיד: ${phone}`,
    `אימייל תלמיד: ${email}`,
    `כרטיס CRM: ${studentUrl}`
  ];
}

function buildStudentHtmlEmail(studentId, data, studentUrl) {
  const firstName = cleanString(data?.fullName?.firstName);
  const lastName = cleanString(data?.fullName?.lastName);
  const fullName = `${firstName} ${lastName}`.trim() || cleanString(data?.name) || 'ללא שם';

  const institution = data?.currentInstitution ? (ENUM_LABELS.currentInstitution[data.currentInstitution] || data.currentInstitution) : '—';
  const studentClass = data?.class ? (ENUM_LABELS.class[data.class] || data.class) : '—';
  const registration = data?.registration ? (ENUM_LABELS.registration[data.registration] || data.registration) : '—';
  const healthInsurance = data?.healthInsurance ? (ENUM_LABELS.healthInsurance[data.healthInsurance] || data.healthInsurance) : '—';
  const familyStatus = data?.famliystatus ? (ENUM_LABELS.familystatus[data.famliystatus] || data.famliystatus) : '—';

  const studentPhone = cleanString(data?.phone?.primaryPhoneNumber) || '—';
  const dadPhone = cleanString(data?.dadPhone?.primaryPhoneNumber) || '—';
  const momPhone = cleanString(data?.momPhone?.primaryPhoneNumber) || '—';
  const studentEmail = cleanString(data?.email?.primaryEmail) || '—';
  const fatherEmail = cleanString(data?.fatherEmail?.primaryEmail) || '—';
  const motherEmail = cleanString(data?.motherEmail?.primaryEmail) || '—';

  const rows = [
    ['שם תלמיד', fullName],
    ['מזהה תלמיד', studentId],
    ['ת"ז', cleanString(data?.tznum)],
    ['תאריך לידה', cleanString(data?.dateofbirth)],
    ['מוסד לימודים', institution !== '—' ? institution : ''],
    ['שיעור', studentClass !== '—' ? studentClass : ''],
    ['רישום', registration !== '—' ? registration : ''],
    ['סטטוס משפחתי', familyStatus !== '—' ? familyStatus : ''],
    ['קופת חולים', healthInsurance !== '—' ? healthInsurance : ''],
    ['טלפון תלמיד', studentPhone !== '—' ? studentPhone : ''],
    ['טלפון אב', dadPhone !== '—' ? dadPhone : ''],
    ['טלפון אם', momPhone !== '—' ? momPhone : ''],
    ['אימייל תלמיד', studentEmail !== '—' ? studentEmail : ''],
    ['אימייל אב', fatherEmail !== '—' ? fatherEmail : ''],
    ['אימייל אם', motherEmail !== '—' ? motherEmail : ''],
    ['כתובת', cleanString(data?.adders?.addressStreet1)],
    ['עיר', cleanString(data?.adders?.addressCity)],
    ['הערה', cleanString(data?.note)]
  ].filter(([, value]) => cleanString(value) !== '');

  const rowsHtml = rows
    .map(
      ([label, value]) =>
        `<tr><td style="padding:8px;border:1px solid #e2e8f0;background:#f8fafc;font-weight:700;">${escapeHtml(label)}</td><td style="padding:8px;border:1px solid #e2e8f0;">${escapeHtml(value)}</td></tr>`
    )
    .join('');

  return `
<!doctype html>
<html lang="he" dir="rtl">
<body style="font-family:Arial,sans-serif;background:#f4f6fb;margin:0;padding:24px;">
  <div style="max-width:760px;margin:0 auto;background:#ffffff;border:1px solid #dbe2ee;border-radius:12px;overflow:hidden;">
    <div style="background:#1d4ed8;color:#fff;padding:16px 20px;">
      <h2 style="margin:0;font-size:22px;">עדכון תלמיד חדש למזכירות</h2>
    </div>
    <div style="padding:20px;">
      <p style="margin-top:0;">נוצר תלמיד חדש במערכת CRM.</p>
      <p>
        <a href="${escapeHtml(studentUrl)}" style="display:inline-block;background:#0f172a;color:#fff;text-decoration:none;padding:10px 14px;border-radius:8px;">לפתיחת כרטיס התלמיד ב-CRM</a>
      </p>
      <table style="width:100%;border-collapse:collapse;">${rowsHtml}</table>
    </div>
  </div>
</body>
</html>`.trim();
}

function buildWebhookParams(studentId, data, studentUrl) {
  const firstName = cleanString(data?.fullName?.firstName);
  const lastName = cleanString(data?.fullName?.lastName);
  const fullName = `${firstName} ${lastName}`.trim() || cleanString(data?.name);

  const params = {
    event: 'student.created',
    student_id: studentId,
    student_url: studentUrl,
    full_name: fullName,
    first_name: firstName,
    last_name: lastName,
    tznum: cleanString(data?.tznum),
    dateofbirth: cleanString(data?.dateofbirth),
    current_institution: cleanString(data?.currentInstitution),
    class: cleanString(data?.class),
    registration: cleanString(data?.registration),
    health_insurance: cleanString(data?.healthInsurance),
    family_status: cleanString(data?.famliystatus),
    student_phone: cleanString(data?.phone?.primaryPhoneNumber),
    dad_phone: cleanString(data?.dadPhone?.primaryPhoneNumber),
    mom_phone: cleanString(data?.momPhone?.primaryPhoneNumber),
    student_email: cleanString(data?.email?.primaryEmail),
    father_email: cleanString(data?.fatherEmail?.primaryEmail),
    mother_email: cleanString(data?.motherEmail?.primaryEmail),
    city: cleanString(data?.adders?.addressCity),
    address: cleanString(data?.adders?.addressStreet1),
    note: cleanString(data?.note)
  };

  const filtered = {};
  for (const [k, v] of Object.entries(params)) {
    if (cleanString(v) !== '') filtered[k] = v;
  }
  return filtered;
}

function buildTelegramMessageHtml(lines) {
  const [title, ...rest] = lines;
  return `<b>${escapeHtml(title)}</b>\n\n<tg-spoiler>${escapeHtml(rest.join('\n'))}</tg-spoiler>`;
}

async function notifyTelegram({ textHtml, studentUrl }) {
  const token = cleanString(TELEGRAM_TOKEN);
  const chatId = cleanString(TELEGRAM_ADMIN_ID);

  if (!token || !chatId) {
    return { sent: false, skipped: true, reason: 'telegram-not-configured' };
  }
  if (!isPublicHttpUrl(studentUrl)) {
    throw new Error(
      'Telegram button URL is not public/valid. Configure TWENTY_LINK in .env (example: https://calm-gray-seal.twenty.com/object/student/).'
    );
  }

  const url = `https://api.telegram.org/bot${token}/sendMessage`;
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      chat_id: chatId,
      text: textHtml,
      parse_mode: 'HTML',
      reply_markup: {
        inline_keyboard: [[{ text: 'פתח כרטיס תלמיד ב-CRM', url: studentUrl }]]
      }
    })
  });

  const bodyText = await response.text();
  let body = {};
  try {
    body = JSON.parse(bodyText);
  } catch {
    body = { raw: bodyText };
  }

  if (!response.ok || body?.ok === false) {
    throw new Error(`Telegram send failed (${response.status}): ${body?.description || bodyText || 'unknown-error'}`);
  }

  return { sent: true, skipped: false };
}

async function notifyWebhook(payload) {
  if (!WEBHOOK_URL) {
    return { sent: false, skipped: true, reason: 'webhook-not-configured' };
  }

  const response = await fetch(WEBHOOK_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    throw new Error(`Webhook send failed (${response.status})`);
  }

  return { sent: true, skipped: false };
}

async function notifyNewStudent({ studentId, data, studentUrl }) {
  const lines = buildStudentSummaryLines(studentId, data, studentUrl);
  const textHtml = buildTelegramMessageHtml(lines);
  const htmlBody = buildStudentHtmlEmail(studentId, data, studentUrl);
  const webhookParams = buildWebhookParams(studentId, data, studentUrl);
  const webhookPayload = {
    ...webhookParams,
    html: htmlBody
  };

  const results = await Promise.allSettled([
    notifyTelegram({ textHtml, studentUrl }),
    notifyWebhook(webhookPayload)
  ]);

  let sentCount = 0;
  let attemptedCount = 0;
  const errors = [];

  for (const result of results) {
    if (result.status === 'fulfilled') {
      if (!result.value.skipped) attemptedCount += 1;
      if (result.value.sent) sentCount += 1;
    } else {
      attemptedCount += 1;
      errors.push(result.reason?.message || 'notification-failed');
    }
  }

  return {
    sentCount,
    attemptedCount,
    errors,
    status:
      attemptedCount === 0
        ? 'skipped'
        : sentCount === attemptedCount
          ? 'ok'
          : sentCount > 0
            ? 'partial'
            : 'failed'
  };
}

function toFormData(rawForm) {
  const firstName = cleanString(rawForm['fullName.firstName'] || rawForm.firstName);
  const lastName = cleanString(rawForm['fullName.lastName'] || rawForm.lastName);
  const fullNameText = `${firstName} ${lastName}`.trim();

  const data = {};

  for (const section of FIELD_SECTIONS) {
    for (const field of section.fields) {
      const rawValue = rawForm[field.key];
      if (rawValue === undefined) continue;
      let value = rawValue;
      if (field.key.endsWith('additionalPhones') || field.key.endsWith('additionalEmails')) {
        value = parseListValue(rawValue);
      } else {
        value = cleanString(rawValue);
      }

      if ((Array.isArray(value) && value.length === 0) || (!Array.isArray(value) && cleanString(value) === '')) {
        continue;
      }

      setNested(data, field.key, value);
    }
  }

  if (firstName || lastName) {
    data.fullName = { firstName, lastName };
    data.name = fullNameText;
  }

  for (const phoneKey of ['phone', 'dadPhone', 'momPhone']) {
    const phoneObj = data[phoneKey];
    if (phoneObj?.primaryPhoneNumber) {
      if (!phoneObj.primaryPhoneCountryCode) phoneObj.primaryPhoneCountryCode = 'IL';
      if (!phoneObj.primaryPhoneCallingCode) phoneObj.primaryPhoneCallingCode = '+972';
      if (!Array.isArray(phoneObj.additionalPhones)) phoneObj.additionalPhones = [];
    }
  }

  for (const emailKey of ['email', 'fatherEmail', 'motherEmail']) {
    const emailObj = data[emailKey];
    if (emailObj?.primaryEmail && !Array.isArray(emailObj.additionalEmails)) {
      emailObj.additionalEmails = [];
    }
  }

  if (data.adders && !data.adders.addressCountry) {
    data.adders.addressCountry = 'Israel';
  }

  return pruneEmpty(data) || {};
}

async function readRequestBody(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', (chunk) => {
      raw += chunk.toString('utf8');
      if (raw.length > 1_000_000) {
        reject(new Error('Request body too large'));
      }
    });
    req.on('end', () => resolve(raw));
    req.on('error', reject);
  });
}

async function parseFormRequest(req) {
  const raw = await readRequestBody(req);
  const params = new URLSearchParams(raw);
  const values = {};
  for (const [key, value] of params.entries()) {
    values[key] = value;
  }
  return values;
}

async function parseJsonRequest(req) {
  const raw = await readRequestBody(req);
  if (!cleanString(raw)) return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    throw new Error('Invalid JSON body');
  }
}

function writeJson(res, statusCode, body) {
  res.writeHead(statusCode, { 'content-type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(body));
}

function readJsonDb(filePath, fallbackValue) {
  try {
    if (!fs.existsSync(filePath)) return fallbackValue;
    const raw = fs.readFileSync(filePath, 'utf8');
    if (!raw.trim()) return fallbackValue;
    return JSON.parse(raw);
  } catch {
    return fallbackValue;
  }
}

function writeJsonDb(filePath, data) {
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
}

function base64UrlEncode(buffer) {
  return Buffer.from(buffer)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

function base64UrlDecode(value) {
  const input = cleanString(value).replace(/-/g, '+').replace(/_/g, '/');
  if (!input) return Buffer.alloc(0);
  const pad = input.length % 4 === 0 ? '' : '='.repeat(4 - (input.length % 4));
  return Buffer.from(input + pad, 'base64');
}

function bytesToPemSpki(spkiBytes) {
  const b64 = Buffer.from(spkiBytes).toString('base64');
  const lines = b64.match(/.{1,64}/g)?.join('\n') || b64;
  return `-----BEGIN PUBLIC KEY-----\n${lines}\n-----END PUBLIC KEY-----\n`;
}

function getRpIdFromRequest(req) {
  if (AUTH_PASSKEY_RP_ID) return AUTH_PASSKEY_RP_ID;
  const host = cleanString(req.headers.host).split(':')[0];
  return host || 'localhost';
}

function getOriginFromRequest(req) {
  const host = cleanString(req.headers.host);
  const forwardedProtoRaw = cleanString(req.headers['x-forwarded-proto']);
  const forwardedProto = forwardedProtoRaw.split(',')[0].trim().toLowerCase();
  const protocol = forwardedProto || (req.socket?.encrypted ? 'https' : 'http');
  return `${protocol}://${host || 'localhost'}`;
}

function getAllowedPasskeyOrigins(req) {
  const raw = AUTH_PASSKEY_ALLOWED_ORIGINS;
  if (!raw) return [getOriginFromRequest(req)];
  return raw
    .split(',')
    .map((v) => cleanString(v))
    .filter(Boolean);
}

function isPasskeyOriginAllowed(origin, req) {
  const normalized = cleanString(origin);
  if (!normalized) return false;
  const allowed = getAllowedPasskeyOrigins(req);
  return allowed.includes(normalized);
}

function prunePasskeyChallenges() {
  const now = Date.now();
  for (const [key, row] of passkeyChallenges.entries()) {
    if (!row || !Number.isFinite(row.expiresAt) || row.expiresAt <= now) {
      passkeyChallenges.delete(key);
    }
  }
}

function createPasskeyChallenge({ email, purpose, next = '/' }) {
  prunePasskeyChallenges();
  const challenge = base64UrlEncode(crypto.randomBytes(32));
  const key = `${purpose}:${email}:${challenge}`;
  passkeyChallenges.set(key, {
    challenge,
    email,
    purpose,
    next: getSafeNextPath(next),
    expiresAt: Date.now() + PASSKEY_CHALLENGE_TTL_MS
  });
  return challenge;
}

function consumePasskeyChallenge({ email, purpose, challenge }) {
  prunePasskeyChallenges();
  const key = `${purpose}:${email}:${challenge}`;
  const row = passkeyChallenges.get(key);
  if (!row) return null;
  passkeyChallenges.delete(key);
  if (row.expiresAt <= Date.now()) return null;
  return row;
}

function getUsers() {
  const users = readJsonDb(USERS_DB_PATH, []);
  return Array.isArray(users) ? users : [];
}

function saveUsers(users) {
  writeJsonDb(USERS_DB_PATH, users);
}

function getSessions() {
  const sessions = readJsonDb(SESSIONS_DB_PATH, {});
  return sessions && typeof sessions === 'object' ? sessions : {};
}

function saveSessions(sessions) {
  writeJsonDb(SESSIONS_DB_PATH, sessions);
}

function getInternalStudentsDb() {
  const data = readJsonDb(INTERNAL_STUDENTS_DB_PATH, {});
  return data && typeof data === 'object' ? data : {};
}

function saveInternalStudentsDb(data) {
  writeJsonDb(INTERNAL_STUDENTS_DB_PATH, data);
}

function getInternalStudentData(studentId) {
  const db = getInternalStudentsDb();
  const row = db[studentId];
  return row && typeof row === 'object' ? row : {};
}

function saveInternalStudentData(studentId, row) {
  const db = getInternalStudentsDb();
  db[studentId] = row;
  saveInternalStudentsDb(db);
}

function normalizeEmail(value) {
  return cleanString(value).toLowerCase();
}

function getUserByEmail(email) {
  const target = normalizeEmail(email);
  const users = getUsers();
  const index = users.findIndex((u) => normalizeEmail(u.email) === target);
  if (index < 0) return { users, user: null, index: -1 };
  return { users, user: users[index], index };
}

function buildPasskeyUserHandle(email) {
  return crypto.createHash('sha256').update(normalizeEmail(email)).digest().subarray(0, 16);
}

function base32Encode(buffer) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = 0;
  let value = 0;
  let output = '';

  for (const byte of buffer) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += alphabet[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }

  if (bits > 0) {
    output += alphabet[(value << (5 - bits)) & 31];
  }

  return output;
}

function base32Decode(secret) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  const clean = cleanString(secret).replace(/=+$/g, '').toUpperCase();
  let bits = 0;
  let value = 0;
  const out = [];

  for (const c of clean) {
    const idx = alphabet.indexOf(c);
    if (idx < 0) continue;
    value = (value << 5) | idx;
    bits += 5;

    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }

  return Buffer.from(out);
}

function generateTotpSecret() {
  return base32Encode(crypto.randomBytes(20));
}

function generateTotpCode(secretBase32, unixTimeSeconds = Math.floor(Date.now() / 1000)) {
  const key = base32Decode(secretBase32);
  const step = Math.floor(unixTimeSeconds / 30);
  const counter = Buffer.alloc(8);
  counter.writeUInt32BE(Math.floor(step / 0x100000000), 0);
  counter.writeUInt32BE(step >>> 0, 4);

  const hmac = crypto.createHmac('sha1', key).update(counter).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const code = ((hmac[offset] & 0x7f) << 24)
    | ((hmac[offset + 1] & 0xff) << 16)
    | ((hmac[offset + 2] & 0xff) << 8)
    | (hmac[offset + 3] & 0xff);

  return String(code % 1_000_000).padStart(6, '0');
}

function isValidTotp(secretBase32, codeInput) {
  const code = cleanString(codeInput).replace(/\s+/g, '');
  if (!/^\d{6}$/.test(code)) return false;

  const now = Math.floor(Date.now() / 1000);
  for (let drift = -1; drift <= 1; drift += 1) {
    if (generateTotpCode(secretBase32, now + drift * 30) === code) {
      return true;
    }
  }

  return false;
}

function buildOtpAuthUri(email, secret) {
  const issuer = AUTH_ISSUER;
  const label = `${issuer}:${email}`;
  const params = new URLSearchParams({
    secret,
    issuer,
    algorithm: 'SHA1',
    digits: '6',
    period: '30'
  });
  return `otpauth://totp/${encodeURIComponent(label)}?${params.toString()}`;
}

function parseCookies(req) {
  const cookieHeader = req.headers.cookie || '';
  const out = {};
  for (const chunk of cookieHeader.split(';')) {
    const part = chunk.trim();
    if (!part) continue;
    const idx = part.indexOf('=');
    if (idx <= 0) continue;
    const k = part.slice(0, idx).trim();
    const v = part.slice(idx + 1).trim();
    out[k] = decodeURIComponent(v);
  }
  return out;
}

function setSessionCookie(res, token) {
  const maxAgeSec = Math.floor(SESSION_TTL_MS / 1000);
  res.setHeader('Set-Cookie', `${SESSION_COOKIE_NAME}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSec}`);
}

function clearSessionCookie(res) {
  res.setHeader('Set-Cookie', `${SESSION_COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
}

function createSession(email, displayName = '') {
  const token = crypto.randomBytes(32).toString('hex');
  const sessions = getSessions();
  sessions[token] = {
    email,
    displayName: cleanString(displayName),
    expiresAt: new Date(Date.now() + SESSION_TTL_MS).toISOString()
  };
  saveSessions(sessions);
  return token;
}

function pruneAndGetSession(token) {
  const sessions = getSessions();
  const now = Date.now();
  let changed = false;

  for (const [k, v] of Object.entries(sessions)) {
    const exp = Date.parse(v?.expiresAt || '');
    if (!Number.isFinite(exp) || exp <= now) {
      delete sessions[k];
      changed = true;
    }
  }

  if (changed) saveSessions(sessions);
  return sessions[token] || null;
}

function destroySession(token) {
  if (!token) return;
  const sessions = getSessions();
  if (sessions[token]) {
    delete sessions[token];
    saveSessions(sessions);
  }
}

function destroySessionsForEmail(email) {
  const target = normalizeEmail(email);
  const sessions = getSessions();
  let changed = false;
  for (const [token, session] of Object.entries(sessions)) {
    if (normalizeEmail(session?.email || '') === target) {
      delete sessions[token];
      changed = true;
    }
  }
  if (changed) saveSessions(sessions);
}

function getSafeNextPath(rawNext) {
  const nextPath = cleanString(rawNext);
  if (!nextPath.startsWith('/')) return '/';
  if (nextPath.startsWith('//')) return '/';
  if (nextPath.startsWith('/auth/')) return '/';
  return nextPath;
}

function getAuthenticatedUser(req) {
  const cookies = parseCookies(req);
  const token = cookies[SESSION_COOKIE_NAME];
  if (!token) return null;

  const session = pruneAndGetSession(token);
  const email = normalizeEmail(session?.email || '');
  if (!email) return null;

  let displayName = cleanString(session?.displayName);
  if (!displayName) {
    const users = getUsers();
    const user = users.find((u) => normalizeEmail(u.email) === email);
    displayName = cleanString(user?.displayName) || email;
  }

  return { email, displayName };
}

function renderLoginPage({ error = '', next = '/', email = '' }) {
  const safeNext = getSafeNextPath(next);
  const content = `
    <div class="hero">
      <h1>כניסה ל-CRM</h1>
      <p>כניסה עם Google Authenticator או Passkey.</p>
    </div>

    <div class="card">
      <form method="POST" action="/auth/login">
        <input type="hidden" name="next" value="${escapeHtml(safeNext)}" />
        <div class="form-grid">
          <div>
            <div class="k">אימייל</div>
            <input type="email" name="email" required value="${escapeHtml(email)}" />
          </div>
          <div>
            <div class="k">קוד מאמת (6 ספרות)</div>
            <input type="text" name="code" inputmode="numeric" pattern="\\d{6}" maxlength="6" required />
          </div>
        </div>
        <div class="actions">
          <button class="primary" type="submit">כניסה</button>
          <a class="button secondary" href="/auth/register">ניהול משתמשים</a>
        </div>
      </form>
      ${error ? `<div class="alert error">${escapeHtml(error)}</div>` : ''}
      <hr style="margin:16px 0;border:0;border-top:1px solid var(--line);" />
      <div class="form-grid">
        <div>
          <div class="k">אימייל ל-Passkey</div>
          <input id="passkey-email" type="email" value="${escapeHtml(email)}" placeholder="name@example.com" />
        </div>
        <div>
          <div class="k">כניסה מהירה</div>
          <button id="passkey-login-btn" class="secondary" type="button">כניסה עם Passkey</button>
        </div>
      </div>
      <input id="passkey-next" type="hidden" value="${escapeHtml(safeNext)}" />
      <div id="passkey-msg" class="alert error" style="display:none;"></div>
    </div>
    <script>
      (function () {
        function b64UrlToBuf(str) {
          const b64 = String(str || '').replace(/-/g, '+').replace(/_/g, '/');
          const pad = b64.length % 4 ? '='.repeat(4 - (b64.length % 4)) : '';
          const raw = atob(b64 + pad);
          const out = new Uint8Array(raw.length);
          for (let i = 0; i < raw.length; i += 1) out[i] = raw.charCodeAt(i);
          return out.buffer;
        }
        function bufToB64Url(buf) {
          const bytes = new Uint8Array(buf);
          let bin = '';
          for (let i = 0; i < bytes.length; i += 1) bin += String.fromCharCode(bytes[i]);
          return btoa(bin).replace(/\\+/g, '-').replace(/\\//g, '_').replace(/=+$/g, '');
        }
        const btn = document.getElementById('passkey-login-btn');
        const msg = document.getElementById('passkey-msg');
        const emailInput = document.getElementById('passkey-email');
        const nextInput = document.getElementById('passkey-next');
        if (!btn || !window.PublicKeyCredential) return;
        btn.addEventListener('click', async function () {
          msg.style.display = 'none';
          try {
            const email = (emailInput.value || '').trim();
            const next = (nextInput.value || '/').trim();
            const optionsRes = await fetch('/auth/passkey/auth/options', {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({ email, next })
            });
            const optionsBody = await optionsRes.json();
            if (!optionsRes.ok) throw new Error(optionsBody.error || 'Passkey options failed');
            const publicKey = {
              challenge: b64UrlToBuf(optionsBody.challenge),
              rpId: optionsBody.rpId,
              userVerification: optionsBody.userVerification || 'preferred',
              allowCredentials: (optionsBody.allowCredentials || []).map(function (c) {
                return { type: c.type || 'public-key', id: b64UrlToBuf(c.id), transports: c.transports || [] };
              })
            };
            const credential = await navigator.credentials.get({ publicKey });
            if (!credential) throw new Error('Passkey authentication canceled.');
            const verifyRes = await fetch('/auth/passkey/auth/verify', {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({
                email,
                next,
                credential: {
                  id: credential.id,
                  rawId: bufToB64Url(credential.rawId),
                  type: credential.type,
                  response: {
                    clientDataJSON: bufToB64Url(credential.response.clientDataJSON),
                    authenticatorData: bufToB64Url(credential.response.authenticatorData),
                    signature: bufToB64Url(credential.response.signature),
                    userHandle: credential.response.userHandle ? bufToB64Url(credential.response.userHandle) : ''
                  }
                }
              })
            });
            const verifyBody = await verifyRes.json();
            if (!verifyRes.ok || !verifyBody.ok) throw new Error(verifyBody.error || 'Passkey verify failed');
            window.location.href = verifyBody.redirectTo || next || '/';
          } catch (err) {
            msg.textContent = err && err.message ? err.message : 'Passkey login failed';
            msg.style.display = 'block';
          }
        });
      })();
    </script>
  `;

  return renderLayout('כניסה', content);
}

function renderRegisterPage({ error = '', success = '', email = '', displayName = '', secret = '', otpAuthUri = '', users = [] }) {
  const qrUrl = otpAuthUri
    ? `https://api.qrserver.com/v1/create-qr-code/?size=220x220&data=${encodeURIComponent(otpAuthUri)}`
    : '';

  const usersRows = users.length
    ? users
        .map(
          (u) =>
            `<tr><td>${escapeHtml(cleanString(u.displayName) || '—')}</td><td>${escapeHtml(u.email)}</td><td>${escapeHtml(new Date(u.createdAt).toLocaleString('he-IL'))}</td></tr>`
        )
        .join('')
    : '<tr><td colspan="3" class="muted">אין משתמשים.</td></tr>';
  const userOptions = users.map((u) => `<option value="${escapeHtml(u.email)}">${escapeHtml(u.email)}</option>`).join('');

  const content = `
    <div class="hero">
      <h1>ניהול משתמשים</h1>
      <p>יצירה ומחיקה של משתמשים מקומיים עם אימות דו-שלבי.</p>
    </div>

    <div class="card">
      <form method="POST" action="/auth/register">
        <div class="form-grid">
          <div>
            <div class="k">סיסמת ניהול</div>
            <input type="password" name="adminPassword" required />
          </div>
          <div>
            <div class="k">אימייל משתמש</div>
            <input type="email" name="email" required value="${escapeHtml(email)}" />
          </div>
          <div>
            <div class="k">שם תצוגה</div>
            <input type="text" name="displayName" required value="${escapeHtml(displayName)}" />
          </div>
        </div>
        <div class="actions">
          <button class="primary" type="submit">יצירת משתמש + קוד מאמת</button>
          <a class="button secondary" href="/auth/login">חזרה לכניסה</a>
          ${renderLogoutControl()}
        </div>
      </form>
      ${error ? `<div class="alert error">${escapeHtml(error)}</div>` : ''}
      ${success ? `<div class="alert success">${escapeHtml(success)}</div>` : ''}
    </div>

    ${otpAuthUri ? `
      <div class="card">
        <h2>סריקה ב-Google Authenticator</h2>
        <div class="grid">
          <div class="field">
            <div class="k">קוד QR</div>
            <div class="v"><img src="${qrUrl}" alt="QR" /></div>
          </div>
          <div class="field">
            <div class="k">מפתח סודי</div>
            <div class="v">${escapeHtml(secret)}</div>
            <div class="k">URI</div>
            <div class="v">${escapeHtml(otpAuthUri)}</div>
          </div>
        </div>
      </div>
    ` : ''}

    <div class="card">
      <h2>משתמשים מקומיים</h2>
      <table>
        <thead><tr><th>שם תצוגה</th><th>אימייל</th><th>נוצר בתאריך</th></tr></thead>
        <tbody>${usersRows}</tbody>
      </table>
    </div>

    <div class="card">
      <h2>מחיקת משתמש קיים</h2>
      <form method="POST" action="/auth/users/delete">
        <div class="form-grid">
          <div>
            <div class="k">סיסמת ניהול</div>
            <input type="password" name="adminPassword" required />
          </div>
          <div>
            <div class="k">אימייל למחיקה</div>
            <input type="email" name="email" list="users-list" required />
            <datalist id="users-list">${userOptions}</datalist>
          </div>
        </div>
        <div class="actions">
          <button class="secondary" type="submit">מחק הרשאת משתמש</button>
        </div>
      </form>
    </div>

    <div class="card">
      <h2>רישום Passkey למשתמש</h2>
      <div class="form-grid">
        <div>
          <div class="k">סיסמת ניהול</div>
          <input id="passkey-admin-password" type="password" />
        </div>
        <div>
          <div class="k">אימייל משתמש</div>
          <input id="passkey-email" type="email" list="users-list" />
        </div>
      </div>
      <div class="actions">
        <button id="passkey-register-btn" class="secondary" type="button">רישום Passkey</button>
      </div>
      <div id="passkey-register-msg" class="alert error" style="display:none;"></div>
    </div>
    <script>
      (function () {
        function b64UrlToBuf(str) {
          const b64 = String(str || '').replace(/-/g, '+').replace(/_/g, '/');
          const pad = b64.length % 4 ? '='.repeat(4 - (b64.length % 4)) : '';
          const raw = atob(b64 + pad);
          const out = new Uint8Array(raw.length);
          for (let i = 0; i < raw.length; i += 1) out[i] = raw.charCodeAt(i);
          return out.buffer;
        }
        function bufToB64Url(buf) {
          const bytes = new Uint8Array(buf);
          let bin = '';
          for (let i = 0; i < bytes.length; i += 1) bin += String.fromCharCode(bytes[i]);
          return btoa(bin).replace(/\\+/g, '-').replace(/\\//g, '_').replace(/=+$/g, '');
        }
        const btn = document.getElementById('passkey-register-btn');
        const msg = document.getElementById('passkey-register-msg');
        if (!btn || !window.PublicKeyCredential) return;
        btn.addEventListener('click', async function () {
          msg.style.display = 'none';
          try {
            const email = (document.getElementById('passkey-email').value || '').trim();
            const adminPassword = (document.getElementById('passkey-admin-password').value || '').trim();
            const optionsRes = await fetch('/auth/passkey/register/options', {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({ email, adminPassword })
            });
            const optionsBody = await optionsRes.json();
            if (!optionsRes.ok) throw new Error(optionsBody.error || 'Register options failed');
            const publicKey = {
              challenge: b64UrlToBuf(optionsBody.challenge),
              rp: optionsBody.rp,
              user: {
                id: b64UrlToBuf(optionsBody.user.id),
                name: optionsBody.user.name,
                displayName: optionsBody.user.displayName
              },
              pubKeyCredParams: optionsBody.pubKeyCredParams || [{ type: 'public-key', alg: -7 }],
              timeout: optionsBody.timeout || 60000,
              attestation: optionsBody.attestation || 'none',
              authenticatorSelection: optionsBody.authenticatorSelection || { residentKey: 'preferred', userVerification: 'preferred' },
              excludeCredentials: (optionsBody.excludeCredentials || []).map(function (c) {
                return { type: c.type || 'public-key', id: b64UrlToBuf(c.id) };
              })
            };
            const credential = await navigator.credentials.create({ publicKey: publicKey });
            if (!credential) throw new Error('Passkey registration canceled.');
            const verifyRes = await fetch('/auth/passkey/register/verify', {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({
                email,
                adminPassword,
                credential: {
                  id: credential.id,
                  rawId: bufToB64Url(credential.rawId),
                  type: credential.type,
                  response: {
                    clientDataJSON: bufToB64Url(credential.response.clientDataJSON),
                    attestationObject: credential.response.attestationObject ? bufToB64Url(credential.response.attestationObject) : '',
                    publicKey: credential.response.getPublicKey ? bufToB64Url(credential.response.getPublicKey()) : '',
                    transports: credential.response.getTransports ? credential.response.getTransports() : []
                  }
                }
              })
            });
            const verifyBody = await verifyRes.json();
            if (!verifyRes.ok || !verifyBody.ok) throw new Error(verifyBody.error || 'Passkey register failed');
            msg.className = 'alert success';
            msg.textContent = 'Passkey נשמר בהצלחה למשתמש.';
            msg.style.display = 'block';
          } catch (err) {
            msg.className = 'alert error';
            msg.textContent = err && err.message ? err.message : 'Passkey register failed';
            msg.style.display = 'block';
          }
        });
      })();
    </script>
  `;

  return renderLayout('ניהול משתמשים', content);
}

async function handleAuthLoginPage(reqUrl, res) {
  const next = getSafeNextPath(reqUrl.searchParams.get('next') || '/');
  const html = renderLoginPage({ next });
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
  res.end(html);
}

async function handleAuthLogin(req, res) {
  const form = await parseFormRequest(req);
  const email = normalizeEmail(form.email);
  const code = cleanString(form.code);
  const next = getSafeNextPath(form.next || '/');

  const users = getUsers();
  const user = users.find((u) => normalizeEmail(u.email) === email);

  if (!user || !isValidTotp(user.secretBase32, code)) {
    const html = renderLoginPage({ error: 'אימייל או קוד אימות שגוי.', next, email: form.email || '' });
    res.writeHead(401, { 'content-type': 'text/html; charset=utf-8' });
    res.end(html);
    return;
  }

  const token = createSession(user.email, cleanString(user.displayName));
  setSessionCookie(res, token);
  res.writeHead(303, { location: next });
  res.end();
}

async function handlePasskeyAuthOptions(req, res) {
  try {
    const body = await parseJsonRequest(req);
    const email = normalizeEmail(body.email);
    const next = getSafeNextPath(body.next || '/');
    const { user } = getUserByEmail(email);
    if (!user) {
      writeJson(res, 404, { error: 'משתמש לא נמצא.' });
      return;
    }

    const passkeys = Array.isArray(user.passkeys) ? user.passkeys : [];
    if (!passkeys.length) {
      writeJson(res, 400, { error: 'למשתמש אין Passkey רשום.' });
      return;
    }

    const challenge = createPasskeyChallenge({ email, purpose: 'auth', next });
    writeJson(res, 200, {
      challenge,
      rpId: getRpIdFromRequest(req),
      userVerification: 'preferred',
      allowCredentials: passkeys.map((p) => ({
        id: p.credentialId,
        type: 'public-key',
        transports: Array.isArray(p.transports) ? p.transports : []
      }))
    });
  } catch (error) {
    writeJson(res, 400, { error: error.message || 'Passkey options failed' });
  }
}

async function handlePasskeyAuthVerify(req, res) {
  try {
    const body = await parseJsonRequest(req);
    const email = normalizeEmail(body.email);
    const credential = body.credential || {};
    const next = getSafeNextPath(body.next || '/');
    const response = credential.response || {};
    const credentialId = cleanString(credential.id);
    if (!email || !credentialId) {
      writeJson(res, 400, { error: 'Missing email or credential.' });
      return;
    }

    const clientDataBuf = base64UrlDecode(response.clientDataJSON);
    const authDataBuf = base64UrlDecode(response.authenticatorData);
    const signatureBuf = base64UrlDecode(response.signature);
    const clientData = JSON.parse(clientDataBuf.toString('utf8'));
    const challenge = cleanString(clientData.challenge);
    const row = consumePasskeyChallenge({ email, purpose: 'auth', challenge });
    if (!row) {
      writeJson(res, 400, { error: 'Challenge לא תקף או פג תוקף.' });
      return;
    }

    const { users, user, index } = getUserByEmail(email);
    if (!user) {
      writeJson(res, 404, { error: 'משתמש לא נמצא.' });
      return;
    }

    const passkeys = Array.isArray(user.passkeys) ? user.passkeys : [];
    const passkey = passkeys.find((p) => p.credentialId === credentialId);
    if (!passkey || !passkey.publicKeySpki) {
      writeJson(res, 400, { error: 'Passkey לא נמצא עבור המשתמש.' });
      return;
    }

    const expectedOrigin = getOriginFromRequest(req);
    if (
      cleanString(clientData.type) !== 'webauthn.get'
      || !isPasskeyOriginAllowed(cleanString(clientData.origin), req)
      || (getAllowedPasskeyOrigins(req).length === 1 && cleanString(clientData.origin) !== expectedOrigin)
    ) {
      writeJson(res, 400, { error: 'Invalid clientData.' });
      return;
    }

    const clientDataHash = crypto.createHash('sha256').update(clientDataBuf).digest();
    const signedPayload = Buffer.concat([authDataBuf, clientDataHash]);
    const verified = crypto.verify('sha256', signedPayload, passkey.publicKeySpki, signatureBuf);
    if (!verified) {
      writeJson(res, 401, { error: 'Signature verification failed.' });
      return;
    }

    if (authDataBuf.length >= 37) {
      const signCount = authDataBuf.readUInt32BE(33);
      if (Number.isFinite(passkey.signCount) && passkey.signCount > 0 && signCount > 0 && signCount <= passkey.signCount) {
        writeJson(res, 401, { error: 'Passkey sign counter invalid.' });
        return;
      }
      passkey.signCount = signCount;
      passkey.lastUsedAt = new Date().toISOString();
      users[index].passkeys = passkeys;
      saveUsers(users);
    }

    const token = createSession(user.email, cleanString(user.displayName));
    setSessionCookie(res, token);
    writeJson(res, 200, { ok: true, redirectTo: row.next || next || '/' });
  } catch (error) {
    writeJson(res, 400, { error: error.message || 'Passkey verify failed' });
  }
}

async function handlePasskeyRegisterOptions(req, res) {
  try {
    const body = await parseJsonRequest(req);
    const adminPassword = cleanString(body.adminPassword);
    const email = normalizeEmail(body.email);
    if (adminPassword !== AUTH_SETUP_PASSWORD) {
      writeJson(res, 401, { error: 'סיסמת ניהול שגויה.' });
      return;
    }
    const { user } = getUserByEmail(email);
    if (!user) {
      writeJson(res, 404, { error: 'משתמש לא נמצא.' });
      return;
    }

    const challenge = createPasskeyChallenge({ email, purpose: 'register', next: '/auth/register' });
    const existing = Array.isArray(user.passkeys) ? user.passkeys : [];
    writeJson(res, 200, {
      challenge,
      rp: { name: AUTH_ISSUER, id: getRpIdFromRequest(req) },
      user: {
        id: base64UrlEncode(buildPasskeyUserHandle(email)),
        name: email,
        displayName: cleanString(user.displayName) || email
      },
      pubKeyCredParams: [
        { type: 'public-key', alg: -7 },
        { type: 'public-key', alg: -257 }
      ],
      attestation: 'none',
      timeout: 60000,
      authenticatorSelection: {
        residentKey: 'preferred',
        userVerification: 'preferred'
      },
      excludeCredentials: existing.map((p) => ({ id: p.credentialId, type: 'public-key' }))
    });
  } catch (error) {
    writeJson(res, 400, { error: error.message || 'Passkey register options failed' });
  }
}

async function handlePasskeyRegisterVerify(req, res) {
  try {
    const body = await parseJsonRequest(req);
    const adminPassword = cleanString(body.adminPassword);
    const email = normalizeEmail(body.email);
    const credential = body.credential || {};
    if (adminPassword !== AUTH_SETUP_PASSWORD) {
      writeJson(res, 401, { error: 'סיסמת ניהול שגויה.' });
      return;
    }
    if (!email || !credential?.id) {
      writeJson(res, 400, { error: 'Missing email or credential.' });
      return;
    }

    const response = credential.response || {};
    const clientDataBuf = base64UrlDecode(response.clientDataJSON);
    const clientData = JSON.parse(clientDataBuf.toString('utf8'));
    const challenge = cleanString(clientData.challenge);
    const row = consumePasskeyChallenge({ email, purpose: 'register', challenge });
    if (!row) {
      writeJson(res, 400, { error: 'Challenge לא תקף או פג תוקף.' });
      return;
    }

    const expectedOrigin = getOriginFromRequest(req);
    if (
      cleanString(clientData.type) !== 'webauthn.create'
      || !isPasskeyOriginAllowed(cleanString(clientData.origin), req)
      || (getAllowedPasskeyOrigins(req).length === 1 && cleanString(clientData.origin) !== expectedOrigin)
    ) {
      writeJson(res, 400, { error: 'Invalid clientData.' });
      return;
    }

    const publicKeyRaw = cleanString(response.publicKey);
    if (!publicKeyRaw) {
      writeJson(res, 400, { error: 'הדפדפן לא סיפק מפתח ציבורי. נסה דפדפן עדכני.' });
      return;
    }

    const { users, user, index } = getUserByEmail(email);
    if (!user) {
      writeJson(res, 404, { error: 'משתמש לא נמצא.' });
      return;
    }
    const passkeys = Array.isArray(user.passkeys) ? user.passkeys : [];
    const credentialId = cleanString(credential.id);
    if (passkeys.some((p) => p.credentialId === credentialId)) {
      writeJson(res, 400, { error: 'Passkey כבר קיים למשתמש.' });
      return;
    }

    passkeys.push({
      credentialId,
      publicKeySpki: bytesToPemSpki(base64UrlDecode(publicKeyRaw)),
      transports: Array.isArray(response.transports) ? response.transports : [],
      signCount: 0,
      createdAt: new Date().toISOString(),
      lastUsedAt: null
    });
    users[index].passkeys = passkeys;
    saveUsers(users);

    writeJson(res, 200, { ok: true });
  } catch (error) {
    writeJson(res, 400, { error: error.message || 'Passkey register verify failed' });
  }
}

async function handleAuthRegisterPage(res, state = {}) {
  const users = getUsers();
  const html = renderRegisterPage({ ...state, users });
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
  res.end(html);
}

async function handleAuthRegister(req, res) {
  const form = await parseFormRequest(req);
  const adminPassword = cleanString(form.adminPassword);
  const email = normalizeEmail(form.email);
  const displayName = cleanString(form.displayName);

  if (adminPassword !== AUTH_SETUP_PASSWORD) {
    await handleAuthRegisterPage(res, { error: 'סיסמת ניהול שגויה.', email: form.email || '', displayName: form.displayName || '' });
    return;
  }

  if (!email || !email.includes('@')) {
    await handleAuthRegisterPage(res, { error: 'אימייל לא תקין.', email: form.email || '', displayName: form.displayName || '' });
    return;
  }
  if (!displayName) {
    await handleAuthRegisterPage(res, { error: 'יש להזין שם תצוגה.', email: form.email || '', displayName: form.displayName || '' });
    return;
  }

  const users = getUsers();
  if (users.some((u) => normalizeEmail(u.email) === email)) {
    await handleAuthRegisterPage(res, { error: 'המשתמש כבר קיים במערכת.', email, displayName });
    return;
  }

  const secretBase32 = generateTotpSecret();
  const newUser = {
    email,
    displayName,
    secretBase32,
    createdAt: new Date().toISOString()
  };
  users.push(newUser);
  saveUsers(users);

  const otpAuthUri = buildOtpAuthUri(email, secretBase32);
  await handleAuthRegisterPage(res, {
    success: 'המשתמש נוצר בהצלחה. סרוק את הקוד במאמת גוגל.',
    email,
    displayName,
    secret: secretBase32,
    otpAuthUri
  });
}

async function handleAuthDeleteUser(req, res) {
  const form = await parseFormRequest(req);
  const adminPassword = cleanString(form.adminPassword);
  const email = normalizeEmail(form.email);

  if (adminPassword !== AUTH_SETUP_PASSWORD) {
    await handleAuthRegisterPage(res, { error: 'סיסמת ניהול שגויה.' });
    return;
  }

  const users = getUsers();
  const filtered = users.filter((u) => normalizeEmail(u.email) !== email);
  if (filtered.length === users.length) {
    await handleAuthRegisterPage(res, { error: 'לא נמצא משתמש למחיקה.' });
    return;
  }

  saveUsers(filtered);
  destroySessionsForEmail(email);
  await handleAuthRegisterPage(res, { success: `המשתמש ${email} נמחק בהצלחה.` });
}

async function handleAuthLogout(req, res) {
  const cookies = parseCookies(req);
  destroySession(cookies[SESSION_COOKIE_NAME]);
  clearSessionCookie(res);
  res.writeHead(303, { location: '/auth/login' });
  res.end();
}

function requireAuthenticatedSession(req, res, reqUrl) {
  const user = getAuthenticatedUser(req);
  if (user) return user;

  const next = getSafeNextPath(`${reqUrl.pathname}${reqUrl.search || ''}`);
  res.writeHead(303, { location: `/auth/login?next=${encodeURIComponent(next)}` });
  res.end();
  return null;
}

function renderLogoutControl() {
  return `
    <form class="logout-form" method="POST" action="/auth/logout">
      <button class="secondary" type="submit">התנתקות</button>
    </form>
  `;
}
function renderLayout(title, content) {
  return `<!doctype html>
<html lang="he" dir="rtl">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(title)}</title>
  <style>
    :root {
      --bg: #f5f5f2;
      --bg-soft: #fcfcf9;
      --card: #ffffff;
      --text: #1e293b;
      --muted: #64748b;
      --line: #d6d9e0;
      --accent: #1d4ed8;
      --accent-2: #0f172a;
      --ok-bg: #ecfdf5;
      --ok-border: #86efac;
      --ok-text: #166534;
      --danger-bg: #fef2f2;
      --danger-border: #fecaca;
      --danger-text: #991b1b;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      font-family: "Rubik", "Segoe UI", sans-serif;
      color: var(--text);
      background:
        radial-gradient(circle at 90% 10%, #dbeafe 0%, transparent 42%),
        radial-gradient(circle at 10% 90%, #dcfce7 0%, transparent 38%),
        linear-gradient(135deg, var(--bg-soft), var(--bg));
      min-height: 100vh;
    }
    .container {
      max-width: 1180px;
      margin: 0 auto;
      padding: 28px 18px 40px;
    }
    .hero {
      background: linear-gradient(120deg, #0f172a, #1e3a8a 45%, #0ea5e9);
      color: #fff;
      border-radius: 26px;
      padding: 28px;
      box-shadow: 0 16px 45px rgba(30, 58, 138, 0.33);
      margin-bottom: 18px;
    }
    .hero h1 { margin: 0 0 6px; font-size: 32px; }
    .hero p { margin: 0; opacity: 0.92; }
    .layout-two {
      display: grid;
      grid-template-columns: 1.1fr 1fr;
      gap: 16px;
      align-items: start;
      margin-bottom: 16px;
    }
    .card {
      background: rgba(255,255,255,0.92);
      backdrop-filter: blur(8px);
      border: 1px solid var(--line);
      border-radius: 20px;
      padding: 18px;
      box-shadow: 0 12px 30px rgba(15, 23, 42, 0.07);
      margin-bottom: 16px;
      transition: transform .18s ease, box-shadow .18s ease;
    }
    .card:hover {
      transform: translateY(-2px);
      box-shadow: 0 16px 35px rgba(15, 23, 42, 0.10);
    }
    h2, h3 { margin-top: 0; }
    .subtitle { color: var(--muted); margin: 2px 0 14px; }
    .form-grid {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 10px;
    }
    .form-grid .full { grid-column: 1 / -1; }
    input, select, textarea {
      width: 100%;
      padding: 11px 12px;
      border: 1px solid var(--line);
      border-radius: 12px;
      font-size: 14px;
      background: #fff;
      color: var(--text);
      transition: border-color .15s ease, box-shadow .15s ease;
    }
    input:focus, select:focus, textarea:focus {
      outline: none;
      border-color: #2563eb;
      box-shadow: 0 0 0 3px rgba(37, 99, 235, 0.15);
    }
    textarea { min-height: 86px; resize: vertical; }
    .actions {
      display: flex;
      gap: 8px;
      flex-wrap: wrap;
      margin-top: 12px;
    }
    button, a.button {
      border: 0;
      border-radius: 12px;
      cursor: pointer;
      text-decoration: none;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      padding: 10px 14px;
      font-weight: 600;
      font-size: 14px;
      transition: transform .12s ease, box-shadow .12s ease, background .12s ease;
    }
    button:hover, a.button:hover { transform: translateY(-1px); }
    button.primary, a.button.primary { background: var(--accent); color: #fff; }
    button.primary:hover, a.button.primary:hover { background: #1e40af; }
    button.secondary, a.button.secondary { background: var(--accent-2); color: #fff; }
    .search-row {
      display: grid;
      grid-template-columns: 1fr auto;
      gap: 8px;
    }
    .alert {
      border-radius: 12px;
      padding: 12px;
      margin-top: 12px;
      white-space: pre-wrap;
      font-size: 14px;
    }
    .alert.error {
      background: var(--danger-bg);
      color: var(--danger-text);
      border: 1px solid var(--danger-border);
    }
    .alert.success {
      background: var(--ok-bg);
      color: var(--ok-text);
      border: 1px solid var(--ok-border);
    }
    .pill {
      display: inline-block;
      padding: 3px 9px;
      border-radius: 999px;
      background: #e2e8f0;
      color: #0f172a;
      font-size: 12px;
      font-weight: 600;
    }
    table {
      width: 100%;
      border-collapse: collapse;
      margin-top: 10px;
    }
    th, td {
      text-align: right;
      border-bottom: 1px solid var(--line);
      padding: 10px;
      vertical-align: top;
    }
    th {
      color: var(--muted);
      font-size: 13px;
      text-transform: uppercase;
      letter-spacing: 0.03em;
    }
    .muted { color: var(--muted); }
    .grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
      gap: 10px;
    }
    .field {
      border: 1px solid var(--line);
      border-radius: 14px;
      padding: 10px;
      background: #fff;
    }
    .field .k { color: var(--muted); font-size: 12px; margin-bottom: 5px; word-break: break-word; }
    .field .v { font-size: 14px; white-space: pre-wrap; word-break: break-word; }
    .field .v a { color: var(--accent); text-decoration: none; font-weight: 600; }
    .field .v a:hover { text-decoration: underline; }
    .logout-form { display: inline-flex; margin: 0; }
    .institution-cards { display: none; margin-top: 10px; gap: 10px; }
    .institution-card {
      border: 1px solid var(--line);
      border-radius: 14px;
      padding: 12px;
      background: #fff;
    }
    .institution-card-head {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
      margin-bottom: 10px;
    }
    .institution-name { font-weight: 700; }
    .institution-phones { display: grid; gap: 6px; }
    @media (max-width: 900px) {
      .layout-two { grid-template-columns: 1fr; }
      .form-grid { grid-template-columns: 1fr; }
      .hero h1 { font-size: 26px; }
      .institution-table { display: none; }
      .institution-cards { display: grid; }
    }
  </style>
</head>
<body>
  <div class="container">${content}</div>
</body>
</html>`;
}

function renderFieldInput(field, values) {
  const current = getInputValue(values, field.key);
  const noteField = field.key === 'note';
  const listField = field.key.endsWith('additionalPhones') || field.key.endsWith('additionalEmails');

  if (field.enum && ENUM_LABELS[field.enum]) {
    return `
      <div>
        <div class="k">${escapeHtml(field.label)}</div>
        ${renderSelect(field.key, ENUM_LABELS[field.enum], values?.[field.key], field.label)}
      </div>
    `;
  }

  if (field.type === 'date') {
    return `
      <div>
        <div class="k">${escapeHtml(field.label)}</div>
        <input type="date" name="${escapeHtml(field.key)}" value="${current}" />
      </div>
    `;
  }

  if (noteField || listField) {
    return `
      <div class="full">
        <div class="k">${escapeHtml(field.label)}</div>
        <textarea name="${escapeHtml(field.key)}" placeholder="${listField ? 'ערכים מופרדים בפסיק' : ''}">${current}</textarea>
      </div>
    `;
  }

  return `
    <div>
      <div class="k">${escapeHtml(field.label)}</div>
      <input type="text" name="${escapeHtml(field.key)}" value="${current}" />
    </div>
  `;
}

function renderCreateStudentPage({ error = '', values = {} }) {
  const sectionsHtml = FIELD_SECTIONS.map((section) => {
    const fieldsHtml = section.fields.map((field) => renderFieldInput(field, values)).join('');
    return `
      <div class="card">
        <h2>${escapeHtml(section.title)}</h2>
        <div class="form-grid">${fieldsHtml}</div>
      </div>
    `;
  }).join('');

  const content = `
    <div class="hero">
      <h1>הוספת תלמיד חדש</h1>
      <p>טופס מלא עם כל השדות הזמינים במערכת.</p>
    </div>

    <form method="POST" action="/students/create">
      ${sectionsHtml}
      <div class="card">
        <div class="actions">
          <button class="primary" type="submit">צור תלמיד</button>
          <a class="button secondary" href="/">חזרה לעמוד הראשי</a>
          ${renderLogoutControl()}
        </div>
        ${error ? `<div class="alert error">${escapeHtml(error)}</div>` : ''}
      </div>
    </form>
  `;

  return renderLayout('הוספת תלמיד', content);
}

function renderSearchPage({
  q = '',
  tz = '',
  institution = '',
  institutionSearch = '',
  institutionSort = 'class_last_name',
  internalStatusFilter = '',
  directDebitFilter = 'all',
  signerFilter = '',
  quickUpdated = false,
  edges = [],
  error = '',
  institutionMode = false,
  institutionCount = 0
}) {
  const backParams = new URLSearchParams();
  if (q) backParams.set('q', q);
  if (institution) backParams.set('institution', institution);
  if (institutionSearch) backParams.set('institutionSearch', institutionSearch);
  if (institutionSort) backParams.set('institutionSort', institutionSort);
  if (internalStatusFilter) backParams.set('internalStatus', internalStatusFilter);
  if (directDebitFilter && directDebitFilter !== 'all') backParams.set('directDebit', directDebitFilter);
  if (signerFilter) backParams.set('signerFilter', signerFilter);
  const listBackPath = backParams.toString() ? `/?${backParams.toString()}` : '/';

  const normalRows = edges.length
    ? edges
        .map(({ node }) => {
          const link = `/student/${encodeURIComponent(node.objectNameSingular)}/${encodeURIComponent(node.recordId)}`;
          return `
            <tr>
              <td>${escapeHtml(node.label || 'ללא שם')}</td>
              <td><a class="button primary" href="${link}">פתח כרטיס</a></td>
            </tr>`;
        })
        .join('')
    : '<tr><td colspan="2" class="muted">אין תוצאות כרגע.</td></tr>';

  const institutionRows = edges.length
    ? edges
        .map(({ node }) => {
          const link = `/student/${encodeURIComponent(node.objectNameSingular)}/${encodeURIComponent(node.recordId)}`;
          const classLabel = node.class ? (ENUM_LABELS.class[node.class] || node.class) : '—';
          const age = calculateAge(node?.dateofbirth);
          const studentPhone = renderPhoneLink(ensurePhoneWithDefaults(node?.phone));
          const dadPhone = renderPhoneLink(ensurePhoneWithDefaults(node?.dadPhone));
          const momPhone = renderPhoneLink(ensurePhoneWithDefaults(node?.momPhone));
          const internalStatus = formatInternalStatus(node?.internalData?.noteStatus);
          const directDebit = formatDirectDebitValue(node?.internalData?.directDebitActive);
          const signedBy = cleanString(node?.internalData?.signedByDisplayName) || cleanString(node?.internalData?.signedByEmail) || '—';
          return `
            <tr>
              <td>${escapeHtml(classLabel)}</td>
              <td>${escapeHtml(node.label || 'ללא שם')}</td>
              <td>${escapeHtml(age === null ? '—' : String(age))}</td>
              <td>${escapeHtml(internalStatus)}</td>
              <td>${escapeHtml(directDebit)}</td>
              <td>${escapeHtml(signedBy)}</td>
              <td>${studentPhone}</td>
              <td>${dadPhone}</td>
              <td>${momPhone}</td>
              <td>
                <div class="actions" style="margin:0;">
                  <a class="button primary" href="${link}">פתח כרטיס</a>
                </div>
                <details style="margin-top:8px;">
                  <summary>עריכה פנימית מהירה</summary>
                  <form method="POST" action="/students/internal/quick-update" style="margin-top:8px;">
                    <input type="hidden" name="studentId" value="${escapeHtml(node.recordId)}" />
                    <input type="hidden" name="next" value="${escapeHtml(listBackPath)}" />
                    <div class="form-grid">
                      <div class="full">
                        <textarea name="noteText" placeholder="הערה פנימית">${escapeHtml(cleanString(node?.internalData?.noteText))}</textarea>
                      </div>
                      <div>
                        ${renderSelect('noteStatus', INTERNAL_NOTE_STATUS_LABELS, cleanString(node?.internalData?.noteStatus), 'סטטוס')}
                      </div>
                      <div>
                        ${renderSelect('directDebitActive', { true: 'כן', false: 'לא' }, normalizeDirectDebitValue(node?.internalData?.directDebitActive), 'הוראת קבע')}
                      </div>
                    </div>
                    <div class="actions">
                      <button class="secondary" type="submit">שמור</button>
                    </div>
                  </form>
                </details>
              </td>
            </tr>`;
        })
        .join('')
    : '<tr><td colspan="10" class="muted">אין תלמידים במוסד זה.</td></tr>';

  const institutionCards = edges.length
    ? edges
        .map(({ node }) => {
          const link = `/student/${encodeURIComponent(node.objectNameSingular)}/${encodeURIComponent(node.recordId)}`;
          const classLabel = node.class ? (ENUM_LABELS.class[node.class] || node.class) : '—';
          const age = calculateAge(node?.dateofbirth);
          const internalStatus = formatInternalStatus(node?.internalData?.noteStatus);
          const directDebit = formatDirectDebitValue(node?.internalData?.directDebitActive);
          const signedBy = cleanString(node?.internalData?.signedByDisplayName) || cleanString(node?.internalData?.signedByEmail) || '—';
          return `
            <div class="institution-card">
              <div class="institution-card-head">
                <div class="institution-name">${escapeHtml(node.label || 'ללא שם')}</div>
                <span class="pill">${escapeHtml(classLabel)}</span>
              </div>
              <div><span class="muted">גיל:</span> ${escapeHtml(age === null ? '—' : String(age))}</div>
              <div><span class="muted">סטטוס פנימי:</span> ${escapeHtml(internalStatus)}</div>
              <div><span class="muted">הוראת קבע:</span> ${escapeHtml(directDebit)}</div>
              <div><span class="muted">נחתם ע"י:</span> ${escapeHtml(signedBy)}</div>
              <div class="institution-phones">
                <div><span class="muted">נייד תלמיד:</span> ${renderPhoneLink(ensurePhoneWithDefaults(node?.phone))}</div>
                <div><span class="muted">נייד אב:</span> ${renderPhoneLink(ensurePhoneWithDefaults(node?.dadPhone))}</div>
                <div><span class="muted">נייד אם:</span> ${renderPhoneLink(ensurePhoneWithDefaults(node?.momPhone))}</div>
              </div>
              <form method="POST" action="/students/internal/quick-update" style="margin-top:8px;">
                <input type="hidden" name="studentId" value="${escapeHtml(node.recordId)}" />
                <input type="hidden" name="next" value="${escapeHtml(listBackPath)}" />
                <div class="form-grid">
                  <div class="full">
                    <textarea name="noteText" placeholder="הערה פנימית">${escapeHtml(cleanString(node?.internalData?.noteText))}</textarea>
                  </div>
                  <div>
                    ${renderSelect('noteStatus', INTERNAL_NOTE_STATUS_LABELS, cleanString(node?.internalData?.noteStatus), 'סטטוס')}
                  </div>
                  <div>
                    ${renderSelect('directDebitActive', { true: 'כן', false: 'לא' }, normalizeDirectDebitValue(node?.internalData?.directDebitActive), 'הוראת קבע')}
                  </div>
                </div>
                <div class="actions">
                  <button class="secondary" type="submit">שמור מידע פנימי</button>
                </div>
              </form>
              <div class="actions">
                <a class="button primary" href="${link}">פתח כרטיס</a>
              </div>
            </div>
          `;
        })
        .join('')
    : '<div class="muted">אין תלמידים במוסד זה.</div>';

  const content = `
    <div class="hero">
      <h1>ניהול תלמידים</h1>
      <p>חיפוש מהיר ושליפה לפי מקום לימודים נוכחי.</p>
    </div>

    <div class="layout-two">
      <div class="card">
        <h2>חיפוש תלמידים</h2>
        <p class="subtitle">אפשר לחפש בטקסט חופשי או להציג את כל התלמידים לפי מוסד נוכחי.</p>
        <form method="GET" action="/">
          <div class="search-row">
            <input name="q" type="text" value="${escapeHtml(q)}" placeholder="חיפוש לפי שם תלמיד" />
            <button class="primary" type="submit">חפש</button>
          </div>
          <div class="search-row" style="margin-top:8px;">
            <input name="tz" type="text" inputmode="numeric" value="${escapeHtml(tz)}" placeholder="חיפוש לפי מספר זהות" />
            <button class="secondary" type="submit">אתר לפי ת"ז</button>
          </div>
        </form>
        <div class="subtitle">או לפי מקום לימודים נוכחי:</div>
        <form method="GET" action="/">
          <div class="search-row">
            ${renderSelect('institution', ENUM_LABELS.currentInstitution, institution, 'בחר מוסד')}
            <button class="primary" type="submit">הצג תלמידים</button>
          </div>
          <div class="search-row" style="margin-top:8px;">
            <input name="institutionSearch" type="text" value="${escapeHtml(institutionSearch)}" placeholder="חיפוש בתוך המוסד" />
            <button class="secondary" type="submit">חיפוש במוסד</button>
          </div>
          <div class="search-row" style="margin-top:8px;">
            ${renderSelect(
              'institutionSort',
              {
                class_last_name: 'מיון: שיעור ואז משפחה',
                age_desc: 'מיון: גיל (מבוגר לצעיר)',
                internal_updated_desc: 'מיון: עדכון פנימי אחרון',
                note_status_asc: 'מיון: סטטוס פנימי',
                direct_debit_desc: 'מיון: הוראת קבע פעילה קודם',
                signer_asc: 'מיון: לפי חותם'
              },
              institutionSort,
              'בחר מיון'
            )}
            <button class="secondary" type="submit">החל מיון</button>
          </div>
          <div class="search-row" style="margin-top:8px;grid-template-columns:1fr 1fr;">
            ${renderSelect('internalStatus', INTERNAL_NOTE_STATUS_LABELS, internalStatusFilter, 'סנן לפי סטטוס פנימי')}
            ${renderSelect('directDebit', { all: 'הוראת קבע: הכל', yes: 'עם הוראת קבע', no: 'בלי הוראת קבע' }, directDebitFilter, 'סנן הוראת קבע')}
          </div>
          <div class="search-row" style="margin-top:8px;">
            <input name="signerFilter" type="text" value="${escapeHtml(signerFilter)}" placeholder="סינון לפי חותם (שם/אימייל)" />
            <button class="secondary" type="submit">החל סינון</button>
          </div>
        </form>
        ${error ? `<div class="alert error">${escapeHtml(error)}</div>` : ''}
        ${quickUpdated ? '<div class="alert success">המידע הפנימי נשמר מהרשימה בהצלחה.</div>' : ''}
      </div>

      <div class="card">
        <h2>פעולות מהירות</h2>
        <p class="subtitle">ליצירת תלמיד חדש עם כל השדות, עבור לעמוד הוספה.</p>
        <div class="actions">
          <a class="button primary" href="/students/new">הוספת תלמיד חדש</a>
          ${renderLogoutControl()}
        </div>
      </div>
    </div>

    <div class="card">
      <h2>תוצאות חיפוש</h2>
      ${institutionMode ? `<div class="subtitle">סה"כ תלמידים במוסד: <b>${institutionCount}</b></div>` : ''}
      ${
        institutionMode
          ? `
            <table class="institution-table">
              <thead>
                <tr><th>שיעור</th><th>שם תלמיד</th><th>גיל</th><th>סטטוס פנימי</th><th>הוראת קבע</th><th>נחתם ע"י</th><th>נייד תלמיד</th><th>נייד אב</th><th>נייד אם</th><th>פעולה</th></tr>
              </thead>
              <tbody>${institutionRows}</tbody>
            </table>
            <div class="institution-cards">${institutionCards}</div>
          `
          : `
            <table>
              <thead>
                <tr><th>שם</th><th>פעולה</th></tr>
              </thead>
              <tbody>${normalRows}</tbody>
            </table>
          `
      }
    </div>
  `;

  return renderLayout('ניהול תלמידים', content);
}

function renderStudentPage({
  objectNameSingular,
  recordId,
  details,
  internalData = {},
  currentUser = null,
  error,
  created = false,
  notify = '',
  updated = false,
  internalUpdated = false,
  edit = false,
  formValues = null
}) {
  const properties = details?.student || {};
  const basePath = `/student/${encodeURIComponent(objectNameSingular)}/${encodeURIComponent(recordId)}`;

  if (edit) {
    const values = formValues || studentToFormValues(properties);
    const sectionsHtml = FIELD_SECTIONS.map((section) => {
      const fieldsHtml = section.fields.map((field) => renderFieldInput(field, values)).join('');
      return `
        <div class="card">
          <h3>${escapeHtml(section.title)}</h3>
          <div class="form-grid">${fieldsHtml}</div>
        </div>`;
    }).join('');

    const content = `
      <div class="hero">
        <h1>עריכת תלמיד</h1>
        <p>אפשר לעדכן ערכים ולשמור ישירות במערכת.</p>
      </div>

      <form method="POST" action="${basePath}/update">
        <div class="card">
          <div class="actions">
            <button class="primary" type="submit">שמור שינויים</button>
            <a class="button secondary" href="${basePath}">חזרה לתצוגה רגילה</a>
          </div>
          ${error ? `<div class="alert error">${escapeHtml(error)}</div>` : ''}
        </div>
        ${sectionsHtml}
      </form>
    `;

    return renderLayout('עריכת תלמיד', content);
  }

  const knownSections = FIELD_SECTIONS.map((section) => {
    const visibleFields = buildSectionFields(section, properties);

    if (visibleFields.length === 0) return '';

    const fieldsHtml = visibleFields
      .map((item) => {
        return `
          <div class="field">
            <div class="k">${escapeHtml(item.label)}</div>
            <div class="v">${item.html}</div>
          </div>`;
      })
      .join('');

    return `
      <div class="card">
        <h3>${escapeHtml(section.title)}</h3>
        <div class="grid">${fieldsHtml}</div>
      </div>`;
  }).join('');

  const content = `
    <div class="hero">
      <h1>כרטיס תלמיד</h1>
      <p>${edit ? 'מצב עריכה: מוצגים כל השדות' : 'מצב תצוגה: מוצגים רק שדות עם מידע'}</p>
    </div>

    <div class="card">
      <div class="actions">
        <a class="button secondary" href="/">חזרה לחיפוש</a>
        <a class="button primary" href="/students/new">הוספת תלמיד חדש</a>
        <a class="button primary" href="${basePath}?edit=1">עריכת שדות</a>
        ${renderLogoutControl()}
      </div>
      ${created ? '<div class="alert success">התלמיד נוצר בהצלחה.</div>' : ''}
      ${notify === 'ok' ? '<div class="alert success">נשלחה התראה לטלגרם ולוובהוק.</div>' : ''}
      ${notify === 'partial' ? '<div class="alert error">התראה נשלחה חלקית (טלגרם או וובהוק).</div>' : ''}
      ${notify === 'failed' ? '<div class="alert error">שמירה הצליחה, אבל שליחת ההתראות נכשלה.</div>' : ''}
      ${updated ? '<div class="alert success">השינויים נשמרו בהצלחה.</div>' : ''}
      ${internalUpdated ? '<div class="alert success">המידע הפנימי נשמר בהצלחה.</div>' : ''}
      ${error ? `<div class="alert error">${escapeHtml(error)}</div>` : ''}
    </div>

    <div class="card">
      <h2>פרטי הכרטיס</h2>
      ${knownSections || '<div class="muted">לא קיים מידע להצגה בכרטיס זה.</div>'}
    </div>

    <div class="card">
      <h2>מידע פנימי (מחוץ ל-CRM)</h2>
      <div class="grid">
        <div class="field">
          <div class="k">הערה פנימית</div>
          <div class="v">${escapeHtml(cleanString(internalData.noteText) || '—')}</div>
        </div>
        <div class="field">
          <div class="k">סטטוס</div>
          <div class="v">${escapeHtml(formatInternalStatus(internalData.noteStatus))}</div>
        </div>
        <div class="field">
          <div class="k">הוראת קבע פעילה</div>
          <div class="v">${formatDirectDebitValue(internalData.directDebitActive)}</div>
        </div>
        <div class="field">
          <div class="k">נחתם ע"י</div>
          <div class="v">${escapeHtml(cleanString(internalData.signedByDisplayName) || cleanString(internalData.signedByEmail) || '—')}</div>
        </div>
        <div class="field">
          <div class="k">זמן חתימה</div>
          <div class="v">${escapeHtml(internalData.signedAt ? new Date(internalData.signedAt).toLocaleString('he-IL') : '—')}</div>
        </div>
      </div>
      <form method="POST" action="${basePath}/internal-update">
        <div class="form-grid">
          <div class="full">
            <div class="k">הערה פנימית</div>
            <textarea name="noteText">${escapeHtml(cleanString(internalData.noteText))}</textarea>
          </div>
          <div>
            <div class="k">סטטוס הערה</div>
            ${renderSelect('noteStatus', INTERNAL_NOTE_STATUS_LABELS, cleanString(internalData.noteStatus), 'בחר סטטוס')}
          </div>
          <div>
            <div class="k">הוראת קבע פעילה</div>
            ${renderSelect('directDebitActive', { true: 'כן', false: 'לא' }, normalizeDirectDebitValue(internalData.directDebitActive), 'בחר')}
          </div>
        </div>
        <div class="actions">
          <button class="secondary" type="submit">שמור מידע פנימי</button>
          <span class="muted">נשמר ע"י: ${escapeHtml(cleanString(currentUser?.displayName) || cleanString(currentUser?.email) || '—')}</span>
        </div>
      </form>
    </div>
  `;

  return renderLayout('כרטיס תלמיד', content);
}

async function twentyGraphQL(query, variables) {
  if (!API_TOKEN) {
    throw new Error('Missing TWENTY_API_TOKEN environment variable');
  }

  const response = await fetch(API_URL, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${API_TOKEN}`,
      'content-type': 'application/json'
    },
    body: JSON.stringify({ query, variables })
  });

  const bodyText = await response.text();
  let body;
  try {
    body = JSON.parse(bodyText);
  } catch {
    throw new Error(`Invalid JSON response (${response.status}): ${bodyText.slice(0, 500)}`);
  }

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${JSON.stringify(body)}`);
  }

  if (body.errors?.length) {
    throw new Error(body.errors.map((e) => e.message).join(' | '));
  }

  return body.data;
}

async function fetchAllStudentsByInstitution(currentInstitution, first = 200) {
  const allEdges = [];
  let after = null;
  let hasNextPage = true;

  while (hasNextPage) {
    const data = await twentyGraphQL(STUDENTS_BY_INSTITUTION_QUERY, {
      currentInstitution,
      first,
      after
    });
    const connection = data?.students;
    const pageEdges = connection?.edges || [];
    allEdges.push(...pageEdges);

    hasNextPage = Boolean(connection?.pageInfo?.hasNextPage);
    after = connection?.pageInfo?.endCursor || null;
    if (!hasNextPage || !after) break;
  }

  return allEdges;
}

async function handleSearch(reqUrl, res) {
  const q = (reqUrl.searchParams.get('q') || '').trim();
  const tz = cleanString(reqUrl.searchParams.get('tz')).replace(/[^\d]/g, '');
  const institution = cleanString(reqUrl.searchParams.get('institution'));
  const institutionSearch = (reqUrl.searchParams.get('institutionSearch') || '').trim();
  const requestedSort = cleanString(reqUrl.searchParams.get('institutionSort'));
  const institutionSort = [
    'class_last_name',
    'age_desc',
    'internal_updated_desc',
    'note_status_asc',
    'direct_debit_desc',
    'signer_asc'
  ].includes(requestedSort)
    ? requestedSort
    : 'class_last_name';
  const internalStatusFilter = cleanString(reqUrl.searchParams.get('internalStatus'));
  const directDebitFilter = cleanString(reqUrl.searchParams.get('directDebit')) || 'all';
  const signerFilter = (reqUrl.searchParams.get('signerFilter') || '').trim();
  const quickUpdated = reqUrl.searchParams.get('quickUpdated') === '1';

  if (!q && !tz && !institution && !institutionSearch) {
    const html = renderSearchPage({
      q,
      tz,
      institution,
      institutionSearch,
      institutionSort,
      internalStatusFilter,
      directDebitFilter,
      signerFilter,
      quickUpdated,
      edges: [],
      institutionMode: false
    });
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(html);
    return;
  }

  if (!institution && institutionSearch) {
    const html = renderSearchPage({
      q,
      tz,
      institution,
      institutionSearch,
      institutionSort,
      internalStatusFilter,
      directDebitFilter,
      signerFilter,
      quickUpdated,
      edges: [],
      institutionMode: false,
      error: 'כדי לחפש בתוך מוסד, יש לבחור קודם מוסד לימודים.'
    });
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(html);
    return;
  }

  try {
    if (institution) {
      const allStudentEdges = await fetchAllStudentsByInstitution(institution, 200);
      let edges = toSearchEdgesFromStudentConnection(allStudentEdges);
      edges = edges.map((edge) => ({
        ...edge,
        node: {
          ...edge.node,
          internalData: getInternalStudentData(edge?.node?.recordId)
        }
      }));

      if (institutionSearch) {
        const qLower = institutionSearch.toLowerCase();
        edges = edges.filter((edge) => cleanString(edge?.node?.label).toLowerCase().includes(qLower));
      }
      if (internalStatusFilter && INTERNAL_NOTE_STATUS_LABELS[internalStatusFilter]) {
        edges = edges.filter((edge) => cleanString(edge?.node?.internalData?.noteStatus) === internalStatusFilter);
      }
      if (directDebitFilter === 'yes') {
        edges = edges.filter((edge) => isDirectDebitActive(edge?.node?.internalData?.directDebitActive));
      } else if (directDebitFilter === 'no') {
        edges = edges.filter((edge) => normalizeDirectDebitValue(edge?.node?.internalData?.directDebitActive) === 'false');
      }
      if (signerFilter) {
        const signerLower = signerFilter.toLowerCase();
        edges = edges.filter((edge) => {
          const signer = `${cleanString(edge?.node?.internalData?.signedByDisplayName)} ${cleanString(edge?.node?.internalData?.signedByEmail)}`.toLowerCase();
          return signer.includes(signerLower);
        });
      }

      if (institutionSort === 'age_desc') {
        edges.sort(compareStudentsByAge);
      } else if (institutionSort === 'internal_updated_desc') {
        edges.sort(compareStudentsByInternalUpdated);
      } else if (institutionSort === 'note_status_asc') {
        edges.sort(compareStudentsByInternalStatus);
      } else if (institutionSort === 'direct_debit_desc') {
        edges.sort(compareStudentsByDirectDebit);
      } else if (institutionSort === 'signer_asc') {
        edges.sort(compareStudentsBySigner);
      } else {
        edges.sort(compareStudentsForInstitution);
      }

      const html = renderSearchPage({
        q,
        institution,
        institutionSearch,
        institutionSort,
        internalStatusFilter,
        directDebitFilter,
        signerFilter,
        quickUpdated,
        edges,
        institutionMode: true,
        institutionCount: edges.length
      });
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end(html);
      return;
    }

    if (tz) {
      const data = await twentyGraphQL(STUDENTS_BY_TZ_QUERY, {
        tznum: tz,
        first: 20
      });
      const edges = toSearchEdgesFromStudentConnection(data?.students?.edges || []);
      const html = renderSearchPage({
        q,
        tz,
        institution,
        institutionSearch,
        institutionSort,
        internalStatusFilter,
        directDebitFilter,
        signerFilter,
        quickUpdated,
        edges,
        institutionMode: false
      });
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end(html);
      return;
    }

    const data = await twentyGraphQL(SEARCH_QUERY, {
      searchInput: q,
      limit: 30,
      excludedObjectNameSingulars: ['workspaceMember'],
      includedObjectNameSingulars: ['student']
    });

    const edges = data?.search?.edges || [];
    const html = renderSearchPage({
      q,
      tz,
      institution,
      institutionSearch,
      institutionSort,
      internalStatusFilter,
      directDebitFilter,
      signerFilter,
      quickUpdated,
      edges,
      institutionMode: false
    });
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(html);
  } catch (error) {
    if (res.headersSent) {
      res.end();
      return;
    }

    const html = renderSearchPage({
      q,
      tz,
      institution,
      institutionSearch,
      institutionSort,
      internalStatusFilter,
      directDebitFilter,
      signerFilter,
      quickUpdated,
      edges: [],
      error: error.message,
      institutionMode: Boolean(institution)
    });
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(html);
  }
}

async function handleCreateStudentPage(res, values = {}, error = '', statusCode = 200) {
  const html = renderCreateStudentPage({ values, error });
  res.writeHead(statusCode, { 'content-type': 'text/html; charset=utf-8' });
  res.end(html);
}

async function handleCreateStudent(req, res) {
  const formValues = await parseFormRequest(req);
  const firstName = cleanString(formValues['fullName.firstName'] || formValues.firstName);
  const lastName = cleanString(formValues['fullName.lastName'] || formValues.lastName);

  if (!firstName || !lastName) {
    await handleCreateStudentPage(res, formValues, 'שם פרטי ושם משפחה הם שדות חובה ליצירת תלמיד.', 400);
    return;
  }

  try {
    const data = toFormData(formValues);
    const result = await twentyGraphQL(CREATE_STUDENT_MUTATION, { data });
    const createdId = result?.createStudent?.id;

    if (!createdId) {
      throw new Error('לא התקבל מזהה תלמיד מהשרת לאחר היצירה.');
    }

    const studentUrl = getStudentCardUrl(createdId, req);
    const notification = await notifyNewStudent({ studentId: createdId, data, studentUrl });
    if (notification.errors.length) {
      console.error('Student notification errors:', notification.errors.join(' | '));
    }

    const notifyStatus = notification.status;
    res.writeHead(303, {
      location: `/student/student/${encodeURIComponent(createdId)}?created=1&notify=${encodeURIComponent(notifyStatus)}`
    });
    res.end();
  } catch (error) {
    await handleCreateStudentPage(res, formValues, error.message, 400);
  }
}

async function handleUpdateStudent(req, res, reqUrl) {
  const parts = reqUrl.pathname.split('/').filter(Boolean);
  const objectNameSingular = decodeURIComponent(parts[1] || '');
  const recordId = decodeURIComponent(parts[2] || '');
  const formValues = await parseFormRequest(req);

  if (!objectNameSingular || !recordId) {
    res.writeHead(400, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('Invalid student path');
    return;
  }

  try {
    const data = toFormData(formValues);
    if (!Object.keys(data).length) {
      throw new Error('לא הוזנו נתונים לשמירה.');
    }

    await twentyGraphQL(UPDATE_STUDENT_MUTATION, { id: recordId, data });
    res.writeHead(303, {
      location: `/student/${encodeURIComponent(objectNameSingular)}/${encodeURIComponent(recordId)}?updated=1`
    });
    res.end();
  } catch (error) {
    const details = await twentyGraphQL(STUDENT_DETAILS_QUERY, { id: recordId }).catch(() => null);
    const html = renderStudentPage({
      objectNameSingular,
      recordId,
      details,
      internalData: getInternalStudentData(recordId),
      edit: true,
      error: error.message,
      formValues
    });
    res.writeHead(400, { 'content-type': 'text/html; charset=utf-8' });
    res.end(html);
  }
}

async function handleInternalStudentUpdate(req, res, reqUrl, currentUser) {
  const parts = reqUrl.pathname.split('/').filter(Boolean);
  const objectNameSingular = decodeURIComponent(parts[1] || '');
  const recordId = decodeURIComponent(parts[2] || '');
  const formValues = await parseFormRequest(req);

  if (!objectNameSingular || !recordId) {
    res.writeHead(400, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('Invalid student path');
    return;
  }

  try {
    const now = new Date().toISOString();
    const noteStatus = cleanString(formValues.noteStatus);
    const internalData = {
      noteText: cleanString(formValues.noteText),
      noteStatus: INTERNAL_NOTE_STATUS_LABELS[noteStatus] ? noteStatus : '',
      directDebitActive: normalizeDirectDebitValue(formValues.directDebitActive),
      signedByEmail: cleanString(currentUser?.email),
      signedByDisplayName: cleanString(currentUser?.displayName),
      signedAt: now,
      updatedAt: now
    };

    saveInternalStudentData(recordId, internalData);
    res.writeHead(303, {
      location: `/student/${encodeURIComponent(objectNameSingular)}/${encodeURIComponent(recordId)}?internalUpdated=1`
    });
    res.end();
  } catch (error) {
    const details = await twentyGraphQL(STUDENT_DETAILS_QUERY, { id: recordId }).catch(() => null);
    const html = renderStudentPage({
      objectNameSingular,
      recordId,
      details,
      internalData: getInternalStudentData(recordId),
      currentUser,
      error: error.message
    });
    res.writeHead(400, { 'content-type': 'text/html; charset=utf-8' });
    res.end(html);
  }
}

async function handleInternalStudentQuickUpdate(req, res, currentUser) {
  const formValues = await parseFormRequest(req);
  const studentId = cleanString(formValues.studentId);
  const next = getSafeNextPath(formValues.next || '/');

  if (!studentId) {
    res.writeHead(400, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('Missing studentId');
    return;
  }

  const noteStatus = cleanString(formValues.noteStatus);
  const now = new Date().toISOString();
  const internalData = {
    noteText: cleanString(formValues.noteText),
    noteStatus: INTERNAL_NOTE_STATUS_LABELS[noteStatus] ? noteStatus : '',
    directDebitActive: normalizeDirectDebitValue(formValues.directDebitActive),
    signedByEmail: cleanString(currentUser?.email),
    signedByDisplayName: cleanString(currentUser?.displayName),
    signedAt: now,
    updatedAt: now
  };
  saveInternalStudentData(studentId, internalData);

  res.writeHead(303, { location: appendQueryToPath(next, 'quickUpdated', '1') });
  res.end();
}

async function handleStudentPage(req, res, reqUrl, currentUser) {
  const parts = reqUrl.pathname.split('/').filter(Boolean);
  const objectNameSingular = decodeURIComponent(parts[1] || '');
  const recordId = decodeURIComponent(parts[2] || '');
  const created = reqUrl.searchParams.get('created') === '1';
  const notify = cleanString(reqUrl.searchParams.get('notify'));
  const updated = reqUrl.searchParams.get('updated') === '1';
  const internalUpdated = reqUrl.searchParams.get('internalUpdated') === '1';
  const edit = reqUrl.searchParams.get('edit') === '1';

  if (!objectNameSingular || !recordId) {
    res.writeHead(400, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('Invalid student path');
    return;
  }

  try {
    const details = await twentyGraphQL(STUDENT_DETAILS_QUERY, { id: recordId });
    const internalData = getInternalStudentData(recordId);
    const html = renderStudentPage({
      objectNameSingular,
      recordId,
      details,
      internalData,
      currentUser,
      created,
      notify,
      updated,
      internalUpdated,
      edit
    });
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(html);
  } catch (error) {
    if (res.headersSent) {
      res.end();
      return;
    }

    const html = renderStudentPage({
      objectNameSingular,
      recordId,
      details: null,
      internalData: getInternalStudentData(recordId),
      currentUser,
      error: error.message,
      created,
      notify,
      updated,
      internalUpdated,
      edit
    });
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(html);
  }
}

const server = http.createServer(async (req, res) => {
  try {
    const reqUrl = new URL(req.url, `http://${req.headers.host}`);

    if (req.method === 'GET' && reqUrl.pathname === '/health') {
      res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ ok: true }));
      return;
    }

    if (req.method === 'GET' && reqUrl.pathname === '/auth/login') {
      await handleAuthLoginPage(reqUrl, res);
      return;
    }

    if (req.method === 'POST' && reqUrl.pathname === '/auth/login') {
      await handleAuthLogin(req, res);
      return;
    }

    if (req.method === 'POST' && reqUrl.pathname === '/auth/passkey/auth/options') {
      await handlePasskeyAuthOptions(req, res);
      return;
    }

    if (req.method === 'POST' && reqUrl.pathname === '/auth/passkey/auth/verify') {
      await handlePasskeyAuthVerify(req, res);
      return;
    }

    if (req.method === 'GET' && reqUrl.pathname === '/auth/register') {
      await handleAuthRegisterPage(res);
      return;
    }

    if (req.method === 'POST' && reqUrl.pathname === '/auth/register') {
      await handleAuthRegister(req, res);
      return;
    }

    if (req.method === 'POST' && reqUrl.pathname === '/auth/users/delete') {
      await handleAuthDeleteUser(req, res);
      return;
    }

    if (req.method === 'POST' && reqUrl.pathname === '/auth/passkey/register/options') {
      await handlePasskeyRegisterOptions(req, res);
      return;
    }

    if (req.method === 'POST' && reqUrl.pathname === '/auth/passkey/register/verify') {
      await handlePasskeyRegisterVerify(req, res);
      return;
    }

    if (req.method === 'POST' && reqUrl.pathname === '/auth/logout') {
      await handleAuthLogout(req, res);
      return;
    }

    const authenticatedUser = requireAuthenticatedSession(req, res, reqUrl);
    if (!authenticatedUser) {
      return;
    }

    if (req.method === 'GET' && reqUrl.pathname === '/') {
      await handleSearch(reqUrl, res);
      return;
    }

    if (req.method === 'GET' && reqUrl.pathname === '/students/new') {
      await handleCreateStudentPage(res);
      return;
    }

    if (req.method === 'POST' && reqUrl.pathname === '/students/create') {
      await handleCreateStudent(req, res);
      return;
    }

    if (req.method === 'POST' && /^\/student\/[^/]+\/[^/]+\/update$/.test(reqUrl.pathname)) {
      await handleUpdateStudent(req, res, reqUrl);
      return;
    }

    if (req.method === 'POST' && /^\/student\/[^/]+\/[^/]+\/internal-update$/.test(reqUrl.pathname)) {
      await handleInternalStudentUpdate(req, res, reqUrl, authenticatedUser);
      return;
    }

    if (req.method === 'POST' && reqUrl.pathname === '/students/internal/quick-update') {
      await handleInternalStudentQuickUpdate(req, res, authenticatedUser);
      return;
    }

    if (req.method === 'GET' && reqUrl.pathname.startsWith('/student/')) {
      await handleStudentPage(req, res, reqUrl, authenticatedUser);
      return;
    }

    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('Not found');
  } catch (error) {
    if (res.headersSent) {
      console.error('Unhandled error after response was sent:', error);
      return;
    }

    res.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' });
    res.end(`Server error: ${error.message}`);
  }
});
server.listen(PORT, () => {
  console.log(`Server listening on http://localhost:${PORT}`);
});




