import { HDate } from "@hebcal/core";
import { getPdfFontDataUrl, launchPdfBrowser } from "./pdf-browser.js";

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

const MAX_ROWS_PER_PAGE = 40;

function chunkRows(rows, chunkSize) {
  const chunks = [];
  for (let index = 0; index < rows.length; index += chunkSize) {
    chunks.push(rows.slice(index, index + chunkSize));
  }
  return chunks;
}

function buildHtml({ title, subtitle, columns, rows, exportedAt, orientation, fontUrl }) {
  const isLandscape = orientation === "landscape";
  const fontSize = isLandscape ? 12.5 : 13;
  const gregorianDate = formatGregorianDate(exportedAt);
  const hebrewDate = formatHebrewDate(exportedAt);
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
  const rowChunks = chunkRows(rows, MAX_ROWS_PER_PAGE);
  const renderTable = (pageRows, pageIndex) => `
    <section class="report-page${pageIndex < rowChunks.length - 1 ? " report-page-break" : ""}">
      <table>
        <colgroup>${columnWidths}</colgroup>
        <thead>
          <tr>${headerCells}</tr>
        </thead>
        <tbody>${renderBodyRows(pageRows)}</tbody>
      </table>
    </section>
  `;

  return `<!doctype html>
<html lang="he" dir="rtl">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <style>
      @page {
        size: A4 ${isLandscape ? "landscape" : "portrait"};
        margin: 20mm 4mm 8mm 4mm;
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
        line-height: 1.35;
      }
      .report {
        direction: rtl;
      }
      table {
        width: 100%;
        border-collapse: collapse;
        table-layout: fixed;
      }
      .report-page {
        width: 100%;
      }
      .report-page-break {
        break-after: page;
        page-break-after: always;
      }
      thead {
        display: table-header-group;
      }
      tbody {
        display: table-row-group;
      }
      tr {
        break-inside: avoid;
        page-break-inside: avoid;
      }
      th, td {
        border: 1px solid #cbd5e1;
        padding: 4px 5px;
        vertical-align: middle;
        text-align: right;
        word-break: break-word;
        overflow-wrap: anywhere;
      }
      th {
        background: #e8eef6;
        color: #0f172a;
        font-weight: 700;
        font-size: 11px;
        padding-top: 5px;
        padding-bottom: 5px;
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
        min-height: 15px;
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
      ${rows.length
        ? rowChunks.map(renderTable).join("")
        : `<div class="empty-state">לא נמצאו רשומות לייצוא עבור התצוגה שנבחרה.</div>`}
    </div>
  </body>
</html>`;
}

function buildHeaderTemplate({ title, subtitle, rowsCount, gregorianDate, hebrewDate }) {
  return `
    <div style="width:100%; padding:0 12px; font-family:Arial, sans-serif; direction:rtl; color:#0f172a;">
      <div style="border:1px solid #cbd5e1; border-radius:8px; background:#f8fafc; padding:6px 10px;">
        <div style="display:flex; justify-content:space-between; align-items:flex-start; gap:12px;">
          <div style="font-size:14px; font-weight:700; color:#1e3a8a;">${escapeHtml(title)}</div>
          <div style="font-size:9px; color:#64748b; text-align:left;">
            <span class="pageNumber"></span>/<span class="totalPages"></span>
          </div>
        </div>
        <div style="margin-top:2px; font-size:9px; color:#475569;">${escapeHtml(subtitle)}</div>
        <div style="margin-top:3px; font-size:8px; color:#64748b;">
          סה"כ רשומות: ${rowsCount} | תאריך לועזי: ${escapeHtml(gregorianDate)} | תאריך עברי: ${escapeHtml(hebrewDate)}
        </div>
      </div>
    </div>
  `;
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
  const headerTemplate = buildHeaderTemplate({
    title,
    subtitle,
    rowsCount: rows.length,
    gregorianDate: formatGregorianDate(exportedAt),
    hebrewDate: formatHebrewDate(exportedAt)
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
      displayHeaderFooter: true,
      headerTemplate,
      footerTemplate: "<div></div>",
      preferCSSPageSize: true,
      margin: {
        top: "70px",
        right: "0",
        bottom: "12px",
        left: "0"
      }
    });
    await page.close();
    return Buffer.from(pdf);
  } finally {
    await browser.close();
  }
}
