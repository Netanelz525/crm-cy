import Link from "next/link";
import { listKnowledgeArticles } from "../../lib/knowledge-articles";

function clean(value) { return String(value || "").trim(); }

export const dynamic = "force-dynamic";

export default async function PublicArticlesPage({ searchParams }) {
  const params = await searchParams;
  const tag = clean(params?.tag);
  const query = clean(params?.q);
  const articles = await listKnowledgeArticles({ publicOnly: true, tag, query });
  const tags = Array.from(new Set(articles.flatMap((article) => article.tags))).sort((a, b) => a.localeCompare(b, "he"));
  return (
    <>
      <div className="public-article-hero">
        <span className="eyebrow">מרכז מידע</span>
        <h1>מאמרים שימושיים</h1>
        <p>מידע, הסברים ועדכונים לתלמידים ולמשפחות.</p>
      </div>
      <div className="public-article-toolbar">
        <form method="get"><input name="q" defaultValue={query} placeholder="חיפוש במאמרים" /><button type="submit">חפש</button></form>
        <div className="public-article-tags"><Link className={!tag ? "active" : ""} href="/articles">הכול</Link>{tags.map((item) => <Link key={item} className={tag === item ? "active" : ""} href={`/articles?tag=${encodeURIComponent(item)}`}>{item}</Link>)}</div>
      </div>
      <div className="public-article-grid">
        {articles.map((article) => (
          <Link key={article.id} href={`/articles/${encodeURIComponent(article.slug)}`} className="public-article-card">
            {article.assets[0] ? <img src={`/api/articles/assets/${encodeURIComponent(article.assets[0].id)}`} alt="" /> : null}
            <div><div className="public-article-card-tags">{article.tags.map((item) => <span key={item}>{item}</span>)}</div><h2>{article.title}</h2><p>{article.excerpt || article.bodyText.slice(0, 180)}</p><span className="public-article-read">קרא עוד</span></div>
          </Link>
        ))}
        {!articles.length ? <div className="card glass"><p className="muted">לא נמצאו מאמרים שפורסמו.</p></div> : null}
      </div>
    </>
  );
}
