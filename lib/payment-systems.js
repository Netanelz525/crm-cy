import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID } from "crypto";
import { initDb, sql } from "./db";

const STRIPE_API_VERSION = "2026-02-25.clover";
const NEDARIM_REPORT_URL = "https://matara.pro/nedarimplus/Reports/Manage3.aspx";
const FX_API_URL = "https://api.frankfurter.dev/v2/rates";
const FX_TARGET_CURRENCY = "ILS";

let paymentTablesReady = false;
let paymentTablesPromise = null;
const fxSeriesCache = new Map();

function clean(value) {
  return String(value || "").trim();
}

function cleanLower(value) {
  return clean(value).toLowerCase();
}

function normalizeSpreadsheetCell(value) {
  const text = clean(value).replace(/\uFEFF/g, "");
  const excelWrapped = text.match(/^="([\s\S]*)"$/);
  if (excelWrapped) return clean(excelWrapped[1]);
  return text;
}

function toJson(value, fallback = {}) {
  try {
    return value ? JSON.parse(value) : fallback;
  } catch {
    return fallback;
  }
}

async function ensurePaymentTables() {
  await initDb();
  if (paymentTablesReady) return;
  if (paymentTablesPromise) {
    await paymentTablesPromise;
    return;
  }

  paymentTablesPromise = (async () => {
    await sql`
      CREATE TABLE IF NOT EXISTS payment_provider_accounts (
        id TEXT PRIMARY KEY,
        provider TEXT NOT NULL,
        label TEXT NOT NULL,
        external_id TEXT,
        encrypted_secret TEXT NOT NULL,
        config_json JSONB NOT NULL DEFAULT '{}'::jsonb,
        is_active BOOLEAN NOT NULL DEFAULT TRUE,
        created_by_user_id TEXT REFERENCES app_users(clerk_user_id),
        updated_by_user_id TEXT REFERENCES app_users(clerk_user_id),
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `;
    await sql`ALTER TABLE payment_provider_accounts ADD COLUMN IF NOT EXISTS external_id TEXT`;
    await sql`ALTER TABLE payment_provider_accounts ADD COLUMN IF NOT EXISTS config_json JSONB NOT NULL DEFAULT '{}'::jsonb`;
    await sql`ALTER TABLE payment_provider_accounts ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT TRUE`;
    await sql`ALTER TABLE payment_provider_accounts ADD COLUMN IF NOT EXISTS created_by_user_id TEXT`;
    await sql`ALTER TABLE payment_provider_accounts ADD COLUMN IF NOT EXISTS updated_by_user_id TEXT`;
    await sql`ALTER TABLE payment_provider_accounts ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()`;
    await sql`ALTER TABLE payment_provider_accounts ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()`;
    await sql`CREATE INDEX IF NOT EXISTS idx_payment_provider_accounts_provider ON payment_provider_accounts (provider, is_active, updated_at DESC)`;
    paymentTablesReady = true;
  })();

  await paymentTablesPromise;
}

function getEncryptionKey() {
  const raw = clean(process.env.PAYMENT_SYSTEMS_SECRET)
    || clean(process.env.AUTH_SETUP_PASSWORD)
    || clean(process.env.CLERK_SECRET_KEY)
    || clean(process.env.DATABASE_URL);
  return createHash("sha256").update(raw).digest();
}

function encryptSecret(secret) {
  const plaintext = clean(secret);
  if (!plaintext) throw new Error("חסר סוד להצפנה.");
  const key = getEncryptionKey();
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString("base64")}:${tag.toString("base64")}:${encrypted.toString("base64")}`;
}

function decryptSecret(payload) {
  const serialized = clean(payload);
  if (!serialized) return "";
  const [ivB64, tagB64, encryptedB64] = serialized.split(":");
  if (!ivB64 || !tagB64 || !encryptedB64) return "";
  const decipher = createDecipheriv("aes-256-gcm", getEncryptionKey(), Buffer.from(ivB64, "base64"));
  decipher.setAuthTag(Buffer.from(tagB64, "base64"));
  return Buffer.concat([
    decipher.update(Buffer.from(encryptedB64, "base64")),
    decipher.final()
  ]).toString("utf8");
}

function mapConnectionRow(row, { includeSecret = false } = {}) {
  if (!row) return null;
  return {
    id: row.id,
    provider: cleanLower(row.provider),
    label: clean(row.label),
    external_id: clean(row.external_id),
    config: typeof row.config_json === "object" && row.config_json
      ? row.config_json
      : toJson(row.config_json, {}),
    is_active: row.is_active !== false,
    created_at: row.created_at,
    updated_at: row.updated_at,
    created_by_user_id: clean(row.created_by_user_id),
    updated_by_user_id: clean(row.updated_by_user_id),
    secret: includeSecret ? decryptSecret(row.encrypted_secret) : "",
    has_secret: Boolean(clean(row.encrypted_secret))
  };
}

function providerLabel(provider) {
  return cleanLower(provider) === "stripe" ? "Stripe" : "נדרים";
}

function normalizeCurrency(value) {
  const normalized = clean(value || "ILS").toUpperCase();
  if (["1"].includes(normalized)) return "ILS";
  if (["2"].includes(normalized)) return "USD";
  if (["3"].includes(normalized)) return "EUR";
  if (["שקל", "ש\"ח", "שח", "NIS", "ILS"].includes(normalized)) return "ILS";
  if (["דולר", "דולרים", "USD", "$"].includes(normalized)) return "USD";
  if (["EUR", "€", "יורו"].includes(normalized)) return "EUR";
  return normalized;
}

function roundMoney(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 0;
  return Math.round(numeric * 100) / 100;
}

function normalizeAmount(value) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const text = clean(value).replace(/,/g, "");
  const amount = Number(text);
  return Number.isFinite(amount) ? amount : 0;
}

function normalizeAmountFromAgorot(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric / 100 : 0;
}

function normalizeStripeObject(value) {
  if (!value || typeof value !== "object") return null;
  return value;
}

function isSuccessfulStripeTransaction(transaction) {
  const source = normalizeStripeObject(transaction?.source);
  const charge = source?.object === "charge" ? source : null;
  const paymentIntent = normalizeStripeObject(
    charge?.payment_intent_object
    || transaction?.payment_intent_object
    || (source?.object === "payment_intent" ? source : null)
  );
  const balanceType = clean(transaction?.type).toLowerCase();
  const chargeStatus = clean(charge?.status).toLowerCase();
  const paymentIntentStatus = clean(paymentIntent?.status).toLowerCase();
  const amount = Number(transaction?.amount) || 0;

  if (amount <= 0) return false;
  if (balanceType && balanceType !== "charge" && balanceType !== "payment") return false;
  if (charge && chargeStatus && chargeStatus !== "succeeded") return false;
  if (paymentIntent && paymentIntentStatus && paymentIntentStatus !== "succeeded") return false;
  if (!charge && !paymentIntent) return false;
  return true;
}

function toInputDate(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const copy = new Date(date);
  copy.setHours(12, 0, 0, 0);
  return copy.toISOString().slice(0, 10);
}

function toNedarimDate(value) {
  const input = toInputDate(value);
  if (!input) return "";
  const [year, month, day] = input.split("-");
  return `${day}/${month}/${year}`;
}

function toUnixTimestampEndOfDay(value) {
  const input = toInputDate(value);
  if (!input) return 0;
  return Math.floor(new Date(`${input}T23:59:59.000Z`).getTime() / 1000);
}

function toUnixTimestampStartOfDay(value) {
  const input = toInputDate(value);
  if (!input) return 0;
  return Math.floor(new Date(`${input}T00:00:00.000Z`).getTime() / 1000);
}

function shiftInputDate(value, offsetDays) {
  const input = toInputDate(value);
  if (!input) return "";
  const date = new Date(`${input}T12:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + offsetDays);
  return date.toISOString().slice(0, 10);
}

