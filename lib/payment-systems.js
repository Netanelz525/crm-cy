import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID } from "crypto";
import { initDb, sql } from "./db";

const STRIPE_API_VERSION = "2026-02-25.clover";
const NEDARIM_REPORT_URL = "https://matara.pro/nedarimplus/Reports/Manage3.aspx";

let paymentTablesReady = false;
let paymentTablesPromise = null;

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
  return cleanLower(provider) === "stripe" ? "Stripe" : "נדרים פלוס";
}

function normalizeCurrency(value) {
  return clean(value || "ILS").toUpperCase();
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

function parseCsv(text) {
  const input = String(text || "").replace(/^\uFEFF/, "");
  const firstLine = input.split(/\r?\n/, 1)[0] || "";
  const delimiter = firstLine.includes(";")
    ? ";"
    : firstLine.includes("\t")
      ? "\t"
      : ",";
  const rows = [];
  let current = [];
  let value = "";
  let inQuotes = false;

  for (let index = 0; index < input.length; index += 1) {
    const char = input[index];
    const next = input[index + 1];

    if (char === "\"") {
      if (inQuotes && next === "\"") {
        value += "\"";
        index += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (char === delimiter && !inQuotes) {
      current.push(value);
      value = "";
      continue;
    }

    if ((char === "\n" || char === "\r") && !inQuotes) {
      if (char === "\r" && next === "\n") index += 1;
      current.push(value);
      rows.push(current);
      current = [];
      value = "";
      continue;
    }

    value += char;
  }

  if (value || current.length) {
    current.push(value);
    rows.push(current);
  }

  const [headerRow, ...dataRows] = rows.filter((row) => row.some((cell) => clean(cell)));
  if (!headerRow?.length) return [];

  return dataRows.map((row) => (
    headerRow.reduce((acc, header, index) => {
      acc[clean(header)] = normalizeSpreadsheetCell(row[index]);
      return acc;
    }, {})
  ));
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
    customerName: findRowValue(row, ["שם"]),
    reference: findRowValue(row, ["מספר אישור", "מספר עסקה", "מספר קבלה"]),
    type: typeParts.join(" | "),
    createdAt: dateText,
    createdAtUnix,
    raw: row,
    donorId: findRowValue(row, ["מספר זהות"]),
    phone: findRowValue(row, ["טלפון"]),
    email: findRowValue(row, ["מייל"]),
    receiptNumber: findRowValue(row, ["מספר קבלה"]),
    voucherNumber: findRowValue(row, ["מספר שובר"]),
    transactionNumber: findRowValue(row, ["מספר עסקה"]),
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
  return {
    id: clean(transaction?.id) || randomUUID(),
    provider: "stripe",
    providerLabel: providerLabel("stripe"),
    connectionId: connection.id,
    connectionLabel: connection.label,
    externalId: clean(connection.external_id || transaction?.source || ""),
    currency: normalizeCurrency(transaction?.currency),
    amount: normalizeAmountFromAgorot(transaction?.amount),
    netAmount: normalizeAmountFromAgorot(transaction?.net),
    feeAmount: normalizeAmountFromAgorot(transaction?.fee),
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
    clearingCompany: "Stripe"
  };
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

  const response = await fetch(NEDARIM_REPORT_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8"
    },
    body: params.toString(),
    cache: "no-store"
  });

  const text = await response.text();
  if (!response.ok) {
    throw new Error(`נדרים פלוס החזיר שגיאה ${response.status}.`);
  }

  if (text.includes("<html") || text.includes("<!DOCTYPE")) {
    throw new Error("נדרים פלוס לא החזיר קובץ CSV. בדקו מזהה מוסד וסיסמת API.");
  }

  return parseCsv(text).map((row) => mapNedarimTransaction(connection, row));
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
      allTransactions.push(mapStripeTransaction(connection, enriched));
    }
    startingAfter = payload?.has_more && chunk.length ? clean(chunk[chunk.length - 1]?.id) : "";
  } while (startingAfter);

  return allTransactions;
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

  transactions.sort((left, right) => {
    const leftValue = Number(left?.createdAtUnix) || 0;
    const rightValue = Number(right?.createdAtUnix) || 0;
    return rightValue - leftValue;
  });

  const totalAmount = transactions.reduce((sum, item) => sum + normalizeAmount(item.amount), 0);
  const totalNetAmount = transactions.reduce((sum, item) => sum + normalizeAmount(item.netAmount), 0);
  const totalFees = transactions.reduce((sum, item) => sum + normalizeAmount(item.feeAmount), 0);

  return {
    connections: connections.map(({ secret, ...connection }) => connection),
    transactions,
    errors,
    summary: {
      transactionsCount: transactions.length,
      sourcesCount: connections.length,
      totalAmount,
      totalNetAmount,
      totalFees
    }
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
