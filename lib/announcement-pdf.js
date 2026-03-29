import fs from "fs/promises";
import path from "path";
import PDFDocument from "pdfkit";
import { getObjectBytesFromR2 } from "./r2";

const A4_WIDTH = 595.28;
const A4_HEIGHT = 841.89;
const FONT_PATH = path.join(process.cwd(), "assets/fonts/NotoSansHebrew-Regular.ttf");

function clean(value) {
  return String(value || "").trim();
}

function extractBlocks(bodyHtml, bodyText) {
  const html = clean(bodyHtml);
  if (!html) {
    return clean(bodyText)
      .split(/\n{2,}/)
      .map((text) => ({ type: "paragraph", text: clean(text) }))
      .filter((block) => block.text);
  }

  const blocks = [];
  const normalized = html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n\n")
    .replace(/<\/h2>/gi, "\n\n")
    .replace(/<\/li>/gi, "\n")
    .replace(/<li>/gi, "• ")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .trim();

  for (const chunk of normalized.split(/\n{2,}/)) {
    const text = clean(chunk);
    if (!text) continue;
    blocks.push({
      type: text.startsWith("•") ? "list" : "paragraph",
      text
    });
  }
  return blocks;
}

function rtlLine(text) {
  return clean(text).split("").reverse().join("");
}

function rtlParagraph(text) {
  return clean(text)
    .split("\n")
    .map(rtlLine)
    .join("\n");
}

function bodyBox(layout) {
  const body = layout?.body || {};
  const left = (Number(body.left) || 10) / 100 * A4_WIDTH;
  const right = A4_WIDTH - ((Number(body.right) || 10) / 100 * A4_WIDTH);
  const top = (Number(body.top) || 27) / 100 * A4_HEIGHT;
  const bottom = A4_HEIGHT - ((Number(body.bottom) || 18) / 100 * A4_HEIGHT);
  return {
    x: left,
    y: top,
    width: Math.max(80, right - left),
    height: Math.max(120, bottom - top)
  };
}

async function backgroundOptions(template) {
  if (!template?.blankObjectKey) return null;
  const object = await getObjectBytesFromR2(template.blankObjectKey);
  const contentType = clean(template.blankContentType || object.contentType).toLowerCase();
  if (!["image/png", "image/jpeg", "image/jpg"].includes(contentType)) {
    return null;
  }
  return {
    bytes: Buffer.from(object.bytes),
    contentType
  };
}

function collectPdfBuffer(doc) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    doc.on("data", (chunk) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
  });
}

export async function renderAnnouncementPdf({ announcement, template }) {
  const doc = new PDFDocument({
    size: [A4_WIDTH, A4_HEIGHT],
    margin: 0,
    compress: true
  });

  const fontBuffer = await fs.readFile(FONT_PATH);
  doc.registerFont("hebrew", fontBuffer);
  doc.font("hebrew");

  const pdfPromise = collectPdfBuffer(doc);
  const background = await backgroundOptions(template);
  if (background) {
    doc.image(background.bytes, 0, 0, {
      width: A4_WIDTH,
      height: A4_HEIGHT
    });
  }

  const layout = announcement?.layoutOverride || { body: {} };
  const box = bodyBox(layout);
  const fontSize = Number(layout?.body?.fontSize) || 24;
  const lineHeight = Number(layout?.body?.lineHeight) || 1.55;
  const align = clean(layout?.body?.textAlign) || "center";
  const blocks = extractBlocks(announcement?.bodyHtml, announcement?.bodyText);

  let cursorY = box.y;
  for (const block of blocks) {
    const blockSize = block.type === "list" ? Math.max(16, fontSize - 2) : fontSize;
    const text = rtlParagraph(block.text);
    const height = doc.heightOfString(text, {
      width: box.width,
      align,
      lineGap: blockSize * (lineHeight - 1)
    });
    if (cursorY + height > box.y + box.height) break;
    doc.fontSize(blockSize).text(text, box.x, cursorY, {
      width: box.width,
      align,
      lineGap: blockSize * (lineHeight - 1)
    });
    cursorY += height + blockSize * 0.22;
  }

  doc.end();
  return pdfPromise;
}
