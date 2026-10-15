// Backups contain CRM records and file references, never file bodies.
export const BACKUP_EXCLUDED_TABLES = new Set([
  "print_job_uploads",
  "print_job_upload_chunks"
]);

export function isBackupFileColumn(name, dataType = "") {
  return dataType === "bytea" || /base64|^(file|chunk|attachment)_(data|content|bytes)$|^data_url$/i.test(name);
}

export function stripBackupFileContent(value, inAttachment = false) {
  if (typeof value === "string") {
    // Embedded data URLs can also occur inside rich-text HTML.
    return value.replace(/data:[^\s"'<>]*;base64,[A-Za-z0-9+/=_-]+/gi, "[file content excluded]");
  }
  if (Array.isArray(value)) return value.map((item) => stripBackupFileContent(item, inAttachment));
  if (!value || typeof value !== "object" || value instanceof Date) return value;
  const attachment = inAttachment || Boolean(value.filename || value.fileName || value.file_name);
  return Object.fromEntries(Object.entries(value)
    .filter(([key]) => !isBackupFileColumn(key) && !(attachment && /^(content|data|bytes|buffer)$/i.test(key)))
    .map(([key, nested]) => [key, stripBackupFileContent(nested, /^(attachments?|files?)$/i.test(key))]));
}
