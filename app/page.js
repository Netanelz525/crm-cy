import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentAppUser } from "../lib/rbac";
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

function clean(v) {
  return String(v || "").trim();
}

function normalizeDigits(v) {
  return clean(v).replace(/[^\d]/g, "");
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

function missingContactItems(student) {
  if (hasCompleteParentContact(student)) return [];
  return ["חסר הורה עם טלפון+אימייל"];
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

function buildNextPath(params) {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (clean(v)) sp.set(k, clean(v));
  }
  return sp.toString() ? `/?${sp.toString()}` : "/";
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

  const tz = normalizeDigits(resolvedSearchParams?.tz);
  const q = clean(resolvedSearchParams?.q);

  let students = [];
  let error = "";

  try {
    if (institution) {
      students = await getStudentsByInstitution(institution);
      if (institutionSearch) {
        const s = institutionSearch.toLowerCase();
        students = students.filter((x) => clean(x.label).toLowerCase().includes(s));
      }
      students = students.map((s) => ({ ...s, missingItems: missingContactItems(s) }));
      if (missingOnly) {
        students = students.filter((s) => (s.missingItems || []).length > 0);
      }
      students.sort(compareInstitutionStudents);
    } else if (tz) {
      students = await searchStudentsByTz(tz);
    } else if (q) {
      students = await searchStudentsByText(q);
    }
  } catch (e) {
    error = e.message || "Search failed";
  }

  const toggleMissingPath = buildNextPath({
    institution,
    institutionSearch,
    q,
    tz,
    missingOnly: institution ? (missingOnly ? "" : "1") : ""
  });
  const institutionCount = institution ? students.length : 0;

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
        <form className="grid" method="GET">
          <input name="q" defaultValue={q} placeholder="חיפוש כללי לפי שם תלמיד" />
          <input name="tz" defaultValue={tz} placeholder="חיפוש כללי לפי תעודת זהות" />
          <select name="institution" defaultValue={institution}>
            <option value="">בחר מוסד</option>
            {Object.entries(INSTITUTIONS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
          <input name="institutionSearch" defaultValue={institutionSearch} placeholder="חיפוש בתוך מוסד" />
          <button type="submit">חפש</button>
        </form>
      </div>

      {institution ? (
        <div className="card summary-row">
          <div>
            סה"כ תלמידים במוסד: <b>{institutionCount}</b>
          </div>
          <Link className="chip-link" href={toggleMissingPath}>
            {missingOnly ? "הצג את כולם" : "הצג רק חסרים"}
          </Link>
        </div>
      ) : null}

      {error ? <div className="card muted">{error}</div> : null}

      <div className="card desktop-table">
        <table>
          <thead>
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
          </thead>
          <tbody>
            {!students.length ? (
              <tr>
                <td colSpan={8} className="muted">
                  אין תוצאות
                </td>
              </tr>
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






