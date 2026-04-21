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

function formatGregorianDate(value) {
  return new Intl.DateTimeFormat("he-IL", {
    dateStyle: "full",
    timeStyle: "short"
  }).format(new Date(value));
}

function formatHebrewDate(value) {
  return new Intl.DateTimeFormat("he-IL-u-ca-hebrew", {
    dateStyle: "full"
  }).format(new Date(value));
}

function inferOrientation(columns, requestedOrientation) {
  const normalized = clean(requestedOrientation).toLowerCase();
  if (normalized === "portrait" || normalized === "landscape") return normalized;
  return "portrait";
}

function buildHtml({ title, subtitle, columns, rows, exportedAt, orientation, fontUrl }) {
  const isLandscape = orientation === "landscape";
  const fontSize = isLandscape
    ? (columns.length > 9 ? 9 : 10)
    : (columns.length > 8 ? 8 : columns.length > 6 ? 9 : 10);
  const gregorianDate = formatGregorianDate(exportedAt);
  const hebrewDate = formatHebrewDate(exportedAt);
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
      .report-intro {
        margin-bottom: 7mm;
      }
      .report-intro h1 {
        margin: 0 0 6px;
        font-size: 20px;
        line-height: 1.2;
      }
      .report-intro p {
        margin: 0;
        color: #475569;
        line-height: 1.45;
      }
      .report-meta-inline {
        margin-top: 6px;
        color: #334155;
      }
      table {
        width: 100%;
        border-collapse: collapse;
        table-layout: fixed;
      }
      thead {
        display: table-header-group;
      }
      tfoot {
        display: table-footer-group;
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
      .repeat-title-row th {
        background: #f8fafc;
        border-color: #94a3b8;
        padding: 10px 8px;
      }
      .repeat-title-shell {
        display: flex;
        align-items: flex-start;
        justify-content: space-between;
        gap: 12px;
      }
      .repeat-title-shell strong,
      .repeat-title-shell span {
        display: block;
      }
      .repeat-title-shell strong {
        font-size: 15px;
        margin-bottom: 3px;
      }
      .repeat-title-meta {
        text-align: left;
        direction: ltr;
        font-size: 11px;
        color: #334155;
        white-space: nowrap;
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
          <p class="report-meta-inline">סה"כ רשומות: ${rows.length} | תאריך לועזי: ${escapeHtml(gregorianDate)} | תאריך עברי: ${escapeHtml(hebrewDate)}</p>
        </div>
      </div>
      ${rows.length
        ? `<table>
            <thead>
              <tr class="repeat-title-row">
                <th colspan="${columns.length}">
                  <div class="repeat-title-shell">
                    <div>
                      <strong>${escapeHtml(title)}</strong>
                      <span>${escapeHtml(subtitle)}</span>
                    </div>
                    <div class="repeat-title-meta">
                      <div>Gregorian: ${escapeHtml(gregorianDate)}</div>
                      <div>Hebrew: ${escapeHtml(hebrewDate)}</div>
                    </div>
                  </div>
                </th>
              </tr>
              <tr>${headerCells}</tr>
            </thead>
            <tbody>${bodyRows}</tbody>
          </table>`
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
