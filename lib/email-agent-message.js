export function cleanEmailText(value) {
  return String(value || "").trim();
}

function stripInboundEmailNoise(value) {
  let text = cleanEmailText(value);
  if (!text) return "";

  const forwardedMarker = text.search(/^-{3,}\s*(?:הודעה שהועברה|Forwarded message)\s*-{3,}$/imu);
  if (forwardedMarker >= 0) text = text.slice(forwardedMarker).replace(/^-{3,}[^\n]*\n?/u, "");

  text = text
    .replace(/^(?:מאת|תאריך|נושא|אל|From|Date|Subject|To)\s*:\s*.*(?:\n|$)/gimu, "")
    .replace(/^\s*(?:מוסדות התורה|בברכה|בכבוד רב|Best regards|Regards)\s*\n[\s\S]*$/imu, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  return text.slice(0, 20000);
}

export function extractInboundMessageText(data) {
  const text = cleanEmailText(
    data?.text || data?.plain_text || data?.body_text || data?.email_text
      || data?.text_body || data?.content?.text || data?.email?.text
  );
  if (text) return stripInboundEmailNoise(text);
  const html = cleanEmailText(
    data?.html || data?.body_html || data?.email_html || data?.html_body
      || data?.content?.html || data?.email?.html
  );
  return stripInboundEmailNoise(html
    .replace(/<br\s*\/?\s*>/gi, "\n")
    .replace(/<\/p\s*>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&#39;|&#x27;/gi, "'")
    .replace(/&quot;/gi, '"')
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s+/g, "\n")
    .trim());
}

export function buildEmailAgentMessage({ subject, body }) {
  const cleanSubject = cleanEmailText(subject);
  const cleanBody = cleanEmailText(body);
  if (cleanSubject && cleanBody) {
    return ["הודעת מייל שהתקבלה:", "--- נושא ---", cleanSubject, "--- גוף ההודעה ---", cleanBody, "--- סוף הודעה ---"].join("\n");
  }
  return cleanBody || cleanSubject;
}
