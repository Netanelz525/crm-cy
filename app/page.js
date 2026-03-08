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

  const q = clean(resolvedSearchParams?.q);
  const tz = clean(resolvedSearchParams?.tz).replace(/[^\d]/g, "");
  const institution = clean(resolvedSearchParams?.institution);
  const institutionSearch = clean(resolvedSearchParams?.institutionSearch);
  const quickUpdated = clean(resolvedSearchParams?.quickUpdated) === "1";
  const internalStatus = clean(resolvedSearchParams?.internalStatus);
  const directDebit = clean(resolvedSearchParams?.directDebit) || "all";
  const signerFilter = clean(resolvedSearchParams?.signerFilter);

  let students = [];
  let error = "";
  try {
    if (institution) {
      students = await getStudentsByInstitution(institution);
    } else if (tz) {
      students = await searchStudentsByTz(tz);
    } else if (q) {
      students = await searchStudentsByText(q);
    }
  } catch (e) {
    error = e.message || "Search failed";
  }

  if (institutionSearch) {
    const s = institutionSearch.toLowerCase();
    students = students.filter((x) => clean(x.label).toLowerCase().includes(s));
  }

  const notesMap = await getNotesByStudentIds(students.map((s) => s.id));
  students = students.map((s) => ({ ...s, note: notesMap[s.id] || null }));

  if (internalStatus) students = students.filter((s) => clean(s.note?.note_status) === internalStatus);
  if (directDebit === "yes") students = students.filter((s) => s.note?.direct_debit_active === true);
  if (directDebit === "no") students = students.filter((s) => s.note?.direct_debit_active === false);
  if (signerFilter) {
    const f = signerFilter.toLowerCase();
    students = students.filter((s) =>
      `${clean(s.note?.signed_by_display_name)} ${clean(s.note?.signed_by_email)}`.toLowerCase().includes(f)
    );
  }

  const next = buildNextPath({ q, tz, institution, institutionSearch, internalStatus, directDebit, signerFilter });

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
          <input name="q" defaultValue={q} placeholder="חיפוש לפי שם תלמיד" />
          <input name="tz" defaultValue={tz} placeholder="חיפוש לפי תעודת זהות" />
          <select name="institution" defaultValue={institution}>
            <option value="">בחר מוסד</option>
            {Object.entries(INSTITUTIONS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
          <input name="institutionSearch" defaultValue={institutionSearch} placeholder="חיפוש בתוך מוסד" />
          <select name="internalStatus" defaultValue={internalStatus}>
            <option value="">סינון לפי סטטוס פנימי</option>
            {Object.entries(NOTE_STATUSES).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
          <select name="directDebit" defaultValue={directDebit}>
            <option value="all">הוראת קבע: הכל</option>
            <option value="yes">עם הוראת קבע</option>
            <option value="no">בלי הוראת קבע</option>
          </select>
          <input name="signerFilter" defaultValue={signerFilter} placeholder="סינון לפי חותם" />
          <button type="submit">חפש</button>
        </form>
      </div>

      {quickUpdated ? <div className="ok">המידע הפנימי נשמר.</div> : null}
      {error ? <div className="card muted">{error}</div> : null}

      <div className="card">
        <table>
          <thead>
            <tr>
              <th>שם</th>
              <th>ת"ז</th>
              <th>גיל</th>
              <th>טלפון תלמיד</th>
              <th>פעולות</th>
            </tr>
          </thead>
          <tbody>
            {!students.length ? (
              <tr>
                <td colSpan={5} className="muted">
                  אין תוצאות
                </td>
              </tr>
            ) : (
              students.map((s) => (
                <tr key={s.id}>
                  <td>{s.label}</td>
                  <td>{s.tznum || "-"}</td>
                  <td>{ageOf(s.dateofbirth) ?? "-"}</td>
                  <td><PhoneLink phoneObj={s.phone} /></td>
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
              ))
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}


