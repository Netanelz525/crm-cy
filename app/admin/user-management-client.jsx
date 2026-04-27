"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

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

function UserCard({
  user,
  currentUserId,
  generatedLinks,
  onCopy,
  onGenerate,
  onUnlink,
  onRoleSave,
  onPreferenceSave,
  onDelete,
  busyKey,
  message
}) {
  const isSelf = user.clerk_user_id === currentUserId;
  const telegramState = generatedLinks[`${user.clerk_user_id}:telegram`];
  const whatsappState = generatedLinks[`${user.clerk_user_id}:whatsapp`];

  return (
    <div style={{ display: "grid", gap: 14, padding: 16, border: "1px solid #d7e1ef", borderRadius: 18, background: "linear-gradient(180deg, #ffffff, #f8fbff)" }}>
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

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: "8px 12px", color: "#5a6f89" }}>
        <div><b>סוגי הרשאות:</b> {[
          user.is_super_admin ? "סופר אדמין" : null,
          user.is_team_member ? "TEAM" : null,
          user.is_manager && !user.is_super_admin ? "מנהל CRM" : null,
          user.can_edit_own_card ? "עריכת כרטיס עצמי" : null
        ].filter(Boolean).join(" | ") || "צפייה בלבד"}</div>
        <div><b>תלמיד מקושר:</b> {user.linked_student_id || "-"}</div>
        <div><b>שיעור/מחלקה:</b> {user.linked_student_class || "-"}</div>
        <div><b>ערוץ מועדף:</b> {user.preferred_agent_channel === "whatsapp" ? "WhatsApp" : user.preferred_agent_channel === "telegram" ? "Telegram" : "לא הוגדר"}</div>
        <div><b>Telegram:</b> {user.telegram_chat_id ? `מחובר (${user.telegram_username || user.telegram_chat_id})` : "לא מחובר"}</div>
        <div><b>WhatsApp:</b> {user.whatsapp_wa_id ? `מחובר (${user.whatsapp_phone_number || user.whatsapp_wa_id})` : "לא מחובר"}</div>
      </div>

      <div style={{ display: "grid", gap: 10, paddingTop: 10, borderTop: "1px solid #e1e9f3" }}>
        <h4>הרשאות משתמש</h4>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 10, alignItems: "center" }}>
          <select defaultValue={user.role} id={`role-${user.clerk_user_id}`} disabled={isSelf} style={{ width: "100%" }}>
            <option value="viewer">צופה</option>
            <option value="editor">עורך</option>
            <option value="admin">מנהל</option>
            <option value="super_admin">סופר אדמין</option>
          </select>
          <button
            type="button"
            style={{ width: "auto" }}
            disabled={isSelf || busyKey === `role:${user.clerk_user_id}`}
            onClick={() => onRoleSave(user.clerk_user_id, document.getElementById(`role-${user.clerk_user_id}`)?.value || user.role)}
          >
            שמור תפקיד
          </button>
        </div>
      </div>

      <div style={{ display: "grid", gap: 10, paddingTop: 10, borderTop: "1px solid #e1e9f3" }}>
        <h4>העדפות סוכן</h4>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 10, alignItems: "center" }}>
          <select id={`pref-${user.clerk_user_id}`} defaultValue={user.preferred_agent_channel || ""} style={{ width: "100%" }}>
            <option value="">ללא העדפה</option>
            <option value="telegram">Telegram</option>
            <option value="whatsapp">WhatsApp</option>
          </select>
          <label style={{ display: "inline-flex", alignItems: "center", gap: 8, width: "auto" }}>
            <input id={`tg-enabled-${user.clerk_user_id}`} type="checkbox" defaultChecked={user.agent_telegram_enabled !== false} style={{ width: "auto" }} />
            Telegram פעיל
          </label>
          <label style={{ display: "inline-flex", alignItems: "center", gap: 8, width: "auto" }}>
            <input id={`wa-enabled-${user.clerk_user_id}`} type="checkbox" defaultChecked={user.agent_whatsapp_enabled !== false} style={{ width: "auto" }} />
            WhatsApp פעיל
          </label>
          <button
            style={{ width: "auto" }}
            type="button"
            disabled={busyKey === `prefs:${user.clerk_user_id}`}
            onClick={() => onPreferenceSave(user.clerk_user_id, {
              preferredAgentChannel: document.getElementById(`pref-${user.clerk_user_id}`)?.value || "",
              agentTelegramEnabled: document.getElementById(`tg-enabled-${user.clerk_user_id}`)?.checked ? "1" : "0",
              agentWhatsAppEnabled: document.getElementById(`wa-enabled-${user.clerk_user_id}`)?.checked ? "1" : "0"
            })}
          >
            שמור העדפות
          </button>
        </div>
      </div>

      <div style={{ display: "grid", gap: 10, paddingTop: 10, borderTop: "1px solid #e1e9f3" }}>
        <h4>שיוך לסוכן</h4>
        <div className="quick-actions">
          <button type="button" style={{ width: "auto" }} disabled={busyKey === `gen-tg:${user.clerk_user_id}`} onClick={() => onGenerate("telegram", user.clerk_user_id)}>
            צור קוד Telegram
          </button>
          <button type="button" className="btn btn-ghost" style={{ width: "auto" }} disabled={!user.telegram_chat_id || busyKey === `unlink-tg:${user.clerk_user_id}`} onClick={() => onUnlink("telegram", user.clerk_user_id)}>
            נתק Telegram
          </button>
          <button type="button" style={{ width: "auto" }} disabled={busyKey === `gen-wa:${user.clerk_user_id}`} onClick={() => onGenerate("whatsapp", user.clerk_user_id)}>
            צור קוד WhatsApp
          </button>
          <button type="button" className="btn btn-ghost" style={{ width: "auto" }} disabled={!user.whatsapp_wa_id || busyKey === `unlink-wa:${user.clerk_user_id}`} onClick={() => onUnlink("whatsapp", user.clerk_user_id)}>
            נתק WhatsApp
          </button>
        </div>
        {telegramState?.code ? (
          <div style={{ display: "grid", gap: 8, padding: 12, borderRadius: 14, border: "1px solid #c9dbee", background: "#f8fbff" }}>
            <div><b>Telegram:</b> קוד {telegramState.code}</div>
            <div className="muted">תוקף עד: {formatDate(telegramState.expiresAt)}</div>
            <div className="quick-actions">
              <button type="button" className="btn btn-ghost" style={{ width: "auto" }} onClick={() => onCopy(telegramState.code, "קוד Telegram הועתק.")}>העתק קוד</button>
              {telegramState.deepLink ? <button type="button" className="btn btn-ghost" style={{ width: "auto" }} onClick={() => onCopy(telegramState.deepLink, "קישור Telegram הועתק.")}>העתק קישור</button> : null}
              {telegramState.deepLink ? <a className="quick-action-btn quick-action-outline" href={telegramState.deepLink} target="_blank" rel="noreferrer">פתח בוט</a> : null}
            </div>
          </div>
        ) : null}
        {whatsappState?.code ? (
          <div style={{ display: "grid", gap: 8, padding: 12, borderRadius: 14, border: "1px solid #c9dbee", background: "#f8fbff" }}>
            <div><b>WhatsApp:</b> קוד {whatsappState.code}</div>
            <div className="muted">תוקף עד: {formatDate(whatsappState.expiresAt)}</div>
            <div className="quick-actions">
              <button type="button" className="btn btn-ghost" style={{ width: "auto" }} onClick={() => onCopy(whatsappState.code, "קוד WhatsApp הועתק.")}>העתק קוד</button>
              {whatsappState.deepLink ? <button type="button" className="btn btn-ghost" style={{ width: "auto" }} onClick={() => onCopy(whatsappState.deepLink, "קישור WhatsApp הועתק.")}>העתק קישור</button> : null}
              {whatsappState.deepLink ? <a className="quick-action-btn quick-action-outline" href={whatsappState.deepLink} target="_blank" rel="noreferrer">פתח WhatsApp</a> : null}
            </div>
          </div>
        ) : null}
      </div>

      <div style={{ display: "grid", gap: 10, paddingTop: 10, borderTop: "1px solid #e1e9f3" }}>
        <h4>פעולות מערכת</h4>
        <div className="quick-actions">
          <button type="button" className="ai-chat-reject-btn" style={{ width: "auto" }} disabled={isSelf || busyKey === `delete:${user.clerk_user_id}`} onClick={() => onDelete(user.clerk_user_id, user.display_name)}>
            מחק משתמש
          </button>
        </div>
      </div>

      {message ? <div className="ok">{message}</div> : null}
    </div>
  );
}

