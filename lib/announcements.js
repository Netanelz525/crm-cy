import { initDb, sql } from "./db";

function clean(value) {
  return String(value || "").trim();
}

function stripHtml(value) {
  return clean(value).replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
}

function sanitizeAnnouncementHtml(value) {
  const raw = String(value || "");
  if (!raw.trim()) return "";
  return raw
    .replace(/<script[\s\S]*?>[\s\S]*?<\/script>/gi, "")
    .replace(/\son\w+="[^"]*"/gi, "")
    .replace(/\son\w+='[^']*'/gi, "")
    .replace(/\sstyle="[^"]*"/gi, "")
    .replace(/\sstyle='[^']*'/gi, "")
    .trim();
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
  return {
    id: clean(row.id),
    name: clean(row.name),
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
  return {
    id: clean(row.id),
    title: clean(row.title),
    announcementDate: row.announcement_date || null,
    bodyText: clean(row.body_text),
    bodyHtml: sanitizeAnnouncementHtml(row.body_html),
    layoutOverride: parseLayout(row.layout_override_json),
    templateId: clean(row.template_id),
    templateName: clean(row.template_name),
    createdByUserId: clean(row.created_by_user_id),
    createdAt: row.created_at || null,
    updatedAt: row.updated_at || null
  };
}

export async function listAnnouncementTemplates() {
  await initDb();
  const rows = await sql`
    SELECT id, name, header_text, footer_text, blank_object_key, blank_content_type, layout_json, created_by_user_id, created_at, updated_at
    FROM announcement_templates
    ORDER BY updated_at DESC, name ASC
  `;
  return rows.map(mapTemplateRow).filter(Boolean);
}

export async function getAnnouncementTemplateById(templateId) {
  await initDb();
  const rows = await sql`
    SELECT id, name, header_text, footer_text, blank_object_key, blank_content_type, layout_json, created_by_user_id, created_at, updated_at
    FROM announcement_templates
    WHERE id = ${clean(templateId)}
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
  await initDb();
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
      t.name AS template_name,
      a.created_by_user_id,
      a.created_at,
      a.updated_at
    FROM announcements a
    JOIN announcement_templates t ON t.id = a.template_id
    WHERE ${clean(search)} = ''
      OR a.title ILIKE ${term}
      OR a.body_text ILIKE ${term}
      OR t.name ILIKE ${term}
    ORDER BY a.updated_at DESC, a.created_at DESC
  `;
  return rows.map(mapAnnouncementRow).filter(Boolean);
}

export async function getAnnouncementById(announcementId) {
  await initDb();
  const rows = await sql`
    SELECT
      a.id,
      a.title,
      a.announcement_date,
      a.body_text,
      a.body_html,
      a.layout_override_json,
      a.template_id,
      t.name AS template_name,
      a.created_by_user_id,
      a.created_at,
      a.updated_at
    FROM announcements a
    JOIN announcement_templates t ON t.id = a.template_id
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
      updated_at = NOW()
    WHERE id = ${clean(announcementId)}
  `;

  return getAnnouncementById(announcementId);
}
