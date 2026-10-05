const HEBREW_TRANSLITERATION = {
  א: "a", ב: "b", ג: "g", ד: "d", ה: "h", ו: "v", ז: "z", ח: "h", ט: "t", י: "y",
  כ: "k", ך: "k", ל: "l", מ: "m", ם: "m", נ: "n", ן: "n", ס: "s", ע: "a", פ: "p",
  ף: "p", צ: "ts", ץ: "ts", ק: "q", ר: "r", ש: "sh", ת: "t"
};

function clean(value) {
  return String(value || "").trim();
}

export function fallbackArticleSlug(title) {
  const transliterated = clean(title).toLowerCase().split("")
    .map((character) => HEBREW_TRANSLITERATION[character] || character)
    .join("");
  const slug = transliterated
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 90);
  return slug || "article";
}

export function normalizeArticleSlug(value, fallbackTitle = "") {
  const raw = clean(value).toLowerCase().split("")
    .map((character) => HEBREW_TRANSLITERATION[character] || character)
    .join("");
  const slug = raw
    .normalize("NFKD")
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/[\s-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 90);
  return slug || fallbackArticleSlug(fallbackTitle);
}
