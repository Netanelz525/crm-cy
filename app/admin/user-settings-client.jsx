"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

function clean(value) {
  return String(value || "").trim();
}

function formatDate(value) {
  if (!value) return "-";
  try {
    return new Date(value).toLocaleString("he-IL");
  } catch {
    return "-";
  }
}

function roleLabel(role) {
  switch (clean(role).toLowerCase()) {
    case "super_admin":
      return "סופר אדמין";
    case "admin":
      return "מנהל";
    case "editor":
      return "עורך";
    default:
      return "צופה";
  }
}

async function copyText(text) {
  if (!clean(text)) return false;
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

function backupDeliveryLabel(value) {
  switch (clean(value).toLowerCase()) {
    case "both":
      return "Email + Telegram";
    case "telegram":
      return "Telegram";
    case "email":
      return "Email";
    default:
      return "לא הוגדר";
  }
}

export default function UserSettingsClient({
  user,
  currentUserId,
  onGenerateTelegramCode,
  onGenerateWhatsAppCode,
  onUnlinkTelegram,
  onUnlinkWhatsApp,
  onSaveRole,
  onSavePreferences,
  onSaveWeeklyBackupPreferences,
  onDeleteUser
}) {
  const router = useRouter();
  const [generatedLinks, setGeneratedLinks] = useState({});
  const [message, setMessage] = useState("");
  const [busyKey, setBusyKey] = useState("");
  const [, startTransition] = useTransition();
  const isSelf = user.clerk_user_id === currentUserId;
  const telegramState = generatedLinks.telegram;
  const whatsappState = generatedLinks.whatsapp;

  async function runAction(key, action) {
    setBusyKey(key);
    setMessage("");
    try {
      await action();
      startTransition(() => router.refresh());
    } catch (error) {
      setMessage(error?.message || "הפעולה נכשלה.");
    } finally {
      setBusyKey("");
    }
  }

  async function handleGenerate(channel) {
    setBusyKey(`gen:${channel}`);
    setMessage("");
    try {
      const result = channel === "telegram"
        ? await onGenerateTelegramCode(user.clerk_user_id)
        : await onGenerateWhatsAppCode(user.clerk_user_id);
      setGeneratedLinks((current) => ({ ...current, [channel]: result }));
    } catch (error) {
      setMessage(error?.message || "יצירת קוד נכשלה.");
    } finally {
      setBusyKey("");
    }
  }

  async function handleCopy(text, successMessage) {
    const ok = await copyText(text);
    setMessage(ok ? successMessage : "לא הצלחתי להעתיק ללוח.");
  }

  function handleUnlink(channel) {
    return runAction(`unlink:${channel}`, async () => {
      if (channel === "telegram") await onUnlinkTelegram(user.clerk_user_id);
      else await onUnlinkWhatsApp(user.clerk_user_id);
      setGeneratedLinks((current) => {
        const next = { ...current };
        delete next[channel];
        return next;
      });
      setMessage(`החיבור ל-${channel === "telegram" ? "Telegram" : "WhatsApp"} נותק.`);
    });
  }

  function handleRoleSave() {
    const formData = new FormData();
    formData.set("targetUserId", user.clerk_user_id);
    formData.set("role", document.getElementById("role")?.value || user.role);
    return runAction("role", async () => {
      await onSaveRole(formData);
      setMessage("התפקיד נשמר.");
    });
  }

  function handlePreferenceSave() {
    const formData = new FormData();
    formData.set("targetUserId", user.clerk_user_id);
    formData.set("preferredAgentChannel", document.getElementById("pref")?.value || "");
    formData.set("agentTelegramEnabled", document.getElementById("tg-enabled")?.checked ? "1" : "0");
    formData.set("agentWhatsAppEnabled", document.getElementById("wa-enabled")?.checked ? "1" : "0");
    return runAction("prefs", async () => {
      await onSavePreferences(formData);
      setMessage("העדפות הערוץ נשמרו.");
    });
  }

  function handleDelete() {
    if (!window.confirm(`למחוק את המשתמש ${user.display_name}?`)) return;
    const formData = new FormData();
    formData.set("targetUserId", user.clerk_user_id);
    return runAction("delete", async () => {
      await onDeleteUser(formData);
      router.push("/admin");
      router.refresh();
    });
  }

  function handleWeeklyBackupSave() {
    const formData = new FormData();
    formData.set("targetUserId", user.clerk_user_id);
    formData.set("weeklyBackupEnabled", document.getElementById("weekly-backup-enabled")?.checked ? "1" : "0");
    formData.set("weeklyBackupDelivery", document.getElementById("weekly-backup-delivery")?.value || "email");
    return runAction("weekly-backup", async () => {
      await onSaveWeeklyBackupPreferences(formData);
      setMessage("העדפות הגיבוי השבועי נשמרו.");
    });
  }

  return (
    <div style={{ display: "grid", gap: 16 }}>
      <div className="quick-actions">
        <Link className="quick-action-btn quick-action-outline" href="/admin/users">חזרה לרשימת משתמשים</Link>
      </div>

      <div className="card glass">
        <h1 style={{ marginBottom: 8 }}>הגדרות משתמש</h1>
        <div style={{ display: "grid", gap: 8 }}>
          <strong>{user.display_name}</strong>
          <div className="muted" dir="ltr">{user.email}</div>
          <div className="student-meta-line">
            <span className="meta-chip">{roleLabel(user.role)}</span>
            {user.is_super_admin ? <span className="meta-chip meta-chip-strong">סופר אדמין</span> : null}
            <span className="meta-chip">{user.access_status === "approved" ? "מאושר" : "ממתין"}</span>
          </div>
        </div>
      </div>

      <div className="card">
        <h3>סיכום מהיר</h3>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: "8px 12px", color: "#5a6f89" }}>
          <div><b>תלמיד מקושר:</b> {user.linked_student_id || "-"}</div>
          <div><b>שיעור/מחלקה:</b> {user.linked_student_class || "-"}</div>
          <div><b>Telegram:</b> {user.telegram_chat_id ? `מחובר (${user.telegram_username || user.telegram_chat_id})` : "לא מחובר"}</div>
          <div><b>WhatsApp:</b> {user.whatsapp_wa_id ? `מחובר (${user.whatsapp_phone_number || user.whatsapp_wa_id})` : "לא מחובר"}</div>
          <div><b>ערוץ מועדף:</b> {user.preferred_agent_channel === "whatsapp" ? "WhatsApp" : user.preferred_agent_channel === "telegram" ? "Telegram" : "לא הוגדר"}</div>
          <div><b>גיבוי שבועי:</b> {user.weekly_backup_enabled ? backupDeliveryLabel(user.weekly_backup_delivery) : "כבוי"}</div>
          <div><b>עודכן:</b> {formatDate(user.updated_at)}</div>
        </div>
      </div>

      <div className="card">
        <h3>הרשאות משתמש</h3>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 10, alignItems: "center" }}>
          <select defaultValue={user.role} id="role" disabled={isSelf} style={{ width: "100%" }}>
            <option value="viewer">צופה</option>
            <option value="editor">עורך</option>
            <option value="admin">מנהל</option>
            <option value="super_admin">סופר אדמין</option>
          </select>
          <button type="button" style={{ width: "auto" }} disabled={isSelf || busyKey === "role"} onClick={handleRoleSave}>
            שמור תפקיד
          </button>
        </div>
      </div>

      <div className="card">
        <h3>העדפות סוכן</h3>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 10, alignItems: "center" }}>
          <select id="pref" defaultValue={user.preferred_agent_channel || ""} style={{ width: "100%" }}>
            <option value="">ללא העדפה</option>
            <option value="telegram">Telegram</option>
            <option value="whatsapp">WhatsApp</option>
          </select>
          <label style={{ display: "inline-flex", alignItems: "center", gap: 8, width: "auto" }}>
            <input id="tg-enabled" type="checkbox" defaultChecked={user.agent_telegram_enabled !== false} style={{ width: "auto" }} />
            Telegram פעיל
          </label>
          <label style={{ display: "inline-flex", alignItems: "center", gap: 8, width: "auto" }}>
            <input id="wa-enabled" type="checkbox" defaultChecked={user.agent_whatsapp_enabled !== false} style={{ width: "auto" }} />
            WhatsApp פעיל
          </label>
          <button style={{ width: "auto" }} type="button" disabled={busyKey === "prefs"} onClick={handlePreferenceSave}>
            שמור העדפות
          </button>
        </div>
      </div>

      <div className="card">
        <h3>גיבוי שבועי לסופר אדמין</h3>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 10, alignItems: "center" }}>
          <label style={{ display: "inline-flex", alignItems: "center", gap: 8, width: "auto" }}>
            <input id="weekly-backup-enabled" type="checkbox" defaultChecked={user.weekly_backup_enabled === true} style={{ width: "auto" }} />
            פעיל
          </label>
          <select id="weekly-backup-delivery" defaultValue={user.weekly_backup_delivery || "email"} style={{ width: "100%" }}>
            <option value="email">Email</option>
            <option value="telegram">Telegram</option>
            <option value="both">Email + Telegram</option>
          </select>
          <button style={{ width: "auto" }} type="button" disabled={busyKey === "weekly-backup"} onClick={handleWeeklyBackupSave}>
            שמור גיבוי שבועי
          </button>
        </div>
        <p className="muted" style={{ margin: "10px 0 0" }}>
          הגיבוי נשלח רק למשתמשים עם תפקיד סופר אדמין, וכולל יצוא JSON של כל טבלאות ה-CRM בלי תמונות.
        </p>
      </div>

      <div className="card">
        <h3>שיוך לסוכן</h3>
        <div className="quick-actions">
          <button type="button" style={{ width: "auto" }} disabled={busyKey === "gen:telegram"} onClick={() => handleGenerate("telegram")}>
            צור קישור Telegram
          </button>
          <button type="button" className="btn btn-ghost" style={{ width: "auto" }} disabled={!user.telegram_chat_id || busyKey === "unlink:telegram"} onClick={() => handleUnlink("telegram")}>
            נתק Telegram
          </button>
          <button type="button" style={{ width: "auto" }} disabled={busyKey === "gen:whatsapp"} onClick={() => handleGenerate("whatsapp")}>
            צור קישור WhatsApp
          </button>
          <button type="button" className="btn btn-ghost" style={{ width: "auto" }} disabled={!user.whatsapp_wa_id || busyKey === "unlink:whatsapp"} onClick={() => handleUnlink("whatsapp")}>
            נתק WhatsApp
          </button>
        </div>

        {telegramState?.code ? (
          <div style={{ display: "grid", gap: 8, padding: 12, borderRadius: 14, border: "1px solid #c9dbee", background: "#f8fbff", marginTop: 12 }}>
            <div><b>Telegram:</b> {telegramState.deepLink ? "קישור חיבור מוכן" : `קוד ${telegramState.code}`}</div>
            {telegramState.deepLink ? <div className="muted" dir="ltr" style={{ wordBreak: "break-all" }}>{telegramState.deepLink}</div> : null}
            <div className="muted">תוקף עד: {formatDate(telegramState.expiresAt)}</div>
            <div className="quick-actions">
              {telegramState.deepLink ? <button type="button" className="quick-action-btn quick-action-outline" style={{ width: "auto" }} onClick={() => handleCopy(telegramState.deepLink, "קישור Telegram הועתק.")}>העתק</button> : null}
              {telegramState.deepLink ? <a className="quick-action-btn quick-action-outline" href={telegramState.deepLink} target="_blank" rel="noreferrer">כניסה</a> : null}
              <button type="button" className="quick-action-btn quick-action-outline" style={{ width: "auto" }} onClick={() => handleCopy(telegramState.code, "קוד Telegram הועתק.")}>העתק קוד</button>
            </div>
          </div>
        ) : null}

        {whatsappState?.code ? (
          <div style={{ display: "grid", gap: 8, padding: 12, borderRadius: 14, border: "1px solid #c9dbee", background: "#f8fbff", marginTop: 12 }}>
            <div><b>WhatsApp:</b> {whatsappState.deepLink ? "קישור חיבור מוכן" : `קוד ${whatsappState.code}`}</div>
            {whatsappState.deepLink ? <div className="muted" dir="ltr" style={{ wordBreak: "break-all" }}>{whatsappState.deepLink}</div> : null}
            <div className="muted">תוקף עד: {formatDate(whatsappState.expiresAt)}</div>
            <div className="quick-actions">
              {whatsappState.deepLink ? <button type="button" className="quick-action-btn quick-action-outline" style={{ width: "auto" }} onClick={() => handleCopy(whatsappState.deepLink, "קישור WhatsApp הועתק.")}>העתק</button> : null}
              {whatsappState.deepLink ? <a className="quick-action-btn quick-action-outline" href={whatsappState.deepLink} target="_blank" rel="noreferrer">כניסה</a> : null}
              <button type="button" className="quick-action-btn quick-action-outline" style={{ width: "auto" }} onClick={() => handleCopy(whatsappState.code, "קוד WhatsApp הועתק.")}>העתק קוד</button>
            </div>
          </div>
        ) : null}
      </div>

      <div className="card">
        <h3>פעולות מערכת</h3>
        <div className="quick-actions">
          <button type="button" className="ai-chat-reject-btn" style={{ width: "auto" }} disabled={isSelf || busyKey === "delete"} onClick={handleDelete}>
            מחק משתמש
          </button>
        </div>
      </div>

      {message ? <div className="ok">{message}</div> : null}
    </div>
  );
}
