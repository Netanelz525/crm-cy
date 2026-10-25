import Docxtemplater from "docxtemplater";
import PizZip from "pizzip";

export const DOCX_CONTENT_TYPE = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
export const MAX_DOCX_TEMPLATE_BYTES = 15 * 1024 * 1024;

function templateXmlFile(name) {
  return /^word\/(document|header\d+|footer\d+|footnotes|endnotes)\.xml$/i.test(name);
}

function hasVisibleParagraphContent(value) {
  return /<w:t\b|<w:tab\b|<w:drawing\b|<w:object\b|<w:fldChar\b|<w:instrText\b/.test(value);
}

function splitLineBreakParagraphs(xml) {
  return xml.replace(/<w:p\b[\s\S]*?<\/w:p>/g, (paragraph) => {
    if (!/<w:br\b/.test(paragraph)) return paragraph;

    const openingTag = paragraph.match(/^<w:p\b[^>]*>/)?.[0] || "<w:p>";
    const properties = paragraph.match(/<w:pPr\b[\s\S]*?<\/w:pPr>/)?.[0] || "";
    const content = paragraph
      .replace(/^<w:p\b[^>]*>/, "")
      .replace(/<\/w:p>$/, "")
      .replace(properties, "")
      // A break is inside a run in WordprocessingML. Close that run before
      // splitting so each generated paragraph remains valid XML.
      .replace(/<w:br\b[^>]*\/\s*>/g, "</w:r><w:docxLineBreak/><w:r>");
    const parts = content.split("<w:docxLineBreak/>").filter(hasVisibleParagraphContent);
    if (parts.length < 2) return paragraph;
    return parts.map((part) => `${openingTag}${properties}${part}</w:p>`).join("");
  });
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
  new Docxtemplater(new PizZip(normalizedBuffer), { paragraphLoop: true, linebreaks: true, errorLogging: false });
  return normalizedBuffer;
}

export function renderDocxTemplate(buffer, data = {}) {
  const doc = new Docxtemplater(new PizZip(buffer), { paragraphLoop: true, linebreaks: true, errorLogging: false });
  doc.render(data);
  const zip = new PizZip(doc.toBuffer());
  Object.keys(zip.files)
    .filter(templateXmlFile)
    .forEach((name) => {
      const file = zip.file(name);
      if (!file) return;
      zip.file(name, splitLineBreakParagraphs(file.asText()));
    });
  return zip.generate({ type: "nodebuffer" });
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


// Kept below the hosting request limit, including multipart overhead.
export const MAX_DOCX_IMPORT_BYTES = 4 * 1024 * 1024;

export function inspectAnnouncementDocx(buffer) {
  if (!buffer?.length || buffer.length > MAX_DOCX_IMPORT_BYTES) throw new Error("יש להעלות קובץ DOCX שאינו ריק, עד 4MB.");
  try {
    const zip = new PizZip(buffer);
    if (!zip.file("word/document.xml") || !zip.file("[Content_Types].xml")) throw new Error("invalid_docx");
    const files = Object.values(zip.files);
    const unpackedSize = files.reduce((sum, file) => sum + Number(file._data?.uncompressedSize || 0), 0);
    if (files.length > 2000 || unpackedSize > 40 * 1024 * 1024) throw new Error("expanded_size");
    const normalized = normalizeDocxTemplate(buffer);
    const names = [];
    const collector = {
      name: "AnnouncementFieldCollector",
      postparse(parts) {
        for (const tag of parts.filter((part) => part.type === "placeholder")) {
          const name = String(tag.value || "").trim();
          if (tag.module || tag.subparsed || !name || name.length > 100 || /(^|[.])(__proto__|prototype|constructor)($|[.])/.test(name)) {
            throw new Error("unsupported_field");
          }
          if (!names.includes(name)) {
            if (names.length >= 100) throw new Error("too_many_fields");
            names.push(name);
          }
        }
        return parts;
      }
    };
    new Docxtemplater(new PizZip(normalized), { paragraphLoop: true, linebreaks: true, errorLogging: false, modules: [collector] });
    if (!names.length) throw new Error("no_fields");
    if (names.length > 100) throw new Error("too_many_fields");
    return { buffer: normalized, fields: names.map((templateFieldId, index) => ({ key: `field_${index + 1}`, templateFieldId, label: "", type: "text", required: false })) };
  } catch (error) {
    const messages = {
      expanded_size: "המסמך גדול מדי לאחר פתיחתו. יש לבחור מסמך פשוט יותר.",
      unsupported_field: "התבנית תומכת בשדות טקסט רגילים כמו {t}. לולאות ושדות מיוחדים אינם נתמכים בייבוא זה.",
      no_fields: "לא נמצאו שדות במסמך. יש לסמן ב־Word שדות בסוגריים מסולסלים, למשל {t}, ולשמור כ־DOCX.",
      too_many_fields: "ניתן לייבא עד 100 שדות שונים במסמך."
    };
    throw new Error(messages[error.message] || "לא ניתן לקרוא את תבנית ה־Word. ודא שהקובץ הוא DOCX תקין ושכל שדה מסומן בסוגריים שלמים, למשל {t}.");
  }
}

export function mappedDocxFields(detected, submitted) {
  if (!Array.isArray(submitted) || submitted.length !== detected.length) throw new Error("יש להגדיר תווית לכל שדה שזוהה במסמך.");
  return detected.map((field, index) => {
    const input = submitted[index];
    if (input.templateFieldId !== field.templateFieldId || !String(input.label || "").trim()) throw new Error("יש להגדיר תווית לכל שדה שזוהה במסמך.");
    if (!["text", "multiline"].includes(input.type)) throw new Error("יש לבחור שדה טקסט או טקסט רב־שורות.");
    return { ...field, label: String(input.label).trim().slice(0, 160), type: input.type };
  });
}
