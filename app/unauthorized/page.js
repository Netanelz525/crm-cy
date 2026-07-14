import Link from "next/link";
import UnauthorizedSignOutAction from "./sign-out-action";

export default function UnauthorizedPage() {
  return (
    <div className="card unauthorized-card">
      <h1>אין הרשאה</h1>
      <p className="muted">אין לך הרשאה לעמוד זה. פנה למנהל המערכת.</p>
      <div className="unauthorized-actions">
        <Link className="btn btn-primary" href="/print">
          הדפסה בתשלום
        </Link>
        <UnauthorizedSignOutAction />
        <Link className="btn btn-ghost" href="/sign-in">
          מעבר להתחברות
        </Link>
      </div>
    </div>
  );
}
