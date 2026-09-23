"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { appendKnowledgeArticleAssets, createKnowledgeArticle, updateKnowledgeArticle } from "../../../lib/knowledge-articles";
import { requireTeamUser } from "../../../lib/rbac";
import { isR2Configured, uploadBufferToR2 } from "../../../lib/r2";

const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

function clean(value) { return String(value || "").trim(); }

function slugify(value) {
  const raw = clean(value).toLowerCase()
    .replace(/[^a-z0-9\u0590-\u05ff\s-]/g, "")
    .replace(/[\s-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 90);
  return raw || `article-${crypto.randomUUID().slice(0, 8)}`;
}

function tagsFromForm(formData) {
  return clean(formData.get("tags")).split(",").map((tag) => clean(tag)).filter(Boolean);
}

async function uploadImages(files, articleId) {
  const assets = [];
  for (const [index, file] of files.entries()) {
    if (!file || typeof file.arrayBuffer !== "function" || !file.size) continue;
    const type = clean(file.type).toLowerCase();
    if (!/^image\/(png|jpeg|webp|gif)$/.test(type)) throw new Error("ניתן לצרף רק PNG, JPG, WEBP או GIF.");
    if (Number(file.size) > MAX_IMAGE_BYTES) throw new Error("גודל כל תמונה מוגבל ל־5MB.");
    if (!isR2Configured()) throw new Error("R2 לא מוגדר במערכת.");
    const id = crypto.randomUUID();
    const key = `knowledge-articles/${articleId}/${id}`;
    await uploadBufferToR2({ key, buffer: Buffer.from(await file.arrayBuffer()), contentType: type, contentDisposition: "inline" });
    assets.push({ id, objectKey: key, fileName: clean(file.name) || `image-${index + 1}`, contentType: type, sizeBytes: Number(file.size) });
  }
  return assets;
}

async function requireArticleEditor() {
  const user = await requireTeamUser();
  if (!user.is_manager && !user.is_super_admin) redirect("/unauthorized");
  return user;
}

export async function createKnowledgeArticleAction(formData) {
  const user = await requireArticleEditor();
  const id = crypto.randomUUID();
  const title = clean(formData.get("title"));
  const files = formData.getAll("images");
  try {
    await createKnowledgeArticle({
      id,
      slug: slugify(formData.get("slug") || title),
      title,
      excerpt: formData.get("excerpt"),
      bodyText: formData.get("bodyText"),
      tags: tagsFromForm(formData),
      status: clean(formData.get("status")),
      createdByUserId: user.clerk_user_id,
      assets: await uploadImages(files, id)
    });
  } catch (error) {
    redirect(`/admin/articles?error=${encodeURIComponent(error?.message || "לא ניתן לשמור את המאמר.")}`);
  }
  revalidatePath("/admin/articles");
  revalidatePath("/articles");
  redirect("/admin/articles?saved=1");
}

export async function updateKnowledgeArticleAction(formData) {
  const user = await requireArticleEditor();
  const id = clean(formData.get("id"));
  try {
    await updateKnowledgeArticle({
      id,
      slug: slugify(formData.get("slug") || formData.get("title")),
      title: formData.get("title"),
      excerpt: formData.get("excerpt"),
      bodyText: formData.get("bodyText"),
      tags: tagsFromForm(formData),
      status: clean(formData.get("status")),
      updatedByUserId: user.clerk_user_id
    });
    await appendKnowledgeArticleAssets(id, await uploadImages(formData.getAll("images"), id));
  } catch (error) {
    redirect(`/admin/articles?error=${encodeURIComponent(error?.message || "לא ניתן לעדכן את המאמר.")}`);
  }
  revalidatePath("/admin/articles");
  revalidatePath("/articles");
  redirect("/admin/articles?saved=1");
}
