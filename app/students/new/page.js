import Link from "next/link";
import { redirect } from "next/navigation";
import { ENUM_LABELS, FIELD_SECTIONS } from "../../../lib/student-fields";
import { requireAuthenticatedUser } from "../../../lib/rbac";
import { createStudentAction } from "./actions";

function clean(v) {
  return String(v || "").trim();
}

function FieldInput({ field }) {
  if (field.enum && ENUM_LABELS[field.enum]) {
    return (
      <select name={field.key} defaultValue="">
        <option value="">בחר</option>
        {Object.entries(ENUM_LABELS[field.enum]).map(([value, label]) => (
          <option key={value} value={value}>
            {label}
          </option>
        ))}
      </select>
    );
  }

  if (field.type === "date") {
    return <input type="date" name={field.key} />;
  }

  if (field.isList) {
    return <textarea name={field.key} placeholder="הפרדה בפסיק או שורה חדשה" />;
  }

  return <input name={field.key} />;
}

export default async function NewStudentPage({ searchParams }) {
  const user = await requireAuthenticatedUser();
  if (!user.is_team_member && !user.is_manager) redirect("/unauthorized");

  const sp = await searchParams;
  const errorText = clean(sp?.error);

  return (
    <>
      <div className="card glass">
        <div className="student-topbar">
          <div>
            <h1>יצירת תלמיד חדש</h1>
            <p className="muted">מלא את הפרטים הדרושים ושמור ישירות ל-CRM.</p>
          </div>
          <div className="student-actions">
            <Link className="btn btn-ghost" href="/">חזרה לרשימה</Link>
          </div>
        </div>
      </div>

      {errorText ? <div className="card muted">{errorText}</div> : null}

      <form action={createStudentAction}>
        <div className="sticky-save-bar">
          <button className="btn btn-save" type="submit">צור תלמיד</button>
        </div>

        {FIELD_SECTIONS.map((section) => (
          <div key={section.title} className="card">
            <h3>{section.title}</h3>
            <div className="grid">
              {section.fields.map((field) => (
                <div key={field.key}>
                  <label>{field.label}</label>
                  <FieldInput field={field} />
                </div>
              ))}
            </div>
          </div>
        ))}
      </form>
    </>
  );
}
