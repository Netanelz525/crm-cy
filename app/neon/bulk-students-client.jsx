"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { ENUM_LABELS } from "../../lib/student-fields";
import { ageOf, buildMissingState, classLabel, clean, columnText, FIELD_DEF_MAP, getByPath, phoneHref, phoneText } from "../../lib/student-view";
import { bulkUpdateNeonStudentsAction } from "./actions";

function PhoneLink({ phoneObj }) {
  const text = phoneText(phoneObj);
  if (text === "-") return "-";
  const href = phoneHref(phoneObj);
  if (!href) return text;
  return <a href={href}>{text}</a>;
}

function fieldPhoneHref(student, fieldKey) {
  const fieldDef = FIELD_DEF_MAP[fieldKey];
  if (!fieldDef || !fieldDef.key.endsWith(".primaryPhoneNumber")) return "";
  const phoneRoot = fieldDef.key.slice(0, -".primaryPhoneNumber".length);
  return phoneHref({
    primaryPhoneNumber: getByPath(student, fieldDef.key),
    primaryPhoneCallingCode: getByPath(student, `${phoneRoot}.primaryPhoneCallingCode`)
  });
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
      return email ? <a href={`mailto:${email}`}>{email}</a> : value;
    }
    return value;
  }

  switch (columnKey) {
    case "name":
      return <Link className="student-link" href={`/neon/students/${student.id}`}>{clean(student?.label) || "-"}</Link>;
    case "studentPhone":
      return <PhoneLink phoneObj={student?.phone} />;
    case "dadPhone":
      return <PhoneLink phoneObj={student?.dadPhone} />;
    case "momPhone":
      return <PhoneLink phoneObj={student?.momPhone} />;
    case "studentEmail": {
      const email = clean(student?.email?.primaryEmail);
      return email ? <a href={`mailto:${email}`}>{email}</a> : "-";
    }
    case "fatherEmail": {
      const email = clean(student?.fatherEmail?.primaryEmail);
      return email ? <a href={`mailto:${email}`}>{email}</a> : "-";
    }
    case "motherEmail": {
      const email = clean(student?.motherEmail?.primaryEmail);
      return email ? <a href={`mailto:${email}`}>{email}</a> : "-";
    }
    default:
      return columnText(student, columnKey);
  }
}

function BulkField({ name, label, children }) {
  const [enabled, setEnabled] = useState(false);
  return (
    <div className="bulk-field-card">
      <label className="bulk-field-toggle">
        <input type="checkbox" name={`apply_${name}`} value="1" checked={enabled} onChange={(event) => setEnabled(event.target.checked)} />
        <span>{label}</span>
      </label>
      <div className={enabled ? "bulk-field-body" : "bulk-field-body disabled"}>{children(enabled)}</div>
    </div>
  );
}

