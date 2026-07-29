"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { canUseAnnouncementTemplate, createAnnouncement, createAnnouncementTemplate, getAnnouncementById, getAnnouncementTemplateById, markAnnouncementPrintQueued, updateAnnouncement, updateAnnouncementTemplate, updateAnnouncementTemplateSettings } from "../../lib/announcements";
import { renderAnnouncementPdf } from "../../lib/announcement-pdf";
import { canUsePrintQueue, createPrintJobFromBuffer, normalizePrintPlan } from "../../lib/print-jobs";
import { requireAuthenticatedUser } from "../../lib/rbac";
import { isR2Configured, uploadBufferToR2 } from "../../lib/r2";

function clean(value) {
  return String(value || "").trim();
}

function escapeHtml(value) {
  return clean(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function getExtension(fileName, contentType) {
  const byName = clean(fileName).split(".").pop()?.toLowerCase() || "";
  if (["png", "jpg", "jpeg", "webp"].includes(byName)) return byName;
  const byType = {
    "image/png": "png",
    "image/jpeg": "jpg",
    "image/webp": "webp"
  };
  return byType[clean(contentType).toLowerCase()] || "bin";
}

function numberFromForm(formData, key, fallback) {
  const numeric = Number(clean(formData.get(key)));
  return Number.isFinite(numeric) ? numeric : fallback;
}

function layoutFromForm(formData) {
  return {
    header: {
      top: numberFromForm(formData, "headerTop", 9),
      left: numberFromForm(formData, "headerLeft", 9),
      right: numberFromForm(formData, "headerRight", 9),
      fontSize: numberFromForm(formData, "headerFontSize", 30),
      textAlign: clean(formData.get("headerAlign")) || "center",
      fontWeight: numberFromForm(formData, "headerFontWeight", 700)
    },
    body: {
      top: numberFromForm(formData, "bodyTop", 27),
      left: numberFromForm(formData, "bodyLeft", 10),
      right: numberFromForm(formData, "bodyRight", 10),
      bottom: numberFromForm(formData, "bodyBottom", 18),
      fontSize: numberFromForm(formData, "bodyFontSize", 24),
      lineHeight: numberFromForm(formData, "bodyLineHeight", 1.55),
      textAlign: clean(formData.get("bodyAlign")) || "center",
      fontWeight: numberFromForm(formData, "bodyFontWeight", 400)
    },
    footer: {
      bottom: numberFromForm(formData, "footerBottom", 8),
      left: numberFromForm(formData, "footerLeft", 9),
      right: numberFromForm(formData, "footerRight", 9),
      fontSize: numberFromForm(formData, "footerFontSize", 26),
      textAlign: clean(formData.get("footerAlign")) || "center",
      fontWeight: numberFromForm(formData, "footerFontWeight", 700)
    }
  };
}

function announcementLayoutFromForm(formData) {
  return {
    body: {
      top: numberFromForm(formData, "bodyTop", 27),
      left: numberFromForm(formData, "bodyLeft", 10),
      right: numberFromForm(formData, "bodyRight", 10),
      bottom: numberFromForm(formData, "bodyBottom", 18),
      fontSize: numberFromForm(formData, "bodyFontSize", 24),
      lineHeight: numberFromForm(formData, "bodyLineHeight", 1.55),
      textAlign: clean(formData.get("bodyAlign")) || "center",
      fontWeight: 400
    }
  };
}

function validateTemplateFields(template, formData) {
  const values = {};
  const lines = [];

  for (const field of template.fields || []) {
    const key = clean(field.key);
    if (!key) continue;
    const value = clean(formData.get(`field:${key}`));
    if (field.required && !value) {
      throw new Error(`חסר שדה חובה: ${field.label || key}`);
    }
    if (field.maxLength && value.length > Number(field.maxLength)) {
      throw new Error(`${field.label || key} ארוך מדי. ניתן להזין עד ${field.maxLength} תווים.`);
    }
    values[key] = value;
    if (value) lines.push({ label: clean(field.label) || key, key, value, multiline: field.type === "multiline" });
  }

  return { values, lines };
}

function titleForAnnouncement(template, fields) {
  return clean(fields.title)
    || clean(fields.name)
    || clean(fields.date && `${template.name} - ${fields.date}`)
    || clean(template.name)
    || "מודעה";
}

function bodyTextForAnnouncement(template, lines) {
  if (lines.length === 1 && ["body", "sources", "source"].includes(lines[0].key)) return lines[0].value;
  return [
    template.name,
    ...lines.map((line) => `${line.label}: ${line.value}`)
  ].filter(Boolean).join("\n");
}

function bodyHtmlForAnnouncement(template, lines) {
  if (lines.length === 1 && ["body", "sources", "source"].includes(lines[0].key)) {
    return `<p>${escapeHtml(lines[0].value).replace(/\n/g, "<br>")}</p>`;
  }

  const parts = [`<h2>${escapeHtml(template.name)}</h2>`];
  for (const line of lines) {
    const value = escapeHtml(line.value).replace(/\n/g, "<br>");
    parts.push(`<p><strong>${escapeHtml(line.label)}:</strong><br>${value}</p>`);
  }
  return parts.join("");
}

function queuedAnnouncementLayout(template, bodyText) {
  const length = clean(bodyText).length;
  const isSources = template.category === "sources";
  return {
    body: {
      top: isSources ? 17 : 22,
      left: 11,
      right: 11,
      bottom: 15,
      fontSize: length > 1100 ? 18 : length > 700 ? 20 : isSources ? 21 : 24,
      lineHeight: isSources ? 1.45 : 1.5,
      textAlign: isSources ? "right" : "center",
      fontWeight: 400
    }
  };
}

function templateFieldDefinitions(template) {
  return (template.fields || []).map((field) => ({
    key: clean(field.key),
    templateFieldId: clean(field.templateFieldId),
    label: clean(field.label),
    type: clean(field.type) || "text",
    required: Boolean(field.required),
    maxLength: Number(field.maxLength || 0) || null
  }));
}

function fieldValuesByTemplateId(template, values) {
  const result = {};
  for (const field of template.fields || []) {
    const templateFieldId = clean(field.templateFieldId);
    const key = clean(field.key);
    if (!templateFieldId || !key) continue;
    result[templateFieldId] = clean(values[key]);
  }
  return result;
}

async function uploadTemplateBlank(file, templateId) {
  if (!file || typeof file.arrayBuffer !== "function" || !clean(file.name)) {
    return { key: "", contentType: "" };
  }
  const contentType = clean(file.type).toLowerCase();
  if (contentType && !["image/png", "image/jpeg", "image/webp"].includes(contentType)) {
    throw new Error("בשלב זה ניתן להעלות לבלנק רק PNG, JPG או WEBP");
  }
  if (!isR2Configured()) {
    throw new Error("R2 לא מוגדר עדיין ב-ENV");
  }
  const extension = getExtension(file.name, contentType);
  const key = `announcement-templates/${templateId}/blank.${extension}`;
  const bytes = Buffer.from(await file.arrayBuffer());
  await uploadBufferToR2({
    key,
    buffer: bytes,
    contentType: contentType || "application/octet-stream"
  });
  return { key, contentType: contentType || "application/octet-stream" };
}

async function requireAnnouncementEditor() {
  const user = await requireAuthenticatedUser();
  if (!user.can_use_announcement_templates) {
    redirect("/unauthorized");
  }
  return user;
}

async function requireAnnouncementTemplateAdmin() {
  const user = await requireAuthenticatedUser();
  if (!user.is_super_admin) {
    redirect("/unauthorized");
  }
  return user;
}

function templateFieldsFromForm(formData) {
  const fieldCount = Number(clean(formData.get("fieldCount")) || 0);
  const fields = [];

  for (let index = 0; index < fieldCount; index += 1) {
    const templateFieldId = clean(formData.get(`fieldTemplateFieldId:${index}`));
    const key = clean(formData.get(`fieldKey:${index}`)) || fieldKeyFromTemplateId(templateFieldId, index);
    const label = clean(formData.get(`fieldLabel:${index}`));
    if (!key && !templateFieldId && !label) continue;

    fields.push({
      key,
      templateFieldId,
      label,
      type: fieldTypeFromForm(formData, index, templateFieldId, label),
      required: clean(formData.get(`fieldRequired:${index}`)) !== "0",
      maxLength: Number(clean(formData.get(`fieldMaxLength:${index}`)) || 0) || undefined
    });
  }

  return fields;
}

function fieldTypeFromForm(formData, index, templateFieldId, label) {
  const explicitType = clean(formData.get(`fieldType:${index}`));
  if (explicitType === "multiline") return "multiline";
  if (explicitType === "text") return "text";
  const hint = `${templateFieldId} ${label}`;
  if (/body|data|source|sources|תוכן|מקור|מראה/i.test(hint)) return "multiline";
  return "text";
}

function fieldKeyFromTemplateId(templateFieldId, index) {
  const normalized = clean(templateFieldId)
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 48);
  return normalized || `field_${index + 1}`;
}

function categoryFromForm(value) {
  const category = clean(value);
  if (["announcement", "letter", "sources"].includes(category)) return category;
  return "announcement";
}

function allowedTemplateRolesFromForm(formData) {
  const roles = formData.getAll("allowedRoles").map(clean).filter(Boolean);
  return roles.filter((role) => ["marei_mekomot"].includes(role));
}

export async function createAnnouncementTemplateAction(formData) {
  const user = await requireAnnouncementTemplateAdmin();
  const templateId = crypto.randomUUID();
  const name = clean(formData.get("name"));
  const generatorName = clean(formData.get("generatorName")) || name;
  const category = categoryFromForm(formData.get("category"));

  if (!name) {
    redirect("/announcements?error=יש להזין שם תבנית");
  }

  try {
    await createAnnouncementTemplate({
      id: templateId,
      name,
      templateKey: clean(formData.get("templateKey")) || undefined,
      generatorName,
      googleDocsUrl: formData.get("googleDocsUrl"),
      category,
      fields: templateFieldsFromForm(formData),
      allowedRoles: allowedTemplateRolesFromForm(formData),
      isPreferred: clean(formData.get("isPreferred")) === "on",
      headerText: generatorName,
      footerText: "",
      layout: undefined,
      createdByUserId: user.clerk_user_id
    });
  } catch (error) {
    redirect(`/announcements?error=${encodeURIComponent(error?.message || "יצירת התבנית נכשלה")}`);
  }

  revalidatePath("/announcements");
  redirect("/announcements?templateCreated=1");
}

export async function updateAnnouncementTemplateAction(formData) {
  await requireAnnouncementEditor();
  const templateId = clean(formData.get("templateId"));
  const current = await getAnnouncementTemplateById(templateId);
  if (!current) {
    redirect("/announcements?error=התבנית לא נמצאה");
  }

  const blankFile = formData.get("blankFile");
  let blankObjectKey = current.blankObjectKey;
  let blankContentType = current.blankContentType;

  try {
    if (blankFile && typeof blankFile.arrayBuffer === "function" && clean(blankFile.name)) {
      const uploaded = await uploadTemplateBlank(blankFile, templateId);
      blankObjectKey = uploaded.key;
      blankContentType = uploaded.contentType;
    }

    await updateAnnouncementTemplate(templateId, {
      name: clean(formData.get("name")),
      headerText: clean(formData.get("headerText")),
      footerText: clean(formData.get("footerText")),
      blankObjectKey,
      blankContentType,
      layout: layoutFromForm(formData)
    });
  } catch (error) {
    redirect(`/announcements/templates/${templateId}?error=${encodeURIComponent(error?.message || "עדכון התבנית נכשל")}`);
  }

  revalidatePath("/announcements");
  revalidatePath(`/announcements/templates/${templateId}`);
  redirect(`/announcements/templates/${templateId}?updated=1`);
}

export async function createAnnouncementAction(formData) {
  const user = await requireAnnouncementEditor();
  const announcementId = crypto.randomUUID();

  try {
    await createAnnouncement({
      id: announcementId,
      title: clean(formData.get("title")),
      announcementDate: clean(formData.get("announcementDate")),
      bodyText: clean(formData.get("bodyText")),
      bodyHtml: clean(formData.get("bodyHtml")),
      layoutOverride: announcementLayoutFromForm(formData),
      templateId: clean(formData.get("templateId")),
      createdByUserId: user.clerk_user_id
    });
  } catch (error) {
    redirect(`/announcements/new?error=${encodeURIComponent(error?.message || "יצירת המודעה נכשלה")}`);
  }

  revalidatePath("/announcements");
  redirect(`/announcements/${announcementId}?created=1`);
}

export async function createQueuedAnnouncementAction(formData) {
  const user = await requireAnnouncementEditor();
  if (!canUsePrintQueue(user)) redirect("/unauthorized");

  const templateId = clean(formData.get("templateId"));
  const outputMode = clean(formData.get("outputMode")) === "print" ? "print" : "email";
  const copies = numberFromForm(formData, "copies", 1);
  const printPlan = normalizePrintPlan(formData.get("printPlan"));
  const announcementId = crypto.randomUUID();

  try {
    const template = await getAnnouncementTemplateById(templateId);
    if (!template) throw new Error("התבנית לא נמצאה");
    if (!canUseAnnouncementTemplate(user, template)) throw new Error("אין הרשאה להשתמש בתבנית זו");

    const { values, lines } = validateTemplateFields(template, formData);
    const title = titleForAnnouncement(template, values);
    const bodyText = bodyTextForAnnouncement(template, lines);
    const bodyHtml = bodyHtmlForAnnouncement(template, lines);

    const announcement = await createAnnouncement({
      id: announcementId,
      title,
      announcementDate: clean(values.date) || new Date().toISOString().slice(0, 10),
      bodyText,
      bodyHtml,
      layoutOverride: queuedAnnouncementLayout(template, bodyText),
      templateId: template.id,
      templateKey: template.templateKey,
      templateFields: values,
      createdByUserId: user.clerk_user_id
    });

    const pdf = await renderAnnouncementPdf({ announcement, template });
    const printJob = await createPrintJobFromBuffer({
      buffer: pdf,
      fileName: `${title}.pdf`,
      contentType: "application/pdf",
      outputMode,
      sourceType: "announcement",
      sourceId: announcement.id,
      sourceMetadata: {
        announcement: {
          id: announcement.id,
          title: announcement.title,
          date: announcement.announcementDate,
          bodyText: announcement.bodyText
        },
        template: {
          id: template.id,
          templateKey: template.templateKey,
          name: template.name,
          generatorName: template.generatorName,
          googleDocsUrl: template.googleDocsUrl,
          googleDocsId: template.googleDocsId,
          category: template.category,
          version: template.version,
          engine: template.engine,
          allowedRoles: template.allowedRoles
        },
        fields: values,
        fieldValuesByTemplateId: fieldValuesByTemplateId(template, values),
        fieldDefinitions: templateFieldDefinitions(template)
      },
      copies,
      printPlan,
      uploadedByUserId: user.clerk_user_id,
      user
    });

    await markAnnouncementPrintQueued(announcement.id, printJob.id);
  } catch (error) {
    redirect(`/announcements?error=${encodeURIComponent(clean(error?.message) || "יצירת המודעה ושליחתה לתור נכשלה")}`);
  }

  revalidatePath("/announcements");
  revalidatePath("/print");
  redirect("/announcements?created=1&queued=1");
}

export async function updateAnnouncementTemplateGoogleDocsAction(formData) {
  await requireAnnouncementTemplateAdmin();
  const templateId = clean(formData.get("templateId"));

  try {
    await updateAnnouncementTemplateSettings(templateId, {
      googleDocsUrl: formData.get("googleDocsUrl"),
      fields: templateFieldsFromForm(formData),
      allowedRoles: allowedTemplateRolesFromForm(formData),
      isPreferred: clean(formData.get("isPreferred")) === "on"
    });
  } catch (error) {
    redirect(`/announcements?error=${encodeURIComponent(clean(error?.message) || "שמירת התבנית נכשלה")}`);
  }

  revalidatePath("/announcements");
  redirect("/announcements?templateUpdated=1");
}

export async function updateQueuedAnnouncementAction(formData) {
  const user = await requireAnnouncementEditor();
  const announcementId = clean(formData.get("announcementId"));
  const submitMode = clean(formData.get("submitMode"));
  const shouldQueue = ["email", "print"].includes(submitMode);
  const outputMode = submitMode === "print" ? "print" : "email";
  const copies = submitMode === "print" ? numberFromForm(formData, "copies", 1) : 1;
  const printPlan = normalizePrintPlan(formData.get("printPlan"));
  let redirectTarget = announcementId ? `/announcements/${announcementId}` : "/announcements";
  let redirectSuffix = "updated=1";

  try {
    const current = await getAnnouncementById(announcementId);
    if (!current) throw new Error("המודעה לא נמצאה");
    redirectTarget = `/announcements/${current.id}`;

    const template = await getAnnouncementTemplateById(current.templateId);
    if (!template) throw new Error("התבנית של המודעה לא נמצאה");
    if (!canUseAnnouncementTemplate(user, template)) throw new Error("אין הרשאה להשתמש בתבנית זו");
    if (shouldQueue && !canUsePrintQueue(user)) throw new Error("אין הרשאה לשליחה לתור");

    const { values, lines } = validateTemplateFields(template, formData);
    const title = titleForAnnouncement(template, values);
    const bodyText = bodyTextForAnnouncement(template, lines);
    const bodyHtml = bodyHtmlForAnnouncement(template, lines);

    const updatedAnnouncement = await updateAnnouncement(current.id, {
      title,
      announcementDate: clean(values.date) || current.announcementDate || new Date().toISOString().slice(0, 10),
      bodyText,
      bodyHtml,
      layoutOverride: queuedAnnouncementLayout(template, bodyText),
      templateId: template.id,
      templateKey: template.templateKey,
      templateFields: values
    });

    if (shouldQueue) {
      const pdf = await renderAnnouncementPdf({ announcement: updatedAnnouncement, template });
      const printJob = await createPrintJobFromBuffer({
        buffer: pdf,
        fileName: `${title}.pdf`,
        contentType: "application/pdf",
        outputMode,
        sourceType: "announcement",
        sourceId: updatedAnnouncement.id,
        sourceMetadata: {
          announcement: {
            id: updatedAnnouncement.id,
            title: updatedAnnouncement.title,
            date: updatedAnnouncement.announcementDate,
            bodyText: updatedAnnouncement.bodyText
          },
          template: {
            id: template.id,
            templateKey: template.templateKey,
            name: template.name,
            generatorName: template.generatorName,
            googleDocsUrl: template.googleDocsUrl,
            googleDocsId: template.googleDocsId,
            category: template.category,
            version: template.version,
            engine: template.engine,
            allowedRoles: template.allowedRoles
          },
          fields: values,
          fieldValuesByTemplateId: fieldValuesByTemplateId(template, values),
          fieldDefinitions: templateFieldDefinitions(template)
        },
        copies,
        printPlan,
        uploadedByUserId: user.clerk_user_id,
        user
      });

      await markAnnouncementPrintQueued(updatedAnnouncement.id, printJob.id);
      redirectSuffix = `updated=1&queued=${outputMode}`;
    }
  } catch (error) {
    redirect(`${redirectTarget}?error=${encodeURIComponent(clean(error?.message) || "עדכון המודעה נכשל")}`);
  }

  revalidatePath("/announcements");
  revalidatePath(`/announcements/${announcementId}`);
  revalidatePath("/print");
  redirect(`${redirectTarget}?${redirectSuffix}`);
}

export async function printAnnouncementAction(formData) {
  const user = await requireAnnouncementEditor();
  if (!canUsePrintQueue(user)) redirect("/unauthorized");

  const announcementId = clean(formData.get("announcementId"));
  const copies = formData.get("copies");
  let redirectTarget = "/announcements";

  try {
    const announcement = await getAnnouncementById(announcementId);
    if (!announcement) throw new Error("המודעה לא נמצאה");
    redirectTarget = `/announcements/${announcement.id}`;
    const template = await getAnnouncementTemplateById(announcement.templateId);
    if (!template) throw new Error("התבנית של המודעה לא נמצאה");

    const pdf = await renderAnnouncementPdf({ announcement, template });
    await createPrintJobFromBuffer({
      buffer: pdf,
      fileName: `${clean(announcement.title) || "מודעה"}.pdf`,
      contentType: "application/pdf",
      copies,
      uploadedByUserId: user.clerk_user_id
    });
  } catch (error) {
    redirect(`${redirectTarget}?error=${encodeURIComponent(clean(error?.message) || "שליחת המודעה להדפסה נכשלה")}`);
  }

  revalidatePath("/print");
  redirect(`${redirectTarget}?printQueued=1`);
}

export async function updateAnnouncementAction(formData) {
  await requireAnnouncementEditor();
  const announcementId = clean(formData.get("announcementId"));

  try {
    await updateAnnouncement(announcementId, {
      title: clean(formData.get("title")),
      announcementDate: clean(formData.get("announcementDate")),
      bodyText: clean(formData.get("bodyText")),
      bodyHtml: clean(formData.get("bodyHtml")),
      layoutOverride: announcementLayoutFromForm(formData),
      templateId: clean(formData.get("templateId"))
    });
  } catch (error) {
    redirect(`/announcements/${announcementId}?error=${encodeURIComponent(error?.message || "עדכון המודעה נכשל")}`);
  }

  revalidatePath("/announcements");
  revalidatePath(`/announcements/${announcementId}`);
  redirect(`/announcements/${announcementId}?updated=1`);
}
