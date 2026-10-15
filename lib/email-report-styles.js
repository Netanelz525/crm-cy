import JSZip from "jszip";

// SheetJS CE does not serialize custom cell fills. Apply the small set of report
// styles to its generated OOXML so recipients see the highlighting in Excel.
export async function styleEmailReport(buffer, reviews) {
  const zip = await JSZip.loadAsync(buffer);
  let styles = await zip.file("xl/styles.xml").async("string");
  let fillStart = 0;
  styles = styles.replace(/<fills count="(\d+)">([\s\S]*?)<\/fills>/, (_, count, body) => {
    fillStart = Number(count);
    return `<fills count="${fillStart + 3}">${body}${["FFFFD6D6", "FFFFE8A3", "FFDCE6F1"].map((color) => `<fill><patternFill patternType="solid"><fgColor rgb="${color}"/><bgColor indexed="64"/></patternFill></fill>`).join("")}</fills>`;
  });
  let styleStart = 0;
  styles = styles.replace(/<cellXfs count="(\d+)">([\s\S]*?)<\/cellXfs>/, (_, count, body) => {
    styleStart = Number(count);
    return `<cellXfs count="${styleStart + 4}">${body}${[fillStart, fillStart + 1, fillStart + 2, 0].map((fillId) => `<xf numFmtId="0" fontId="0" fillId="${fillId}" borderId="0" xfId="0" applyFill="1" applyAlignment="1"><alignment vertical="top" wrapText="1" readingOrder="2"/></xf>`).join("")}</cellXfs>`;
  });
  let sheet = await zip.file("xl/worksheets/sheet1.xml").async("string");
  sheet = sheet.replace(/<c\b([^>]*\br="[A-Z]+(\d+)"[^>]*)>/g, (tag, attributes, row) => {
    const index = Number(row);
    const priority = reviews[index - 2]?.priority;
    const style = index === 1 ? styleStart + 2 : priority === 0 ? styleStart : priority === 1 ? styleStart + 1 : styleStart + 3;
    return `<c${attributes.replace(/\s+s="\d+"/, "")} s="${style}">`;
  });
  sheet = sheet.replace(/<sheetViews>[\s\S]*?<\/sheetViews>/, '<sheetViews><sheetView workbookViewId="0" rightToLeft="1"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>');
  zip.file("xl/styles.xml", styles);
  zip.file("xl/worksheets/sheet1.xml", sheet);
  return zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
}
