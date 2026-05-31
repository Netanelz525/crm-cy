import Link from "next/link";

export function AdminPageHeader({
  title,
  description,
  backHref = "/admin",
  backLabel = "חזרה לניהול",
  children
}) {
  return (
    <section className="card glass">
      <h1 style={{ marginTop: 0 }}>{title}</h1>
      {description ? (
        <p className="muted" style={{ marginBottom: 0 }}>
          {description}
        </p>
      ) : null}
      <div className="quick-actions">
        <Link className="quick-action-btn quick-action-outline" href={backHref}>
          {backLabel}
        </Link>
        {children}
      </div>
    </section>
  );
}

export function AdminAreaLinkCard({ title, description, href, cta, badge }) {
  return (
    <Link
      href={href}
      className="card"
      style={{
        display: "grid",
        gap: 14,
        borderRadius: 22,
        background: "linear-gradient(180deg, #ffffff, #f7fbff)",
        transition: "transform 160ms ease, box-shadow 160ms ease"
      }}
    >
      <div className="summary-row" style={{ alignItems: "flex-start" }}>
        <div>
          <h2 style={{ margin: 0 }}>{title}</h2>
          <p className="muted" style={{ margin: "8px 0 0" }}>
            {description}
          </p>
        </div>
        {badge ? <span className="meta-chip">{badge}</span> : null}
      </div>
      <div className="student-link" style={{ textDecoration: "none" }}>
        {cta}
      </div>
    </Link>
  );
}
