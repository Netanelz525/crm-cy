import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentAppUser } from "../lib/rbac";
import { ENUM_LABELS, FIELD_SECTIONS, getByPath } from "../lib/student-fields";
import { getStudentsByInstitution, searchStudentsByText, searchStudentsByTz } from "../lib/twenty";

const INSTITUTIONS = {
  YR: "יחי ראובן",
  OE: "אור אפרים",
  CY: "חכמי ירושלים",
  BOGER: "בוגר",
  BOGERNCONTACT: "בוגר ללא יצירת קשר",
  TEST: "טסט"
};

const CLASS_LABELS = {
  Z: "אברך",
  A: "שיעור א",
  B: "שיעור ב",
  C: "שיעור ג",
  D: "שיעור ד",
  E: "שיעור ה",
  X: "קיבוץ",
  TEAM: "צוות"
};

const CLASS_ORDER = {
  A: 1,
  B: 2,
  C: 3,
  D: 4,
  E: 5,
  X: 6,
  Z: 7,
  TEAM: 8
};

const INSTITUTION_COLUMNS = [
  { key: "name", label: "שם", defaultSelected: true },
  { key: "class", label: "שיעור", defaultSelected: true },
  { key: "tznum", label: "ת\"ז", defaultSelected: true },
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

const SYSTEM_FIELDS = FIELD_SECTIONS.flatMap((section) => section.fields);
const FIELD_DEF_MAP = Object.fromEntries(SYSTEM_FIELDS.map((field) => [field.key, field]));
const SYSTEM_FIELD_COLUMNS = SYSTEM_FIELDS.map((field) => ({
  key: `field:${field.key}`,
  label: field.label,
  defaultSelected: false
}));

const INSTITUTION_COLUMNS_FULL = [
  ...INSTITUTION_COLUMNS,
  ...SYSTEM_FIELD_COLUMNS.filter((col) => !INSTITUTION_COLUMNS.some((base) => base.key === col.key))
];

const INSTITUTION_COLUMN_MAP = Object.fromEntries(INSTITUTION_COLUMNS_FULL.map((c) => [c.key, c]));
const DEFAULT_INSTITUTION_COLUMN_KEYS = INSTITUTION_COLUMNS_FULL.filter((c) => c.defaultSelected).map((c) => c.key);

function clean(v) {
  return String(v || "").trim();
}

function normalizeDigits(v) {
  return clean(v).replace(/[^\d]/g, "");
}

function parseListParam(value) {
  if (Array.isArray(value)) return value.map(clean).filter(Boolean);
  const raw = clean(value);
  if (!raw) return [];
  if (raw.includes(",")) return raw.split(",").map(clean).filter(Boolean);
  return [raw];
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

function buildMissingState(student) {
  const hasContactMissing = !hasCompleteParentContact(student);
  const hasIdentityMissing = !clean(student?.tznum) || !clean(student?.dateofbirth);
  const items = [];
  if (hasContactMissing) items.push("חסר הורה עם טלפון+אימייל");
  if (hasIdentityMissing) items.push("חסר ת\"ז או תאריך לידה");
  return {
    items,
    flags: {
      contact: hasContactMissing,
      identity: hasIdentityMissing
    }
  };
}

function matchesMissingFilter(missingState, missingType) {
  if (!missingType) return true;
  return Boolean(missingState?.flags?.[missingType]);
}

function phoneText(phoneObj) {
  if (!phoneObj?.primaryPhoneNumber) return "-";
  return [clean(phoneObj.primaryPhoneCallingCode), clean(phoneObj.primaryPhoneNumber)].filter(Boolean).join(" ");
}

function phoneHref(phoneObj) {
  const number = normalizeDigits(phoneObj?.primaryPhoneNumber);
  if (!number) return "";
  const calling = clean(phoneObj?.primaryPhoneCallingCode).replace(/[^\d+]/g, "");
  const prefix = calling || "+";
  return `tel:${prefix}${number}`.replace(/\s+/g, "");
}

function PhoneLink({ phoneObj }) {
  const text = phoneText(phoneObj);
  if (text === "-") return "-";
  const href = phoneHref(phoneObj);
  if (!href) return text;
  return <a href={href}>{text}</a>;
}

function ageOf(dateValue) {
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

function getLastName(student) {
  const fromFullName = clean(student?.fullName?.lastName);
  if (fromFullName) return fromFullName;
  const label = clean(student?.label);
  if (!label) return "";
  const parts = label.split(/\s+/).filter(Boolean);
  return clean(parts[parts.length - 1]);
}

function compareInstitutionStudents(a, b) {
  const aClass = clean(a.class).toUpperCase();
  const bClass = clean(b.class).toUpperCase();
  const aRank = CLASS_ORDER[aClass] ?? 999;
  const bRank = CLASS_ORDER[bClass] ?? 999;
  if (aRank !== bRank) return aRank - bRank;

  const lastCmp = getLastName(a).localeCompare(getLastName(b), "he", { sensitivity: "base" });
  if (lastCmp !== 0) return lastCmp;
  return clean(a.label).localeCompare(clean(b.label), "he", { sensitivity: "base" });
}

function classLabel(value) {
  const key = clean(value).toUpperCase();
  return CLASS_LABELS[key] || (value || "-");
}

function enumLabel(enumName, value) {
  const key = clean(value);
  if (!key) return "-";
  return ENUM_LABELS?.[enumName]?.[key] || key;
}

function formatDate(value) {
  const raw = clean(value);
  if (!raw) return "-";
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return raw;
  return d.toLocaleDateString("he-IL");
}

function formatFieldColumn(student, fieldKey) {
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

function normalizePhoneForTel(value) {
  return clean(value).replace(/[^\d]/g, "");
}

function fieldPhoneHref(student, fieldKey) {
  const fieldDef = FIELD_DEF_MAP[fieldKey];
  if (!fieldDef || !fieldDef.key.endsWith(".primaryPhoneNumber")) return "";
  const phoneRoot = fieldDef.key.slice(0, -".primaryPhoneNumber".length);
  const number = normalizePhoneForTel(getByPath(student, fieldDef.key));
  const calling = clean(getByPath(student, `${phoneRoot}.primaryPhoneCallingCode`)).replace(/[^\d+]/g, "");
  if (!number) return "";
  return `tel:${(calling || "+")}${number}`.replace(/\s+/g, "");
}

function buildNextPath(params) {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (Array.isArray(v)) {
      v.map(clean).filter(Boolean).forEach((item) => sp.append(k, item));
      continue;
    }
    if (clean(v)) sp.set(k, clean(v));
  }
  return sp.toString() ? `/?${sp.toString()}` : "/";
}

function columnText(student, columnKey) {
  if (columnKey.startsWith("field:")) {
    return formatFieldColumn(student, columnKey.slice("field:".length));
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

function columnNode(student, columnKey) {
  if (columnKey.startsWith("field:")) {
    const fieldKey = columnKey.slice("field:".length);
    const value = columnText(student, columnKey);
    if (value === "-") return "-";

    const fieldDef = FIELD_DEF_MAP[fieldKey];
    if (fieldDef?.key.endsWith(".primaryPhoneNumber")) {
      const href = fieldPhoneHref(student, fieldKey);
      return href ? <a href={href}>{value}</a> : value;
    }
    if (fieldDef?.key.endsWith(".primaryEmail")) {
      const email = clean(getByPath(student, fieldKey));
      return email ? <a href={"mailto:" + email}>{email}</a> : value;
    }
    return value;
  }

  switch (columnKey) {
    case "name":
      return <Link className="student-link" href={"/students/" + student.id}>{clean(student?.label) || "-"}</Link>;
    case "studentPhone":
      return <PhoneLink phoneObj={student?.phone} />;
    case "dadPhone":
      return <PhoneLink phoneObj={student?.dadPhone} />;
    case "momPhone":
      return <PhoneLink phoneObj={student?.momPhone} />;
    default:
      return columnText(student, columnKey);
  }
}

export default async function HomePage({ searchParams }) {
  const currentUser = await getCurrentAppUser();
  if (!currentUser) redirect("/sign-in");

  const resolvedSearchParams = await searchParams;

  if (!currentUser.is_team_member && !currentUser.is_manager) {
    if (currentUser.linked_student_id) {
      redirect(`/students/${currentUser.linked_student_id}`);
    }
    const approvedUnknown = String(currentUser.access_status || "") === "approved";
    return (
      <div className="card">
        <h1>{approvedUnknown ? "אין כרטיס תלמיד מקושר" : "הגישה ממתינה לאישור"}</h1>
        <p className="muted">
          {approvedUnknown
            ? "המשתמש אושר, אך אין כרטיס תלמיד המשויך למייל שלך במערכת. יש לפנות למשתמש TEAM."
            : "לא נמצא תלמיד תואם למייל שלך. משתמש TEAM צריך לאשר משתמשים לא מוכרים."}
        </p>
      </div>
    );
  }

  const institution = clean(resolvedSearchParams?.institution);
  const institutionSearch = clean(resolvedSearchParams?.institutionSearch);
  const missingOnly = clean(resolvedSearchParams?.missingOnly) === "1";
  const missingTypeParam = clean(resolvedSearchParams?.missingType).toLowerCase();
  const missingType = ["contact", "identity"].includes(missingTypeParam)
    ? missingTypeParam
    : (missingOnly ? "contact" : "");

  const tz = normalizeDigits(resolvedSearchParams?.tz);
  const q = clean(resolvedSearchParams?.q);
  const modeParam = clean(resolvedSearchParams?.mode).toLowerCase();
  const mode = modeParam || (institution || institutionSearch || missingOnly || missingType ? "institution" : q || tz ? "search" : "");

  const parsedColumnKeys = parseListParam(resolvedSearchParams?.cols).filter((k) => INSTITUTION_COLUMN_MAP[k]);
  const selectedColumnKeys = parsedColumnKeys.length ? parsedColumnKeys : DEFAULT_INSTITUTION_COLUMN_KEYS;
  const selectedColumns = selectedColumnKeys.map((k) => INSTITUTION_COLUMN_MAP[k]).filter(Boolean);

  let students = [];
  let error = "";

  try {
    if (mode === "institution" && institution) {
      students = await getStudentsByInstitution(institution);
      if (institutionSearch) {
        const s = institutionSearch.toLowerCase();
        students = students.filter((x) => clean(x.label).toLowerCase().includes(s));
      }
      students = students.map((s) => {
        const missingState = buildMissingState(s);
        return { ...s, missingItems: missingState.items, missingFlags: missingState.flags };
      });
      if (missingType) {
        students = students.filter((s) => matchesMissingFilter({ flags: s.missingFlags }, missingType));
      }
      students.sort(compareInstitutionStudents);
    } else if (mode === "search") {
      if (tz) {
        students = (await searchStudentsByTz(tz)).slice(0, 10);
      } else if (q) {
        students = await searchStudentsByText(q, 10);
      }
    }
  } catch (e) {
    error = e.message || "Search failed";
  }

  const toggleMissingPath = buildNextPath({
    mode: "institution",
    institution,
    institutionSearch,
    missingOnly: "",
    missingType: "",
    cols: selectedColumnKeys
  });

  const institutionCount = mode === "institution" && institution ? students.length : 0;

  const exportParams = new URLSearchParams();
  if (institution) exportParams.set("institution", institution);
  if (institutionSearch) exportParams.set("institutionSearch", institutionSearch);
  if (missingType) exportParams.set("missingType", missingType);
  selectedColumnKeys.forEach((k) => exportParams.append("cols", k));
  const exportHref = `/api/export/institution?${exportParams.toString()}`;

  return (
    <>
      <div className="card glass">
        <h1>ניהול תלמידים - TEAM</h1>
        <p className="muted">גישה מלאה לחיפוש, עדכון מידע ואישור משתמשים לא מוכרים.</p>
        <div className="quick-actions">
          <Link className="quick-action-btn quick-action-outline" href="/admin">מעבר לאישור משתמשים</Link>
          <Link className="quick-action-btn quick-action-outline" href="/finder">איתור תלמיד</Link>
          <Link className="quick-action-btn quick-action-primary" href="/students/new">יצירת תלמיד</Link>
        </div>
      </div>

      <div className="card glass">
        <h3>חיפוש כללי תלמידים</h3>
        <form className="grid" method="GET">
          <input type="hidden" name="mode" value="search" />
          <input name="q" defaultValue={mode === "search" ? q : ""} placeholder="חיפוש לפי שם תלמיד" />
          <input name="tz" defaultValue={mode === "search" ? tz : ""} placeholder="חיפוש לפי תעודת זהות" />
          <button type="submit">חפש תלמיד</button>
        </form>
      </div>

      <div className="card glass">
        <h3>תצוגת מוסד</h3>
        <form className="grid" method="GET">
          <input type="hidden" name="mode" value="institution" />
          <select name="institution" defaultValue={mode === "institution" ? institution : ""}>
            <option value="">בחר מוסד</option>
            {Object.entries(INSTITUTIONS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
          <input
            name="institutionSearch"
            defaultValue={mode === "institution" ? institutionSearch : ""}
            placeholder="חיפוש בתוך מוסד"
          />
          <button type="submit">הצג מוסד</button>
        </form>
      </div>

      {mode === "institution" && institution ? (
        <>
          <div className="card summary-row">
            <div>
              סה"כ תלמידים במוסד: <b>{institutionCount}</b>
            </div>
            <div className="quick-actions" style={{ marginTop: 0 }}>
              <Link className="chip-link" href={toggleMissingPath}>
                נקה סינון חוסרים
              </Link>
              <a className="chip-link" href={exportHref}>ייצוא אקסל</a>
            </div>
          </div>

          <div className="card">
            <details className="display-settings">
              <summary>ניהול תצוגה וסינון</summary>
              <form method="GET" className="column-picker">
                <input type="hidden" name="mode" value="institution" />
                <input type="hidden" name="institution" value={institution} />
                <input type="hidden" name="institutionSearch" value={institutionSearch} />
                <div className="grid">
                  <select name="missingType" defaultValue={missingType}>
                    <option value="">ללא סינון חוסרים</option>
                    <option value="contact">חוסר בהורה (טלפון+מייל)</option>
                    <option value="identity">חוסר בת"ז או תאריך לידה</option>
                  </select>
                </div>
                <div className="column-grid">
                  {INSTITUTION_COLUMNS_FULL.map((col) => (
                    <label key={col.key} className="column-item">
                      <input type="checkbox" name="cols" value={col.key} defaultChecked={selectedColumnKeys.includes(col.key)} />
                      <span>{col.label}</span>
                    </label>
                  ))}
                </div>
                <button type="submit">עדכן תצוגה</button>
              </form>
            </details>
          </div>
        </>
      ) : null}

      {error ? <div className="card muted">{error}</div> : null}

      <div className="card desktop-table">
        <table>
          <thead>
            {mode === "institution" && institution ? (
              <tr>
                {selectedColumns.map((col) => (
                  <th key={col.key}>{col.label}</th>
                ))}
              </tr>
            ) : (
              <tr>
                <th>שם</th>
                <th>שיעור</th>
                <th>ת"ז</th>
                <th>גיל</th>
                <th>טלפון תלמיד</th>
                <th>טלפון אב</th>
                <th>טלפון אם</th>
                <th>חוסרים</th>
              </tr>
            )}
          </thead>
          <tbody>
            {!students.length ? (
              <tr>
                <td colSpan={mode === "institution" && institution ? Math.max(selectedColumns.length, 1) : 8} className="muted">
                  אין תוצאות
                </td>
              </tr>
            ) : mode === "institution" && institution ? (
              students.map((s) => {
                const hasMissing = (s.missingItems || []).length > 0;
                return (
                  <tr key={s.id} style={hasMissing ? { background: "#fff1f2" } : undefined}>
                    {selectedColumns.map((col) => (
                      <td
                        key={col.key}
                        style={col.key === "missing" && hasMissing ? { color: "#b42318", fontWeight: 700 } : undefined}
                      >
                        {columnNode(s, col.key)}
                      </td>
                    ))}
                  </tr>
                );
              })
            ) : (
              students.map((s) => {
                const hasMissing = (s.missingItems || []).length > 0;
                return (
                  <tr key={s.id} style={hasMissing ? { background: "#fff1f2" } : undefined}>
                    <td><Link className="student-link" href={`/students/${s.id}`}>{s.label}</Link></td>
                    <td>{classLabel(s.class)}</td>
                    <td>{s.tznum || "-"}</td>
                    <td>{ageOf(s.dateofbirth) ?? "-"}</td>
                    <td><PhoneLink phoneObj={s.phone} /></td>
                    <td><PhoneLink phoneObj={s.dadPhone} /></td>
                    <td><PhoneLink phoneObj={s.momPhone} /></td>
                    <td style={hasMissing ? { color: "#b42318", fontWeight: 700 } : undefined}>
                      {hasMissing ? s.missingItems.join(", ") : "-"}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      <div className="mobile-student-list">
        {!students.length ? (
          <div className="card muted">אין תוצאות</div>
        ) : mode === "institution" && institution ? (
          students.map((s) => {
            const hasMissing = (s.missingItems || []).length > 0;
            return (
              <div key={s.id} className={`student-mobile-card ${hasMissing ? "missing" : ""}`}>
                <div className="student-mobile-head">
                  <Link className="student-link" href={`/students/${s.id}`}>{s.label}</Link>
                </div>
                <div className="student-mobile-grid">
                  {selectedColumns.map((col) => (
                    <div key={col.key}>
                      <b>{col.label}:</b> {columnNode(s, col.key)}
                    </div>
                  ))}
                </div>
              </div>
            );
          })
        ) : (
          students.map((s) => {
            const hasMissing = (s.missingItems || []).length > 0;
            return (
              <div key={s.id} className={`student-mobile-card ${hasMissing ? "missing" : ""}`}>
                <div className="student-mobile-head">
                  <Link className="student-link" href={`/students/${s.id}`}>{s.label}</Link>
                  <span>{classLabel(s.class)}</span>
                </div>
                <div className="student-mobile-grid">
                  <div><b>ת"ז:</b> {s.tznum || "-"}</div>
                  <div><b>גיל:</b> {ageOf(s.dateofbirth) ?? "-"}</div>
                  <div><b>טלפון תלמיד:</b> <PhoneLink phoneObj={s.phone} /></div>
                  <div><b>טלפון אב:</b> <PhoneLink phoneObj={s.dadPhone} /></div>
                  <div><b>טלפון אם:</b> <PhoneLink phoneObj={s.momPhone} /></div>
                </div>
                <div className="student-mobile-missing">
                  <b>חוסרים:</b> {hasMissing ? s.missingItems.join(", ") : "-"}
                </div>
              </div>
            );
          })
        )}
      </div>
    </>
  );
}




















