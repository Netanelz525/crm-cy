import { listAppUsers, listPendingUnknownUsers, requireTeamUser } from "../../lib/rbac";
import { approveUserAction, setEditPermissionAction } from "./actions";

export default async function AdminPage() {
  const currentUser = await requireTeamUser();
  const pendingUsers = await listPendingUnknownUsers();
  const users = await listAppUsers();

  return (
    <>
      <div className="card">
        <h1>TEAM Management</h1>
        <p className="muted">
          Only TEAM users can approve unknown users and update permissions.
          <br />
          Signed in as: {currentUser.display_name}
        </p>
      </div>

      <div className="card">
        <h2>Pending unknown users</h2>
        <table>
          <thead>
            <tr>
              <th>Name</th>
              <th>Email</th>
              <th>Status</th>
              <th>Can Edit</th>
              <th>Action</th>
            </tr>
          </thead>
          <tbody>
            {!pendingUsers.length ? (
              <tr>
                <td colSpan={5} className="muted">
                  No pending users.
                </td>
              </tr>
            ) : (
              pendingUsers.map((u) => (
                <tr key={u.clerk_user_id}>
                  <td>{u.display_name}</td>
                  <td>{u.email}</td>
                  <td>{u.access_status}</td>
                  <td>{u.can_edit_own_card ? "Yes" : "No"}</td>
                  <td>
                    <div style={{ display: "grid", gap: 8 }}>
                      <form action={approveUserAction}>
                        <input type="hidden" name="targetUserId" value={u.clerk_user_id} />
                        <input type="hidden" name="withEdit" value="0" />
                        <button type="submit">Approve user</button>
                      </form>
                      <form action={approveUserAction}>
                        <input type="hidden" name="targetUserId" value={u.clerk_user_id} />
                        <input type="hidden" name="withEdit" value="1" />
                        <button type="submit">Approve + edit</button>
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
        <h2>All users</h2>
        <table>
          <thead>
            <tr>
              <th>Name</th>
              <th>Email</th>
              <th>Status</th>
              <th>Linked Student</th>
              <th>Class</th>
              <th>Own Card Edit</th>
              <th>Action</th>
            </tr>
          </thead>
          <tbody>
            {!users.length ? (
              <tr>
                <td colSpan={7} className="muted">
                  No data
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
                  <td>{u.can_edit_own_card ? "Yes" : "No"}</td>
                  <td>
                    {String(u.linked_student_class || "").toUpperCase() === "TEAM" ? (
                      "-"
                    ) : (
                      <form action={setEditPermissionAction}>
                        <input type="hidden" name="targetUserId" value={u.clerk_user_id} />
                        <input type="hidden" name="enabled" value={u.can_edit_own_card ? "0" : "1"} />
                        <button type="submit">{u.can_edit_own_card ? "Disable edit" : "Enable edit"}</button>
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
