import { revalidatePath } from "next/cache";
import {
  approveUnknownUser,
  listAppUsers,
  listPendingUnknownUsers,
  requireTeamUser,
  setOwnCardEditPermission
} from "../../lib/rbac";

function clean(v) {
  return String(v || "").trim();
}

export async function approveUserAction(formData) {
  "use server";
  const approver = await requireTeamUser();
  const targetUserId = clean(formData.get("targetUserId"));
  const withEdit = clean(formData.get("withEdit")) === "1";
  if (!targetUserId) return;
  await approveUnknownUser(targetUserId, approver.clerk_user_id, withEdit);
  revalidatePath("/admin");
}

export async function setEditPermissionAction(formData) {
  "use server";
  await requireTeamUser();
  const targetUserId = clean(formData.get("targetUserId"));
  const enabled = clean(formData.get("enabled")) === "1";
  if (!targetUserId) return;
  await setOwnCardEditPermission(targetUserId, enabled);
  revalidatePath("/admin");
}

export default async function AdminPage() {
  const currentUser = await requireTeamUser();
  const pendingUsers = await listPendingUnknownUsers();
  const users = await listAppUsers();

  return (
    <>
      <div className="card">
        <h1>ניהול TEAM</h1>
        <p className="muted">
          רק משתמשי TEAM יכולים לאשר משתמשים לא מוכרים ולעדכן מידע.
          <br />
          מחובר: {currentUser.display_name}
        </p>
      </div>

      <div className="card">
        <h2>משתמשים לא מוכרים שממתינים לאישור</h2>
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

      <div className="card">
        <h2>כל המשתמשים</h2>
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
                  <td>{u.linked_student_id || "—"}</td>
                  <td>{u.linked_student_class || "—"}</td>
                  <td>{u.can_edit_own_card ? "כן" : "לא"}</td>
                  <td>
                    {String(u.linked_student_class || "").toUpperCase() === "TEAM" ? (
                      "—"
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
    </>
  );
}
