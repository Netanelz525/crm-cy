import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentAppUser } from "../../lib/rbac";
import { listAllStudents, searchStudentsByTz } from "../../lib/twenty";

function clean(v) {
  return String(v || "").trim();
}

function normEmail(v) {
  return clean(v).toLowerCase();
}

function normPhone(v) {
  return clean(v).replace(/[^\d]/g, "");
}

function phoneText(phoneObj) {
  if (!phoneObj?.primaryPhoneNumber) return "-";
  return [clean(phoneObj.primaryPhoneCallingCode), clean(phoneObj.primaryPhoneNumber)].filter(Boolean).join(" ");
}

function phoneHref(phoneObj) {
  const number = normPhone(phoneObj?.primaryPhoneNumber);
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

function matchesEmail(student, owner, query) {
  const q = normEmail(query);
  const studentEmail = normEmail(student?.email?.primaryEmail);
  const fatherEmail = normEmail(student?.fatherEmail?.primaryEmail);
  const motherEmail = normEmail(student?.motherEmail?.primaryEmail);

  if (owner === "student") return studentEmail.includes(q);
  if (owner === "father") return fatherEmail.includes(q);
  if (owner === "mother") return motherEmail.includes(q);
  return studentEmail.includes(q) || fatherEmail.includes(q) || motherEmail.includes(q);
}

function matchesPhone(student, owner, query) {
  const q = normPhone(query);
  const studentPhone = normPhone(student?.phone?.primaryPhoneNumber);
  const fatherPhone = normPhone(student?.dadPhone?.primaryPhoneNumber);
  const motherPhone = normPhone(student?.momPhone?.primaryPhoneNumber);

  const contains = (src) => src && (src.includes(q) || q.includes(src));

  if (owner === "student") return contains(studentPhone);
  if (owner === "father") return contains(fatherPhone);
  if (owner === "mother") return contains(motherPhone);
  return contains(studentPhone) || contains(fatherPhone) || contains(motherPhone);
}

export default async function FinderPage({ searchParams }) {
  const currentUser = await getCurrentAppUser();
  if (!currentUser) redirect("/sign-in");
  if (!currentUser.is_team_member && !currentUser.is_manager) redirect("/unauthorized");

  const sp = await searchParams;
  const fieldType = clean(sp?.fieldType || "tz");
  const owner = clean(sp?.owner || "any");
  const value = clean(sp?.value);

  let students = [];
  let error = "";

  if (value) {
    try {
      if (fieldType === "tz") {
        students = await searchStudentsByTz(normPhone(value));
      } else {
        const all = await listAllStudents(200, 20);
        if (fieldType === "email") {
          students = all.filter((s) => matchesEmail(s, owner, value));
        } else if (fieldType === "phone") {
          students = all.filter((s) => matchesPhone(s, owner, value));
        }
      }
    } catch (e) {
      error = e.message || "חיפוש נכשל";
    }
  }

  return (
    <>
      <div className="card">
        <h1>איתור תלמיד</h1>
        <p className="muted">בחר בדיוק איזה פרט אתה מחפש ועל מי הוא שייך.</p>
        <p>
          <Link href="/">חזרה למסך הראשי</Link>
        </p>
      </div>

      <div className="card">
        <form className="grid" method="GET">
          <select name="fieldType" defaultValue={fieldType}>
            <option value="tz">תעודת זהות</option>
            <option value="email">אימייל</option>
            <option value="phone">טלפון</option>
          </select>

          <select name="owner" defaultValue={owner}>
            <option value="any">תלמיד/אב/אם</option>
            <option value="student">תלמיד</option>
            <option value="father">אב</option>
            <option value="mother">אם</option>
          </select>

          <input name="value" defaultValue={value} placeholder="הזן ערך לחיפוש" />
          <button type="submit">אתר</button>
        </form>
      </div>

      {error ? <div className="card muted">{error}</div> : null}

      <div className="card">
        <table>
          <thead>
            <tr>
              <th>שם</th>
              <th>שיעור</th>
              <th>מוסד</th>
              <th>ת"ז</th>
              <th>טלפון תלמיד</th>
              <th>טלפון אב</th>
              <th>טלפון אם</th>
            </tr>
          </thead>
          <tbody>
            {!students.length ? (
              <tr>
                <td colSpan={7} className="muted">{value ? "לא נמצאו תוצאות" : "הזן נתון לחיפוש"}</td>
              </tr>
            ) : (
              students.map((s) => (
                <tr key={s.id}>
                  <td><Link href={`/students/${s.id}`}>{s.label}</Link></td>
                  <td>{s.class || "-"}</td>
                  <td>{s.currentInstitution || "-"}</td>
                  <td>{s.tznum || "-"}</td>
                  <td><PhoneLink phoneObj={s.phone} /></td>
                  <td><PhoneLink phoneObj={s.dadPhone} /></td>
                  <td><PhoneLink phoneObj={s.momPhone} /></td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}
