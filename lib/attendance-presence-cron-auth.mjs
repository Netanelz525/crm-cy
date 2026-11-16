import { createPublicKey, verify } from 'node:crypto';
const issuer = 'https://token.actions.githubusercontent.com';
export const presenceCronAudience = 'https://crm-cy-nu.vercel.app/api/cron/attendance-presence';
let cache;
async function keys() {
  if (cache && cache.until > Date.now()) return cache.keys;
  const response = await fetch(`${issuer}/.well-known/jwks`, { signal: AbortSignal.timeout(5000), redirect: 'error' });
  if (!response.ok) throw new Error('OIDC keys unavailable');
  const data = await response.json();
  cache = { keys: data.keys, until: Date.now() + 300000 };
  return cache.keys;
}
export async function authorizePresenceCron(request, loadKeys = keys) {
  try {
    const token = request.headers.get('authorization')?.replace(/^Bearer /, '') || '';
    if (token.length > 16000) return false;
    const parts = token.split('.');
    if (parts.length !== 3) return false;
    const header = JSON.parse(Buffer.from(parts[0], 'base64url'));
    if (header.alg !== 'RS256' || !header.kid) return false;
    const claims = JSON.parse(Buffer.from(parts[1], 'base64url'));
    const now = Date.now() / 1000;
    if (claims.iss !== issuer || claims.aud !== presenceCronAudience ||
      !Number.isFinite(claims.exp) || claims.exp <= now ||
      !Number.isFinite(claims.iat) || claims.iat > now + 30 || now - claims.iat > 600 ||
      (claims.nbf != null && claims.nbf > now + 30) ||
      claims.repository_id !== '1176067153' || claims.ref !== 'refs/heads/main' ||
      claims.workflow_ref !== 'Netanelz525/crm-cy/.github/workflows/attendance-presence.yml@refs/heads/main' ||
      !['schedule', 'workflow_dispatch'].includes(claims.event_name)) return false;
    const jwk = (await loadKeys()).find(key => key.kid === header.kid && key.kty === 'RSA');
    if (!jwk) return false;
    return verify('RSA-SHA256', Buffer.from(`${parts[0]}.${parts[1]}`), createPublicKey({ key: jwk, format: 'jwk' }), Buffer.from(parts[2], 'base64url'));
  } catch { return false; }
}
