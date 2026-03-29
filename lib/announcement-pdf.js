import fs from "fs/promises";
import path from "path";
import { PDFDocument, rgb } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import { parse } from "node-html-parser";
import { getObjectBytesFromR2 } from "./r2";

const A4_WIDTH = 595.28;
const A4_HEIGHT = 841.89;
const FONT_PATH = path.join(process.cwd(), "assets/fonts/NotoSansHebrew-Regular.ttf");
const TEXT_COLOR = rgb(20 / 255, 38 / 255, 66 / 255);

function clean(value) {
  return String(value || "").trim();
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

function extractText(node) {
  if (!node) return "";
  if (node.nodeType === 3) {
    return String(node.rawText || node.text || "").replace(/\u00a0/g, " ");
  }
  if (node.tagName?.toLowerCase() === "br") {
    return "\n";
  }
  const children = Array.isArray(node.childNodes) ? node.childNodes : [];
  return children.map(extractText).join("");
}

function normalizeBlockText(value) {
  return clean(value)
    .replace(/\u00a0/g, " ")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n[ \t]+/g, "\n")
    .replace(/[ \t]{2,}/g, " ");
}

function styleValue(style, key) {
  const raw = clean(style);
  if (!raw) return "";
  for (const part of raw.split(";")) {
    const [property, ...rest] = part.split(":");
    if (clean(property).toLowerCase() === key) {
      return clean(rest.join(":")).toLowerCase();
    }
  }
  return "";
}

function blockAlign(node, fallbackAlign) {
  const value = styleValue(node?.getAttribute?.("style"), "text-align");
  return ["right", "center", "left"].includes(value) ? value : fallbackAlign;
}

function blockSize(tagName, baseFontSize) {
  const tag = clean(tagName).toLowerCase();
  if (tag === "h2") return Math.max(24, Math.round(baseFontSize * 1.45));
  if (tag === "h3") return Math.max(22, Math.round(baseFontSize * 1.2));
  return baseFontSize;
}

function extractBlocks(bodyHtml, bodyText, layout) {
  const fallbackAlign = clean(layout?.body?.textAlign) || "center";
  const baseFontSize = Number(layout?.body?.fontSize) || 24;
  const html = clean(bodyHtml);
  if (!html) {
    return clean(bodyText)
      .split(/\n{2,}/)
      .map((text) => ({
        text: normalizeBlockText(text),
        align: fallbackAlign,
        fontSize: baseFontSize
      }))
      .filter((block) => block.text);
  }

  const root = parse(`<div>${html}</div>`);
  const container = root.firstChild || root;
  const blocks = [];

  for (const child of container.childNodes || []) {
    const tag = clean(child.tagName).toLowerCase();

    if (tag === "ul" || tag === "ol") {
      const listAlign = blockAlign(child, fallbackAlign);
      for (const item of child.querySelectorAll("li")) {
        const text = normalizeBlockText(`• ${extractText(item)}`);
        if (!text) continue;
        blocks.push({
          text,
          align: blockAlign(item, listAlign),
          fontSize: baseFontSize
        });
      }
      continue;
    }

    if (["p", "h2", "h3", "li"].includes(tag)) {
      const text = normalizeBlockText(extractText(child));
      if (!text) continue;
      blocks.push({
        text: tag === "li" ? `• ${text}` : text,
        align: blockAlign(child, fallbackAlign),
        fontSize: blockSize(tag, baseFontSize)
      });
      continue;
    }

    const text = normalizeBlockText(extractText(child));
    if (!text) continue;
    blocks.push({
      text,
      align: fallbackAlign,
      fontSize: baseFontSize
    });
  }

  return blocks.length ? blocks : extractBlocks("", bodyText, layout);
}

function rtlLine(text) {
  return clean(text).split("").reverse().join("");
}

function wrapParagraph(text, font, fontSize, width) {
  const words = clean(text).split(/\s+/).filter(Boolean);
  if (!words.length) return [];

  const lines = [];
  let current = "";
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    const candidateWidth = font.widthOfTextAtSize(rtlLine(candidate), fontSize);
    if (candidateWidth <= width || !current) {
      current = candidate;
      continue;
    }
    lines.push(current);
    current = word;
  }

  if (current) lines.push(current);
  return lines;
}

function backgroundType(contentType) {
  const normalized = clean(contentType).toLowerCase();
  if (normalized === "image/png") return "png";
  if (normalized === "image/jpeg" || normalized === "image/jpg") return "jpg";
  return "";
}

async function drawBackground(pdfDoc, page, template) {
  if (!template?.blankObjectKey) return;
  const object = await getObjectBytesFromR2(template.blankObjectKey);
  const type = backgroundType(template.blankContentType || object.contentType);
  if (!type) return;

  const image = type === "png"
    ? await pdfDoc.embedPng(object.bytes)
    : await pdfDoc.embedJpg(object.bytes);

  page.drawImage(image, {
    x: 0,
    y: 0,
    width: A4_WIDTH,
    height: A4_HEIGHT
  });
}

function drawBlock(page, font, box, block, cursorY, lineHeightMultiplier) {
  const fontSize = Number(block.fontSize) || 24;
  const lineGap = fontSize * Math.max(0, lineHeightMultiplier - 1);
  const paragraphLines = block.text
    .split("\n")
    .flatMap((paragraph) => {
      const normalized = normalizeBlockText(paragraph);
      return normalized ? wrapParagraph(normalized, font, fontSize, box.width) : [""];
    });

  const lineHeight = fontSize + lineGap;
  const blockHeight = paragraphLines.length * lineHeight;
  if (cursorY + blockHeight > box.y + box.height) {
    return { cursorY, rendered: false };
  }

  let lineY = cursorY;
  for (const line of paragraphLines) {
    const renderedText = rtlLine(line);
    const lineWidth = font.widthOfTextAtSize(renderedText, fontSize);
    let x = box.x;
    if (block.align === "right") {
      x = box.x + box.width - lineWidth;
    } else if (block.align === "center") {
      x = box.x + (box.width - lineWidth) / 2;
    }

    page.drawText(renderedText, {
      x,
      y: A4_HEIGHT - lineY - fontSize,
      size: fontSize,
      font,
      color: TEXT_COLOR
    });

    lineY += lineHeight;
  }

  return {
    cursorY: lineY + fontSize * 0.18,
    rendered: true
  };
}

export async function renderAnnouncementPdf({ announcement, template }) {
  const pdfDoc = await PDFDocument.create();
  pdfDoc.registerFontkit(fontkit);
  const page = pdfDoc.addPage([A4_WIDTH, A4_HEIGHT]);

  await drawBackground(pdfDoc, page, template);

  const fontBytes = await fs.readFile(FONT_PATH);
  const font = await pdfDoc.embedFont(fontBytes, { subset: true });
  const layout = announcement?.layoutOverride || { body: {} };
  const box = bodyBox(layout);
  const lineHeightMultiplier = Number(layout?.body?.lineHeight) || 1.55;
  const blocks = extractBlocks(announcement?.bodyHtml, announcement?.bodyText, layout);

  let cursorY = box.y;
  for (const block of blocks) {
    const result = drawBlock(page, font, box, block, cursorY, lineHeightMultiplier);
    if (!result.rendered) break;
    cursorY = result.cursorY;
  }

  return Buffer.from(await pdfDoc.save());
}