function extractTransactionInputDate(transaction) {
  const createdAt = clean(transaction?.createdAt);
  if (createdAt) {
    const parsed = new Date(createdAt);
    if (!Number.isNaN(parsed.getTime())) {
      return parsed.toISOString().slice(0, 10);
    }
    const match = createdAt.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})/);
    if (match) {
      const [, day, month, year] = match;
      const fullYear = year.length === 2 ? `20${year}` : year;
      return `${fullYear}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
    }
  }
  if (Number(transaction?.createdAtUnix)) {
    return new Date(Number(transaction.createdAtUnix) * 1000).toISOString().slice(0, 10);
  }
  return "";
}

function parseDateValueToIso(value) {
  const input = clean(value);
  if (!input) return "";
  const direct = new Date(input);
  if (!Number.isNaN(direct.getTime())) {
    return direct.toISOString().slice(0, 10);
  }
  const match = input.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})/);
  if (!match) return "";
  const [, day, month, year] = match;
  const fullYear = year.length === 2 ? `20${year}` : year;
  return `${fullYear}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
}

function isDateWithinRange(value, dateFrom, dateTo) {
  const iso = parseDateValueToIso(value);
  if (!iso) return false;
  const from = toInputDate(dateFrom);
  const to = toInputDate(dateTo);
  if (from && iso < from) return false;
  if (to && iso > to) return false;
  return true;
}

async function fetchFxSeries({ baseCurrency, quoteCurrency = FX_TARGET_CURRENCY, dateFrom, dateTo }) {
  const base = normalizeCurrency(baseCurrency);
  const quote = normalizeCurrency(quoteCurrency);
  if (!base || !quote || base === quote) return [];

  const safeFrom = shiftInputDate(dateFrom, -7);
  const safeTo = toInputDate(dateTo);
  const cacheKey = `${base}:${quote}:${safeFrom}:${safeTo}`;
  if (fxSeriesCache.has(cacheKey)) {
    return fxSeriesCache.get(cacheKey);
  }

  const params = new URLSearchParams({
    from: safeFrom,
    to: safeTo,
    base,
    quotes: quote,
    providers: "ECB"
  });
  const response = await fetch(`${FX_API_URL}?${params.toString()}`, {
    cache: "no-store"
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok || !Array.isArray(payload)) {
    throw new Error(`שערי חליפין לא זמינים עבור ${base}/${quote}.`);
  }

  const series = payload
    .map((item) => ({
      date: clean(item?.date),
      rate: Number(item?.rate)
    }))
    .filter((item) => item.date && Number.isFinite(item.rate) && item.rate > 0)
    .sort((left, right) => left.date.localeCompare(right.date));

  fxSeriesCache.set(cacheKey, series);
  return series;
}

function resolveFxRateForDate(series, targetDate) {
  const safeTargetDate = toInputDate(targetDate);
  if (!safeTargetDate) return null;
  let match = null;
  for (const item of series) {
    if (item.date > safeTargetDate) break;
    match = item;
  }
  return match;
}

async function enrichTransactionsWithIlsAmounts(transactions, { dateFrom, dateTo }) {
  const currencies = [...new Set(
    transactions
      .map((transaction) => normalizeCurrency(transaction?.currency || transaction?.originalCurrency || FX_TARGET_CURRENCY))
      .filter((currency) => currency && currency !== FX_TARGET_CURRENCY)
  )];

  const fxByCurrency = new Map();
  const fxResults = await Promise.allSettled(currencies.map(async (currency) => ({
    currency,
    series: await fetchFxSeries({
      baseCurrency: currency,
      quoteCurrency: FX_TARGET_CURRENCY,
      dateFrom,
      dateTo
    })
  })));

  fxResults.forEach((result, index) => {
    const currency = currencies[index];
    if (result.status === "fulfilled") {
      fxByCurrency.set(result.value.currency, result.value.series);
      return;
    }
    fxByCurrency.set(currency, []);
  });

  return transactions.map((transaction) => {
    const originalCurrency = normalizeCurrency(transaction?.currency || transaction?.originalCurrency || FX_TARGET_CURRENCY);
    const transactionDate = extractTransactionInputDate(transaction) || toInputDate(dateTo);
    const originalAmount = roundMoney(transaction?.originalAmount ?? transaction?.amount);
    const settlementCurrency = normalizeCurrency(transaction?.settlementCurrency || transaction?.currency || originalCurrency);
    const originalNetAmount = transaction?.originalNetAmount == null ? null : roundMoney(transaction.originalNetAmount);
    const originalFeeAmount = transaction?.originalFeeAmount == null ? null : roundMoney(transaction.originalFeeAmount);
    const settlementNetAmount = roundMoney(transaction?.settlementNetAmount ?? transaction?.netAmount);
    const settlementFeeAmount = roundMoney(transaction?.settlementFeeAmount ?? transaction?.feeAmount);

    if (originalCurrency === FX_TARGET_CURRENCY) {
      return {
        ...transaction,
        originalCurrency,
        originalAmount,
        originalNetAmount: originalNetAmount ?? settlementNetAmount,
        originalFeeAmount: originalFeeAmount ?? settlementFeeAmount,
        amountIls: originalAmount,
        netAmountIls: originalNetAmount ?? settlementNetAmount,
        feeAmountIls: originalFeeAmount ?? settlementFeeAmount,
        fxRateToIls: 1,
        fxRateDate: transactionDate
      };
    }

    const fxEntry = resolveFxRateForDate(fxByCurrency.get(originalCurrency) || [], transactionDate);
    const settlementFxEntry = settlementCurrency === FX_TARGET_CURRENCY
      ? { rate: 1, date: transactionDate }
      : resolveFxRateForDate(fxByCurrency.get(settlementCurrency) || [], transactionDate);
    if (!fxEntry) {
      return {
        ...transaction,
        originalCurrency,
        originalAmount,
        originalNetAmount,
        originalFeeAmount,
        amountIls: 0,
        netAmountIls: settlementFxEntry ? roundMoney(settlementNetAmount * settlementFxEntry.rate) : 0,
        feeAmountIls: settlementFxEntry ? roundMoney(settlementFeeAmount * settlementFxEntry.rate) : 0,
        fxRateToIls: null,
        fxRateDate: ""
      };
    }

    return {
      ...transaction,
      originalCurrency,
      originalAmount,
      originalNetAmount: originalNetAmount ?? null,
      originalFeeAmount: originalFeeAmount ?? null,
      amountIls: roundMoney(originalAmount * fxEntry.rate),
      netAmountIls: settlementFxEntry
        ? roundMoney(settlementNetAmount * settlementFxEntry.rate)
        : (originalNetAmount == null ? 0 : roundMoney(originalNetAmount * fxEntry.rate)),
      feeAmountIls: settlementFxEntry
        ? roundMoney(settlementFeeAmount * settlementFxEntry.rate)
        : (originalFeeAmount == null ? 0 : roundMoney(originalFeeAmount * fxEntry.rate)),
      fxRateToIls: fxEntry.rate,
      fxRateDate: fxEntry.date
    };
  });
}

function decodePaymentText(buffer) {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer || 0);
  if (!bytes.length) return "";
  const hasUtf16Bom = bytes.length > 1 && (
    (bytes[0] === 0xff && bytes[1] === 0xfe)
    || (bytes[0] === 0xfe && bytes[1] === 0xff)
  );
  const looksUtf16Le = hasUtf16Bom || (
    bytes.length > 8
    && bytes[1] === 0x00
    && bytes[3] === 0x00
  );
  if (looksUtf16Le) {
    return new TextDecoder("utf-16le").decode(bytes);
  }
  return new TextDecoder("utf-8").decode(bytes);
}

function countDelimiterCandidates(line, delimiter) {
  return String(line || "").split(delimiter).length;
}

function detectNedarimDelimiter(text) {
  const firstLine = String(text || "").replace(/^\uFEFF/, "").split(/\r?\n/, 1)[0] || "";
  const tabColumns = countDelimiterCandidates(firstLine, "\t");
  const commaColumns = countDelimiterCandidates(firstLine, ",");
  return tabColumns >= commaColumns ? "\t" : ",";
}

