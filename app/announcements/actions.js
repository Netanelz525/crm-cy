"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createAnnouncement, createAnnouncementTemplate, getAnnouncementById, getAnnouncementTemplateById, markAnnouncementPrintQueued, updateAnnouncement, updateAnnouncementTemplate } from "../../lib/announcements";
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
  if (!user.is_team_member && !user.is_manager) {
    redirect("/unauthorized");
  }
  return user;
}

export async function createAnnouncementTemplateAction(formData) {
  const user = await requireAnnouncementEditor();
  const templateId = crypto.randomUUID();
  const name = clean(formData.get("name"));
  const headerText = clean(formData.get("headerText"));
  const footerText = clean(formData.get("footerText"));
  const blankFile = formData.get("blankFile");

  if (!name) {
    redirect("/announcements?error=יש להזין שם תבנית");
  }

  let blank = { key: "", contentType: "" };
  try {
    blank = await uploadTemplateBlank(blankFile, templateId);
    await createAnnouncementTemplate({
      id: templateId,
      name,
      headerText,
      footerText,
      blankObjectKey: blank.key,
      blankContentType: blank.contentType,
      layout: layoutFromForm(formData),
      createdByUserId: user.clerk_user_id
    });
  } catch (error) {
    redirect(`/announcements?error=${encodeURIComponent(error?.message || "יצירת התבנית נכשלה")}`);
  }

  revalidatePath("/announcements");
  redirect(`/announcements/templates/${templateId}?created=1`);
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
  const copies = numberFromForm(formData, "copies", 1);
  const printPlan = normalizePrintPlan(formData.get("printPlan"));
  const announcementId = crypto.randomUUID();

  try {
    const template = await getAnnouncementTemplateById(templateId);
    if (!template) throw new Error("התבנית לא נמצאה");

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
