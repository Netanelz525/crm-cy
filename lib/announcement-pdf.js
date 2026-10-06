import { announcementBodyStyleCss } from "./announcement-layout";
import { getObjectBytesFromR2 } from "./r2";
import { getPdfFontDataUrl, launchPdfBrowser } from "./pdf-browser";
import { normalizeDocxForPreview, renderDocxTemplate } from "./docx-template";
import fs from "fs/promises";
import path from "path";

const DOCX_PREVIEW_SCRIPT = path.join(process.cwd(), "node_modules/docx-preview/dist/docx-preview.js");
const JSZIP_SCRIPT = path.join(process.cwd(), "node_modules/jszip/dist/jszip.min.js");

function clean(value) {
  return String(value || "").trim();
}

function toDataUrl(bytes, contentType) {
  return `data:${clean(contentType) || "application/octet-stream"};base64,${Buffer.from(bytes).toString("base64")}`;
}

async function getBackgroundDataUrl(template) {
  if (!template?.blankObjectKey) return "";
  const object = await getObjectBytesFromR2(template.blankObjectKey);
  return toDataUrl(object.bytes, template.blankContentType || object.contentType);
}

async function getFontDataUrl() {
  return getPdfFontDataUrl();
}

function fallbackHtml(bodyText) {
  const safe = clean(bodyText)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\n/g, "<br>");
  return `<p>${safe}</p>`;
}

function buildHtml({ announcement, template, backgroundUrl, fontUrl }) {
  const html = clean(announcement?.bodyHtml) || fallbackHtml(announcement?.bodyText);
  const style = announcementBodyStyleCss(announcement?.layoutOverride?.body || {});

  return `<!doctype html>
<html lang="he" dir="rtl">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <style>
      @page { size: A4; margin: 0; }
      @font-face {
        font-family: "NotoSansHebrew";
        src: url("${fontUrl}") format("truetype");
        font-weight: 400;
        font-style: normal;
      }
      html, body {
        width: 210mm;
        height: 297mm;
        margin: 0;
        padding: 0;
        background: #ffffff;
        font-family: "NotoSansHebrew", sans-serif;
        -webkit-print-color-adjust: exact;
        print-color-adjust: exact;
      }
      .page {
        position: relative;
        width: 210mm;
        height: 297mm;
        overflow: hidden;
        background: #ffffff;
      }
      .blank {
        position: absolute;
        inset: 0;
        width: 100%;
        height: 100%;
        object-fit: cover;
      }
      .body {
        position: absolute;
        z-index: 1;
        overflow: hidden;
        white-space: normal;
        word-break: break-word;
        overflow-wrap: anywhere;
        color: #142642;
        direction: rtl;
        unicode-bidi: plaintext;
        ${style}
      }
      .body p,
      .body h1,
      .body h2,
      .body h3,
      .body ul,
      .body ol {
        margin: 0 0 0.55em;
      }
      .body p:last-child,
      .body h1:last-child,
      .body h2:last-child,
      .body h3:last-child,
      .body ul:last-child,
      .body ol:last-child {
        margin-bottom: 0;
      }
      .body h2 {
        font-size: 1.12em;
        line-height: 1.28;
        font-weight: 800;
      }
      .body h3 {
        font-size: 1.06em;
        line-height: 1.3;
        font-weight: 800;
      }
      .body ul,
      .body ol {
        padding: 0 1.2em 0 0;
      }
      .body strong, .body b { font-weight: 700; }
      .body u { text-decoration: underline; }
      .body [style*="text-align: left"] { text-align: left !important; }
      .body [style*="text-align: center"] { text-align: center !important; }
      .body [style*="text-align: right"] { text-align: right !important; }
      .body [style*="color:"] { color: inherit; }
      .body span[style*="color: #0c5fa8"] { color: #0c5fa8 !important; }
      .body span[style*="color:#0c5fa8"] { color: #0c5fa8 !important; }
      .body span[style*="color: #a43131"] { color: #a43131 !important; }
      .body span[style*="color:#a43131"] { color: #a43131 !important; }
      .body span[style*="color: #142642"] { color: #142642 !important; }
      .body span[style*="color:#142642"] { color: #142642 !important; }
    </style>
  </head>
  <body>
    <div class="page">
      ${backgroundUrl ? `<img class="blank" src="${backgroundUrl}" alt="" />` : ""}
      <div class="body">${html}</div>
    </div>
  </body>
</html>`;
}

export async function renderAnnouncementPdf({ announcement, template }) {
  if (template?.docxObjectKey) {
    return renderDocxAnnouncementPdf({ announcement, template });
  }

  const [backgroundUrl, fontUrl] = await Promise.all([
    getBackgroundDataUrl(template),
    getFontDataUrl()
  ]);
  const html = buildHtml({ announcement, template, backgroundUrl, fontUrl });

  const browser = await launchPdfBrowser();
  try {
    const page = await browser.newPage();
    await page.emulateMediaType("screen");
    await page.setContent(html, { waitUntil: "networkidle0" });
    const pdf = await page.pdf({
      format: "A4",
      printBackground: true,
      preferCSSPageSize: true,
      margin: {
        top: "0",
        right: "0",
        bottom: "0",
        left: "0"
      }
    });
    await page.close();
    return Buffer.from(pdf);
  } finally {
    await browser.close();
  }
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
      .docx-wrapper { padding: 0 !important; background: #fff !important; }
      .docx-wrapper section.docx { margin: 0 !important; box-shadow: none !important; }
      footer p span > div { width: max-content !important; height: auto !important; }
      footer img { max-width: 100% !important; height: auto !important; }
    </style></head><body><div id="docx-container"></div></body></html>`, { waitUntil: "load" });
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
