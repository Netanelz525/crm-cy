"use client";

import Link from "next/link";
import { useMemo, useState } from "react";

function clean(value) {
  return String(value || "").trim();
}

function roleLabel(role) {
  switch (clean(role).toLowerCase()) {
    case "super_admin":
      return "סופר אדמין";
    case "admin":
      return "מנהל";
    case "editor":
      return "עורך";
    case "print_only":
      return "הדפסה בלבד";
    case "marei_mekomot":
      return "מראה מקומות";
    default:
      return "צופה";
  }
}

function accessSummary(user) {
  return [
    user.is_super_admin ? "סופר אדמין" : null,
    user.is_team_member ? "צוות ניהול" : null,
    user.is_manager && !user.is_super_admin ? "מנהל CRM" : null,
    user.is_print_only ? "הדפסה בלבד" : null,
    user.is_marei_mekomot ? "מראה מקומות" : null,
    user.can_edit_own_card ? "עריכת כרטיס עצמי" : null
  ].filter(Boolean).join(" | ") || "צפייה בלבד";
}

function weeklyBackupLabel(user) {
  if (user.weekly_backup_enabled !== true) return "כבוי";
  switch (clean(user.weekly_backup_delivery).toLowerCase()) {
    case "both":
      return "Email + Telegram";
    case "telegram":
      return "Telegram";
    case "email":
      return "Email";
    default:
      return "פעיל";
  }
}

export default function UserManagementClient({ users }) {
  const [query, setQuery] = useState("");

  const filteredUsers = useMemo(() => {
    const term = clean(query).toLowerCase();
    if (!term) return users;
    return users.filter((user) => [
      user.display_name,
      user.email,
      user.linked_student_id,
      user.telegram_username,
      user.whatsapp_phone_number,
      user.whatsapp_profile_name
    ].some((value) => clean(value).toLowerCase().includes(term)));
  }, [query, users]);

  return (
    <div className="card">
      <div className="summary-row" style={{ alignItems: "flex-end", flexWrap: "wrap" }}>
        <div>
          <h2 style={{ marginBottom: 6 }}>משתמשים וסוכנים</h2>
          <p className="muted" style={{ margin: 0 }}>
            רשימת משתמשים, חיפוש מהיר, ותצוגת הרשאות לפני מעבר לעמוד ההגדרות המלא של כל משתמש.
          </p>
        </div>
        <div style={{ minWidth: 280 }}>
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="חיפוש לפי שם, מייל, תלמיד, טלגרם או WhatsApp" />
        </div>
      </div>

      <div style={{ display: "grid", gap: 14, marginTop: 16 }}>
        {filteredUsers.map((user) => (
          <div
            key={user.clerk_user_id}
            style={{
              display: "grid",
              gap: 12,
              padding: 16,
              border: "1px solid #d7e1ef",
              borderRadius: 18,
              background: "linear-gradient(180deg, #ffffff, #f8fbff)"
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12, flexWrap: "wrap" }}>
              <div>
                <strong>{user.display_name}</strong>
                <div className="muted" dir="ltr">{user.email}</div>
              </div>
              <div className="student-meta-line">
                <span className="meta-chip">{roleLabel(user.role)}</span>
                {user.is_super_admin ? <span className="meta-chip meta-chip-strong">סופר אדמין</span> : null}
                <span className="meta-chip">{user.access_status === "approved" ? "מאושר" : "ממתין"}</span>
              </div>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: "8px 12px", color: "#5a6f89" }}>
              <div><b>הרשאות:</b> {accessSummary(user)}</div>
              <div><b>תלמיד מקושר:</b> {user.linked_student_id || "-"}</div>
              <div><b>שיעור/מחלקה:</b> {user.linked_student_class || "-"}</div>
              <div><b>ערוץ מועדף:</b> {user.preferred_agent_channel === "whatsapp" ? "WhatsApp" : user.preferred_agent_channel === "telegram" ? "Telegram" : "לא הוגדר"}</div>
              <div><b>גיבוי שבועי:</b> {weeklyBackupLabel(user)}</div>
              <div><b>Telegram:</b> {user.telegram_chat_id ? "מחובר" : "לא מחובר"}</div>
              <div><b>WhatsApp:</b> {user.whatsapp_wa_id ? "מחובר" : "לא מחובר"}</div>
            </div>

            <div className="quick-actions">
              <Link className="quick-action-btn quick-action-outline" href={`/admin/users/${encodeURIComponent(user.clerk_user_id)}`}>
                לעמוד המשתמש
              </Link>
            </div>
          </div>
        ))}

        {!filteredUsers.length ? <div className="muted">לא נמצאו משתמשים.</div> : null}
      </div>
    </div>
  );
}
