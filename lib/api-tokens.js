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

const AUTH_CACHE_TTL_MS = 60 * 60 * 1000;
const LAST_USED_UPDATE_INTERVAL_MS = 15 * 60 * 1000;
const authCache = globalThis.__crmApiTokenAuthCache || new Map();
globalThis.__crmApiTokenAuthCache = authCache;

function canUseCachedToken(cachedToken, requiredScope) {
  if (!cachedToken || cachedToken.expiresAt < Date.now()) return false;
  const scopes = Array.isArray(cachedToken.scopes) ? cachedToken.scopes : [];
  return !requiredScope || scopes.includes(requiredScope);
}

async function maybeTouchTokenLastUsed(tokenId, tokenHash) {
  const cachedToken = authCache.get(tokenHash);
  const now = Date.now();
  if (cachedToken?.lastUsedTouchedAt && now - cachedToken.lastUsedTouchedAt < LAST_USED_UPDATE_INTERVAL_MS) {
    return;
  }
  await sql`
    UPDATE api_tokens
    SET last_used_at = NOW()
    WHERE id = ${tokenId}
  `;
  if (cachedToken) {
    authCache.set(tokenHash, {
      ...cachedToken,
      lastUsedTouchedAt: now
    });
  }
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
  const normalizedTokenId = clean(tokenId);
  await sql`
    UPDATE api_tokens
    SET revoked_at = NOW()
    WHERE id = ${normalizedTokenId}
      AND revoked_at IS NULL
  `;
  for (const [tokenHash, cachedToken] of authCache.entries()) {
    if (cachedToken?.id === normalizedTokenId) {
      authCache.delete(tokenHash);
    }
  }
}

export async function authenticateApiToken(rawToken, requiredScope) {
  const nextToken = clean(rawToken);
  if (!nextToken) return null;

  const tokenHash = hashToken(nextToken);
  const cachedToken = authCache.get(tokenHash);
  if (canUseCachedToken(cachedToken, requiredScope)) {
    maybeTouchTokenLastUsed(cachedToken.id, tokenHash).catch(() => null);
    return cachedToken;
  }

  await initDb();
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

  const authToken = {
    id: token.id,
    label: token.label,
    token_prefix: token.token_prefix,
    scopes,
    revoked_at: token.revoked_at,
    expiresAt: Date.now() + AUTH_CACHE_TTL_MS,
    lastUsedTouchedAt: 0
  };
  authCache.set(tokenHash, authToken);
  maybeTouchTokenLastUsed(token.id, tokenHash).catch(() => null);

  return authToken;
}

export function readBearerToken(request) {
  const authHeader = clean(request.headers.get("authorization"));
  if (!authHeader.toLowerCase().startsWith("bearer ")) return "";
  return clean(authHeader.slice(7));
}
