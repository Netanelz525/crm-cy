import { createHash, randomBytes } from 'node:crypto';
import { ensureDbFeature, sql } from './db';

export const MOBILE_NONCE = /^[A-Za-z0-9_-]{43}$/;
export const hashMobileSecret = value => createHash('sha256').update(value).digest('base64url');

async function ensureMobileAuth() {
  await ensureDbFeature('mobile-auth', '1', async () => {
    await sql`CREATE TABLE IF NOT EXISTS mobile_auth_codes (
      code_hash TEXT PRIMARY KEY, challenge TEXT NOT NULL,
      user_id TEXT NOT NULL, expires_at TIMESTAMPTZ NOT NULL
    )`;
    await sql`CREATE INDEX IF NOT EXISTS mobile_auth_codes_expiry ON mobile_auth_codes(expires_at)`;
  });
}

export async function issueMobileCode(userId, challenge) {
  if (!userId || !MOBILE_NONCE.test(challenge)) throw new Error('Invalid mobile authentication request');
  await ensureMobileAuth();
  const code = randomBytes(32).toString('base64url');
  await sql`DELETE FROM mobile_auth_codes WHERE expires_at < NOW()`;
  await sql`INSERT INTO mobile_auth_codes(code_hash, challenge, user_id, expires_at)
    VALUES (${hashMobileSecret(code)}, ${challenge}, ${userId}, NOW() + INTERVAL '2 minutes')`;
  return code;
}

export async function consumeMobileCode(code, verifier) {
  if (!MOBILE_NONCE.test(code || '') || !MOBILE_NONCE.test(verifier || '')) return null;
  await ensureMobileAuth();
  const rows = await sql`DELETE FROM mobile_auth_codes
    WHERE code_hash = ${hashMobileSecret(code)} AND challenge = ${hashMobileSecret(verifier)}
      AND expires_at > NOW() RETURNING user_id`;
  return rows[0]?.user_id || null;
}
