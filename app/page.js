import Link from "next/link";
import { redirect } from "next/navigation";
import { getNotesByStudentIds } from "../lib/notes";
import { getCurrentAppUser } from "../lib/rbac";
import { quickUpdateNoteAction } from "./actions";
import { getStudentsByInstitution, searchStudentsByText, searchStudentsByTz } from "../lib/twenty";

const NOTE_STATUSES = {
  NOT_RELEVANT: "Not relevant",
  OTHER: "Other",
  CONTACTED: "Contacted"
};

const INSTITUTIONS = {
  YR: "Yechi Reuven",
  OE: "Or Ephraim",
  CY: "Chachmei Yerushalayim",
  BOGER: "Graduate",
  BOGERNCONTACT: "Graduate - no contact",
  TEST: "Test"
};

function clean(v) {
  return String(v || "").trim();
}

function phoneText(phoneObj) {
  if (!phoneObj?.primaryPhoneNumber) return "-";
  return [clean(phoneObj.primaryPhoneCallingCode), clean(phoneObj.primaryPhoneNumber)].filter(Boolean).join(" ");
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

  if (!currentUser.is_team_member) {
    if (currentUser.linked_student_id) {
      redirect(`/students/${currentUser.linked_student_id}`);
    }
    const approvedUnknown = String(currentUser.access_status || "") === "approved";
    return (
      <div className="card">
        <h1>{approvedUnknown ? "No linked student card" : "Access pending approval"}</h1>
        <p className="muted">
          {approvedUnknown
            ? "Your user is approved, but no student record is linked to your email in the CRM. Please contact a TEAM user."
            : "No matching student was found for your email. A TEAM user must approve unknown users."}
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
        <h1>Students Management - TEAM</h1>
        <p className="muted">Full access to search, updates, and unknown-user approvals.</p>
        <p>
          <Link href="/admin">Open user approvals</Link>
        </p>
      </div>

      <div className="card">
        <form className="grid" method="GET">
          <input name="q" defaultValue={q} placeholder="Search by student name" />
          <input name="tz" defaultValue={tz} placeholder="Search by ID number" />
          <select name="institution" defaultValue={institution}>
            <option value="">Select institution</option>
            {Object.entries(INSTITUTIONS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
          <input name="institutionSearch" defaultValue={institutionSearch} placeholder="Search inside institution" />
          <select name="internalStatus" defaultValue={internalStatus}>
            <option value="">Filter by internal status</option>
            {Object.entries(NOTE_STATUSES).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
          <select name="directDebit" defaultValue={directDebit}>
            <option value="all">Direct debit: all</option>
            <option value="yes">With direct debit</option>
            <option value="no">Without direct debit</option>
          </select>
          <input name="signerFilter" defaultValue={signerFilter} placeholder="Filter by signed-by user" />
          <button type="submit">Search</button>
        </form>
      </div>

      {quickUpdated ? <div className="ok">Internal data saved.</div> : null}
      {error ? <div className="card muted">{error}</div> : null}

      <div className="card">
        <table>
          <thead>
            <tr>
              <th>Name</th>
              <th>ID</th>
              <th>Age</th>
              <th>Student Phone</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {!students.length ? (
              <tr>
                <td colSpan={5} className="muted">
                  No results
                </td>
              </tr>
            ) : (
              students.map((s) => (
                <tr key={s.id}>
                  <td>{s.label}</td>
                  <td>{s.tznum || "-"}</td>
                  <td>{ageOf(s.dateofbirth) ?? "-"}</td>
                  <td>{phoneText(s.phone)}</td>
                  <td>
                    <div style={{ display: "grid", gap: 8 }}>
                      <Link href={`/students/${s.id}`}>Student card</Link>
                      <details>
                        <summary>Quick internal edit</summary>
                        <form action={quickUpdateNoteAction}>
                          <input type="hidden" name="studentId" value={s.id} />
                          <input type="hidden" name="next" value={next} />
                          <textarea name="noteText" defaultValue={s.note?.note_text || ""} placeholder="Internal note" />
                          <select name="noteStatus" defaultValue={s.note?.note_status || ""}>
                            <option value="">Status</option>
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
                            <option value="">Direct debit</option>
                            <option value="true">Yes</option>
                            <option value="false">No</option>
                          </select>
                          <button type="submit">Save</button>
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
