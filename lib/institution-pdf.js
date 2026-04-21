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

function formatDateTime(value) {
  return new Date(value).toLocaleString("he-IL");
}

function inferOrientation(columns, requestedOrientation) {
  const normalized = clean(requestedOrientation).toLowerCase();
  if (normalized === "portrait" || normalized === "landscape") return normalized;
  return columns.length > 6 ? "landscape" : "portrait";
}

function buildHtml({ title, subtitle, columns, rows, exportedAt, orientation, fontUrl }) {
  const isLandscape = orientation === "landscape";
  const fontSize = columns.length > 9 ? 9 : columns.length > 6 ? 10 : 11;
  const headerCells = columns.map((column) => `<th>${escapeHtml(column.label)}</th>`).join("");
  const bodyRows = rows.map((row) => {
    const cells = columns.map((column) => {
      const value = row?.[column.key];
      const text = value === "" ? "&nbsp;" : escapeHtml(value);
      const className = column.kind === "blank" ? "blank-cell" : "";
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
      .report-head {
        display: flex;
        justify-content: space-between;
        align-items: flex-start;
        gap: 12px;
        margin-bottom: 10mm;
      }
      .report-head h1 {
        margin: 0 0 6px;
        font-size: 20px;
        line-height: 1.2;
      }
      .report-head p {
        margin: 0;
        color: #475569;
        line-height: 1.45;
      }
      .report-meta {
        min-width: 140px;
        padding: 10px 12px;
        border: 1px solid #d7dee8;
        border-radius: 12px;
        background: #f8fafc;
      }
      .report-meta strong,
      .report-meta span {
        display: block;
      }
      .report-meta strong {
        margin-bottom: 4px;
        font-size: 18px;
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
      <div class="report-head">
        <div>
          <h1>${escapeHtml(title)}</h1>
          <p>${escapeHtml(subtitle)}</p>
          <p>הופק בתאריך ${escapeHtml(formatDateTime(exportedAt))}</p>
        </div>
        <div class="report-meta">
          <span>סה"כ רשומות</span>
          <strong>${rows.length}</strong>
          <span>${isLandscape ? "פריסת הדפסה רחבה" : "פריסת הדפסה אנכית"}</span>
        </div>
      </div>
      ${rows.length
        ? `<table><thead><tr>${headerCells}</tr></thead><tbody>${bodyRows}</tbody></table>`
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
