import { HDate } from "@hebcal/core";
import { getPdfFontDataUrl, launchPdfBrowser } from "./pdf-browser";

function clean(value) {
  return String(value || "").trim();
}

function escapeHtml(value) {
  return clean(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function formatGregorianDate(value) {
  return new Intl.DateTimeFormat("he-IL", {
    dateStyle: "full",
    timeStyle: "short"
  }).format(new Date(value));
}

function formatHebrewDate(value) {
  try {
    return new HDate(new Date(value)).renderGematriya();
  } catch {
    return "תאריך עברי לא זמין";
  }
}

function inferOrientation(columns, requestedOrientation) {
  const normalized = clean(requestedOrientation).toLowerCase();
  if (normalized === "portrait" || normalized === "landscape") return normalized;
  return "portrait";
}

function estimateRowsPerPage(columns, orientation) {
  const isLandscape = orientation === "landscape";
  if (columns.length <= 4) return isLandscape ? 44 : 47;
  if (columns.length <= 6) return isLandscape ? 36 : 39;
  if (isLandscape) return columns.length > 10 ? 25 : 28;
  if (columns.length > 9) return 30;
  if (columns.length > 7) return 34;
  return 40;
}

function estimatePageSizes(columns, orientation) {
  const basePageSize = estimateRowsPerPage(columns, orientation);
  const firstPageSize = Math.max(20, basePageSize);
  const nextPageSize = basePageSize;
  return {
    firstPageSize,
    nextPageSize
  };
}

function chunkRows(rows, firstPageSize, nextPageSize) {
  if (!rows.length) return [];
  const totalRows = rows.length;
  let pageCount = 1;
  while (true) {
    const capacity = firstPageSize + Math.max(0, pageCount - 1) * nextPageSize;
    if (capacity >= totalRows) break;
    pageCount += 1;
  }

  const pages = [];
  let index = 0;
  let remainingRows = totalRows;
  let remainingPages = pageCount;

  for (let pageIndex = 0; pageIndex < pageCount; pageIndex += 1) {
    const pageCapacity = pageIndex === 0 ? firstPageSize : nextPageSize;
    const minForRest = Math.max(0, remainingPages - 1);
    const balancedSize = Math.ceil(remainingRows / remainingPages);
    const size = Math.min(pageCapacity, Math.max(1, remainingRows - minForRest, balancedSize));
    pages.push(rows.slice(index, index + size));
    index += size;
    remainingRows -= size;
    remainingPages -= 1;
  }

  return pages;
}

function buildHtml({ title, subtitle, columns, rows, exportedAt, orientation, fontUrl }) {
  const isLandscape = orientation === "landscape";
  const fontSize = isLandscape
    ? (columns.length > 9 ? 8.5 : 9.5)
    : (columns.length > 8 ? 8 : columns.length > 6 ? 8.5 : 9.5);
  const gregorianDate = formatGregorianDate(exportedAt);
  const hebrewDate = formatHebrewDate(exportedAt);
  const { firstPageSize, nextPageSize } = estimatePageSizes(columns, orientation);
  const pages = chunkRows(rows, firstPageSize, nextPageSize);
  const columnWidths = columns.map((column) => (
    column.kind === "rowNumber" ? '<col style="width: 9mm" />' : "<col />"
  )).join("");
  const headerCells = columns.map((column) => `<th class="${column.kind === "rowNumber" ? "row-number-head" : ""}">${escapeHtml(column.label)}</th>`).join("");
  const renderBodyRows = (pageRows) => pageRows.map((row) => {
    const cells = columns.map((column) => {
      const value = row?.[column.key];
      const text = value === "" ? "&nbsp;" : escapeHtml(value);
      const className = [
        column.kind === "blank" ? "blank-cell" : "",
        column.kind === "rowNumber" ? "row-number-cell" : ""
      ].filter(Boolean).join(" ");
      return `<td class="${className}">${text}</td>`;
    }).join("");
    return `<tr>${cells}</tr>`;
  }).join("");

  return `<!doctype html>
<html lang="he" dir="rtl">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <style>
      @page {
        size: A4 ${isLandscape ? "landscape" : "portrait"};
        margin: 5mm 6mm 4mm 6mm;
      }
      @font-face {
        font-family: "NotoSansHebrew";
        src: url("${fontUrl}") format("truetype");
        font-weight: 400;
        font-style: normal;
      }
      html, body {
        margin: 0;
        padding: 0;
        background: #fff;
        color: #1f2937;
        font-family: "NotoSansHebrew", sans-serif;
        -webkit-print-color-adjust: exact;
        print-color-adjust: exact;
      }
      body {
        font-size: ${fontSize}px;
        line-height: 1.2;
      }
      .report {
        direction: rtl;
      }
      .report-intro {
        margin-bottom: 1mm;
        padding: 1.2mm 2mm 1mm;
        border: 1px solid #cbd5e1;
        border-radius: 7px;
        background: linear-gradient(180deg, #f8fafc 0%, #eef4fb 100%);
      }
      .report-intro h1 {
        margin: 0 0 1px;
        font-size: 16px;
        line-height: 1.2;
        color: #1e3a8a;
        text-align: right;
      }
      .report-intro p {
        margin: 0;
        color: #475569;
        font-size: 9.5px;
        line-height: 1.15;
      }
      .report-intro-summary {
        display: flex;
        flex-wrap: wrap;
        gap: 2px;
        margin-top: 2px;
      }
      .report-chip {
        display: inline-block;
        padding: 1px 5px;
        border-radius: 999px;
        background: #ffffff;
        border: 1px solid #cbd5e1;
        color: #334155;
        font-size: 9px;
        line-height: 1.2;
      }
      .report-meta-inline {
        margin-top: 2px;
        color: #64748b;
        font-size: 8.5px;
      }
      .report-page {
        break-after: page;
        page-break-after: always;
      }
      .report-page:last-of-type {
        break-after: auto;
        page-break-after: auto;
      }
      table {
        width: 100%;
        border-collapse: collapse;
        table-layout: fixed;
      }
      thead {
        display: table-header-group;
      }
      tbody tr {
        break-inside: avoid;
        page-break-inside: avoid;
      }
      th, td {
        border: 1px solid #cbd5e1;
        padding: 1px 4px;
        vertical-align: middle;
        text-align: right;
        word-break: break-word;
        overflow-wrap: anywhere;
      }
      th {
        background: #e8eef6;
        color: #0f172a;
        font-weight: 700;
        font-size: ${Math.max(fontSize - 0.5, 8)}px;
      }
      .row-number-head,
      .row-number-cell {
        width: 8mm;
        min-width: 8mm;
        max-width: 8mm;
        text-align: center;
        white-space: nowrap;
        padding-right: 1px;
        padding-left: 1px;
      }
      tbody tr:nth-child(even) td {
        background: #fafcff;
      }
      .blank-cell {
        min-height: 10px;
        background: #fffef7;
      }
      .empty-state {
        padding: 18mm 8mm;
        border: 1px dashed #cbd5e1;
        border-radius: 14px;
        text-align: center;
        color: #64748b;
      }
      .report-footer {
        margin-top: 0.2mm;
        padding-top: 0.2mm;
        text-align: center;
        font-size: 8px;
        color: #64748b;
      }
    </style>
  </head>
  <body>
    <div class="report">
      <div class="report-intro">
        <div>
          <h1>${escapeHtml(title)}</h1>
          <p>${escapeHtml(subtitle)}</p>
          <div class="report-intro-summary">
            <span class="report-chip">סה"כ רשומות: ${rows.length}</span>
            <span class="report-chip">תאריך לועזי: ${escapeHtml(gregorianDate)}</span>
            <span class="report-chip">תאריך עברי: ${escapeHtml(hebrewDate)}</span>
          </div>
          <p class="report-meta-inline">עמוד ראשון מתוך ${pages.length}</p>
        </div>
      </div>
      ${rows.length
        ? pages.map((pageRows, index) => `
            <section class="report-page">
              <table>
                <colgroup>${columnWidths}</colgroup>
                <thead>
                  <tr>${headerCells}</tr>
                </thead>
                <tbody>${renderBodyRows(pageRows)}</tbody>
              </table>
              <div class="report-footer">עמוד ${index + 1} מתוך ${pages.length}</div>
            </section>
          `).join("")
        : `<div class="empty-state">לא נמצאו רשומות לייצוא עבור התצוגה שנבחרה.</div>`}
    </div>
  </body>
</html>`;
}

export async function renderInstitutionPdf({ title, subtitle, columns, rows, orientation }) {
  const exportedAt = new Date().toISOString();
  const fontUrl = await getPdfFontDataUrl();
  const effectiveOrientation = inferOrientation(columns, orientation);
  const html = buildHtml({
    title,
    subtitle,
    columns,
    rows,
    exportedAt,
    orientation: effectiveOrientation,
    fontUrl
  });

  const browser = await launchPdfBrowser();
  try {
    const page = await browser.newPage();
    await page.emulateMediaType("screen");
    await page.setContent(html, { waitUntil: "networkidle0" });
    const pdf = await page.pdf({
      format: "A4",
      landscape: effectiveOrientation === "landscape",
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
