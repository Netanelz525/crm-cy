import { sql, initDb } from "./db";

function clean(value) {
  return String(value || "").trim();
}

function normalizeTags(values) {
  const list = Array.isArray(values) ? values : String(values || "").split(",");
  return Array.from(new Set(list.map((value) => clean(value).replace(/\s+/g, " ")).filter(Boolean))).slice(0, 30);
}

function mapAsset(row) {
  if (!row) return null;
  return {
    id: clean(row.id),
    articleId: clean(row.article_id),
    fileName: clean(row.file_name),
    contentType: clean(row.content_type) || "application/octet-stream",
    sizeBytes: Number(row.size_bytes || 0),
    objectKey: clean(row.object_key),
    sortOrder: Number(row.sort_order || 0)
  };
}

function mapArticle(row, assets = []) {
  if (!row) return null;
  return {
    id: clean(row.id),
    slug: clean(row.slug),
    title: clean(row.title),
    excerpt: clean(row.excerpt),
    bodyText: String(row.body_text || ""),
    status: clean(row.status) || "draft",
    tags: normalizeTags(row.tags),
    coverObjectKey: clean(row.cover_object_key),
    createdByUserId: clean(row.created_by_user_id),
    updatedByUserId: clean(row.updated_by_user_id),
    publishedAt: row.published_at || null,
    createdAt: row.created_at || null,
    updatedAt: row.updated_at || null,
    assets: assets.map(mapAsset).filter(Boolean)
  };
}

async function loadAssets(articleIds = []) {
  const ids = articleIds.map(clean).filter(Boolean);
  if (!ids.length) return new Map();
  const rows = await sql`
    SELECT id, article_id, object_key, file_name, content_type, size_bytes, sort_order
    FROM knowledge_article_assets
    WHERE article_id = ANY(${ids})
    ORDER BY sort_order ASC, created_at ASC
  `;
  const map = new Map();
  for (const row of rows) {
    const key = clean(row.article_id);
    map.set(key, [...(map.get(key) || []), row]);
  }
  return map;
}

export async function listKnowledgeArticles({ publicOnly = false, tag = "", query = "" } = {}) {
  await initDb();
  const normalizedTag = clean(tag);
  const normalizedQuery = clean(query);
  const rows = await sql`
    SELECT id, slug, title, excerpt, body_text, status, tags, cover_object_key,
           created_by_user_id, updated_by_user_id, published_at, created_at, updated_at
    FROM knowledge_articles
    WHERE (${!publicOnly} OR status = 'published')
      AND (${!normalizedTag} OR ${normalizedTag} = ANY(COALESCE(tags, ARRAY[]::TEXT[])))
      AND (
        ${!normalizedQuery}
        OR title ILIKE ${`%${normalizedQuery}%`}
        OR excerpt ILIKE ${`%${normalizedQuery}%`}
        OR body_text ILIKE ${`%${normalizedQuery}%`}
      )
    ORDER BY COALESCE(published_at, created_at) DESC, title ASC
  `;
  const assets = await loadAssets(rows.map((row) => row.id));
  return rows.map((row) => mapArticle(row, assets.get(clean(row.id)) || []));
}

export async function getKnowledgeArticleBySlug(slug, { publicOnly = false } = {}) {
  await initDb();
  const normalizedSlug = clean(slug);
  if (!normalizedSlug) return null;
  const rows = await sql`
    SELECT id, slug, title, excerpt, body_text, status, tags, cover_object_key,
           created_by_user_id, updated_by_user_id, published_at, created_at, updated_at
    FROM knowledge_articles
    WHERE slug = ${normalizedSlug}
      AND (${!publicOnly} OR status = 'published')
    LIMIT 1
  `;
  const article = rows[0];
  if (!article) return null;
  const assets = await loadAssets([article.id]);
  return mapArticle(article, assets.get(clean(article.id)) || []);
}

