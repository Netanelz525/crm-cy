"use client";

import { useFormStatus } from "react-dom";
import { sendQuickStudentEmailAction } from "./student-quick-email-actions";

function clean(value) {
  return String(value || "").trim();
}

const ROLE_CONFIG = [
  { value: "father", label: "אבא", emailPath: "fatherEmail" },
  { value: "mother", label: "אמא", emailPath: "motherEmail" },
  { value: "student", label: "תלמיד", emailPath: "email" }
];

function roleEmail(student, key) {
  return clean(student?.[key]?.primaryEmail);
}

function QuickEmailSubmit({ disabled }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={disabled || pending}>
      {pending ? "שולח..." : "שלח מייל"}
    </button>
  );
}

export default function StudentQuickEmailForm({ student, returnTo = "/neon", canSendEmails = false, canEmailParents = true }) {
  if (!canSendEmails) return null;
  const studentId = clean(student?.id);
  if (!studentId) return null;

  const options = ROLE_CONFIG.map((role) => ({
    ...role,
    email: roleEmail(student, role.emailPath)
  })).filter((role) => role.email && (canEmailParents || role.value === "student"));

  return (
    <details className="student-tag-quick-panel student-quick-email-panel">
      <summary className="chip-link student-tag-quick-trigger">שלח מייל</summary>
      <div className="student-tag-quick-body">
        {!options.length ? (
          <div className="muted">אין בכרטיס כתובת מייל לאבא, אמא או תלמיד.</div>
        ) : (
          <form action={sendQuickStudentEmailAction} className="student-tag-quick-form student-quick-email-form">
            <input type="hidden" name="studentId" value={studentId} />
            <input type="hidden" name="returnTo" value={returnTo} />
            <div className="student-quick-email-recipient-grid">
              {options.map((role) => (
                <label key={role.value} className="email-filter-chip">
                  <input
                    type="checkbox"
                    className="email-filter-chip-input"
                    name="recipientRoles"
                    value={role.value}
                    defaultChecked={role.value !== "student" || options.length === 1}
                  />
                  <span>{role.label}</span>
                  <small>{role.email}</small>
                </label>
              ))}
            </div>
            <input name="subject" placeholder="נושא המייל" required />
            <textarea name="bodyText" rows={4} placeholder="תוכן ההודעה" required />
            <input name="senderName" placeholder="שם שולח" />
            <label className="student-quick-email-greeting-toggle">
              <input type="checkbox" name="includeGreeting" value="1" />
              <span>הוסף פניה אישית לפי שם הנמען</span>
            </label>
            <QuickEmailSubmit disabled={!options.length} />
          </form>
        )}
      </div>
    </details>
  );
}
