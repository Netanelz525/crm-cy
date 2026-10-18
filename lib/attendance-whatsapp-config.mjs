const clean = (value) => String(value ?? "").trim();
const roles = new Set(["student", "father", "mother"]);

export function validateAttendanceWhatsAppConfig(input, templates, statusOptions) {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("הגדרות WhatsApp אינן תקינות.");
  const templateName = clean(input.templateName);
  const templateLanguage = clean(input.templateLanguage) || "he";
  const template = templates.find((item) => item.name === templateName && item.language === templateLanguage);
  if (!template) throw new Error("יש לבחור תבנית WhatsApp מאושרת בשפה שנבחרה.");
  if (/meeting_invitation/i.test(templateName)) throw new Error("תבנית הזמנה נשלחת מאזור ההזמנה של המפגש.");
  const allowed = new Set(statusOptions.map(([value]) => value));
  const readList = (name, valid) => {
    if (!Array.isArray(input[name])) throw new Error(`שדה ${name} חייב להיות רשימה.`);
    const values = input[name].map(clean);
    if (values.some((value) => !valid.has(value))) throw new Error(`ערך לא תקין בשדה ${name}.`);
    return values;
  };
  // Preserve button order; do not sort or silently discard obsolete statuses.
  const responseStatuses = readList("responseStatuses", allowed);
  const buttons = (template.buttons || []).filter((button) => ["QUICK_REPLY", "QUICK_REPLY_BUTTON"].includes(clean(button.type || button.subType).toUpperCase()));
  if (responseStatuses.length !== buttons.length || new Set(responseStatuses).size !== responseStatuses.length) {
    throw new Error(`יש לבחור סטטוס שונה לכל אחד מ־${buttons.length} כפתורי התגובה.`);
  }
  const recipientRoles = [...new Set(readList("recipientRoles", roles))];
  if (!recipientRoles.length) throw new Error("יש לבחור לפחות סוג נמען אחד.");
  const targetStatuses = [...new Set(readList("targetStatuses", allowed))];
  const parameterOverrides = {};
  const definitions = template.parameterDefinitions || [];
  for (const definition of definitions) {
    if (definition.source !== "free") continue;
    const key = String(definition.index);
    parameterOverrides[key] = clean(input.parameterOverrides?.[key]);
  }
  const imageId = clean(input.imageId);
  if (template.requiresMedia && !imageId) throw new Error("התבנית דורשת קובץ מצורף.");
  return { templateName, templateLanguage, parameterOverrides, responseStatuses, recipientRoles, targetStatuses, imageId };
}