export default function BulkStudentsClient({ students, selectedColumns, showInstitutionView }) {
  const [selectedIds, setSelectedIds] = useState([]);
  const [bulkOpen, setBulkOpen] = useState(false);

  const selectedSet = useMemo(() => new Set(selectedIds), [selectedIds]);
  const allVisibleSelected = students.length > 0 && students.every((student) => selectedSet.has(student.id));

  function toggleStudent(studentId, checked) {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (checked) next.add(studentId);
      else next.delete(studentId);
      return Array.from(next);
    });
  }

  function toggleAll(checked) {
    setSelectedIds(checked ? students.map((student) => student.id) : []);
  }

  function closeBulk() {
    setBulkOpen(false);
  }

  return (
    <>
      {students.length ? (
        <div className="card summary-row">
          <div>נבחרו לעדכון מרוכז: <b>{selectedIds.length}</b></div>
          <div className="quick-actions" style={{ marginTop: 0 }}>
            <button type="button" className="chip-link bulk-trigger-btn" disabled={!selectedIds.length} onClick={() => setBulkOpen(true)}>
              עדכון שדה מרוכז
            </button>
            <button type="button" className="chip-link bulk-trigger-btn" disabled={!selectedIds.length} onClick={() => setSelectedIds([])}>
              נקה בחירה
            </button>
          </div>
        </div>
      ) : null}

      {bulkOpen ? (
        <div className="bulk-modal-backdrop" onClick={closeBulk}>
          <div className="bulk-modal" onClick={(event) => event.stopPropagation()}>
            <div className="student-topbar">
              <div>
                <h3>עדכון מרוכז לתלמידים נבחרים</h3>
                <p className="muted">נבחרו {selectedIds.length} תלמידים. סמן רק את השדות שברצונך להחיל על כולם.</p>
              </div>
              <button type="button" className="btn btn-ghost" onClick={closeBulk}>סגור</button>
            </div>
            <form action={bulkUpdateNeonStudentsAction} className="bulk-form-grid">
              {selectedIds.map((id) => (
                <input key={id} type="hidden" name="studentIds" value={id} />
              ))}
              <BulkField name="currentInstitution" label="מוסד">
                {(enabled) => (
                  <select name="currentInstitution" disabled={!enabled} defaultValue="">
                    <option value="">בחר מוסד</option>
                    {Object.entries(ENUM_LABELS.currentInstitution || {}).map(([value, label]) => (
                      <option key={value} value={value}>{label}</option>
                    ))}
                  </select>
                )}
              </BulkField>
              <BulkField name="class" label="שיעור">
                {(enabled) => (
                  <select name="class" disabled={!enabled} defaultValue="">
                    <option value="">בחר שיעור</option>
                    {Object.entries(ENUM_LABELS.class || {}).map(([value, label]) => (
                      <option key={value} value={value}>{label}</option>
                    ))}
                  </select>
                )}
              </BulkField>
              <BulkField name="registration" label="רישום">
                {(enabled) => (
                  <select name="registration" disabled={!enabled} defaultValue="">
                    <option value="">בחר רישום</option>
                    {Object.entries(ENUM_LABELS.registration || {}).map(([value, label]) => (
                      <option key={value} value={value}>{label}</option>
                    ))}
                  </select>
                )}
              </BulkField>
              <BulkField name="famliystatus" label="סטטוס משפחתי">
                {(enabled) => (
                  <select name="famliystatus" disabled={!enabled} defaultValue="">
                    <option value="">בחר סטטוס</option>
                    {Object.entries(ENUM_LABELS.familystatus || {}).map(([value, label]) => (
                      <option key={value} value={value}>{label}</option>
                    ))}
                  </select>
                )}
              </BulkField>
              <BulkField name="healthInsurance" label="קופת חולים">
                {(enabled) => (
                  <select name="healthInsurance" disabled={!enabled} defaultValue="">
                    <option value="">בחר קופה</option>
                    {Object.entries(ENUM_LABELS.healthInsurance || {}).map(([value, label]) => (
                      <option key={value} value={value}>{label}</option>
                    ))}
                  </select>
                )}
              </BulkField>
              <BulkField name="childrenCount" label="מספר ילדים">
                {(enabled) => (
                  <input type="number" min="0" step="1" name="childrenCount" disabled={!enabled} />
                )}
              </BulkField>
              <BulkField name="note" label="הערה">
                {(enabled) => (
                  <textarea name="note" disabled={!enabled} placeholder="הערה שתתווסף לכל הרשומות שנבחרו" />
                )}
              </BulkField>
              <div className="quick-actions">
                <button type="submit">החל על הרשומות שנבחרו</button>
              </div>
            </form>
          </div>
        </div>
      ) : null}

      <div className="card desktop-table">
        <table>
          <thead>
            {showInstitutionView ? (
              <tr>
                <th className="selection-cell">
                  <input type="checkbox" checked={allVisibleSelected} onChange={(event) => toggleAll(event.target.checked)} />
                </th>
                {selectedColumns.map((col) => <th key={col.key}>{col.label}</th>)}
              </tr>
            ) : (
              <tr>
                <th className="selection-cell">
                  <input type="checkbox" checked={allVisibleSelected} onChange={(event) => toggleAll(event.target.checked)} />
                </th>
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
                <td colSpan={showInstitutionView ? Math.max(selectedColumns.length + 1, 1) : 9} className="muted">אין תוצאות</td>
              </tr>
            ) : showInstitutionView ? (
              students.map((student) => {
                const hasMissing = (student.missingItems || []).length > 0;
                return (
                  <tr key={student.id} style={hasMissing ? { background: "#fff1f2" } : undefined}>
                    <td className="selection-cell">
                      <input type="checkbox" checked={selectedSet.has(student.id)} onChange={(event) => toggleStudent(student.id, event.target.checked)} />
                    </td>
                    {selectedColumns.map((col) => (
                      <td key={col.key} style={col.key === "missing" && hasMissing ? { color: "#b42318", fontWeight: 700 } : undefined}>
                        {columnNode(student, col.key)}
                      </td>
                    ))}
                  </tr>
                );
              })
            ) : (
              students.map((student) => {
                const missingState = buildMissingState(student);
                const hasMissing = missingState.items.length > 0;
                return (
                  <tr key={student.id} style={hasMissing ? { background: "#fff1f2" } : undefined}>
                    <td className="selection-cell">
                      <input type="checkbox" checked={selectedSet.has(student.id)} onChange={(event) => toggleStudent(student.id, event.target.checked)} />
                    </td>
                    <td><Link className="student-link" href={`/neon/students/${student.id}`}>{student.label}</Link></td>
                    <td>{classLabel(student.class)}</td>
                    <td>{student.tznum || "-"}</td>
                    <td>{ageOf(student.dateofbirth) ?? "-"}</td>
                    <td><PhoneLink phoneObj={student.phone} /></td>
                    <td><PhoneLink phoneObj={student.dadPhone} /></td>
                    <td><PhoneLink phoneObj={student.momPhone} /></td>
                    <td style={hasMissing ? { color: "#b42318", fontWeight: 700 } : undefined}>{hasMissing ? missingState.items.join(", ") : "-"}</td>
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
        ) : showInstitutionView ? (
          students.map((student) => {
            const hasMissing = (student.missingItems || []).length > 0;
            return (
              <div key={student.id} className={`student-mobile-card ${hasMissing ? "missing" : ""}`}>
                <label className="bulk-mobile-select">
                  <input type="checkbox" checked={selectedSet.has(student.id)} onChange={(event) => toggleStudent(student.id, event.target.checked)} />
                  <span>בחר לעדכון מרוכז</span>
                </label>
                <div className="student-mobile-head">
                  <Link className="student-link" href={`/neon/students/${student.id}`}>{student.label}</Link>
                </div>
                <div className="student-mobile-grid">
                  {selectedColumns.map((col) => <div key={col.key}><b>{col.label}:</b> {columnNode(student, col.key)}</div>)}
                </div>
              </div>
            );
          })
        ) : (
          students.map((student) => {
            const missingState = buildMissingState(student);
            const hasMissing = missingState.items.length > 0;
            return (
              <div key={student.id} className={`student-mobile-card ${hasMissing ? "missing" : ""}`}>
                <label className="bulk-mobile-select">
                  <input type="checkbox" checked={selectedSet.has(student.id)} onChange={(event) => toggleStudent(student.id, event.target.checked)} />
                  <span>בחר לעדכון מרוכז</span>
                </label>
                <div className="student-mobile-head">
                  <Link className="student-link" href={`/neon/students/${student.id}`}>{student.label}</Link>
                  <span>{classLabel(student.class)}</span>
                </div>
                <div className="student-mobile-grid">
                  <div><b>ת"ז:</b> {student.tznum || "-"}</div>
                  <div><b>גיל:</b> {ageOf(student.dateofbirth) ?? "-"}</div>
                  <div><b>טלפון תלמיד:</b> <PhoneLink phoneObj={student.phone} /></div>
                  <div><b>טלפון אב:</b> <PhoneLink phoneObj={student.dadPhone} /></div>
                  <div><b>טלפון אם:</b> <PhoneLink phoneObj={student.momPhone} /></div>
                </div>
                <div className="student-mobile-missing"><b>חוסרים:</b> {hasMissing ? missingState.items.join(", ") : "-"}</div>
              </div>
            );
          })
        )}
      </div>
    </>
  );
}
