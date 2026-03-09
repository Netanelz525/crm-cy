"use server";

import { redirect } from "next/navigation";
import { toFormData } from "../../../lib/student-fields";
import { requireAuthenticatedUser } from "../../../lib/rbac";
import { createStudentByData } from "../../../lib/twenty";

function clean(v) {
  return String(v || "").trim();
}

function buildStudentUrl(studentId) {
  const base = clean(process.env.TWENTY_LINK);
  if (!base) return "";
  const normalized = base.endsWith("/") ? base : `${base}/`;
  return `${normalized}${encodeURIComponent(studentId)}`;
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function buildWebhookHtml(raw, studentId, studentUrl) {
  const firstName = clean(raw["fullName.firstName"]);
  const lastName = clean(raw["fullName.lastName"]);
  const fullName = `${firstName} ${lastName}`.trim() || "-";

  const rows = [
    ["שם תלמיד", fullName],
    ["תעודת זהות", clean(raw.tznum) || "-"],
    ["מוסד", clean(raw.currentInstitution) || "-"],
    ["שיעור", clean(raw.class) || "-"],
    ["רישום", clean(raw.registration) || "-"],
    ["טלפון תלמיד", clean(raw["phone.primaryPhoneNumber"]) || "-"],
    ["אימייל תלמיד", clean(raw["email.primaryEmail"]) || "-"],
    ["מזהה תלמיד", studentId]
  ];

  const tableRows = rows
    .map(
      ([k, v]) =>
        `<tr><td style="padding:6px 10px;border:1px solid #d8dee9;"><b>${escapeHtml(k)}</b></td><td style="padding:6px 10px;border:1px solid #d8dee9;">${escapeHtml(v)}</td></tr>`
    )
    .join("");

  const link = studentUrl
    ? `<p><a href="${escapeHtml(studentUrl)}" target="_blank" rel="noopener noreferrer">פתיחת כרטיס תלמיד ב-CRM</a></p>`
    : "";

  return `<div dir="rtl" style="font-family:Arial,sans-serif">
<h2>נוצר תלמיד חדש במערכת</h2>
${link}
<table style="border-collapse:collapse;border:1px solid #d8dee9">${tableRows}</table>
</div>`;
}

async function notifyWebhook(payload) {
  const webhookUrl = clean(process.env.WEBHOOK);
  if (!webhookUrl) return;

  const response = await fetch(webhookUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
    cache: "no-store"
  });

  if (!response.ok) {
    const bodyText = await response.text().catch(() => "");
    throw new Error(`Webhook send failed (${response.status}): ${bodyText || "unknown-error"}`);
  }
}

export async function createStudentAction(formData) {
  const user = await requireAuthenticatedUser();
  if (!user.is_team_member && !user.is_manager) {
    redirect("/unauthorized");
  }

  const raw = Object.fromEntries(formData.entries());
  const data = toFormData(raw);

  const firstName = clean(raw["fullName.firstName"]);
  const lastName = clean(raw["fullName.lastName"]);
  if (!firstName || !lastName) {
    redirect("/students/new?error=שם פרטי ושם משפחה הם שדות חובה");
  }

  if (!Object.keys(data).length) {
    redirect("/students/new?error=לא הוזנו נתונים לשמירה");
  }

  const created = await createStudentByData(data);
  const studentId = clean(created?.id);

  if (!studentId) {
    redirect("/students/new?error=לא התקבל מזהה תלמיד לאחר שמירה");
  }

  try {
    const studentUrl = buildStudentUrl(studentId);
    const payload = {
      event: "student.created",
      studentId,
      studentUrl,
      createdAt: new Date().toISOString(),
      html: buildWebhookHtml(raw, studentId, studentUrl),
      raw,
      normalized: data
    };
    await notifyWebhook(payload);
  } catch (error) {
    console.error("Student webhook notification failed:", error?.message || error);
  }

  redirect(`/students/${studentId}?created=1`);
}
