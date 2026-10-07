import { DOCX_CONTENT_TYPE } from "./docx-template";

const DEFAULT_CONVERT_URL = "https://unifi.kfilter.net/booklet-printer/api/convert/pdf";
const RETRYABLE_STATUSES = new Set([502, 503, 504]);

function clean(value) {
  return String(value || "").trim();
}

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

export async function convertAnnouncementDocxToPdf(docxBuffer, fileName) {
  const apiKey = clean(process.env.BOOKLET_PRINTER_API_KEY);
  if (!apiKey) {
    throw new Error("חסר BOOKLET_PRINTER_API_KEY. יש להגדיר את מפתח שירות ההמרה ב־Vercel.");
  }

  const form = new FormData();
  form.append("file", new Blob([docxBuffer], { type: DOCX_CONTENT_TYPE }), fileName);
  const url = clean(process.env.BOOKLET_PRINTER_CONVERT_URL) || DEFAULT_CONVERT_URL;
  let lastError = null;

  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: {
          Accept: "application/pdf",
          Authorization: `Bearer ${apiKey}`,
          "User-Agent": "crm-cy-word-converter/1.0"
        },
        body: form,
        cache: "no-store"
      });
      const payload = Buffer.from(await response.arrayBuffer());

      if (response.ok && payload.subarray(0, 5).toString() === "%PDF-") return payload;

      const message = clean(payload.toString("utf8"));
      if (RETRYABLE_STATUSES.has(response.status) && attempt < 3) {
        await sleep(attempt * 1200);
        continue;
      }
      if (!response.ok) {
        const error = new Error(`שירות המרת Word נכשל (${response.status})${message && !message.startsWith("<") ? `: ${message.slice(0, 240)}` : ""}`);
        error.retryable = RETRYABLE_STATUSES.has(response.status);
        throw error;
      }
      const error = new Error(`שירות ההמרה לא החזיר PDF תקין${message && !message.startsWith("<") ? `: ${message.slice(0, 240)}` : ""}`);
      error.retryable = true;
      throw error;
    } catch (error) {
      lastError = error;
      if (attempt < 3 && (error?.retryable || error?.name === "TypeError")) {
        await sleep(attempt * 1200);
        continue;
      }
    }
  }

  throw lastError || new Error("שירות ההמרה לא החזיר PDF תקין.");
}
