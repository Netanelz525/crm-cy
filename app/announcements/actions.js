"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createAnnouncement, createAnnouncementTemplate, getAnnouncementTemplateById, updateAnnouncement, updateAnnouncementTemplate } from "../../lib/announcements";
import { requireAuthenticatedUser } from "../../lib/rbac";
import { isR2Configured, uploadBufferToR2 } from "../../lib/r2";

function clean(value) {
  return String(value || "").trim();
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
      fontWeight: numberFromForm(formData, "bodyFontWeight", 400)
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
    redirect(`/announcements?error=${encodeURIComponent(error?.message || "יצירת המודעה נכשלה")}`);
  }

  revalidatePath("/announcements");
  redirect(`/announcements/${announcementId}?created=1`);
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
