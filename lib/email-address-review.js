const DOMAIN_TYPOS = {
  "gmial.com": "gmail.com", "gamil.com": "gmail.com", "gmal.com": "gmail.com",
  "gmaill.com": "gmail.com", "gmail.con": "gmail.com", "gmail.co": "gmail.com",
  "gmail.com.com": "gmail.com", "gnail.com": "gmail.com", "gmail.cim": "gmail.com",
  "hotmial.com": "hotmail.com", "hotmail.con": "hotmail.com",
  "outlok.com": "outlook.com", "outlook.con": "outlook.com",
  "yaho.com": "yahoo.com", "yahoo.con": "yahoo.com"
};

// These are review hints, not proof of validity and never automatic corrections.
export function reviewEmailAddress(email, reasons = "") {
  const address = String(email || "").trim();
  const parts = address.split("@");
  const domainLabels = (parts[1] || "").split(".");
  if (parts.length !== 2 || !parts[0] || !parts[1] || /\s/.test(address) ||
      /[<>(),;:\\"\[\]]/.test(parts[0]) ||
      parts[0].startsWith(".") || parts[0].endsWith(".") || address.includes("..") ||
      domainLabels.length < 2 || domainLabels.some((label) => label.length > 63 || !/^[\p{L}\p{N}](?:[\p{L}\p{N}-]*[\p{L}\p{N}])?$/u.test(label)) ||
      !/^(?:[\p{L}]{2,}|xn--[a-z0-9-]+)$/iu.test(domainLabels.at(-1))) {
    return { priority: 0, status: "כתובת לא תקינה", action: "לבדוק את מבנה הכתובת, סימן @, רווחים והנקודות.", suggestedDomain: "" };
  }
  const suggestedDomain = DOMAIN_TYPOS[parts[1].toLowerCase()];
  if (suggestedDomain) return {
    priority: 1, status: "חשד לטעות הקלדה", suggestedDomain,
    action: `לבדוק עם בעל הכתובת אם הדומיין אמור להיות ${suggestedDomain}. זו הצעה בלבד.`
  };
  const detail = String(reasons || "");
  if (/\b5\.1\.[123]\b|user unknown|unknown (user|recipient)|no such (user|mailbox)|mailbox (not found|does not exist)|recipient (not found|does not exist)|address (not found|does not exist)|invalid (email|recipient|address)|domain (not found|does not exist)|nxdomain/i.test(detail)) {
    return { priority: 1, status: "יש לאמת את הכתובת", action: "שרת הדואר דיווח שהכתובת או הדומיין לא קיימים. לבדוק הקלדה ולאמת עם בעל הכתובת; ייתכן שהתיבה נסגרה.", suggestedDomain: "" };
  }
  if (/mailbox full|over quota|quota exceeded|\b[45]\.2\.2\b|spam|complain|suppress|block|policy|rate.?limit|temporar|timeout|timed out|defer/i.test(detail)) {
    return { priority: 2, status: "בעיית מסירה — אין ראיה לטעות הקלדה", action: "לבדוק תיבה מלאה, חסימה או תקלה זמנית לפי סיבת השגיאה. אין לשנות כתובת על סמך השגיאה בלבד.", suggestedDomain: "" };
  }
  return { priority: 3, status: "נדרשת בדיקה ידנית", action: "סיבת הכשל אינה מספיקה לזיהוי טעות הקלדה. לאמת את הכתובת מול בעליה אם הכשל חוזר.", suggestedDomain: "" };
}
