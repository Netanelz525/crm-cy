import Link from "next/link";
import { setEditPermissionAction } from "./actions";

export default function AllUsersCard({ currentUser, users }) {
  return (
    <div className="card">
      <h2>כל המשתמשים</h2>
      {currentUser.is_super_admin ? (
        <div className="muted" style={{ marginBottom: 12 }}>
          לניהול מלא של משתמש וסוכן, עברו מתוך רשימת המשתמשים העליונה לעמוד המשתמש.
        </div>
      ) : null}

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
                <td colSpan={7} className="muted">אין נתונים</td>
              </tr>
            ) : (
              users.map((user) => (
                <tr key={user.clerk_user_id}>
                  <td>{user.display_name}</td>
                  <td>{user.email}</td>
                  <td>{user.access_status}</td>
                  <td>{user.linked_student_id || "-"}</td>
                  <td>{user.linked_student_class || "-"}</td>
                  <td>{user.can_edit_own_card ? "כן" : "לא"}</td>
                  <td>
                    {currentUser.is_super_admin ? (
                      <Link href={`/admin/users/${encodeURIComponent(user.clerk_user_id)}`}>עמוד משתמש</Link>
                    ) : String(user.linked_student_class || "").toUpperCase() === "TEAM" ? (
                      "-"
                    ) : (
                      <form action={setEditPermissionAction}>
                        <input type="hidden" name="targetUserId" value={user.clerk_user_id} />
                        <input type="hidden" name="enabled" value={user.can_edit_own_card ? "0" : "1"} />
                        <button type="submit">{user.can_edit_own_card ? "בטל עריכה" : "אפשר עריכה"}</button>
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
          users.map((user) => (
            <div key={user.clerk_user_id} className="generic-mobile-card">
              <div className="generic-mobile-head">{user.display_name}</div>
              <div className="generic-mobile-grid">
                <div><b>אימייל:</b> {user.email}</div>
                <div><b>סטטוס:</b> {user.access_status}</div>
                <div><b>תלמיד מקושר:</b> {user.linked_student_id || "-"}</div>
                <div><b>שיעור:</b> {user.linked_student_class || "-"}</div>
                <div><b>עריכת כרטיס עצמי:</b> {user.can_edit_own_card ? "כן" : "לא"}</div>
              </div>
              {currentUser.is_super_admin ? (
                <Link className="quick-action-btn quick-action-outline" href={`/admin/users/${encodeURIComponent(user.clerk_user_id)}`}>
                  עמוד משתמש
                </Link>
              ) : String(user.linked_student_class || "").toUpperCase() === "TEAM" ? null : (
                <form action={setEditPermissionAction}>
                  <input type="hidden" name="targetUserId" value={user.clerk_user_id} />
                  <input type="hidden" name="enabled" value={user.can_edit_own_card ? "0" : "1"} />
                  <button type="submit">{user.can_edit_own_card ? "בטל עריכה" : "אפשר עריכה"}</button>
                </form>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
