import { revokeApiTokenAction } from "./actions";

function formatDateTime(value) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleString("he-IL");
}

export default function ApiTokensCard({ apiTokens }) {
  return (
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
                  <td>{formatDateTime(token.created_at)}</td>
                  <td>{formatDateTime(token.last_used_at)}</td>
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
                <div><b>נוצר:</b> {formatDateTime(token.created_at)}</div>
                <div><b>שימוש אחרון:</b> {formatDateTime(token.last_used_at)}</div>
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
  );
}
