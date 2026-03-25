import Link from "next/link";
import { redirect } from "next/navigation";
import { ENUM_LABELS, FIELD_SECTIONS } from "../../../lib/student-fields";
import { requireAuthenticatedUser } from "../../../lib/rbac";
import { createStudentAction } from "./actions";

const TOP_CREATE_KEYS = new Set(["currentInstitution", "class", "registration"]);

function clean(v) {
  return String(v || "").trim();
}

function isAdvancedOnlyField(fieldKey) {
  return /\.additional(Phones|Emails)$/.test(String(fieldKey || ""));
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
  const advancedMode = clean(sp?.advanced) === "1";
  const existingStudentId = clean(sp?.existingStudentId);
  const duplicate = clean(sp?.duplicate) === "1";

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
            <Link className="btn btn-ghost" href={advancedMode ? "/students/new" : "/students/new?advanced=1"}>
              {advancedMode ? "מעבר ליצירה רגילה" : "יצירה מתקדמת"}
            </Link>
          </div>
        </div>
      </div>

      {errorText ? (
        <div className="card muted">
          <div>{errorText}</div>
          {duplicate && existingStudentId ? <div style={{ marginTop: 10 }}><Link className="chip-link" href={`/students/${existingStudentId}`}>פתח תלמיד קיים</Link></div> : null}
        </div>
      ) : null}

      <form action={createStudentAction}>
        <div className="sticky-save-bar">
          <button className="btn btn-save" type="submit">צור תלמיד</button>
        </div>

        <div className="card edit-focus-card">
          <h3 className="edit-focus-title">פרטי מסגרת לימוד</h3>
          <div className="grid">
            {FIELD_SECTIONS.flatMap((section) => section.fields)
              .filter((field) => TOP_CREATE_KEYS.has(field.key))
              .map((field) => (
                <div key={field.key}>
                  <label>{field.label}</label>
                  <FieldInput field={field} />
                </div>
              ))}
          </div>
          <p className="muted" style={{ marginTop: 8, marginBottom: 0 }}>
            טלפונים ואימיילים נוספים מוסתרים כברירת מחדל. להצגה שלהם בחר "יצירה מתקדמת".
          </p>
        </div>

        {FIELD_SECTIONS.map((section) => {
          const sectionFields = section.fields.filter((field) => {
            if (TOP_CREATE_KEYS.has(field.key)) return false;
            if (field.neonOnly) return false;
            if (!advancedMode && isAdvancedOnlyField(field.key)) return false;
            return true;
          });
          if (!sectionFields.length) return null;

          return (
            <div key={section.title} className="card">
              <h3>{section.title}</h3>
              <div className="grid">
                {sectionFields.map((field) => (
                  <div key={field.key}>
                    <label>{field.label}</label>
                    <FieldInput field={field} />
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </form>
    </>
  );
}
