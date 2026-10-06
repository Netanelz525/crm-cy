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
  return inlineHeadersAndFooters(doc.toBuffer());
}

function inlineHeadersAndFooters(buffer) {
  const zip = new PizZip(buffer);
  let documentXml = zip.file("word/document.xml")?.asText();
  const documentRelsFile = zip.file("word/_rels/document.xml.rels");
  if (!documentXml || !documentRelsFile) return buffer;

  let documentRels = documentRelsFile.asText();
  let nextRelationshipId = 1;
  for (const match of documentRels.matchAll(/Id="rId(\d+)"/g)) {
    nextRelationshipId = Math.max(nextRelationshipId, Number(match[1]) + 1);
  }

  for (const part of [
    ["word/header1.xml", "word/_rels/header1.xml.rels", "hdr"],
    ["word/footer1.xml", "word/_rels/footer1.xml.rels", "ftr"]
  ]) {
    const [xmlPath, relsPath, rootTag] = part;
    const xmlFile = zip.file(xmlPath);
    const relsFile = zip.file(relsPath);
    if (!xmlFile || !relsFile) continue;

    const xml = xmlFile.asText();
    const content = xml
      .replace(new RegExp(`^[\\s\\S]*?<w:${rootTag}[^>]*>`), "")
      .replace(new RegExp(`</w:${rootTag}>[\\s\\S]*$`), "");
    const relationshipIds = {};
    const rels = relsFile.asText();

    for (const match of rels.matchAll(
      /<Relationship\s+Id="([^"]+)"\s+Type="([^"]+)"\s+Target="([^"]+)"\s*\/?\s*>/g
    )) {
      const [, sourceId, type, target] = match;
      const targetId = `rId${nextRelationshipId++}`;
      relationshipIds[sourceId] = targetId;
      documentRels = documentRels.replace(
        "</Relationships>",
        `<Relationship Id="${targetId}" Type="${type}" Target="${target}"/></Relationships>`
      );
    }

    let remappedContent = content;
    for (const [sourceId, targetId] of Object.entries(relationshipIds)) {
      remappedContent = remappedContent
        .replaceAll(`r:embed="${sourceId}"`, `r:embed="${targetId}"`)
        .replaceAll(`r:id="${sourceId}"`, `r:id="${targetId}"`);
    }

    if (rootTag === "hdr") {
      documentXml = documentXml.replace("<w:body>", `<w:body>${remappedContent}`);
    } else {
      const sectionPropertiesIndex = documentXml.lastIndexOf("<w:sectPr");
      if (sectionPropertiesIndex >= 0) {
        documentXml = `${documentXml.slice(0, sectionPropertiesIndex)}${remappedContent}${documentXml.slice(sectionPropertiesIndex)}`;
      }
    }
  }

  zip.file("word/document.xml", documentXml);
  zip.file("word/_rels/document.xml.rels", documentRels);
  return zip.generate({ type: "nodebuffer" });
}
