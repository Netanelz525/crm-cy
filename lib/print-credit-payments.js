import crypto from "node:crypto";
import { initDb, sql } from "./db";
import { addPrintCreditPackage, PRINT_CREDIT_PACKAGES } from "./print-jobs";

const NEDARIM_IFRAME_URL = "https://www.matara.pro/nedarimplus/iframe/";
const NEDARIM_CALLBACK_IPS = new Set([
  "18.194.219.73",
  "3.70.117.239",
  "3.74.120.185",
  "18.196.146.117"
]);

function clean(value) {
  return String(value || "").trim();
}

function onlyDigits(value) {
  return clean(value).replace(/\D+/g, "");
}

function amountShekel(amountAgorot) {
  return (Number(amountAgorot || 0) / 100).toFixed(2).replace(/\.00$/, "");
}

function getNedarimConfig() {
  const mosad = clean(process.env.NEDARIM_PRINT_MOSAD || process.env.NEDARIM_MOSAD || "7018355");
  const apiValid = clean(process.env.NEDARIM_PRINT_API_VALID || process.env.NEDARIM_API_VALID || "hSV7aTh6w+");
  if (!mosad || !apiValid) throw new Error("חסר חיבור נדרים לרכישת חבילות הדפסה.");
  return { mosad, apiValid, iframeUrl: NEDARIM_IFRAME_URL };
}

export function isAllowedNedarimCallbackIp(ip) {
  const value = clean(ip).replace(/^::ffff:/, "");
  if (!value) return false;
  return NEDARIM_CALLBACK_IPS.has(value);
}

function splitName(displayName, email) {
  const parts = clean(displayName).split(/\s+/).filter(Boolean);
  if (parts.length > 1) {
    return {
      firstName: parts.slice(0, -1).join(" ").slice(0, 50),
      lastName: parts.at(-1).slice(0, 50)
    };
  }
  const fallback = clean(parts[0] || email.split("@")[0] || "משתמש");
  return { firstName: fallback.slice(0, 50), lastName: "" };
}

function normalizePayerDetails(value = {}) {
  const email = clean(value.email).toLowerCase().slice(0, 50);
  const fullName = clean(value.fullName).slice(0, 100);
  const identityNumber = onlyDigits(value.identityNumber).slice(0, 9);
  return {
    fullName,
    email,
    identityNumber,
    phone: onlyDigits(value.phone).slice(0, 20)
  };
}

function findPackage(packageKey) {
  return PRINT_CREDIT_PACKAGES.find((pack) => pack.key === clean(packageKey));
}

export function getPrintCreditPackage(packageKey) {
  return findPackage(packageKey) || null;
}

function mapIntentRow(row) {
  if (!row) return null;
  return {
    id: clean(row.id),
    userId: clean(row.user_id),
    packageKey: clean(row.package_key),
    pages: Number(row.pages || 0),
    amountAgorot: Number(row.amount_agorot || 0),
    status: clean(row.status) || "pending",
    nedarimTransactionId: clean(row.nedarim_transaction_id),
    confirmation: clean(row.confirmation),
    lastNum: clean(row.last_num),
    responsePayload: row.response_payload || {},
    creditedTransactionId: clean(row.credited_transaction_id),
    createdAt: row.created_at || null,
    approvedAt: row.approved_at || null,
    failedAt: row.failed_at || null
  };
}

export async function createPrintCreditPurchaseIntent({ user, packageKey, callbackUrl, payerDetails = {} }) {
  await initDb();
  const pack = findPackage(packageKey);
  const userId = clean(user?.clerk_user_id);
  if (!userId || !pack) throw new Error("חבילת הדפסה לא תקינה.");

  const id = crypto.randomUUID();
  await sql`
    INSERT INTO print_credit_purchase_intents (
      id,
      user_id,
      package_key,
      pages,
      amount_agorot,
      status,
      created_at
    )
    VALUES (
      ${id},
      ${userId},
      ${pack.key},
      ${pack.pages},
      ${pack.amountAgorot},
      'pending',
      NOW()
    )
  `;

  const { mosad, apiValid, iframeUrl } = getNedarimConfig();
  const payer = normalizePayerDetails(payerDetails);
  if (!payer.fullName) throw new Error("יש להזין שם משלם לפני פתיחת החיוב.");
  if (!payer.email) throw new Error("יש להזין מייל לפני פתיחת החיוב.");
  const email = payer.email;
  const { firstName, lastName } = splitName(payer.fullName, email);
  const packageText = `חבילת הדפסה ${pack.pages} דפים`;
  const transaction = {
    Mosad: mosad,
    ApiValid: apiValid,
    PaymentType: "Ragil",
    Currency: "1",
    Zeout: payer.identityNumber,
    FirstName: firstName,
    LastName: lastName,
    Street: "",
    City: "",
    Phone: payer.phone || onlyDigits(user?.phone || user?.studentPhone || ""),
    Mail: email.slice(0, 50),
    Amount: amountShekel(pack.amountAgorot),
    Tashlumim: "1",
    Day: "",
    Groupe: packageText,
    Comment: `רכישת ${packageText} למערכת CRM`,
    Param1: id,
    Param2: userId.slice(0, 100),
    ForceUpdateMatching: "",
    ThirdPartyReceipt: "",
    CallBack: clean(callbackUrl),
    CallBackMailError: clean(process.env.NEDARIM_CALLBACK_MAIL_ERROR || email),
    Tokef: ""
  };

  return {
    intentId: id,
    package: pack,
    iframeUrl,
    transaction
  };
}

export async function getPrintCreditPurchaseIntent(id, userId = "") {
  await initDb();
  const rows = await sql`
    SELECT *
    FROM print_credit_purchase_intents
    WHERE id = ${clean(id)}
      AND (${clean(userId)} = '' OR user_id = ${clean(userId)})
    LIMIT 1
  `;
  return mapIntentRow(rows[0]);
}

