import { listApiTokens } from "../../lib/api-tokens";
import { getResendConfigStatus } from "../../lib/resend";
import { listAppUsers, listPendingUnknownUsers, requireTeamUser } from "../../lib/rbac";
import ApiAccessClient from "./api-access-client";
import UserManagementClient from "./user-management-client";
import {
  approveUserAction,
  deleteUserAction,
  generateUserTelegramLinkCodeAction,
  generateUserWhatsAppLinkCodeAction,
  revokeApiTokenAction,
  sendResendTestEmailAction,
  setEditPermissionAction,
  unlinkUserTelegramAction,
  unlinkUserWhatsAppAction,
  updateUserAgentPreferencesAction,
  updateUserRoleAction
} from "./actions";

export default async function AdminPage({ searchParams }) {
  const currentUser = await requireTeamUser();
  const resolvedSearchParams = await searchParams;
  const pendingUsers = await listPendingUnknownUsers();
  const users = await listAppUsers();
  const apiTokens = await listApiTokens();
  const apiBaseUrl = process.env.CRM_BASE_URL || process.env.APP_BASE_URL || "http://localhost:3000";
  const emailSent = String(resolvedSearchParams?.emailSent || "") === "1";
  const emailError = String(resolvedSearchParams?.emailError || "");
  const resendStatus = getResendConfigStatus();

  return (
    <>
      <div className="card glass">
        <h1>ניהול TEAM</h1>
        <p className="muted">
          רק משתמשי TEAM יכולים לאשר משתמשים לא מוכרים, לעדכן הרשאות, ולנהל גישת API ל-CRM.
          <br />
          מחובר: {currentUser.display_name}
        </p>
        {currentUser.is_super_admin ? (
          <div className="student-meta-line">
            <span className="meta-chip meta-chip-strong">סופר אדמין</span>
          </div>
        ) : null}
      </div>

      {currentUser.is_super_admin ? (
        <UserManagementClient
          users={users}
          currentUserId={currentUser.clerk_user_id}
          onGenerateTelegramCode={generateUserTelegramLinkCodeAction}
          onGenerateWhatsAppCode={generateUserWhatsAppLinkCodeAction}
          onUnlinkTelegram={unlinkUserTelegramAction}
          onUnlinkWhatsApp={unlinkUserWhatsAppAction}
          onSaveRole={updateUserRoleAction}
          onSavePreferences={updateUserAgentPreferencesAction}
          onDeleteUser={deleteUserAction}
        />
      ) : null}

      {emailSent ? <div className="ok">מייל הבדיקה נשלח בהצלחה.</div> : null}
      {emailError ? <div className="card muted">{emailError}</div> : null}

      <ApiAccessClient apiBaseUrl={apiBaseUrl} />

      <div className="card">
        <h2>שליחת מיילים</h2>
        <p className="muted">
          שליחה דרך Resend לאירועים והתראות מערכת. בהמשך אפשר לחבר את אותו מנגנון לאירועים אוטומטיים.
        </p>
        <div className="muted" style={{ marginTop: 8 }}>
          סטטוס: {resendStatus.configured ? "מוגדר" : "חסר API key"}
          {resendStatus.fromEmail ? ` | שולח: ${resendStatus.fromEmail}` : ""}
        </div>
        {!resendStatus.configured ? (
          <div className="muted" style={{ marginTop: 8 }}>
            יש להגדיר ב-ENV: {resendStatus.missing.join(", ")}
          </div>
        ) : null}
        <form action={sendResendTestEmailAction} className="grid" style={{ marginTop: 16 }}>
          <input
            name="to"
            type="email"
            defaultValue={currentUser.email || ""}
            placeholder="כתובת מייל לבדיקה"
            dir="ltr"
          />
          <input
            name="subject"
            defaultValue="בדיקת מייל מה-CRM"
            placeholder="נושא"
          />
          <textarea
            name="message"
            rows={5}
            defaultValue={"שלום,\nזהו מייל בדיקה ממערכת ה-CRM דרך Resend."}
            placeholder="תוכן ההודעה"
          />
          <button type="submit" disabled={!resendStatus.configured}>שלח מייל בדיקה</button>
        </form>
      </div>

      <div className="card">
        <h2>טוקני API פעילים והיסטוריים</h2>

        <div className="desktop-table">
          <table>
            <thead>
              <tr>
                <th>שם</th>
                <th>Prefix</th>
                <th>Scopes</th>
                <th>נוצר</th>
                <th>שימוש אחרון</th>
                <th>סטטוס</th>
                <th>פעולה</th>
              </tr>
            </thead>
            <tbody>
              {!apiTokens.length ? (
                <tr>
                  <td colSpan={7} className="muted">עדיין אין טוקנים.</td>
                </tr>
              ) : (
                apiTokens.map((token) => (
                  <tr key={token.id}>
                    <td>{token.label}</td>
                    <td><code>{token.token_prefix}</code></td>
                    <td>{Array.isArray(token.scopes) ? token.scopes.join(", ") : "-"}</td>
                    <td>{token.created_at ? new Date(token.created_at).toLocaleString("he-IL") : "-"}</td>
                    <td>{token.last_used_at ? new Date(token.last_used_at).toLocaleString("he-IL") : "-"}</td>
                    <td>{token.revoked_at ? "מבוטל" : "פעיל"}</td>
                    <td>
                      {token.revoked_at ? "-" : (
                        <form action={revokeApiTokenAction}>
                          <input type="hidden" name="tokenId" value={token.id} />
                          <button type="submit">בטל טוקן</button>
                        </form>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        <div className="mobile-generic-list">
          {!apiTokens.length ? (
            <div className="card muted">עדיין אין טוקנים.</div>
          ) : (
            apiTokens.map((token) => (
              <div key={token.id} className="generic-mobile-card">
                <div className="generic-mobile-head">{token.label}</div>
                <div className="generic-mobile-grid">
                  <div><b>Prefix:</b> <code>{token.token_prefix}</code></div>
                  <div><b>Scopes:</b> {Array.isArray(token.scopes) ? token.scopes.join(", ") : "-"}</div>
                  <div><b>נוצר:</b> {token.created_at ? new Date(token.created_at).toLocaleString("he-IL") : "-"}</div>
                  <div><b>שימוש אחרון:</b> {token.last_used_at ? new Date(token.last_used_at).toLocaleString("he-IL") : "-"}</div>
                  <div><b>סטטוס:</b> {token.revoked_at ? "מבוטל" : "פעיל"}</div>
                </div>
                {!token.revoked_at ? (
                  <form action={revokeApiTokenAction}>
                    <input type="hidden" name="tokenId" value={token.id} />
                    <button type="submit">בטל טוקן</button>
                  </form>
                ) : null}
              </div>
            ))
          )}
        </div>
      </div>

      <div className="card">
        <h2>משתמשים לא מוכרים שממתינים לאישור</h2>

        <div className="desktop-table">
          <table>
            <thead>
              <tr>
                <th>שם</th>
                <th>אימייל</th>
                <th>סטטוס</th>
                <th>עריכה</th>
                <th>פעולה</th>
              </tr>
            </thead>
            <tbody>
              {!pendingUsers.length ? (
                <tr>
                  <td colSpan={5} className="muted">
                    אין משתמשים ממתינים.
                  </td>
                </tr>
              ) : (
                pendingUsers.map((u) => (
                  <tr key={u.clerk_user_id}>
                    <td>{u.display_name}</td>
                    <td>{u.email}</td>
                    <td>{u.access_status}</td>
                    <td>{u.can_edit_own_card ? "כן" : "לא"}</td>
                    <td>
                      <div style={{ display: "grid", gap: 8 }}>
                        <form action={approveUserAction}>
                          <input type="hidden" name="targetUserId" value={u.clerk_user_id} />
                          <input type="hidden" name="withEdit" value="0" />
                          <button type="submit">אשר משתמש</button>
                        </form>
                        <form action={approveUserAction}>
                          <input type="hidden" name="targetUserId" value={u.clerk_user_id} />
                          <input type="hidden" name="withEdit" value="1" />
                          <button type="submit">אשר + עריכה</button>
                        </form>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        <div className="mobile-generic-list">
          {!pendingUsers.length ? (
            <div className="card muted">אין משתמשים ממתינים.</div>
          ) : (
            pendingUsers.map((u) => (
              <div key={u.clerk_user_id} className="generic-mobile-card">
                <div className="generic-mobile-head">{u.display_name}</div>
                <div className="generic-mobile-grid">
                  <div><b>אימייל:</b> {u.email}</div>
                  <div><b>סטטוס:</b> {u.access_status}</div>
                  <div><b>עריכה:</b> {u.can_edit_own_card ? "כן" : "לא"}</div>
                </div>
                <div style={{ display: "grid", gap: 8 }}>
                  <form action={approveUserAction}>
                    <input type="hidden" name="targetUserId" value={u.clerk_user_id} />
                    <input type="hidden" name="withEdit" value="0" />
                    <button type="submit">אשר משתמש</button>
                  </form>
                  <form action={approveUserAction}>
                    <input type="hidden" name="targetUserId" value={u.clerk_user_id} />
                    <input type="hidden" name="withEdit" value="1" />
                    <button type="submit">אשר + עריכה</button>
                  </form>
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      <div className="card">
        <h2>כל המשתמשים</h2>

        <div className="desktop-table">
          <table>
            <thead>
              <tr>
                <th>שם</th>
                <th>אימייל</th>
                <th>סטטוס</th>
                <th>תלמיד מקושר</th>
                <th>שיעור</th>
                <th>עריכת כרטיס עצמי</th>
                <th>פעולה</th>
              </tr>
            </thead>
            <tbody>
              {!users.length ? (
                <tr>
                  <td colSpan={7} className="muted">
                    אין נתונים
                  </td>
                </tr>
              ) : (
                users.map((u) => (
                  <tr key={u.clerk_user_id}>
                    <td>{u.display_name}</td>
                    <td>{u.email}</td>
                    <td>{u.access_status}</td>
                    <td>{u.linked_student_id || "-"}</td>
                    <td>{u.linked_student_class || "-"}</td>
                    <td>{u.can_edit_own_card ? "כן" : "לא"}</td>
                    <td>
                      {String(u.linked_student_class || "").toUpperCase() === "TEAM" ? (
                        "-"
                      ) : (
                        <form action={setEditPermissionAction}>
                          <input type="hidden" name="targetUserId" value={u.clerk_user_id} />
                          <input type="hidden" name="enabled" value={u.can_edit_own_card ? "0" : "1"} />
                          <button type="submit">{u.can_edit_own_card ? "בטל עריכה" : "אפשר עריכה"}</button>
                        </form>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        <div className="mobile-generic-list">
          {!users.length ? (
            <div className="card muted">אין נתונים</div>
          ) : (
            users.map((u) => (
              <div key={u.clerk_user_id} className="generic-mobile-card">
                <div className="generic-mobile-head">{u.display_name}</div>
                <div className="generic-mobile-grid">
                  <div><b>אימייל:</b> {u.email}</div>
                  <div><b>סטטוס:</b> {u.access_status}</div>
                  <div><b>תלמיד מקושר:</b> {u.linked_student_id || "-"}</div>
                  <div><b>שיעור:</b> {u.linked_student_class || "-"}</div>
                  <div><b>עריכת כרטיס עצמי:</b> {u.can_edit_own_card ? "כן" : "לא"}</div>
                </div>
                {String(u.linked_student_class || "").toUpperCase() !== "TEAM" ? (
                  <form action={setEditPermissionAction}>
                    <input type="hidden" name="targetUserId" value={u.clerk_user_id} />
                    <input type="hidden" name="enabled" value={u.can_edit_own_card ? "0" : "1"} />
                    <button type="submit">{u.can_edit_own_card ? "בטל עריכה" : "אפשר עריכה"}</button>
                  </form>
                ) : null}
              </div>
            ))
          )}
        </div>
      </div>
    </>
  );
}
