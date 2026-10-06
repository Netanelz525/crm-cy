import Docxtemplater from "docxtemplater";
import PizZip from "pizzip";

export const DOCX_CONTENT_TYPE = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
export const MAX_DOCX_TEMPLATE_BYTES = 15 * 1024 * 1024;

function templateXmlFile(name) {
  return /^word\/(document|header\d+|footer\d+|footnotes|endnotes)\.xml$/i.test(name);
}

export function normalizeDocxTemplate(buffer) {
  const zip = new PizZip(buffer);
  Object.keys(zip.files)
    .filter(templateXmlFile)
    .forEach((name) => {
      const file = zip.file(name);
      if (!file) return;
      const normalized = file.asText().replace(/\{\{([A-Za-z0-9_.-]+)\}\}/g, "{$1}");
      zip.file(name, normalized);
    });

  const normalizedBuffer = zip.generate({ type: "nodebuffer" });
  // Parse once before storage so malformed DOCX files fail at upload time.
  new Docxtemplater(new PizZip(normalizedBuffer), { paragraphLoop: true, linebreaks: true });
  return normalizedBuffer;
}

export function renderDocxTemplate(buffer, data = {}) {
  const doc = new Docxtemplater(new PizZip(buffer), { paragraphLoop: true, linebreaks: true });
  doc.render(data);
  return doc.toBuffer();
}
