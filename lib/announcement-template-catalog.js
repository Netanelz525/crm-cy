export const ANNOUNCEMENT_TEMPLATE_CATALOG = [
  {
    templateKey: "general-announcement",
    generatorName: "בלנק מודעות",
    name: "מודעה כללית",
    category: "announcement",
    version: 1,
    engine: "local-pdf",
    active: true,
    fields: [
      {
        key: "body",
        templateFieldId: "7",
        label: "תוכן המודעה",
        type: "multiline",
        required: true,
        maxLength: 1500
      }
    ]
  },
  {
    templateKey: "kollel-letterhead",
    generatorName: "בלנק כולל",
    name: "מכתב על בלנק הכולל",
    category: "letter",
    version: 1,
    engine: "local-pdf",
    active: true,
    fields: [
      {
        key: "body",
        templateFieldId: "data",
        label: "תוכן המכתב",
        type: "multiline",
        required: true,
        maxLength: 2500
      }
    ]
  },
  {
    templateKey: "daily-scholar",
    generatorName: "נציב יום חכמי רגיל",
    name: "נציב יום חכמי ישראל",
    category: "announcement",
    version: 1,
    engine: "local-pdf",
    active: true,
    fields: [
      { key: "date", templateFieldId: "date", label: "תאריך", type: "text", required: true, maxLength: 50 },
      { key: "description", templateFieldId: "d", label: "תיאור", type: "text", required: false, maxLength: 100 },
      { key: "name", templateFieldId: "name", label: "שם", type: "text", required: true, maxLength: 100 }
    ]
  },
  {
    templateKey: "marei-mekomot",
    generatorName: "merei-mekomot",
    name: "מראה מקומות",
    category: "sources",
    version: 1,
    engine: "local-pdf",
    active: true,
    fields: [
      { key: "title", templateFieldId: "4", label: "כותרת ראשית", type: "text", required: true, maxLength: 100 },
      { key: "subtitle", templateFieldId: "1", label: "כותרת משנה", type: "text", required: false, maxLength: 120 },
      { key: "source", templateFieldId: "3", label: "מקור ראשון", type: "multiline", required: true, maxLength: 500 },
      { key: "commentator", templateFieldId: "6", label: "מפרש או מקור נוסף", type: "text", required: false, maxLength: 200 },
      { key: "note", templateFieldId: "7", label: "הערה", type: "text", required: false, maxLength: 200 }
    ]
  },
  {
    templateKey: "or-efraim-sources",
    generatorName: "מראה מקומות אור אפרים",
    name: "מראה מקומות אור אפרים",
    category: "sources",
    version: 1,
    engine: "local-pdf",
    active: true,
    fields: [
      { key: "title", templateFieldId: "1", label: "כותרת ראשית", type: "text", required: true, maxLength: 100 },
      { key: "subtitle", templateFieldId: "2", label: "כותרת משנה", type: "text", required: false, maxLength: 150 },
      { key: "sources", templateFieldId: "3", label: "מראה מקומות", type: "multiline", required: true, maxLength: 1000 }
    ]
  }
];

export function announcementTemplateCatalogRank(templateKey) {
  const index = ANNOUNCEMENT_TEMPLATE_CATALOG.findIndex((template) => template.templateKey === templateKey);
  return index === -1 ? ANNOUNCEMENT_TEMPLATE_CATALOG.length + 1 : index;
}
