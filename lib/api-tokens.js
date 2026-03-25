import crypto from "node:crypto";
import { initDb, sql } from "./db";

function clean(value) {
  return String(value || "").trim();
}

function normalizeScopes(scopes) {
  const values = Array.isArray(scopes) ? scopes : [scopes];
  const normalized = values.map((scope) => clean(scope)).filter(Boolean);
  return normalized.length ? normalized : ["students:read"];
}

function hashToken(rawToken) {
  return crypto.createHash("sha256").update(rawToken).digest("hex");
}

export async function listApiTokens() {
  await initDb();
  return sql`
    SELECT
      id,
      label,
      token_prefix,
      scopes,
      created_by_user_id,
      last_used_at,
      revoked_at,
      created_at
    FROM api_tokens
    ORDER BY created_at DESC
  `;
}

export async function createApiToken({ label, scopes, createdByUserId }) {
  await initDb();
  const nextLabel = clean(label);
  if (!nextLabel) {
    throw new Error("חובה להזין שם לטוקן");
  }

  const normalizedScopes = normalizeScopes(scopes);
  const rawToken = `crm_${crypto.randomBytes(24).toString("hex")}`;
  const tokenPrefix = rawToken.slice(0, 12);
  const tokenHash = hashToken(rawToken);
  const id = crypto.randomUUID();

  await sql`
    INSERT INTO api_tokens (
      id,
      label,
      token_prefix,
      token_hash,
      scopes,
      created_by_user_id
    )
    VALUES (
      ${id},
      ${nextLabel},
      ${tokenPrefix},
      ${tokenHash},
      ${normalizedScopes},
      ${clean(createdByUserId) || null}
    )
  `;

  return {
    id,
    rawToken,
    tokenPrefix,
    label: nextLabel,
    scopes: normalizedScopes
  };
}

export async function revokeApiToken(tokenId) {
  await initDb();
  await sql`
    UPDATE api_tokens
    SET revoked_at = NOW()
    WHERE id = ${clean(tokenId)}
      AND revoked_at IS NULL
  `;
}

export async function authenticateApiToken(rawToken, requiredScope) {
  await initDb();
  const nextToken = clean(rawToken);
  if (!nextToken) return null;

  const tokenHash = hashToken(nextToken);
  const rows = await sql`
    SELECT
      id,
      label,
      token_prefix,
      scopes,
      revoked_at
    FROM api_tokens
    WHERE token_hash = ${tokenHash}
    LIMIT 1
  `;
  const token = rows[0] || null;
  if (!token || token.revoked_at) return null;

  const scopes = Array.isArray(token.scopes) ? token.scopes : [];
  if (requiredScope && !scopes.includes(requiredScope)) return null;

  await sql`
    UPDATE api_tokens
    SET last_used_at = NOW()
    WHERE id = ${token.id}
  `;

  return token;
}

export function readBearerToken(request) {
  const authHeader = clean(request.headers.get("authorization"));
  if (!authHeader.toLowerCase().startsWith("bearer ")) return "";
  return clean(authHeader.slice(7));
}
