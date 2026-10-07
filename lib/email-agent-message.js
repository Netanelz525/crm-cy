export function cleanEmailText(value) {
  return String(value || "").trim();
}

export function extractInboundMessageText(data) {
  const text = cleanEmailText(data?.text || data?.plain_text || data?.body_text);
  if (text) return text.slice(0, 20000);
  const html = cleanEmailText(data?.html || data?.body_html);
  return html
    .replace(/<br\s*\/?\s*>/gi, "\n")
    .replace(/<\/p\s*>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s+/g, "\n")
    .trim()
    .slice(0, 20000);
}

export function buildEmailAgentMessage({ subject, body }) {
  const cleanSubject = cleanEmailText(subject);
  const cleanBody = cleanEmailText(body);
  if (cleanSubject && cleanBody) return `נושא המייל: ${cleanSubject}\n\nגוף ההודעה:\n${cleanBody}`;
  return cleanBody || cleanSubject;
}