function parseDelimitedRecords(text, delimiter) {
  const input = String(text || "").replace(/^\uFEFF/, "");
  const rows = [];
  let row = [];
  let cell = "";
  let inQuotes = false;

  for (let index = 0; index < input.length; index += 1) {
    const char = input[index];
    const next = input[index + 1];

    if (char === "\"") {
      if (inQuotes && next === "\"") {
        cell += "\"";
        index += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (!inQuotes && char === delimiter) {
      row.push(cell);
      cell = "";
      continue;
    }

    if (!inQuotes && (char === "\n" || char === "\r")) {
      if (char === "\r" && next === "\n") {
        index += 1;
      }
      row.push(cell);
      cell = "";
      if (row.some((value) => clean(value))) {
        rows.push(row);
      }
      row = [];
      continue;
    }

    cell += char;
  }

  if (cell.length || row.length) {
    row.push(cell);
    if (row.some((value) => clean(value))) {
      rows.push(row);
    }
  }

  return rows;
}

function parseTabDelimitedRecords(text) {
  return String(text || "")
    .replace(/^\uFEFF/, "")
    .split(/\r?\n/)
    .filter((line) => clean(line))
    .map((line) => line.split("\t"));
}

function isNedarimDate(value) {
  return /^\d{1,2}\/\d{1,2}\/\d{2,4}(?:\s+\d{1,2}:\d{2}(?::\d{2})?)?$/.test(clean(value));
}

function isCurrencyToken(value) {
  return ["שקל", "ils", "usd", "eur"].includes(cleanLower(value));
}

function isNumericLike(value) {
  return /^-?\d+(?:\.\d+)?$/.test(clean(value));
}

function isPhoneLike(value) {
  return /^[+\d][\d\s\-]{5,}$/.test(clean(value));
}

function isEmailLike(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(clean(value));
}

function createNedarimRow(headers, values) {
  const row = {};
  headers.forEach((header, index) => {
    row[header] = normalizeSpreadsheetCell(values[index] || "");
  });
  return row;
}

function alignNedarimRow(headers, values) {
  const parts = values.map(normalizeSpreadsheetCell);
  if (parts.length === headers.length) {
    return createNedarimRow(headers, parts);
  }

  const dateIndex = parts.findIndex(isNedarimDate);
  if (dateIndex < 3) {
    return createNedarimRow(headers, parts);
  }

  const amountIndex = dateIndex - 2;
  const row = createNedarimRow(headers, Array(headers.length).fill(""));

  row["מספר זהות"] = parts[0] || "";
  row["שם"] = parts[1] || "";

  const contactParts = parts.slice(2, amountIndex);
  let email = "";
  let phone = "";
  const addressParts = [];

  contactParts.forEach((part) => {
    if (!email && isEmailLike(part)) {
      email = part;
      return;
    }
    if (!phone && isPhoneLike(part)) {
      phone = part;
      return;
    }
    if (clean(part)) {
      addressParts.push(part);
    }
  });

  row["כתובת"] = addressParts.join(" ").trim();
  row["טלפון"] = phone;
  row["מייל"] = email;
  row["סכום"] = parts[amountIndex] || "";
  row["מטבע"] = parts[amountIndex + 1] || "";
  row["תאריך עסקה"] = parts[dateIndex] || "";
  row["מספר אישור"] = parts[dateIndex + 1] || "";
  row["4 ספרות אחרונות"] = parts[dateIndex + 2] || "";
  row["תוקף"] = parts[dateIndex + 3] || "";

  const tail = parts.slice(dateIndex + 4);
  row["מספר קבלה"] = tail.at(-1) || "";
  row["מספר שובר"] = tail.at(-2) || "";
  row["מספר עסקה"] = tail.at(-3) || "";
  row["מספר הו\"ק"] = tail.at(-4) || "";
  row["חברה סולקת"] = tail.at(-5) || "";
  row["מותג"] = tail.at(-6) || "";

  const middle = tail.slice(0, Math.max(0, tail.length - 6));
  let cursor = 0;

  if (middle[cursor] && isNumericLike(middle[cursor])) {
    row["תשלומים"] = middle[cursor];
    cursor += 1;
  }

  if (middle[cursor]) {
    row["קטגוריה"] = middle[cursor];
    cursor += 1;
  }

  if (middle[cursor]) {
    row["הערות"] = middle[cursor];
    cursor += 1;
  }

  if (middle.length - cursor > 1 && isNumericLike(middle.at(-1))) {
    row["מספר מסוף"] = middle.at(-1);
    row["שם מסוף"] = middle.slice(cursor, -1).filter((value) => clean(value)).join(" | ");
  } else {
    row["שם מסוף"] = middle.slice(cursor).filter((value) => clean(value)).join(" | ");
  }

  if (!row["מטבע"] && isCurrencyToken(parts[amountIndex + 1])) {
    row["מטבע"] = parts[amountIndex + 1];
  }

  return row;
}

function parseNedarimDelimitedText(text) {
  const delimiter = detectNedarimDelimiter(text);
  const records = delimiter === "\t"
    ? parseTabDelimitedRecords(text)
    : parseDelimitedRecords(text, delimiter);
  const headers = (records.shift() || []).map(clean).filter(Boolean);
  if (!headers.length) return [];
  return records
    .map((record) => alignNedarimRow(headers, record))
    .filter((row) => Object.values(row).some((value) => clean(value)));
}

function findRowValue(row, candidates) {
  for (const key of candidates) {
    if (clean(row?.[key])) return clean(row[key]);
  }
  return "";
}

function mapNedarimTransaction(connection, row) {
  const dateText = findRowValue(row, ["תאריך עסקה"]);
  const amountText = findRowValue(row, ["סכום"]);
  const amount = normalizeAmount(amountText);
  const receiptNumber = findRowValue(row, ["מספר קבלה"]);
  const transactionNumber = findRowValue(row, ["מספר עסקה"]);
  const voucherNumber = findRowValue(row, ["מספר שובר"]);
  const customerName = findRowValue(row, ["שם"]);
  const donorId = findRowValue(row, ["מספר זהות"]);

  if (!dateText || !Number.isFinite(amount) || amount <= 0) return null;
  if (!receiptNumber && !transactionNumber && !voucherNumber) return null;
  if (customerName && isNumericLike(customerName) && donorId && receiptNumber === donorId) return null;

  let createdAtUnix = Date.parse(dateText) || 0;
  if (!createdAtUnix && /^\d{1,2}\/\d{1,2}\/\d{2,4}/.test(dateText)) {
    const [datePart, timePart = "00:00:00"] = dateText.split(" ");
    const [day, month, year] = datePart.split("/");
    const fullYear = year.length === 2 ? `20${year}` : year;
    createdAtUnix = Date.parse(`${fullYear}-${month.padStart(2, "0")}-${day.padStart(2, "0")}T${timePart}`) || 0;
  }
  const category = findRowValue(row, ["קטגוריה"]);
  const notes = findRowValue(row, ["הערות"]);
  const terminalName = findRowValue(row, ["שם מסוף"]);
  const terminalNumber = findRowValue(row, ["מספר מסוף"]);
  const paymentCount = findRowValue(row, ["תשלומים"]);
  const brand = findRowValue(row, ["מותג"]);
  const company = findRowValue(row, ["חברה סולקת"]);
  const descriptionParts = [category, notes, terminalName].filter(Boolean);
  const typeParts = [paymentCount, brand].filter(Boolean);
  return {
    id: clean(findRowValue(row, ["מספר עסקה", "מספר קבלה", "מספר שובר"])) || randomUUID(),
    provider: "nederim",
    providerLabel: providerLabel("nederim"),
    connectionId: connection.id,
    connectionLabel: connection.label,
    externalId: connection.external_id,
    currency: normalizeCurrency(findRowValue(row, ["מטבע"]) || "ILS"),
    amount,
    netAmount: amount,
    feeAmount: 0,
    status: "success",
    description: descriptionParts.join(" | "),
    customerName,
    reference: findRowValue(row, ["מספר אישור", "מספר עסקה", "מספר קבלה"]),
    type: typeParts.join(" | "),
    createdAt: dateText,
    createdAtUnix,
    raw: row,
    donorId,
    phone: findRowValue(row, ["טלפון"]),
    email: findRowValue(row, ["מייל"]),
    receiptNumber,
    voucherNumber,
    transactionNumber,
    directDebitNumber: findRowValue(row, ["מספר הו\"ק"]),
    terminalNumber,
    brand,
    clearingCompany: company
  };
}

function mapStripeTransaction(connection, transaction) {
  const source = normalizeStripeObject(transaction?.source);
  const charge = source?.object === "charge" ? source : null;
  const paymentIntent = normalizeStripeObject(charge?.payment_intent_object || transaction?.payment_intent_object || (source?.object === "payment_intent" ? source : null));
  const customer = normalizeStripeObject(charge?.customer_object || paymentIntent?.customer_object || transaction?.customer_object);
  const billingDetails = charge?.billing_details || {};
  const metadata = {
    ...(customer?.metadata || {}),
    ...(paymentIntent?.metadata || {}),
    ...(charge?.metadata || {})
  };
  const email = clean(
    billingDetails?.email
      || charge?.receipt_email
      || customer?.email
      || paymentIntent?.receipt_email
  );
  const phone = clean(
    billingDetails?.phone
      || customer?.phone
  );
  const customerName = clean(
    billingDetails?.name
      || customer?.name
      || paymentIntent?.shipping?.name
  );
  const brand = clean(charge?.payment_method_details?.card?.brand);
  const last4 = clean(charge?.payment_method_details?.card?.last4);
  const description = [
    clean(transaction?.description),
    clean(charge?.description),
    clean(paymentIntent?.description),
    clean(charge?.statement_descriptor)
  ].filter(Boolean).join(" | ");
  const receiptNumber = clean(metadata.receipt_number || metadata.receipt || metadata.receiptNumber);
  const voucherNumber = clean(metadata.invoice_number || metadata.invoice || metadata.voucher_number);
  const transactionNumber = clean(charge?.id || paymentIntent?.id || transaction?.source || transaction?.id);
  const originalCurrency = normalizeCurrency(
    charge?.currency
      || paymentIntent?.currency
      || source?.currency
      || transaction?.currency
  );
  const originalAmount = normalizeAmountFromAgorot(
    charge?.amount
      ?? paymentIntent?.amount_received
      ?? paymentIntent?.amount
      ?? source?.amount
      ?? transaction?.amount
  );
  const settlementCurrency = normalizeCurrency(transaction?.currency);
  const settlementAmount = normalizeAmountFromAgorot(transaction?.amount);
  const settlementNetAmount = normalizeAmountFromAgorot(transaction?.net);
  const settlementFeeAmount = normalizeAmountFromAgorot(transaction?.fee);
  return {
    id: clean(transaction?.id) || randomUUID(),
    provider: "stripe",
    providerLabel: providerLabel("stripe"),
    connectionId: connection.id,
    connectionLabel: connection.label,
    externalId: clean(connection.external_id || transaction?.source || ""),
    currency: originalCurrency,
    amount: originalAmount,
    netAmount: settlementNetAmount,
    feeAmount: settlementFeeAmount,
    status: clean(charge?.status || paymentIntent?.status || transaction?.status || "success"),
    description,
    customerName,
    reference: clean(charge?.id || transaction?.source || transaction?.id),
    type: [
      clean(transaction?.type),
      brand ? `card ${brand}` : "",
      last4 ? `****${last4}` : ""
    ].filter(Boolean).join(" | "),
    createdAt: transaction?.created ? new Date(transaction.created * 1000).toISOString() : "",
    createdAtUnix: Number(transaction?.created) || 0,
    raw: transaction,
    donorId: clean(metadata.donor_id || metadata.tz || metadata.identity_number || metadata.id_number),
    phone,
    email,
    receiptNumber,
    voucherNumber,
    transactionNumber,
    directDebitNumber: clean(metadata.direct_debit_number || metadata.mandate),
    terminalNumber: "",
    brand,
    clearingCompany: "Stripe",
    originalAmount,
    originalCurrency,
    originalNetAmount: null,
    originalFeeAmount: null,
    settlementAmount,
    settlementCurrency,
    settlementNetAmount,
    settlementFeeAmount
  };
}

function formatStripeInterval(interval, count) {
  const safeInterval = cleanLower(interval);
  const safeCount = Number(count) || 1;
  const labels = {
    day: safeCount === 1 ? "יומי" : `כל ${safeCount} ימים`,
    week: safeCount === 1 ? "שבועי" : `כל ${safeCount} שבועות`,
    month: safeCount === 1 ? "חודשי" : `כל ${safeCount} חודשים`,
    year: safeCount === 1 ? "שנתי" : `כל ${safeCount} שנים`
  };
  return labels[safeInterval] || `${safeInterval || "unknown"} ${safeCount}`;
}

function formatNedarimFrequency(value) {
  const code = clean(value);
  const labels = {
    "1": "חודשי",
    "2": "דו-חודשי",
    "3": "רבעוני",
    "6": "חצי שנתי",
    "12": "שנתי"
  };
  return labels[code] || code;
}

function isNedarimNoRemainingPaymentsIssue(value) {
  const text = clean(value).replace(/\s+/g, " ");
  return text.includes("לא פעיל") && text.includes("אין יתרת תשלומים");
}

function mapNedarimMandateStatus(value) {
  const code = clean(value);
  if (code === "1") return { status: "active", label: "פעילה" };
  if (code === "2") return { status: "issues", label: "מוקפאת" };
  if (code === "3") return { status: "issues", label: "נמחקה" };
  return { status: "issues", label: code || "לא ידוע" };
}

function mapStripeCancellationReason(value) {
  const reason = cleanLower(value);
  if (reason === "payment_failed") return "חיוב נכשל";
  if (reason === "payment_disputed") return "עסקה הוכחשה";
  if (reason === "cancellation_requested") return "סיום תשלומים / ביטול יזום";
  return clean(value);
}

function mapStripeDeclineCode(value) {
  const code = cleanLower(value);
  if (code === "insufficient_funds") return "אין מספיק יתרה";
  if (code === "do_not_honor") return "העסקה סורבה על ידי המנפיק";
  if (code === "generic_decline") return "העסקה נדחתה";
  if (code === "expired_card") return "תוקף הכרטיס פג";
  if (code === "incorrect_cvc") return "קוד אבטחה שגוי";
  if (code === "lost_card") return "הכרטיס דווח כאבוד";
  if (code === "stolen_card") return "הכרטיס דווח כגנוב";
  if (code === "processing_error") return "שגיאת עיבוד בחיוב";
  if (code === "card_not_supported") return "הכרטיס לא נתמך";
  if (code === "pickup_card") return "הכרטיס נחסם על ידי המנפיק";
  return clean(value);
}

function getStripeIssueText(subscription, latestInvoice, paymentIntent) {
  const paymentError = normalizeStripeObject(paymentIntent?.last_payment_error);
  const invoiceError = normalizeStripeObject(latestInvoice?.last_finalization_error);
  const invoicePaymentError = normalizeStripeObject(latestInvoice?.last_payment_error);
  const rawReason = clean(
    paymentError?.message
      || invoicePaymentError?.message
      || invoiceError?.message
      || mapStripeDeclineCode(paymentError?.decline_code || invoicePaymentError?.decline_code)
      || mapStripeCancellationReason(subscription?.cancellation_details?.reason)
  );
  if (rawReason) return rawReason;

  const status = cleanLower(subscription?.status);
  if (status === "past_due") return "החיוב האחרון לא נגבה וההוראה במצב פיגור";
  if (status === "unpaid") return "החיוב האחרון נכשל וההוראה לא שולמה";
  if (status === "paused") return "ההוראה הושהתה";
  if (status === "incomplete" || status === "incomplete_expired") return "הקמת ההוראה לא הושלמה";
  if (status === "canceled") return mapStripeCancellationReason(subscription?.cancellation_details?.reason) || "ההוראה בוטלה";
  return "";
}

function getStripeMandateState(subscription) {
  const status = cleanLower(subscription?.status);
  const cancellationReason = cleanLower(subscription?.cancellation_details?.reason);

  if (["past_due", "unpaid", "paused", "incomplete", "incomplete_expired"].includes(status)) {
    return {
      status: "issues",
      statusLabel: `עם תקלות (${clean(subscription?.status) || "payment_failed"})`
    };
  }

  if (status === "canceled") {
    if (["payment_failed", "payment_disputed"].includes(cancellationReason)) {
      return {
        status: "issues",
        statusLabel: `עם תקלות (${mapStripeCancellationReason(cancellationReason)})`
      };
    }

    return {
      status: "completed",
      statusLabel: "הסתיימה"
    };
  }

  return {
    status: "active",
    statusLabel: clean(subscription?.status) || "active"
  };
}

function mapNedarimMandate(connection, row) {
  const createdAt = clean(row?.CreationDate);
  const createdAtIso = parseDateValueToIso(createdAt);
  const nextDate = clean(row?.NextDate);
  const amount = normalizeAmount(row?.Amount);
  const enabled = clean(row?.Enabled) === "1";
  if (!enabled || amount <= 0) return null;

  const currency = normalizeCurrency(row?.Currency || "ILS");
  const successCode = clean(row?.Success);
  const last4 = clean(row?.LastNum);
  const expiry = clean(row?.Tokef);
  const issueText = clean(row?.ErrorText);
  const completedByNoRemainingPayments = isNedarimNoRemainingPaymentsIssue(issueText);
  const hasIssue = Boolean(issueText);
  const status = completedByNoRemainingPayments ? "completed" : hasIssue ? "issues" : "active";
  const statusLabel = completedByNoRemainingPayments
    ? "הסתיימה - אין יתרת תשלומים"
    : hasIssue ? "עם תקלות" : "פעיל";

  return {
    id: clean(row?.KevaId) || randomUUID(),
    provider: "nederim",
    providerLabel: providerLabel("nederim"),
    connectionId: connection.id,
    connectionLabel: connection.label,
    externalId: connection.external_id,
    currency,
    amount,
    originalCurrency: currency,
    originalAmount: amount,
    netAmount: amount,
    feeAmount: 0,
    status,
    statusLabel,
    createdAt,
    createdAtUnix: createdAtIso ? Date.parse(`${createdAtIso}T12:00:00.000Z`) / 1000 : 0,
    nextChargeDate: nextDate,
    customerName: clean(row?.ClientName),
    email: clean(row?.Mail),
    phone: clean(row?.Phone),
    donorId: clean(row?.Zeout),
    address: clean(row?.Adresse),
    city: clean(row?.City),
    comments: clean(row?.Comments),
    group: clean(row?.Groupe),
    errorText: issueText,
    issueKind: completedByNoRemainingPayments ? "no_remaining_payments" : hasIssue ? "payment_issue" : "",
    recurringCode: clean(row?.Itra),
    successCode,
    successLabel: successCode ? `קוד הצלחה ${successCode}` : "",
    paymentMethodLast4: last4,
    paymentMethodExpiry: expiry,
    mandateId: clean(row?.KevaId),
    enabled,
    raw: row
  };
}

function mapNedarimMandateDetails(connection, payload) {
  const statusInfo = mapNedarimMandateStatus(payload?.KevaStatus);
  const currency = normalizeCurrency(payload?.KevaCurrency || "ILS");
  const amount = normalizeAmount(payload?.KevaAmount);
  const issueText = clean(payload?.ErrorText || payload?.KevaErrorText || payload?.LastError || payload?.StatusText);
  const completedByNoRemainingPayments = isNedarimNoRemainingPaymentsIssue(issueText);
  const history = Array.isArray(payload?.HistoryData)
    ? payload.HistoryData.map((item) => ({
        id: clean(item?.ID) || clean(item?.TransactionId) || randomUUID(),
        date: clean(item?.Date),
        amountText: clean(item?.Amount),
        amount: normalizeAmount(clean(item?.Amount).replace(/[^\d.-]/g, "")),
        name: clean(item?.Name),
        last4: clean(item?.LastNum),
        transactionId: clean(item?.TransactionId)
      }))
    : [];

  return {
    provider: "nederim",
    providerLabel: providerLabel("nederim"),
    connectionId: connection.id,
    connectionLabel: connection.label,
    mandateId: clean(payload?.KevaId),
    status: completedByNoRemainingPayments ? "completed" : statusInfo.status,
    statusLabel: completedByNoRemainingPayments ? "הסתיימה - אין יתרת תשלומים" : statusInfo.label,
    customerName: clean(payload?.KevaName),
    donorId: clean(payload?.KevaZeout),
    email: clean(payload?.KevaMail),
    phone: clean(payload?.KevaPhone),
    address: clean(payload?.KevaAdresse),
    city: clean(payload?.KevaCity),
    group: clean(payload?.KevaGroupe),
    comments: clean(payload?.KevaObservation),
    amount,
    currency,
    amountText: `${amount.toFixed(2)} ${currency}`,
    nextChargeDate: clean(payload?.KevaNextDate),
    createdAt: clean(payload?.CreatedDate),
    recurringCode: formatNedarimFrequency(payload?.KevaFrequency),
    paymentMethodLast4: clean(payload?.KevaLastNum),
    paymentMethodExpiry: clean(payload?.KevaTokef),
    successCount: Number(payload?.KevaSuccess || payload?.HistoryCount || 0) || 0,
    totalHistoryAmount: normalizeAmount(payload?.TotalHistoryAmount),
    totalHistoryCurrency: currency,
    avour: clean(payload?.KevaAvour),
    asToremCard: clean(payload?.KevaAsToremCard),
    errorText: issueText,
    issueKind: completedByNoRemainingPayments ? "no_remaining_payments" : issueText ? "payment_issue" : "",
    historyCount: Number(payload?.HistoryCount || history.length || 0) || 0,
    history
  };
}

function mapStripeMandate(connection, subscription) {
  const customer = normalizeStripeObject(subscription?.customer);
  const defaultPaymentMethod = normalizeStripeObject(subscription?.default_payment_method);
  const items = Array.isArray(subscription?.items?.data) ? subscription.items.data : [];
  const activeItems = items.filter((item) => item?.price?.type === "recurring");
  const amount = roundMoney(activeItems.reduce((sum, item) => {
    const quantity = Number(item?.quantity) || 1;
    const unitAmount = normalizeAmountFromAgorot(item?.price?.unit_amount);
    return sum + (unitAmount * quantity);
  }, 0));
  const currency = normalizeCurrency(subscription?.currency || activeItems[0]?.price?.currency || "ILS");
  const createdAtUnix = Number(subscription?.created) || 0;
  const createdAt = createdAtUnix ? new Date(createdAtUnix * 1000).toISOString() : "";
  const nextChargeDate = Number(subscription?.current_period_end)
    ? new Date(Number(subscription.current_period_end) * 1000).toISOString()
    : "";
  const interval = activeItems[0]?.price?.recurring?.interval;
  const intervalCount = activeItems[0]?.price?.recurring?.interval_count;
  const brand = clean(defaultPaymentMethod?.card?.brand);
  const last4 = clean(defaultPaymentMethod?.card?.last4);
  const expiry = defaultPaymentMethod?.card?.exp_month && defaultPaymentMethod?.card?.exp_year
    ? `${String(defaultPaymentMethod.card.exp_month).padStart(2, "0")}/${String(defaultPaymentMethod.card.exp_year).slice(-2)}`
    : "";
  const status = cleanLower(subscription?.status);
  const latestInvoice = normalizeStripeObject(subscription?.latest_invoice);
  const paymentIntent = normalizeStripeObject(latestInvoice?.payment_intent);
  const state = getStripeMandateState(subscription);
  const issueText = state.status === "issues"
    ? getStripeIssueText(subscription, latestInvoice, paymentIntent)
    : state.status === "completed"
      ? clean(
          mapStripeCancellationReason(subscription?.cancellation_details?.reason)
          || "הוראת הקבע הסתיימה"
        )
      : "";

  if (!["active", "trialing", "past_due", "unpaid", "paused", "incomplete", "incomplete_expired", "canceled"].includes(status)) {
    return null;
  }

  return {
    id: clean(subscription?.id) || randomUUID(),
    provider: "stripe",
    providerLabel: providerLabel("stripe"),
    connectionId: connection.id,
    connectionLabel: connection.label,
    externalId: clean(connection.external_id || subscription?.id),
    currency,
    amount,
    originalCurrency: currency,
    originalAmount: amount,
    netAmount: amount,
    feeAmount: 0,
    status: state.status,
    statusLabel: state.statusLabel,
    createdAt,
    createdAtUnix,
    nextChargeDate,
    customerName: clean(customer?.name),
    email: clean(customer?.email),
    phone: clean(customer?.phone),
    donorId: clean(customer?.metadata?.donor_id || customer?.metadata?.tz || customer?.metadata?.identity_number),
    address: clean(customer?.address?.line1),
    city: clean(customer?.address?.city),
    comments: clean(subscription?.description),
    group: clean(customer?.metadata?.group || customer?.metadata?.campaign),
    errorText: issueText,
    recurringCode: formatStripeInterval(interval, intervalCount),
    successCode: "",
    successLabel: "",
    paymentMethodLast4: last4,
    paymentMethodExpiry: expiry,
    brand,
    mandateId: clean(subscription?.id),
    enabled: true,
    raw: subscription
  };
}

function mapStripeMandateDetails(connection, subscription, invoices = []) {
  const mapped = mapStripeMandate(connection, subscription);
  if (!mapped) {
    throw new Error("הוראת הקבע ב-Stripe אינה פעילה או לא זמינה.");
  }

  const history = invoices.map((invoice) => ({
    id: clean(invoice?.id) || randomUUID(),
    date: Number(invoice?.status_transitions?.paid_at)
      ? new Date(Number(invoice.status_transitions.paid_at) * 1000).toISOString()
      : Number(invoice?.created)
        ? new Date(Number(invoice.created) * 1000).toISOString()
        : "",
    amountText: `${normalizeAmountFromAgorot(invoice?.amount_paid).toFixed(2)} ${normalizeCurrency(invoice?.currency || mapped.currency)}`,
    amount: normalizeAmountFromAgorot(invoice?.amount_paid),
    status: clean(invoice?.status),
    transactionId: clean(invoice?.payment_intent?.id || invoice?.charge || invoice?.id),
    invoiceNumber: clean(invoice?.number || invoice?.id)
  }));

  return {
    ...mapped,
    errorText: mapped.errorText || getStripeIssueText(
      subscription,
      normalizeStripeObject(subscription?.latest_invoice),
      normalizeStripeObject(subscription?.latest_invoice?.payment_intent)
    ),
    successCount: history.filter((item) => cleanLower(item.status) === "paid").length,
    totalHistoryAmount: roundMoney(history.reduce((sum, item) => sum + normalizeAmount(item.amount), 0)),
    totalHistoryCurrency: mapped.currency,
    historyCount: history.length,
    history
  };
}

async function requestNedarimJson(connection, action, extraParams = {}) {
  async function request(method) {
    const params = new URLSearchParams({
      Action: action,
      MosadId: clean(connection.external_id),
      ApiPassword: clean(connection.secret),
      ...Object.fromEntries(Object.entries(extraParams).map(([key, value]) => [key, clean(value)]))
    });
    const response = await fetch(
      method === "GET" ? `${NEDARIM_REPORT_URL}?${params.toString()}` : NEDARIM_REPORT_URL,
      {
        method,
        headers: method === "POST"
          ? { "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8" }
          : undefined,
        body: method === "POST" ? params.toString() : undefined,
        cache: "no-store"
      }
    );
    const text = decodePaymentText(new Uint8Array(await response.arrayBuffer()));
    if (!response.ok) {
      throw new Error(`נדרים פלוס החזיר שגיאה ${response.status}.`);
    }
    return JSON.parse(text);
  }

  try {
    return await request("GET");
  } catch {
    return request("POST");
  }
}

async function stripeRequest(connection, path, searchParams = null) {
  const auth = Buffer.from(`${clean(connection.secret)}:`).toString("base64");
  const query = searchParams ? `?${searchParams.toString()}` : "";
  const response = await fetch(`https://api.stripe.com${path}${query}`, {
    headers: {
      Authorization: `Basic ${auth}`,
      "Stripe-Version": STRIPE_API_VERSION
    },
    cache: "no-store"
  });
  const payload = await response.json();
  if (!response.ok) {
    throw new Error(clean(payload?.error?.message) || `Stripe החזיר שגיאה ${response.status}.`);
  }
  return payload;
}

async function fetchStripeCustomer(connection, customerId, cache) {
  const id = clean(customerId);
  if (!id) return null;
  if (cache.customers.has(id)) return cache.customers.get(id);
  const customer = await stripeRequest(connection, `/v1/customers/${encodeURIComponent(id)}`);
  cache.customers.set(id, customer);
  return customer;
}

async function fetchStripePaymentIntent(connection, paymentIntentId, cache) {
  const id = clean(paymentIntentId);
  if (!id) return null;
  if (cache.paymentIntents.has(id)) return cache.paymentIntents.get(id);
  const params = new URLSearchParams();
  params.append("expand[]", "customer");
  const paymentIntent = await stripeRequest(connection, `/v1/payment_intents/${encodeURIComponent(id)}`, params);
  cache.paymentIntents.set(id, paymentIntent);
  return paymentIntent;
}

async function enrichStripeSource(connection, item, cache) {
  const source = normalizeStripeObject(item?.source);
  if (!source) return item;

  const nextItem = { ...item, source };

  if (source.object === "charge") {
    const charge = { ...source };
    if (typeof charge.payment_intent === "string" && charge.payment_intent) {
      charge.payment_intent_object = await fetchStripePaymentIntent(connection, charge.payment_intent, cache);
    } else if (charge.payment_intent && typeof charge.payment_intent === "object") {
      charge.payment_intent_object = charge.payment_intent;
    }

    if (typeof charge.customer === "string" && charge.customer) {
      charge.customer_object = await fetchStripeCustomer(connection, charge.customer, cache);
    } else if (charge.customer && typeof charge.customer === "object") {
      charge.customer_object = charge.customer;
    } else if (typeof charge.payment_intent_object?.customer === "string" && charge.payment_intent_object.customer) {
      charge.customer_object = await fetchStripeCustomer(connection, charge.payment_intent_object.customer, cache);
    } else if (charge.payment_intent_object?.customer && typeof charge.payment_intent_object.customer === "object") {
      charge.customer_object = charge.payment_intent_object.customer;
    }

    nextItem.source = charge;
    return nextItem;
  }

  if (source.object === "payment_intent") {
    const paymentIntent = { ...source };
    if (typeof paymentIntent.customer === "string" && paymentIntent.customer) {
      paymentIntent.customer_object = await fetchStripeCustomer(connection, paymentIntent.customer, cache);
    } else if (paymentIntent.customer && typeof paymentIntent.customer === "object") {
      paymentIntent.customer_object = paymentIntent.customer;
    }
    nextItem.payment_intent_object = paymentIntent;
    return nextItem;
  }

  return nextItem;
}

async function fetchNedarimTransactions(connection, { dateFrom, dateTo }) {
  const params = new URLSearchParams({
    Action: "GetHistoryCSV",
    MosadNumber: clean(connection.external_id),
    ApiPassword: clean(connection.secret),
    From: toNedarimDate(dateFrom),
    To: toNedarimDate(dateTo),
    ToMail: "0"
  });

  async function requestCsv(method) {
    const response = await fetch(
      method === "GET" ? `${NEDARIM_REPORT_URL}?${params.toString()}` : NEDARIM_REPORT_URL,
      {
        method,
        headers: method === "POST"
          ? { "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8" }
          : undefined,
        body: method === "POST" ? params.toString() : undefined,
        cache: "no-store"
      }
    );
    const buffer = new Uint8Array(await response.arrayBuffer());
    const text = decodePaymentText(buffer);
    if (!response.ok) {
      throw new Error(`נדרים פלוס החזיר שגיאה ${response.status}.`);
    }
    if (text.includes("<html") || text.includes("<!DOCTYPE")) {
      throw new Error("נדרים פלוס לא החזיר CSV בפורמט צפוי.");
    }
    return buffer;
  }

  const attempts = [];
  for (const method of ["POST", "GET"]) {
    try {
      const buffer = await requestCsv(method);
      const rows = parseNedarimDelimitedText(decodePaymentText(buffer))
        .map((row) => mapNedarimTransaction(connection, row))
        .filter(Boolean);
      if (rows.length) return rows;
      attempts.push(`${method}: 0 rows`);
    } catch (error) {
      attempts.push(`${method}: ${error?.message || "failed"}`);
    }
  }

  throw new Error(`נדרים פלוס לא החזיר עסקאות. ${attempts.join(" | ")}`);
}

async function fetchStripeTransactions(connection, { dateFrom, dateTo }) {
  const allTransactions = [];
  let startingAfter = "";
  const cache = {
    customers: new Map(),
    paymentIntents: new Map()
  };

  do {
    const params = new URLSearchParams({
      limit: "100",
      "created[gte]": String(toUnixTimestampStartOfDay(dateFrom)),
      "created[lte]": String(toUnixTimestampEndOfDay(dateTo))
    });
    if (startingAfter) params.set("starting_after", startingAfter);
    params.append("expand[]", "data.source");
    const payload = await stripeRequest(connection, "/v1/balance_transactions", params);
    const chunk = Array.isArray(payload?.data) ? payload.data : [];
    for (const item of chunk) {
      const enriched = await enrichStripeSource(connection, item, cache);
      if (!isSuccessfulStripeTransaction(enriched)) continue;
      allTransactions.push(mapStripeTransaction(connection, enriched));
    }
    startingAfter = payload?.has_more && chunk.length ? clean(chunk[chunk.length - 1]?.id) : "";
  } while (startingAfter);

  return allTransactions;
}

async function fetchNedarimMandates(connection) {
  const pageSize = 1000;
  let lastId = "0";
  const allMandates = [];

  for (let page = 0; page < 20; page += 1) {
    const payload = await requestNedarimJson(connection, "GetKevaJson", {
      LastId: clean(lastId || "0"),
      MaxId: String(pageSize)
    });
    const chunk = Array.isArray(payload) ? payload : [];
    if (!chunk.length) break;
    allMandates.push(...chunk);
    const nextLastId = clean(chunk.at(-1)?.KevaId || "");
    if (!nextLastId || nextLastId === lastId || chunk.length < pageSize) break;
    lastId = nextLastId;
  }

  return allMandates
    .map((row) => mapNedarimMandate(connection, row))
    .filter(Boolean);
}

async function fetchStripeMandates(connection) {
  const allMandates = [];
  let startingAfter = "";

  do {
    const params = new URLSearchParams({
      limit: "100",
      status: "all"
    });
    params.append("expand[]", "data.customer");
    params.append("expand[]", "data.default_payment_method");
    params.append("expand[]", "data.items.data.price");
    params.append("expand[]", "data.latest_invoice.payment_intent");
    if (startingAfter) params.set("starting_after", startingAfter);

    const payload = await stripeRequest(connection, "/v1/subscriptions", params);
    const chunk = Array.isArray(payload?.data) ? payload.data : [];
    chunk.forEach((subscription) => {
      const mapped = mapStripeMandate(connection, subscription);
      if (!mapped) return;
      allMandates.push(mapped);
    });
    startingAfter = payload?.has_more && chunk.length ? clean(chunk[chunk.length - 1]?.id) : "";
  } while (startingAfter);

  return allMandates;
}

async function fetchNedarimMandateDetails(connection, mandateId) {
  const payload = await requestNedarimJson(connection, "GetKevaId", {
    KevaId: clean(mandateId)
  });
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new Error("נדרים לא החזיר פרטי הוראת קבע תקינים.");
  }
  return mapNedarimMandateDetails(connection, payload);
}

async function fetchStripeMandateDetails(connection, mandateId) {
  const params = new URLSearchParams();
  params.append("expand[]", "customer");
  params.append("expand[]", "default_payment_method");
  params.append("expand[]", "items.data.price");
  params.append("expand[]", "latest_invoice.payment_intent");
  const subscription = await stripeRequest(connection, `/v1/subscriptions/${encodeURIComponent(clean(mandateId))}`, params);

  const invoiceParams = new URLSearchParams({
    subscription: clean(mandateId),
    limit: "20"
  });
  const invoicesPayload = await stripeRequest(connection, "/v1/invoices", invoiceParams);
  const invoices = Array.isArray(invoicesPayload?.data) ? invoicesPayload.data : [];

  return mapStripeMandateDetails(connection, subscription, invoices);
}

export async function listPaymentConnections({ activeOnly = false, includeSecret = false } = {}) {
  await ensurePaymentTables();
  const rows = activeOnly
    ? await sql`
        SELECT *
        FROM payment_provider_accounts
        WHERE is_active = TRUE
        ORDER BY provider ASC, label ASC, updated_at DESC
      `
    : await sql`
        SELECT *
        FROM payment_provider_accounts
        ORDER BY is_active DESC, provider ASC, label ASC, updated_at DESC
      `;
  return rows.map((row) => mapConnectionRow(row, { includeSecret }));
}

export async function getPaymentConnectionById(id, { includeSecret = false } = {}) {
  await ensurePaymentTables();
  const connectionId = clean(id);
  if (!connectionId) return null;
  const rows = await sql`
    SELECT *
    FROM payment_provider_accounts
    WHERE id = ${connectionId}
    LIMIT 1
  `;
  return mapConnectionRow(rows[0], { includeSecret });
}

export async function createPaymentConnection({
  provider,
  label,
  externalId,
  secret,
  createdByUserId,
  config = {}
}) {
  await ensurePaymentTables();
  const normalizedProvider = cleanLower(provider);
  const normalizedLabel = clean(label);
  const normalizedExternalId = clean(externalId);
  const normalizedSecret = clean(secret);

  if (!["nederim", "stripe"].includes(normalizedProvider)) {
    throw new Error("סוג חיבור לא נתמך.");
  }
  if (!normalizedLabel) {
    throw new Error("חסר שם לחיבור.");
  }
  if (!normalizedSecret) {
    throw new Error("חסר סוד גישה.");
  }
  if (normalizedProvider === "nederim" && !normalizedExternalId) {
    throw new Error("בחיבור נדרים פלוס חייבים להזין מזהה מוסד.");
  }

  const id = randomUUID();
  await sql`
    INSERT INTO payment_provider_accounts (
      id,
      provider,
      label,
      external_id,
      encrypted_secret,
      config_json,
      is_active,
      created_by_user_id,
      updated_by_user_id
    )
    VALUES (
      ${id},
      ${normalizedProvider},
      ${normalizedLabel},
      ${normalizedExternalId},
      ${encryptSecret(normalizedSecret)},
      ${JSON.stringify(config)}::jsonb,
      TRUE,
      ${clean(createdByUserId)},
      ${clean(createdByUserId)}
    )
  `;
  return id;
}

export async function updatePaymentConnection({
  id,
  label,
  externalId,
  secret,
  updatedByUserId,
  config
}) {
  await ensurePaymentTables();
  const connectionId = clean(id);
  if (!connectionId) throw new Error("לא נבחר חיבור לעדכון.");

  const existing = await getPaymentConnectionById(connectionId, { includeSecret: false });
  if (!existing) throw new Error("החיבור לא נמצא.");

  const normalizedLabel = clean(label);
  const normalizedExternalId = clean(externalId);
  const normalizedSecret = clean(secret);
  if (!normalizedLabel) throw new Error("חסר שם לחיבור.");
  if (existing.provider === "nederim" && !normalizedExternalId) {
    throw new Error("בחיבור נדרים פלוס חייבים להזין מזהה מוסד.");
  }

  const nextSecret = normalizedSecret
    ? encryptSecret(normalizedSecret)
    : null;
  const nextConfig = config === undefined ? existing.config : config;

  await sql`
    UPDATE payment_provider_accounts
    SET
      label = ${normalizedLabel},
      external_id = ${normalizedExternalId},
      encrypted_secret = COALESCE(${nextSecret}, encrypted_secret),
      config_json = ${JSON.stringify(nextConfig || {})}::jsonb,
      updated_by_user_id = ${clean(updatedByUserId)},
      updated_at = NOW()
    WHERE id = ${connectionId}
  `;

  return connectionId;
}

export async function setPaymentConnectionActive(id, active, updatedByUserId) {
  await ensurePaymentTables();
  const connectionId = clean(id);
  if (!connectionId) return;
  await sql`
    UPDATE payment_provider_accounts
    SET
      is_active = ${Boolean(active)},
      updated_by_user_id = ${clean(updatedByUserId)},
      updated_at = NOW()
    WHERE id = ${connectionId}
  `;
}

export async function deletePaymentConnection(id) {
  await ensurePaymentTables();
  const connectionId = clean(id);
  if (!connectionId) throw new Error("לא נבחר חיבור למחיקה.");
  await sql`
    DELETE FROM payment_provider_accounts
    WHERE id = ${connectionId}
  `;
}

export async function testPaymentConnection({
  id,
  dateFrom = "",
  dateTo = ""
}) {
  const connection = await getPaymentConnectionById(id, { includeSecret: true });
  if (!connection) {
    throw new Error("החיבור לא נמצא.");
  }

  const range = getDefaultPaymentDateRange();
  const safeDateFrom = clean(dateFrom) || shiftInputDate(range.dateTo, -7) || range.dateFrom;
  const safeDateTo = clean(dateTo) || range.dateTo;

  if (connection.provider === "stripe") {
    const account = await stripeRequest(connection, "/v1/account");
    return {
      ok: true,
      provider: connection.provider,
      connectionId: connection.id,
      connectionLabel: connection.label,
      message: `חיבור Stripe תקין. החשבון ${clean(account?.display_name) || clean(account?.business_profile?.name) || clean(account?.id) || connection.label} נגיש.`,
      details: {
        accountId: clean(account?.id),
        accountName: clean(account?.display_name) || clean(account?.business_profile?.name)
      }
    };
  }

  const transactions = await fetchNedarimTransactions(connection, {
    dateFrom: safeDateFrom,
    dateTo: safeDateTo
  });
  return {
    ok: true,
    provider: connection.provider,
    connectionId: connection.id,
    connectionLabel: connection.label,
    message: `חיבור נדרים תקין. נמצאו ${transactions.length} עסקאות בטווח ${safeDateFrom} עד ${safeDateTo}.`,
    details: {
      transactionsCount: transactions.length,
      dateFrom: safeDateFrom,
      dateTo: safeDateTo
    }
  };
}

export async function getPaymentDashboard({
  connectionIds = [],
  dateFrom,
  dateTo
}) {
  await ensurePaymentTables();
  const allConnections = await listPaymentConnections({ activeOnly: true, includeSecret: true });
  const normalizedIds = Array.isArray(connectionIds)
    ? connectionIds.map(clean).filter(Boolean)
    : [];
  const connections = normalizedIds.length
    ? allConnections.filter((connection) => normalizedIds.includes(connection.id))
    : allConnections;

  const results = await Promise.allSettled(
    connections.map(async (connection) => {
      if (connection.provider === "stripe") {
        return fetchStripeTransactions(connection, { dateFrom, dateTo });
      }
      return fetchNedarimTransactions(connection, { dateFrom, dateTo });
    })
  );

  const transactions = [];
  const errors = [];

  results.forEach((result, index) => {
    const connection = connections[index];
    if (result.status === "fulfilled") {
      result.value.forEach((item) => transactions.push(item));
      return;
    }
    errors.push({
      connectionId: connection?.id || "",
      connectionLabel: connection?.label || "",
      provider: connection?.provider || "",
      message: result.reason?.message || "שליפת העסקאות נכשלה."
    });
  });

  const enrichedTransactions = await enrichTransactionsWithIlsAmounts(transactions, { dateFrom, dateTo });

  enrichedTransactions.sort((left, right) => {
    const leftValue = Number(left?.createdAtUnix) || 0;
    const rightValue = Number(right?.createdAtUnix) || 0;
    return rightValue - leftValue;
  });

  const totalAmount = enrichedTransactions.reduce((sum, item) => sum + normalizeAmount(item.amountIls), 0);
  const totalNetAmount = enrichedTransactions.reduce((sum, item) => sum + normalizeAmount(item.netAmountIls), 0);
  const totalFees = enrichedTransactions.reduce((sum, item) => sum + normalizeAmount(item.feeAmountIls), 0);

  return {
    connections: connections.map(({ secret, ...connection }) => connection),
    transactions: enrichedTransactions,
    errors,
    summary: {
      transactionsCount: enrichedTransactions.length,
      sourcesCount: connections.length,
      totalAmount,
      totalNetAmount,
      totalFees
    }
  };
}

export async function getPaymentMandatesDashboard({
  connectionIds = []
}) {
  await ensurePaymentTables();
  const allConnections = await listPaymentConnections({ activeOnly: true, includeSecret: true });
  const normalizedIds = Array.isArray(connectionIds)
    ? connectionIds.map(clean).filter(Boolean)
    : [];
  const connections = normalizedIds.length
    ? allConnections.filter((connection) => normalizedIds.includes(connection.id))
    : allConnections;

  const results = await Promise.allSettled(
    connections.map(async (connection) => {
      if (connection.provider === "stripe") {
        return fetchStripeMandates(connection);
      }
      return fetchNedarimMandates(connection);
    })
  );

  const mandates = [];
  const errors = [];

  results.forEach((result, index) => {
    const connection = connections[index];
    if (result.status === "fulfilled") {
      result.value.forEach((item) => mandates.push(item));
      return;
    }
    errors.push({
      connectionId: connection?.id || "",
      connectionLabel: connection?.label || "",
      provider: connection?.provider || "",
      message: result.reason?.message || "שליפת הוראות הקבע נכשלה."
    });
  });

  const today = toInputDate(new Date());
  const enrichedMandates = await enrichTransactionsWithIlsAmounts(mandates, { dateFrom: today, dateTo: today });

  enrichedMandates.sort((left, right) => {
    const leftValue = Number(left?.createdAtUnix) || 0;
    const rightValue = Number(right?.createdAtUnix) || 0;
    return rightValue - leftValue;
  });

  const totalAmount = enrichedMandates.reduce((sum, item) => sum + normalizeAmount(item.amountIls ?? item.amount), 0);

  return {
    connections: connections.map(({ secret, ...connection }) => connection),
    mandates: enrichedMandates,
    errors,
    summary: {
      mandatesCount: enrichedMandates.length,
      sourcesCount: connections.length,
      totalAmount
    }
  };
}

export async function getPaymentMandateDetails({
  connectionId,
  mandateId
}) {
  const connection = await getPaymentConnectionById(connectionId, { includeSecret: true });
  if (!connection || !connection.is_active) {
    throw new Error("חיבור התשלום לא נמצא או שאינו פעיל.");
  }
  const safeMandateId = clean(mandateId);
  if (!safeMandateId) {
    throw new Error("חסר מזהה הוראת קבע.");
  }

  const details = connection.provider === "stripe"
    ? await fetchStripeMandateDetails(connection, safeMandateId)
    : await fetchNedarimMandateDetails(connection, safeMandateId);

  const today = toInputDate(new Date());
  const [enriched] = await enrichTransactionsWithIlsAmounts([details], { dateFrom: today, dateTo: today });

  return {
    ...enriched,
    history: Array.isArray(details.history) ? details.history : []
  };
}

export function getDefaultPaymentDateRange() {
  const end = new Date();
  end.setHours(12, 0, 0, 0);
  const start = new Date(end);
  start.setDate(start.getDate() - 30);
  return {
    dateFrom: toInputDate(start),
    dateTo: toInputDate(end)
  };
}

export function getPaymentProviderLabel(provider) {
  return providerLabel(provider);
}
