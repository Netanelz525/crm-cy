import Link from "next/link";
import { redirect } from "next/navigation";
import { getNotesByStudentIds } from "../lib/notes";
import { getCurrentAppUser } from "../lib/rbac";
import { quickUpdateNoteAction } from "./actions";
import { getStudentsByInstitution, searchStudentsByText, searchStudentsByTz } from "../lib/twenty";

const NOTE_STATUSES = {
  NOT_RELEVANT: "לא רלוונטי",
  OTHER: "אחר",
  CONTACTED: "דיברו"
};

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

function phoneText(phoneObj) {
  if (!phoneObj?.primaryPhoneNumber) return "-";
  return [clean(phoneObj.primaryPhoneCallingCode), clean(phoneObj.primaryPhoneNumber)].filter(Boolean).join(" ");
}

function phoneHref(phoneObj) {
  const number = clean(phoneObj?.primaryPhoneNumber).replace(/[^\d]/g, "");
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

function missingContactItems(student) {
  const out = [];
  if (!clean(student?.dadPhone?.primaryPhoneNumber)) out.push("טלפון אב");
  if (!clean(student?.momPhone?.primaryPhoneNumber)) out.push("טלפון אם");
  if (!clean(student?.fatherEmail?.primaryEmail)) out.push("אימייל אב");
  if (!clean(student?.motherEmail?.primaryEmail)) out.push("אימייל אם");
  return out;
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
  const quickUpdated = clean(resolvedSearchParams?.quickUpdated) === "1";

  const finderTz = clean(resolvedSearchParams?.finderTz).replace(/[^\d]/g, "");
  const finderEmail = clean(resolvedSearchParams?.finderEmail);
  const finderPhone = clean(resolvedSearchParams?.finderPhone);

  let tz = clean(resolvedSearchParams?.tz).replace(/[^\d]/g, "");
  let q = clean(resolvedSearchParams?.q);

  if (finderTz) {
    tz = finderTz;
    q = "";
  } else if (finderEmail) {
    q = finderEmail;
    tz = "";
  } else if (finderPhone) {
    q = finderPhone;
    tz = "";
  }

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

  const notesMap = await getNotesByStudentIds(students.map((s) => s.id));
  students = students.map((s) => ({ ...s, note: notesMap[s.id] || null, missingItems: s.missingItems || [] }));

  const next = buildNextPath({ institution, institutionSearch, missingOnly: missingOnly ? "1" : "", q, tz });
  const institutionCount = institution ? students.length : 0;

  return (
    <>
      <div className="card">
        <h1>ניהול תלמידים - TEAM</h1>
        <p className="muted">גישה מלאה לחיפוש, עדכון מידע ואישור משתמשים לא מוכרים.</p>
        <p>
          <Link href="/admin">מעבר לאישור משתמשים</Link>
        </p>
      </div>

      <div className="card">
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
          <label style={{ display: "flex", alignItems: "center", gap: 8, padding: "10px" }}>
            <input type="checkbox" name="missingOnly" value="1" defaultChecked={missingOnly} style={{ width: 16 }} />
            הצג רק תלמידים עם מידע חסר
          </label>
          <button type="submit">חפש</button>
        </form>

        <details style={{ marginTop: 12 }}>
          <summary style={{ cursor: "pointer", fontWeight: 700 }}>איתור תלמיד</summary>
          <form className="grid" method="GET" style={{ marginTop: 10 }}>
            <input name="finderTz" defaultValue={finderTz || tz} placeholder="איתור לפי תעודת זהות" />
            <input name="finderEmail" defaultValue={finderEmail} placeholder="איתור לפי אימייל תלמיד/הורים" />
            <input name="finderPhone" defaultValue={finderPhone} placeholder="איתור לפי טלפון תלמיד/הורים" />
            <button type="submit">אתר תלמיד</button>
          </form>
        </details>
      </div>

      {institution ? <div className="card">סה"כ תלמידים במוסד: <b>{institutionCount}</b></div> : null}
      {quickUpdated ? <div className="ok">המידע הפנימי נשמר.</div> : null}
      {error ? <div className="card muted">{error}</div> : null}

      <div className="card">
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
              <th>פעולות</th>
            </tr>
          </thead>
          <tbody>
            {!students.length ? (
              <tr>
                <td colSpan={9} className="muted">
                  אין תוצאות
                </td>
              </tr>
            ) : (
              students.map((s) => {
                const hasMissing = (s.missingItems || []).length > 0;
                return (
                  <tr key={s.id} style={hasMissing ? { background: "#fff1f2" } : undefined}>
                    <td>{s.label}</td>
                    <td>{classLabel(s.class)}</td>
                    <td>{s.tznum || "-"}</td>
                    <td>{ageOf(s.dateofbirth) ?? "-"}</td>
                    <td><PhoneLink phoneObj={s.phone} /></td>
                    <td><PhoneLink phoneObj={s.dadPhone} /></td>
                    <td><PhoneLink phoneObj={s.momPhone} /></td>
                    <td style={hasMissing ? { color: "#b42318", fontWeight: 700 } : undefined}>
                      {hasMissing ? s.missingItems.join(", ") : "-"}
                    </td>
                    <td>
                      <div style={{ display: "grid", gap: 8 }}>
                        <Link href={`/students/${s.id}`}>כרטיס תלמיד</Link>
                        <details>
                          <summary>עריכה פנימית מהירה</summary>
                          <form action={quickUpdateNoteAction}>
                            <input type="hidden" name="studentId" value={s.id} />
                            <input type="hidden" name="next" value={next} />
                            <textarea name="noteText" defaultValue={s.note?.note_text || ""} placeholder="הערה פנימית" />
                            <select name="noteStatus" defaultValue={s.note?.note_status || ""}>
                              <option value="">סטטוס</option>
                              {Object.entries(NOTE_STATUSES).map(([value, label]) => (
                                <option key={value} value={value}>
                                  {label}
                                </option>
                              ))}
                            </select>
                            <select
                              name="directDebitActive"
                              defaultValue={
                                s.note?.direct_debit_active === true
                                  ? "true"
                                  : s.note?.direct_debit_active === false
                                    ? "false"
                                    : ""
                              }
                            >
                              <option value="">הוראת קבע</option>
                              <option value="true">כן</option>
                              <option value="false">לא</option>
                            </select>
                            <button type="submit">שמור</button>
                          </form>
                        </details>
                      </div>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}


