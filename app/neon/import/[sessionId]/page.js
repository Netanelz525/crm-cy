import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { applyNeonStudentsImportAction } from "../../actions";
import { buildSuggestedMappings, MATCH_FIELD_OPTIONS } from "../../../../lib/excel-student-import";
import { getImportSession } from "../../../../lib/import-sessions";
import { FIELD_SECTIONS } from "../../../../lib/student-fields";
import { requireAuthenticatedUser } from "../../../../lib/rbac";

function clean(value) {
  return String(value || "").trim();
}

function allImportFields() {
  return FIELD_SECTIONS.flatMap((section) =>
    section.fields.map((field) => ({
      ...field,
      sectionTitle: section.title
    }))
  );
}

export default async function NeonImportMappingPage({ params, searchParams }) {
  const user = await requireAuthenticatedUser();
  if (!user.is_team_member && !user.is_manager) {
    redirect("/unauthorized");
  }

  const resolvedParams = await params;
  const resolvedSearchParams = await searchParams;
  const sessionId = clean(resolvedParams?.sessionId);
  const session = await getImportSession(sessionId);
  if (!session || clean(session.created_by_user_id) !== clean(user.clerk_user_id)) {
    notFound();
  }

  const mappingError = clean(resolvedSearchParams?.error);
  const fields = allImportFields();
  const suggestions = buildSuggestedMappings(session.headers || []);

  return (
    <>
      <div className="card glass">
        <div className="student-topbar">
          <div>
            <h1>מיפוי קובץ אקסל ל-Neon</h1>
            <p className="muted">
              קובץ: {session.file_name} | שורות: {Array.isArray(session.rows) ? session.rows.length : 0} | עמודות: {Array.isArray(session.headers) ? session.headers.length : 0}
            </p>
          </div>
          <div className="student-actions">
            <Link className="btn btn-ghost" href="/neon">חזרה ל-Neon</Link>
          </div>
        </div>
      </div>

      {mappingError ? <div className="card muted">{mappingError}</div> : null}

      <div className="card">
        <h3>עמודות שזוהו בקובץ</h3>
        <div className="saved-views-list">
          {(session.headers || []).map((header) => (
            <span key={header} className="saved-view-chip">{header}</span>
          ))}
        </div>
      </div>

      <form action={applyNeonStudentsImportAction}>
        <input type="hidden" name="sessionId" value={session.id} />

        <div className="card edit-focus-card">
          <h3 className="edit-focus-title">עמודות זיהוי</h3>
          <p className="muted">בחר עמודה אחת או יותר לזיהוי תלמיד. העדכון יתבצע רק בהתאמה מלאה לפי כל עמודות הזיהוי שתבחר.</p>
          <div className="grid">
            {MATCH_FIELD_OPTIONS.map((option) => (
              <div key={option.key}>
                <label>{option.label}</label>
                <select name={`match_${option.key}`} defaultValue={suggestions.matchMapping?.[option.key] || ""}>
                  <option value="">לא להשתמש</option>
                  {(session.headers || []).map((header) => (
                    <option key={header} value={header}>{header}</option>
                  ))}
                </select>
              </div>
            ))}
          </div>
        </div>

        {FIELD_SECTIONS.map((section) => {
          const sectionFields = fields.filter((field) => field.sectionTitle === section.title);
          if (!sectionFields.length) return null;

          return (
            <div key={section.title} className="card">
              <h3>{section.title}</h3>
              <div className="grid">
                {sectionFields.map((field) => (
                  <div key={field.key}>
                    <label>{field.label}</label>
                    <select name={`map_${field.key}`} defaultValue={suggestions.fieldMapping?.[field.key] || ""}>
                      <option value="">לא לעדכן</option>
                      {(session.headers || []).map((header) => (
                        <option key={header} value={header}>{header}</option>
                      ))}
                    </select>
                  </div>
                ))}
              </div>
            </div>
          );
        })}

        <div className="sticky-save-bar">
          <button className="btn btn-save" type="submit">החל ייבוא לפי המיפוי שבחרתי</button>
        </div>
      </form>
    </>
  );
}
