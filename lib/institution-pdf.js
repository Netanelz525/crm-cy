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
  if (isLandscape) return columns.length > 10 ? 16 : 18;
  if (columns.length > 9) return 18;
  if (columns.length > 7) return 20;
  return 24;
}

function estimatePageSizes(columns, orientation) {
  const basePageSize = estimateRowsPerPage(columns, orientation);
  const firstPageSize = Math.max(8, basePageSize - 4);
  const nextPageSize = basePageSize + 4;
  return {
    firstPageSize,
    nextPageSize
  };
}

function chunkRows(rows, firstPageSize, nextPageSize) {
  if (!rows.length) return [];
  const pages = [];
  let index = 0;
  let pageIndex = 0;
  while (index < rows.length) {
    const size = pageIndex === 0 ? firstPageSize : nextPageSize;
    pages.push(rows.slice(index, index + size));
    index += size;
    pageIndex += 1;
  }
  return pages;
}

function buildHtml({ title, subtitle, columns, rows, exportedAt, orientation, fontUrl }) {
  const isLandscape = orientation === "landscape";
  const fontSize = isLandscape
    ? (columns.length > 9 ? 9 : 10)
    : (columns.length > 8 ? 8 : columns.length > 6 ? 9 : 10);
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
        margin: 14mm 12mm 14mm 12mm;
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
      }
      .report {
        direction: rtl;
      }
      .report-intro {
        margin-bottom: 5mm;
        border: 1px solid #94a3b8;
        background: linear-gradient(180deg, #f8fafc 0%, #eef4fb 100%);
        border-radius: 12px;
        padding: 5mm 5mm 4mm;
        box-shadow: inset 0 1px 0 rgba(255,255,255,0.9);
      }
      .report-intro h1 {
        margin: 0 0 4px;
        font-size: 19px;
        line-height: 1.2;
      }
      .report-intro p {
        margin: 0;
        color: #475569;
        line-height: 1.45;
      }
      .report-intro-summary {
        display: flex;
        flex-wrap: wrap;
        gap: 6px;
        margin-top: 10px;
      }
      .report-chip {
        display: inline-block;
        padding: 4px 9px;
        border-radius: 999px;
        background: #ffffff;
        border: 1px solid #cbd5e1;
        color: #0f172a;
        font-size: 11px;
      }
      .report-meta-inline {
        margin-top: 4px;
        color: #475569;
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
        padding: 8px 6px;
        vertical-align: top;
        text-align: right;
        word-break: break-word;
        overflow-wrap: anywhere;
      }
      th {
        background: #e8eef6;
        color: #0f172a;
        font-weight: 700;
      }
      .row-number-head,
      .row-number-cell {
        width: 9mm;
        min-width: 9mm;
        max-width: 9mm;
        text-align: center;
        white-space: nowrap;
        padding-right: 1px;
        padding-left: 1px;
      }
      tbody tr:nth-child(even) td {
        background: #fafcff;
      }
      .blank-cell {
        min-height: 24px;
        background: #fffef7;
      }
      .empty-state {
        padding: 18mm 8mm;
        border: 1px dashed #cbd5e1;
        border-radius: 14px;
        text-align: center;
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
          <p class="report-meta-inline">עמוד 1 מתוך ${pages.length}</p>
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
