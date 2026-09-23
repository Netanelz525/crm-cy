import Link from "next/link";
import { requireTeamUser } from "../../../lib/rbac";
import { listKnowledgeArticles } from "../../../lib/knowledge-articles";
import { createKnowledgeArticleAction, updateKnowledgeArticleAction } from "./actions";
import ArticleSlugField from "./article-slug-field";

function clean(value) { return String(value || "").trim(); }

function imageUrl(assetId) {
  return `/api/articles/assets/${encodeURIComponent(clean(assetId))}`;
}

export default async function KnowledgeArticlesAdminPage({ searchParams }) {
  const user = await requireTeamUser();
  if (!user.is_manager && !user.is_super_admin) return null;
  const params = await searchParams;
  const query = clean(params?.q);
  const saved = clean(params?.saved) === "1";
  const error = clean(params?.error);
  const articles = await listKnowledgeArticles({ query });

  return (
    <>
      <div className="card glass">
        <div className="student-topbar">
          <div>
            <h1>מאמרי מידע לתלמידים</h1>
            <p className="muted">יצירת תוכן ציבורי לפי נושאים ותגיות. מאמרים מפורסמים זמינים בקישור ציבורי גם ללא התחברות.</p>
          </div>
          <div className="quick-actions">
            <Link className="quick-action-btn quick-action-outline" href="/articles">תצוגה ציבורית</Link>
            <Link className="quick-action-btn quick-action-outline" href="/admin">חזרה לניהול</Link>
          </div>
        </div>
        <div className="student-meta-line">
          <span className="meta-chip">סה״כ מאמרים: {articles.length}</span>
          <span className="meta-chip">הרשאה: {user.is_super_admin ? "סופר אדמין" : "מנהל"}</span>
        </div>
      </div>

      {saved ? <div className="ok">המאמר נשמר בהצלחה.</div> : null}
      {error ? <div className="error">{error}</div> : null}

      <details className="card glass knowledge-article-editor" open={!saved}>
        <summary><strong>יצירת מאמר חדש</strong><span className="muted">מאמר חדש נשמר כטיוטה אלא אם בוחרים לפרסם</span></summary>
        <form action={createKnowledgeArticleAction} encType="multipart/form-data" className="grid">
          <input name="title" placeholder="כותרת המאמר" required />
          <ArticleSlugField />
          <input name="tags" placeholder="תגיות, מופרדות בפסיקים" />
          <input name="excerpt" placeholder="תקציר קצר לתצוגה ברשימה" style={{ gridColumn: "1 / -1" }} />
          <textarea name="bodyText" placeholder="תוכן המאמר" required style={{ minHeight: 220, gridColumn: "1 / -1" }} />
          <label className="knowledge-article-upload">
            <span>תמונות למאמר</span>
            <input name="images" type="file" accept="image/png,image/jpeg,image/webp,image/gif" multiple />
            <small className="muted">עד 5MB לתמונה. התמונות יישמרו ב־R2.</small>
          </label>
          <label className="knowledge-article-status"><span>מצב</span><select name="status" defaultValue="draft"><option value="draft">טיוטה</option><option value="published">פרסם לציבור</option></select></label>
          <button type="submit">שמור מאמר</button>
        </form>
      </details>

      <section className="card glass">
        <div className="student-topbar">
          <h2>מאמרים קיימים</h2>
          <form className="quick-actions" method="get"><input name="q" defaultValue={query} placeholder="חיפוש מאמר" /><button type="submit">חפש</button></form>
        </div>
        <div className="knowledge-article-admin-list">
          {articles.map((article) => (
            <details key={article.id} className="knowledge-article-admin-card">
              <summary><span><strong>{article.title}</strong><small>{article.status === "published" ? "פורסם לציבור" : "טיוטה"} · {article.tags.join(" · ") || "ללא תגיות"}</small></span><span className="meta-chip">/{article.slug}</span></summary>
              <form action={updateKnowledgeArticleAction} encType="multipart/form-data" className="grid">
                <input type="hidden" name="id" value={article.id} />
                <input name="title" defaultValue={article.title} placeholder="כותרת" required />
                <ArticleSlugField defaultValue={article.slug} />
                <input name="tags" defaultValue={article.tags.join(", ")} placeholder="תגיות" />
                <input name="excerpt" defaultValue={article.excerpt} placeholder="תקציר" style={{ gridColumn: "1 / -1" }} />
                <textarea name="bodyText" defaultValue={article.bodyText} required style={{ minHeight: 180, gridColumn: "1 / -1" }} />
                <label><span>מצב</span><select name="status" defaultValue={article.status}><option value="draft">טיוטה</option><option value="published">פורסם לציבור</option></select></label>
                <label>הוספת תמונות<input name="images" type="file" accept="image/png,image/jpeg,image/webp,image/gif" multiple /></label>
                <button type="submit">שמור שינויים</button>
                {article.status === "published" ? <Link className="btn btn-ghost" href={`/articles/${encodeURIComponent(article.slug)}`} target="_blank">פתח מאמר ציבורי</Link> : null}
              </form>
              {article.assets.length ? <div className="knowledge-article-thumbnails">{article.assets.map((asset) => <img key={asset.id} src={imageUrl(asset.id)} alt={asset.fileName} />)}</div> : null}
            </details>
          ))}
          {!articles.length ? <p className="muted">אין מאמרים עדיין.</p> : null}
        </div>
      </section>
    </>
  );
}
