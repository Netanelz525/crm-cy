import Link from "next/link";
import { notFound } from "next/navigation";
import { getKnowledgeArticleBySlug } from "../../../lib/knowledge-articles";

export const dynamic = "force-dynamic";

export default async function PublicArticlePage({ params }) {
  const resolved = await params;
  const article = await getKnowledgeArticleBySlug(resolved?.slug, { publicOnly: true });
  if (!article) notFound();
  return (
    <article className="public-article-page">
      <Link className="quick-action-btn quick-action-outline" href="/articles">חזרה למרכז המידע</Link>
      <header><div className="public-article-card-tags">{article.tags.map((item) => <span key={item}>{item}</span>)}</div><h1>{article.title}</h1>{article.excerpt ? <p className="public-article-lead">{article.excerpt}</p> : null}</header>
      {article.assets.map((asset) => <img key={asset.id} className="public-article-image" src={`/api/articles/assets/${encodeURIComponent(asset.id)}`} alt={asset.fileName} />)}
      <div className="public-article-body">{article.bodyText.split(/\n{2,}/).map((paragraph, index) => <p key={index}>{paragraph.split("\n").map((line, lineIndex) => <span key={lineIndex}>{line}{lineIndex < paragraph.split("\n").length - 1 ? <br /> : null}</span>)}</p>)}</div>
    </article>
  );
}
