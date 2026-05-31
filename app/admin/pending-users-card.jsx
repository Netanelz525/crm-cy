import { approveUserAction } from "./actions";

export default function PendingUsersCard({ pendingUsers }) {
  return (
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
                <td colSpan={5} className="muted">אין משתמשים ממתינים.</td>
              </tr>
            ) : (
              pendingUsers.map((user) => (
                <tr key={user.clerk_user_id}>
                  <td>{user.display_name}</td>
                  <td>{user.email}</td>
                  <td>{user.access_status}</td>
                  <td>{user.can_edit_own_card ? "כן" : "לא"}</td>
                  <td>
                    <div style={{ display: "grid", gap: 8 }}>
                      <form action={approveUserAction}>
                        <input type="hidden" name="targetUserId" value={user.clerk_user_id} />
                        <input type="hidden" name="withEdit" value="0" />
                        <button type="submit">אשר משתמש</button>
                      </form>
                      <form action={approveUserAction}>
                        <input type="hidden" name="targetUserId" value={user.clerk_user_id} />
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
          pendingUsers.map((user) => (
            <div key={user.clerk_user_id} className="generic-mobile-card">
              <div className="generic-mobile-head">{user.display_name}</div>
              <div className="generic-mobile-grid">
                <div><b>אימייל:</b> {user.email}</div>
                <div><b>סטטוס:</b> {user.access_status}</div>
                <div><b>עריכה:</b> {user.can_edit_own_card ? "כן" : "לא"}</div>
              </div>
              <div style={{ display: "grid", gap: 8 }}>
                <form action={approveUserAction}>
                  <input type="hidden" name="targetUserId" value={user.clerk_user_id} />
                  <input type="hidden" name="withEdit" value="0" />
                  <button type="submit">אשר משתמש</button>
                </form>
                <form action={approveUserAction}>
                  <input type="hidden" name="targetUserId" value={user.clerk_user_id} />
                  <input type="hidden" name="withEdit" value="1" />
                  <button type="submit">אשר + עריכה</button>
                </form>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