export default function UserManagementClient({
  users,
  currentUserId,
  onGenerateTelegramCode,
  onGenerateWhatsAppCode,
  onUnlinkTelegram,
  onUnlinkWhatsApp,
  onSaveRole,
  onSavePreferences,
  onDeleteUser
}) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [generatedLinks, setGeneratedLinks] = useState({});
  const [message, setMessage] = useState("");
  const [busyKey, setBusyKey] = useState("");
  const [, startTransition] = useTransition();

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

  async function handleGenerate(channel, userId) {
    setBusyKey(`gen-${channel === "telegram" ? "tg" : "wa"}:${userId}`);
    setMessage("");
    try {
      const result = channel === "telegram"
        ? await onGenerateTelegramCode(userId)
        : await onGenerateWhatsAppCode(userId);
      setGeneratedLinks((current) => ({
        ...current,
        [`${userId}:${channel}`]: result
      }));
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

  function handleUnlink(channel, userId) {
    return runAction(`unlink-${channel === "telegram" ? "tg" : "wa"}:${userId}`, async () => {
      if (channel === "telegram") await onUnlinkTelegram(userId);
      else await onUnlinkWhatsApp(userId);
      setGeneratedLinks((current) => {
        const next = { ...current };
        delete next[`${userId}:${channel}`];
        return next;
      });
      setMessage(`החיבור ל-${channel === "telegram" ? "Telegram" : "WhatsApp"} נותק.`);
    });
  }

  function handleRoleSave(userId, role) {
    const formData = new FormData();
    formData.set("targetUserId", userId);
    formData.set("role", role);
    return runAction(`role:${userId}`, async () => {
      await onSaveRole(formData);
      setMessage("התפקיד נשמר.");
    });
  }

  function handlePreferenceSave(userId, values) {
    const formData = new FormData();
    formData.set("targetUserId", userId);
    formData.set("preferredAgentChannel", values.preferredAgentChannel);
    formData.set("agentTelegramEnabled", values.agentTelegramEnabled);
    formData.set("agentWhatsAppEnabled", values.agentWhatsAppEnabled);
    return runAction(`prefs:${userId}`, async () => {
      await onSavePreferences(formData);
      setMessage("העדפות הערוץ נשמרו.");
    });
  }

  function handleDelete(userId, displayName) {
    if (!window.confirm(`למחוק את המשתמש ${displayName}?`)) return;
    const formData = new FormData();
    formData.set("targetUserId", userId);
    return runAction(`delete:${userId}`, async () => {
      await onDeleteUser(formData);
      setMessage("המשתמש נמחק.");
    });
  }

  return (
    <div className="card">
      <div className="summary-row" style={{ alignItems: "flex-end", flexWrap: "wrap" }}>
        <div>
          <h2 style={{ marginBottom: 6 }}>משתמשים וסוכנים</h2>
          <p className="muted" style={{ margin: 0 }}>
            חיפוש, מחיקה, הרשאות, שיוך לסוכן, קודי חיבור זמניים והעדפות Telegram / WhatsApp.
          </p>
        </div>
        <div style={{ minWidth: 280 }}>
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="חיפוש לפי שם, מייל, תלמיד, טלגרם או WhatsApp" />
        </div>
      </div>
      {message ? <div className="ok" style={{ marginTop: 12 }}>{message}</div> : null}
      <div style={{ display: "grid", gap: 14, marginTop: 16 }}>
        {filteredUsers.map((user) => (
          <UserCard
            key={user.clerk_user_id}
            user={user}
            currentUserId={currentUserId}
            generatedLinks={generatedLinks}
            onCopy={handleCopy}
            onGenerate={handleGenerate}
            onUnlink={handleUnlink}
            onRoleSave={handleRoleSave}
            onPreferenceSave={handlePreferenceSave}
            onDelete={handleDelete}
            busyKey={busyKey}
          />
        ))}
        {!filteredUsers.length ? <div className="muted">לא נמצאו משתמשים.</div> : null}
      </div>
    </div>
  );
}
