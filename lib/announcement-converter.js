import { DOCX_CONTENT_TYPE } from "./docx-template";

const DEFAULT_CONVERT_URL = "https://unifi.kfilter.net/booklet-printer/api/convert/pdf";

function clean(value) {
  return String(value || "").trim();
}

export async function convertAnnouncementDocxToPdf(docxBuffer, fileName) {
  const apiKey = clean(process.env.BOOKLET_PRINTER_API_KEY);
  if (!apiKey) {
    throw new Error("חסר BOOKLET_PRINTER_API_KEY. יש להגדיר את מפתח שירות ההמרה ב־Vercel.");
  }

  const form = new FormData();
  form.append("file", new Blob([docxBuffer], { type: DOCX_CONTENT_TYPE }), fileName);
  const response = await fetch(clean(process.env.BOOKLET_PRINTER_CONVERT_URL) || DEFAULT_CONVERT_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}` },
    body: form,
    cache: "no-store"
  });

  if (!response.ok) {
    const message = clean(await response.text().catch(() => ""));
    throw new Error(`שירות המרת Word נכשל (${response.status})${message ? `: ${message.slice(0, 240)}` : ""}`);
  }

  const pdf = Buffer.from(await response.arrayBuffer());
  if (pdf.length < 5 || pdf.subarray(0, 5).toString() !== "%PDF-") {
    const message = clean(pdf.toString("utf8"));
    throw new Error(`שירות ההמרה לא החזיר PDF תקין${message ? `: ${message.slice(0, 240)}` : ""}`);
  }
  return pdf;
}