function payloadStatus(payload) {
  return clean(payload?.Status || payload?.status || payload?.Result || payload?.result);
}

function payloadTransactionId(payload) {
  return clean(payload?.ID || payload?.TransactionId || payload?.transactionId || payload?.Shovar || payload?.shovar);
}

function parseAgorot(value) {
  const text = clean(value).replace(/[^\d.,-]/g, "").replace(",", ".");
  if (!text) return null;
  const numeric = Number(text);
  if (!Number.isFinite(numeric)) return null;
  return Math.round(numeric * 100);
}

function payloadAmountAgorot(payload) {
  const directValue = clean(payload?.Amount || payload?.amount || payload?.Total || payload?.total || payload?.Sum || payload?.sum);
  return parseAgorot(directValue);
}

async function failPrintCreditIntent(intent, payload, message, fields = {}) {
  await sql`
    UPDATE print_credit_purchase_intents
    SET
      status = 'failed',
      response_payload = ${payload || {}},
      nedarim_transaction_id = ${fields.transactionId || null},
      confirmation = ${fields.confirmation || null},
      last_num = ${fields.lastNum || null},
      failed_at = NOW()
    WHERE id = ${intent.id}
      AND status IN ('pending', 'processing')
  `;
  throw new Error(message);
}

export async function approvePrintCreditPurchaseFromNedarim(payload, { requireKnownSuccess = true } = {}) {
  await initDb();
  const intentId = clean(payload?.Param1 || payload?.param1);
  if (!intentId) throw new Error("חסר מזהה רכישה בתשובת נדרים.");

  const rows = await sql`
    SELECT *
    FROM print_credit_purchase_intents
    WHERE id = ${intentId}
    LIMIT 1
  `;
  const intent = mapIntentRow(rows[0]);
  if (!intent) throw new Error("רכישת הקרדיט לא נמצאה.");

  const status = payloadStatus(payload);
  const isSuccess = status.toLowerCase() === "ok";
  if (requireKnownSuccess && !isSuccess) {
    await sql`
      UPDATE print_credit_purchase_intents
      SET
        status = 'failed',
        response_payload = ${payload || {}},
        failed_at = NOW()
      WHERE id = ${intent.id}
        AND status = 'pending'
    `;
    return { ok: false, status: "failed", intent };
  }

  if (intent.status === "approved") {
    return { ok: true, status: "approved", intent, alreadyApproved: true };
  }

  const transactionId = payloadTransactionId(payload);
  const confirmation = clean(payload?.Confirmation);
  const lastNum = clean(payload?.LastNum);
  const expectedPackage = findPackage(intent.packageKey);
  if (!expectedPackage || expectedPackage.pages !== intent.pages || expectedPackage.amountAgorot !== intent.amountAgorot) {
    await failPrintCreditIntent(intent, payload, "פרטי חבילת ההדפסה אינם תואמים למחירון המערכת.", {
      transactionId,
      confirmation,
      lastNum
    });
  }

  if (!transactionId) {
    await failPrintCreditIntent(intent, payload, "חסר מזהה עסקה בתשובת נדרים.", {
      confirmation,
      lastNum
    });
  }

  const amountFromPayload = payloadAmountAgorot(payload);
  if (amountFromPayload === null) {
    await failPrintCreditIntent(intent, payload, "חסר סכום עסקה בתשובת נדרים.", {
      transactionId,
      confirmation,
      lastNum
    });
  }

  if (amountFromPayload !== intent.amountAgorot) {
    await failPrintCreditIntent(intent, payload, "סכום העסקה אינו תואם לחבילת ההדפסה.", {
      transactionId,
      confirmation,
      lastNum
    });
  }

  const duplicateRows = await sql`
    SELECT id
    FROM print_credit_purchase_intents
    WHERE nedarim_transaction_id = ${transactionId}
      AND id <> ${intent.id}
      AND status = 'approved'
    LIMIT 1
  `;
  if (duplicateRows.length) {
    await failPrintCreditIntent(intent, payload, "מזהה העסקה כבר שימש לרכישת קרדיט אחרת.", {
      transactionId,
      confirmation,
      lastNum
    });
  }

  const claimRows = await sql`
    UPDATE print_credit_purchase_intents
    SET
      status = 'processing',
      response_payload = ${payload || {}},
      nedarim_transaction_id = ${transactionId || null},
      confirmation = ${confirmation || null},
      last_num = ${lastNum || null}
    WHERE id = ${intent.id}
      AND status = 'pending'
    RETURNING *
  `;

  if (!claimRows.length) {
    const latest = await getPrintCreditPurchaseIntent(intent.id);
    return { ok: latest?.status === "approved", status: latest?.status || intent.status, intent: latest || intent, alreadyProcessed: true };
  }

  const creditTransactionId = `nedarim-print-credit-${intent.id}`;
  const credit = await addPrintCreditPackage({
    userId: intent.userId,
    packageKey: intent.packageKey,
    createdByUserId: intent.userId,
    transactionId: creditTransactionId,
    metadata: {
      source: "nedarim_iframe",
      intentId: intent.id,
      nedarimTransactionId: transactionId,
      confirmation,
      lastNum
    }
  });

  const updateRows = await sql`
    UPDATE print_credit_purchase_intents
    SET
      status = 'approved',
      credited_transaction_id = ${creditTransactionId},
      approved_at = NOW()
    WHERE id = ${intent.id}
      AND status = 'processing'
    RETURNING *
  `;

  return {
    ok: true,
    status: "approved",
    intent: mapIntentRow(updateRows[0]) || intent,
    credit
  };
}
