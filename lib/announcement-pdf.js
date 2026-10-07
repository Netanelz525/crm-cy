import { getObjectBytesFromR2 } from "./r2";
import { launchPdfBrowser } from "./pdf-browser";
import { normalizeDocxForPreview, renderDocxTemplate } from "./docx-template";
import fs from "fs/promises";
import path from "path";

const DOCX_PREVIEW_SCRIPT = path.join(process.cwd(), "node_modules/docx-preview/dist/docx-preview.js");
const JSZIP_SCRIPT = path.join(process.cwd(), "node_modules/jszip/dist/jszip.min.js");

function clean(value) {
  return String(value || "").trim();
}

export async function renderAnnouncementPdf({ announcement, template }) {
  if (!template?.docxObjectKey) {
    throw new Error("לתבנית אין קובץ Word פעיל. יש להעלות קובץ DOCX לפני הפקת PDF.");
  }
  return renderDocxAnnouncementPdf({ announcement, template });
}

export function getAnnouncementPdfRenderer(template) {
  return template?.docxObjectKey ? "docx-preview-pdf" : "missing-docx-template";
}

function docxTemplateData(announcement, template) {
  const fields = announcement?.templateFields && typeof announcement.templateFields === "object" ? announcement.templateFields : {};
  const data = { ...fields, title: fields.title || announcement?.title, name: fields.name || announcement?.title };
  for (const field of template?.fields || []) {
    const key = clean(field?.key);
    const templateFieldId = clean(field?.templateFieldId);
    if (!templateFieldId || !key || !(key in fields)) continue;
    data[templateFieldId] = fields[key];
  }
  for (const [key, value] of Object.entries(data)) {
    if (value && typeof value === "object") data[key] = value.type === "image" ? "" : String(value.value || value.text || "");
  }
  return data;
}

export async function renderDocxAnnouncementPdf({ announcement, template }) {
  const object = await getObjectBytesFromR2(template.docxObjectKey);
  const renderedDocx = normalizeDocxForPreview(
    renderDocxTemplate(Buffer.from(object.bytes), docxTemplateData(announcement, template))
  );
  const [jszipScript, docxPreviewScript] = await Promise.all([
    fs.readFile(JSZIP_SCRIPT, "utf8"),
    fs.readFile(DOCX_PREVIEW_SCRIPT, "utf8")
  ]);
  const browser = await launchPdfBrowser();
  try {
    const page = await browser.newPage();
    await page.setContent(`<!doctype html><html lang="he" dir="rtl"><head><meta charset="utf-8" /><style>
      @page { size: A4; margin: 0; }
      html, body { margin: 0 !important; padding: 0 !important; background: #fff; }
      .docx-wrapper { width: 210mm !important; padding: 0 !important; background: #fff !important; }
      .docx-wrapper section.docx {
        box-sizing: border-box !important;
        width: 210mm !important;
        min-height: 297mm !important;
        margin: 0 !important;
        box-shadow: none !important;
      }
      /* Match the intentional blank paragraphs in the original Google/Word
         layout of the sources template. docx-preview otherwise compresses
         those empty paragraphs to a single browser line box. */
      #docx-container[data-template-key="marei-mekomot"] .docx-wrapper section.docx article {
        position: relative;
        top: 18.9px;
      }
      #docx-container[data-template-key="marei-mekomot"] .docx-wrapper section.docx article > p:nth-of-type(1) {
        margin-bottom: 30px !important;
      }
      #docx-container[data-template-key="marei-mekomot"] .docx-wrapper section.docx article > p:nth-of-type(3) {
        min-height: 62px !important;
        margin-bottom: 0 !important;
      }
      #docx-container[data-template-key="marei-mekomot"] .docx-wrapper section.docx article > p:nth-of-type(n+4):nth-of-type(-n+8) {
        margin-bottom: 17px !important;
      }
      /* The source DOCX names Noto Sans Symbols for its bullet glyphs. That
         font is not available in the server Chromium runtime, so force the
         same round bullet through a local fallback font instead of emitting
         a square placeholder. */
      .docx-wrapper section.docx article p[class*="docx-num-"]::before {
        content: "●" !important;
        font-family: Arial, sans-serif !important;
        font-size: 18pt !important;
      }
      footer p span > div { width: max-content !important; height: auto !important; }
      footer img { max-width: 100% !important; height: auto !important; }
    </style></head><body><div id="docx-container" data-template-key="${clean(template.templateKey)}"></div></body></html>`, { waitUntil: "load" });
    await page.addScriptTag({ content: jszipScript });
    await page.addScriptTag({ content: docxPreviewScript });
    const encodedDocx = Buffer.from(renderedDocx).toString("base64");
    await page.evaluate(async (base64) => {
      const bytes = Uint8Array.from(atob(base64), (character) => character.charCodeAt(0));
      await window.docx.renderAsync(bytes, document.getElementById("docx-container"), null, {
        useBase64URL: true,
        renderHeaders: true,
        renderFooters: true,
        breakPages: true
      });
    }, encodedDocx);
    await page.emulateMediaType("screen");
    const pdf = await page.pdf({ format: "A4", printBackground: true, preferCSSPageSize: true, margin: { top: "0", right: "0", bottom: "0", left: "0" } });
    await page.close();
    return Buffer.from(pdf);
  } finally {
    await browser.close();
  }
}
