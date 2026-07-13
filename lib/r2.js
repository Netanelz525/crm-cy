import { GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";

function clean(value) {
  return String(value || "").trim();
}

function sanitizeHeaderFilename(value) {
  const fallback = clean(value)
    .replace(/[^\x20-\x7E]+/g, "_")
    .replace(/["\\;]+/g, "_")
    .replace(/\s+/g, " ")
    .trim();
  return fallback || "document";
}

function sanitizeContentDisposition(value) {
  const raw = clean(value).replace(/[\r\n]+/g, " ");
  if (!raw) return "";
  if (/^[\t\x20-\x7E]*$/.test(raw)) return raw;

  const disposition = clean(raw.split(";")[0]).toLowerCase();
  const safeDisposition = ["inline", "attachment"].includes(disposition) ? disposition : "inline";
  const filenameMatch = raw.match(/filename="([^"]*)"/i) || raw.match(/filename=([^;]*)/i);
  const originalFilename = clean(filenameMatch?.[1]) || "document";
  const fallbackFilename = sanitizeHeaderFilename(originalFilename);
  return `${safeDisposition}; filename="${fallbackFilename}"; filename*=UTF-8''${encodeURIComponent(originalFilename)}`;
}

function requireEnv(name) {
  const value = clean(process.env[name]);
  if (!value) {
    throw new Error(`Missing ${name} env variable.`);
  }
  return value;
}

const accountId = clean(process.env.R2_ACCOUNT_ID);
const accessKeyId = clean(process.env.R2_ACCESS_KEY_ID);
const secretAccessKey = clean(process.env.R2_SECRET_ACCESS_KEY);
const bucket = clean(process.env.R2_BUCKET);

let client = null;

function getClient() {
  if (client) return client;
  client = new S3Client({
    region: "auto",
    endpoint: `https://${requireEnv("R2_ACCOUNT_ID")}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: requireEnv("R2_ACCESS_KEY_ID"),
      secretAccessKey: requireEnv("R2_SECRET_ACCESS_KEY")
    }
  });
  return client;
}

export function isR2Configured() {
  return Boolean(accountId && accessKeyId && secretAccessKey && bucket);
}

export function getR2Bucket() {
  return requireEnv("R2_BUCKET");
}

export async function uploadBufferToR2({ key, buffer, contentType, contentDisposition }) {
  const normalizedKey = clean(key);
  if (!normalizedKey) throw new Error("Missing R2 object key.");
  const safeContentDisposition = sanitizeContentDisposition(contentDisposition);
  await getClient().send(new PutObjectCommand({
    Bucket: getR2Bucket(),
    Key: normalizedKey,
    Body: buffer,
    ContentType: clean(contentType) || "application/octet-stream",
    ...(safeContentDisposition ? { ContentDisposition: safeContentDisposition } : {})
  }));
  return { key: normalizedKey, bucket: getR2Bucket() };
}

export async function getObjectBytesFromR2(key) {
  const normalizedKey = clean(key);
  if (!normalizedKey) throw new Error("Missing R2 object key.");
  const response = await getClient().send(new GetObjectCommand({
    Bucket: getR2Bucket(),
    Key: normalizedKey
  }));
  const bytes = await response.Body.transformToByteArray();
  return {
    bytes,
    contentType: clean(response.ContentType) || "application/octet-stream"
  };
}
