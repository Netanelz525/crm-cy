import fs from "fs/promises";
import path from "path";
import chromium from "@sparticuz/chromium";
import puppeteer from "puppeteer-core";
import { announcementBodyStyleCss } from "./announcement-layout";
import { getObjectBytesFromR2 } from "./r2";

const FONT_PATH = path.join(process.cwd(), "assets/fonts/NotoSansHebrew-Regular.ttf");
const LOCAL_CHROME_PATHS = [
  process.env.PUPPETEER_EXECUTABLE_PATH,
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Chromium.app/Contents/MacOS/Chromium"
].filter(Boolean);

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
  const bytes = await fs.readFile(FONT_PATH);
  return `data:font/ttf;base64,${bytes.toString("base64")}`;
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

async function resolveExecutablePath() {
  if (process.env.VERCEL) {
    return chromium.executablePath();
  }
  for (const candidate of LOCAL_CHROME_PATHS) {
    try {
      await fs.access(candidate);
      return candidate;
    } catch {}
  }
  return chromium.executablePath();
}

async function launchBrowser() {
  const executablePath = await resolveExecutablePath();
  const isLocalChrome = LOCAL_CHROME_PATHS.includes(executablePath);
  return puppeteer.launch({
    executablePath,
    headless: true,
    args: isLocalChrome ? ["--no-sandbox"] : chromium.args,
    defaultViewport: {
      width: 794,
      height: 1123,
      deviceScaleFactor: 2
    }
  });
}

export async function renderAnnouncementPdf({ announcement, template }) {
  const [backgroundUrl, fontUrl] = await Promise.all([
    getBackgroundDataUrl(template),
    getFontDataUrl()
  ]);
  const html = buildHtml({ announcement, template, backgroundUrl, fontUrl });

  const browser = await launchBrowser();
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
