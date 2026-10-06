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

export function normalizeDocxForPreview(buffer) {
  const zip = new PizZip(buffer);
  let documentXml = zip.file("word/document.xml")?.asText();
  if (!documentXml) return buffer;

  const sections = [...documentXml.matchAll(/<w:sectPr[\s\S]*?<\/w:sectPr>/g)];
  if (sections.length < 2) return buffer;

  // Google Docs exports can leave several section properties in one logical
  // page. docx-preview treats every section as a new page, unlike Word. Keep
  // the final page settings, but collapse the extra sections and carry the
  // original header/footer references onto the surviving section.
  const headerFooterReferences = sections
    .flatMap((section) => section[0].match(/<w:(?:headerReference|footerReference)[^>]*\/>/g) || [])
    .filter((reference, index, references) => references.indexOf(reference) === index);
  let sectionIndex = 0;
  documentXml = documentXml.replace(/<w:sectPr[\s\S]*?<\/w:sectPr>/g, (section) => {
    sectionIndex += 1;
    if (sectionIndex !== sections.length) return "";
    const withoutReferences = section.replace(/<w:(?:headerReference|footerReference)[^>]*\/>/g, "");
    return withoutReferences.replace("</w:sectPr>", `${headerFooterReferences.join("")}</w:sectPr>`);
  });

  zip.file("word/document.xml", documentXml);
  return zip.generate({ type: "nodebuffer" });
}
