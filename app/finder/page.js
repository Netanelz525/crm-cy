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

function containsValue(sourceValue, queryValue) {
  if (!sourceValue || !queryValue) return false;
  return sourceValue.includes(queryValue);
}

function ownerFields(fieldType, owner) {
  if (fieldType === "email") {
    const all = [
      { key: "student", label: "אימייל תלמיד", get: (s) => normEmail(s?.email?.primaryEmail) },
      { key: "father", label: "אימייל אב", get: (s) => normEmail(s?.fatherEmail?.primaryEmail) },
      { key: "mother", label: "אימייל אם", get: (s) => normEmail(s?.motherEmail?.primaryEmail) }
    ];
    return owner === "any" ? all : all.filter((f) => f.key === owner);
  }

  if (fieldType === "phone") {
    const all = [
      { key: "student", label: "טלפון תלמיד", get: (s) => normPhone(s?.phone?.primaryPhoneNumber) },
      { key: "father", label: "טלפון אב", get: (s) => normPhone(s?.dadPhone?.primaryPhoneNumber) },
      { key: "mother", label: "טלפון אם", get: (s) => normPhone(s?.momPhone?.primaryPhoneNumber) }
    ];
    return owner === "any" ? all : all.filter((f) => f.key === owner);
  }

  return [];
}

function matchSources(student, fieldType, owner, value) {
  if (fieldType === "tz") {
    const tz = normPhone(student?.tznum);
    const q = normPhone(value);
    return containsValue(tz, q) ? ["תעודת זהות"] : [];
  }

  const fields = ownerFields(fieldType, owner);
  const q = fieldType === "email" ? normEmail(value) : normPhone(value);
  return fields
    .filter((f) => containsValue(f.get(student), q))
    .map((f) => f.label);
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
        students = all
          .map((s) => ({ ...s, _matchedBy: matchSources(s, fieldType, owner, value) }))
          .filter((s) => s._matchedBy.length > 0);
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
              <th>נמצא לפי</th>
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
                <td colSpan={8} className="muted">{value ? "לא נמצאו תוצאות" : "הזן נתון לחיפוש"}</td>
              </tr>
            ) : (
              students.map((s) => (
                <tr key={s.id}>
                  <td><Link href={`/students/${s.id}`}>{s.label}</Link></td>
                  <td>{(s._matchedBy || []).join(", ") || "-"}</td>
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