export async function createKnowledgeArticle({ id, slug, title, excerpt, bodyText, tags, status = "draft", createdByUserId, assets = [] }) {
  await initDb();
  const normalizedId = clean(id);
  const normalizedSlug = clean(slug);
  const normalizedTitle = clean(title);
  const normalizedBody = String(bodyText || "").trim();
  const normalizedStatus = status === "published" ? "published" : "draft";
  const publishedAt = normalizedStatus === "published" ? new Date() : null;
  if (!normalizedId || !normalizedSlug || !normalizedTitle || !normalizedBody) throw new Error("יש למלא כותרת ותוכן למאמר.");
  await sql`
    INSERT INTO knowledge_articles (id, slug, title, excerpt, body_text, status, tags, published_at, created_by_user_id, updated_by_user_id)
    VALUES (${normalizedId}, ${normalizedSlug}, ${normalizedTitle}, ${clean(excerpt)}, ${normalizedBody}, ${normalizedStatus}, ${normalizeTags(tags)}, ${publishedAt}, ${clean(createdByUserId) || null}, ${clean(createdByUserId) || null})
  `;
  for (const [index, asset] of assets.entries()) {
    await sql`
      INSERT INTO knowledge_article_assets (id, article_id, object_key, file_name, content_type, size_bytes, sort_order)
      VALUES (${clean(asset.id)}, ${normalizedId}, ${clean(asset.objectKey)}, ${clean(asset.fileName)}, ${clean(asset.contentType)}, ${Number(asset.sizeBytes || 0)}, ${index})
    `;
  }
  return getKnowledgeArticleBySlug(normalizedSlug);
}

export async function updateKnowledgeArticle({ id, slug, title, excerpt, bodyText, tags, status, updatedByUserId }) {
  await initDb();
  const normalizedId = clean(id);
  const normalizedSlug = clean(slug);
  const normalizedStatus = status === "published" ? "published" : "draft";
  await sql`
    UPDATE knowledge_articles
    SET slug = COALESCE(NULLIF(${normalizedSlug}, ''), slug), title = ${clean(title)}, excerpt = ${clean(excerpt)}, body_text = ${String(bodyText || "").trim()},
        tags = ${normalizeTags(tags)}, status = ${normalizedStatus},
        published_at = CASE WHEN ${normalizedStatus} = 'published' THEN COALESCE(published_at, NOW()) ELSE NULL END,
        updated_by_user_id = ${clean(updatedByUserId) || null}, updated_at = NOW()
    WHERE id = ${normalizedId}
  `;
  const rows = await sql`SELECT slug FROM knowledge_articles WHERE id = ${normalizedId} LIMIT 1`;
  return rows[0] ? getKnowledgeArticleBySlug(rows[0].slug) : null;
}

export async function appendKnowledgeArticleAssets(articleId, assets = []) {
  await initDb();
  const normalizedId = clean(articleId);
  if (!normalizedId || !assets.length) return null;
  const orderRows = await sql`
    SELECT COALESCE(MAX(sort_order), -1) AS max_order
    FROM knowledge_article_assets
    WHERE article_id = ${normalizedId}
  `;
  const startOrder = Number(orderRows[0]?.max_order ?? -1) + 1;
  for (const [index, asset] of assets.entries()) {
    await sql`
      INSERT INTO knowledge_article_assets (id, article_id, object_key, file_name, content_type, size_bytes, sort_order)
      VALUES (${clean(asset.id)}, ${normalizedId}, ${clean(asset.objectKey)}, ${clean(asset.fileName)}, ${clean(asset.contentType)}, ${Number(asset.sizeBytes || 0)}, ${startOrder + index})
    `;
  }
  const rows = await sql`SELECT slug FROM knowledge_articles WHERE id = ${normalizedId} LIMIT 1`;
  return rows[0] ? getKnowledgeArticleBySlug(rows[0].slug) : null;
}

export async function getKnowledgeArticleAsset(assetId, { publicOnly = true } = {}) {
  await initDb();
  const rows = await sql`
    SELECT a.id, a.article_id, a.object_key, a.file_name, a.content_type, a.size_bytes, a.sort_order,
           k.status
    FROM knowledge_article_assets a
    JOIN knowledge_articles k ON k.id = a.article_id
    WHERE a.id = ${clean(assetId)}
      AND (${!publicOnly} OR k.status = 'published')
    LIMIT 1
  `;
  return mapAsset(rows[0]);
}
