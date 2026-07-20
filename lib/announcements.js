import { initDb, sql } from "./db";
import { ANNOUNCEMENT_TEMPLATE_CATALOG, announcementTemplateCatalogRank } from "./announcement-template-catalog";

function clean(value) {
  return String(value || "").trim();
}

function stripHtml(value) {
  return clean(value).replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
}

function parseJson(value, fallback) {
  if (Array.isArray(value) || (value && typeof value === "object")) return value;
  if (!value) return fallback;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function sanitizeInlineStyle(value) {
  const raw = clean(value);
  if (!raw) return "";

  const safeParts = [];
  for (const part of raw.split(";")) {
    const [property, ...rest] = part.split(":");
    const normalizedProperty = clean(property).toLowerCase();
    const normalizedValue = clean(rest.join(":"));
    if (!normalizedProperty || !normalizedValue) continue;

    if (normalizedProperty === "text-align" && ["right", "center", "left"].includes(normalizedValue)) {
      safeParts.push(`text-align:${normalizedValue}`);
      continue;
    }

    if (normalizedProperty === "color" && /^#[0-9a-f]{3,8}$/i.test(normalizedValue)) {
      safeParts.push(`color:${normalizedValue}`);
    }
  }

  return safeParts.join(";");
}

export function sanitizeAnnouncementHtml(value) {
  const raw = String(value || "");
  if (!raw.trim()) return "";
  const cleaned = raw
    .replace(/<script[\s\S]*?>[\s\S]*?<\/script>/gi, "")
    .replace(/\son\w+="[^"]*"/gi, "")
    .replace(/\son\w+='[^']*'/gi, "")
    .trim();

  const allowedTags = new Set(["p", "br", "strong", "b", "em", "i", "u", "h2", "h3", "ul", "ol", "li", "span"]);

  return cleaned.replace(/<\s*(\/?)\s*([a-z0-9]+)([^>]*)>/gi, (_match, closing, tagName, attributes = "") => {
    const tag = clean(tagName).toLowerCase();
    if (!allowedTags.has(tag)) return "";
    if (closing) return `</${tag}>`;
    if (tag === "br") return "<br>";

    const styleMatch = attributes.match(/\sstyle=(?:"([^"]*)"|'([^']*)')/i);
    const safeStyle = sanitizeInlineStyle(styleMatch?.[1] || styleMatch?.[2] || "");
    return safeStyle ? `<${tag} style="${safeStyle}">` : `<${tag}>`;
  });
}

function defaultLayout() {
  return {
    page: {
      size: "A4"
    },
    header: {
      top: 9,
      left: 9,
      right: 9,
      fontSize: 30,
      textAlign: "center",
      fontWeight: 700
    },
    body: {
      top: 27,
      left: 10,
      right: 10,
      bottom: 18,
      fontSize: 24,
      lineHeight: 1.55,
      textAlign: "center"
    },
    footer: {
      bottom: 8,
      left: 9,
      right: 9,
      fontSize: 26,
      textAlign: "center",
      fontWeight: 700
    }
  };
}

function parseLayout(value) {
  const defaults = defaultLayout();
  if (!value) return defaults;
  if (typeof value === "object") {
    return {
      ...defaults,
      ...value,
      header: { ...defaults.header, ...(value.header || {}) },
      body: { ...defaults.body, ...(value.body || {}) },
      footer: { ...defaults.footer, ...(value.footer || {}) }
    };
  }
  try {
    const parsed = JSON.parse(value);
    return parseLayout(parsed);
  } catch {
    return defaults;
  }
}

function mapTemplateRow(row) {
  if (!row) return null;
  const fields = parseJson(row.fields_json, []);
  return {
    id: clean(row.id),
    name: clean(row.name),
    templateKey: clean(row.template_key) || clean(row.id),
    generatorName: clean(row.generator_name),
    category: clean(row.category),
    version: Number(row.version || 1),
    engine: clean(row.engine) || "local-pdf",
    active: row.active !== false,
    fields: Array.isArray(fields) ? fields : [],
    headerText: clean(row.header_text),
    footerText: clean(row.footer_text),
    blankObjectKey: clean(row.blank_object_key),
    blankContentType: clean(row.blank_content_type),
    layout: parseLayout(row.layout_json),
    createdByUserId: clean(row.created_by_user_id),
    createdAt: row.created_at || null,
    updatedAt: row.updated_at || null
  };
}

function mapAnnouncementRow(row) {
  if (!row) return null;
  const templateFields = parseJson(row.template_fields_json, {});
  return {
    id: clean(row.id),
    title: clean(row.title),
    announcementDate: row.announcement_date || null,
    bodyText: clean(row.body_text),
    bodyHtml: sanitizeAnnouncementHtml(row.body_html),
    layoutOverride: parseLayout(row.layout_override_json),
    templateId: clean(row.template_id),
    templateKey: clean(row.template_key),
    templateFields: templateFields && typeof templateFields === "object" && !Array.isArray(templateFields) ? templateFields : {},
    templateName: clean(row.template_name),
    templateGeneratorName: clean(row.template_generator_name),
    templateCategory: clean(row.template_category),
    printJobId: clean(row.print_job_id),
    printJobStatus: clean(row.print_job_status),
    queuedAt: row.queued_at || null,
    createdByUserId: clean(row.created_by_user_id),
    createdAt: row.created_at || null,
    updatedAt: row.updated_at || null
  };
}

async function ensureAnnouncementTemplateCatalog() {
  await initDb();

  for (const template of ANNOUNCEMENT_TEMPLATE_CATALOG) {
    const existingRows = await sql`
      SELECT id, name, template_key, generator_name, category, version, engine, active, fields_json
      FROM announcement_templates
      WHERE id = ${template.templateKey}
        OR template_key = ${template.templateKey}
        OR name = ${template.name}
      ORDER BY CASE WHEN id = ${template.templateKey} THEN 0 ELSE 1 END
      LIMIT 1
    `;
    const existing = existingRows[0];
    const existingId = clean(existing?.id);

    if (existingId) {
      const existingFields = parseJson(existing.fields_json, []);
      const isCurrent =
        clean(existing.name) === template.name
        && clean(existing.template_key) === template.templateKey
        && clean(existing.generator_name) === template.generatorName
        && clean(existing.category) === template.category
        && Number(existing.version || 1) === template.version
        && clean(existing.engine) === template.engine
        && existing.active === template.active
        && JSON.stringify(existingFields) === JSON.stringify(template.fields);
      if (isCurrent) continue;

      await sql`
        UPDATE announcement_templates
        SET
          name = ${template.name},
          header_text = ${template.generatorName},
          footer_text = '',
          template_key = ${template.templateKey},
          generator_name = ${template.generatorName},
          category = ${template.category},
          version = ${template.version},
          engine = ${template.engine},
          active = ${template.active},
          fields_json = ${JSON.stringify(template.fields)}::jsonb,
          updated_at = NOW()
        WHERE id = ${existingId}
      `;
      continue;
    }

    await sql`
      INSERT INTO announcement_templates (
        id,
        name,
        header_text,
        footer_text,
        layout_json,
        template_key,
        generator_name,
        category,
        version,
        engine,
        active,
        fields_json
      )
      VALUES (
        ${template.templateKey},
        ${template.name},
        ${template.generatorName},
        '',
        ${JSON.stringify(defaultLayout())}::jsonb,
        ${template.templateKey},
        ${template.generatorName},
        ${template.category},
        ${template.version},
        ${template.engine},
        ${template.active},
        ${JSON.stringify(template.fields)}::jsonb
      )
    `;
  }
}

export async function listAnnouncementTemplates() {
  await ensureAnnouncementTemplateCatalog();
  const rows = await sql`
    SELECT id, name, template_key, generator_name, category, version, engine, active, fields_json, header_text, footer_text, blank_object_key, blank_content_type, layout_json, created_by_user_id, created_at, updated_at
    FROM announcement_templates
    WHERE active = TRUE
      AND COALESCE(template_key, '') <> ''
    ORDER BY category ASC, name ASC
  `;
  return rows
    .map(mapTemplateRow)
    .filter(Boolean)
    .sort((a, b) => announcementTemplateCatalogRank(a.templateKey) - announcementTemplateCatalogRank(b.templateKey));
}

export async function getAnnouncementTemplateById(templateId) {
  await ensureAnnouncementTemplateCatalog();
  const rows = await sql`
    SELECT id, name, template_key, generator_name, category, version, engine, active, fields_json, header_text, footer_text, blank_object_key, blank_content_type, layout_json, created_by_user_id, created_at, updated_at
    FROM announcement_templates
    WHERE id = ${clean(templateId)}
      OR template_key = ${clean(templateId)}
    LIMIT 1
  `;
  return mapTemplateRow(rows[0]);
}

export async function createAnnouncementTemplate({
  id,
  name,
  headerText,
  footerText,
  blankObjectKey,
  blankContentType,
  layout,
  createdByUserId
}) {
  await initDb();
  const normalizedId = clean(id);
  const normalizedName = clean(name);
  if (!normalizedId || !normalizedName) throw new Error("חסרים מזהה או שם תבנית");

  await sql`
    INSERT INTO announcement_templates (
      id,
      name,
      header_text,
      footer_text,
      blank_object_key,
      blank_content_type,
      layout_json,
      created_by_user_id
    )
    VALUES (
      ${normalizedId},
      ${normalizedName},
      ${clean(headerText)},
      ${clean(footerText)},
      ${clean(blankObjectKey)},
      ${clean(blankContentType)},
      ${JSON.stringify(parseLayout(layout))}::jsonb,
      ${clean(createdByUserId)}
    )
  `;

  return getAnnouncementTemplateById(normalizedId);
}

export async function updateAnnouncementTemplate(templateId, updates = {}) {
  await initDb();
  const current = await getAnnouncementTemplateById(templateId);
  if (!current) return null;

  const next = {
    ...current,
    ...updates,
    layout: parseLayout(updates.layout || current.layout)
  };

  await sql`
    UPDATE announcement_templates
    SET
      name = ${clean(next.name)},
      header_text = ${clean(next.headerText)},
      footer_text = ${clean(next.footerText)},
      blank_object_key = ${clean(next.blankObjectKey)},
      blank_content_type = ${clean(next.blankContentType)},
      layout_json = ${JSON.stringify(next.layout)}::jsonb,
      updated_at = NOW()
    WHERE id = ${clean(templateId)}
  `;

  return getAnnouncementTemplateById(templateId);
}

export async function listAnnouncements(search = "") {
  await ensureAnnouncementTemplateCatalog();
  const term = `%${clean(search)}%`;
  const rows = await sql`
    SELECT
      a.id,
      a.title,
      a.announcement_date,
      a.body_text,
      a.body_html,
      a.layout_override_json,
      a.template_id,
      a.template_key,
      a.template_fields_json,
      a.print_job_id,
      a.queued_at,
      t.name AS template_name,
      t.generator_name AS template_generator_name,
      t.category AS template_category,
      p.status AS print_job_status,
      a.created_by_user_id,
      a.created_at,
      a.updated_at
    FROM announcements a
    JOIN announcement_templates t ON t.id = a.template_id
    LEFT JOIN print_jobs p ON p.id = a.print_job_id
    WHERE ${clean(search)} = ''
      OR a.title ILIKE ${term}
      OR a.body_text ILIKE ${term}
      OR t.name ILIKE ${term}
    ORDER BY a.created_at DESC
  `;
  return rows.map(mapAnnouncementRow).filter(Boolean);
}

export async function getAnnouncementById(announcementId) {
  await ensureAnnouncementTemplateCatalog();
  const rows = await sql`
    SELECT
      a.id,
      a.title,
      a.announcement_date,
      a.body_text,
      a.body_html,
      a.layout_override_json,
      a.template_id,
      a.template_key,
      a.template_fields_json,
      a.print_job_id,
      a.queued_at,
      t.name AS template_name,
      t.generator_name AS template_generator_name,
      t.category AS template_category,
      p.status AS print_job_status,
      a.created_by_user_id,
      a.created_at,
      a.updated_at
    FROM announcements a
    JOIN announcement_templates t ON t.id = a.template_id
    LEFT JOIN print_jobs p ON p.id = a.print_job_id
    WHERE a.id = ${clean(announcementId)}
    LIMIT 1
  `;
  return mapAnnouncementRow(rows[0]);
}

export async function createAnnouncement({
  id,
  title,
  announcementDate,
  bodyText,
  bodyHtml,
  layoutOverride,
  templateId,
  templateKey,
  templateFields,
  printJobId,
  queuedAt,
  createdByUserId
}) {
  await initDb();
  const normalizedId = clean(id);
  const safeBodyHtml = sanitizeAnnouncementHtml(bodyHtml);
  const searchableBodyText = clean(bodyText) || stripHtml(safeBodyHtml);
  if (!normalizedId || !clean(title) || !searchableBodyText || !clean(templateId)) {
    throw new Error("חסרים שדות חובה למודעה");
  }

  await sql`
    INSERT INTO announcements (
      id,
      title,
      announcement_date,
      body_text,
      body_html,
      layout_override_json,
      template_id,
      template_key,
      template_fields_json,
      print_job_id,
      queued_at,
      created_by_user_id
    )
    VALUES (
      ${normalizedId},
      ${clean(title)},
      ${clean(announcementDate) || null},
      ${searchableBodyText},
      ${safeBodyHtml || null},
      ${JSON.stringify(parseLayout(layoutOverride))}::jsonb,
      ${clean(templateId)},
      ${clean(templateKey)},
      ${JSON.stringify(templateFields && typeof templateFields === "object" ? templateFields : {})}::jsonb,
      ${clean(printJobId) || null},
      ${queuedAt || null},
      ${clean(createdByUserId)}
    )
  `;

  return getAnnouncementById(normalizedId);
}

export async function updateAnnouncement(announcementId, updates = {}) {
  await initDb();
  const current = await getAnnouncementById(announcementId);
  if (!current) return null;

  const next = {
    ...current,
    ...updates
  };
  const safeBodyHtml = sanitizeAnnouncementHtml(next.bodyHtml);
  const searchableBodyText = clean(next.bodyText) || stripHtml(safeBodyHtml);

  await sql`
    UPDATE announcements
    SET
      title = ${clean(next.title)},
      announcement_date = ${clean(next.announcementDate) || null},
      body_text = ${searchableBodyText},
      body_html = ${safeBodyHtml || null},
      layout_override_json = ${JSON.stringify(parseLayout(next.layoutOverride))}::jsonb,
      template_id = ${clean(next.templateId)},
      template_key = ${clean(next.templateKey)},
      template_fields_json = ${JSON.stringify(next.templateFields && typeof next.templateFields === "object" ? next.templateFields : {})}::jsonb,
      print_job_id = ${clean(next.printJobId) || null},
      queued_at = ${next.queuedAt || null},
      updated_at = NOW()
    WHERE id = ${clean(announcementId)}
  `;

  return getAnnouncementById(announcementId);
}

export async function markAnnouncementPrintQueued(announcementId, printJobId) {
  await initDb();
  await sql`
    UPDATE announcements
    SET
      print_job_id = ${clean(printJobId) || null},
      queued_at = NOW(),
      updated_at = NOW()
    WHERE id = ${clean(announcementId)}
  `;
  return getAnnouncementById(announcementId);
}
