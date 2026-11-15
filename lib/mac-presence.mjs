export { PRESENCE_MESSAGES } from "./presence-messages.mjs";
export class PresenceError extends Error {
  constructor(code) { super(code); this.code = code; }
}
// Public endpoint from MAC_PRESENCE_API.md. Credentials are always server envs.
export const DEFAULT_PRESENCE_ENDPOINT = 'https://unifi.kfilter.net/attendance/public/mac-presence';

export function normalizeMac(value) {
  const text = String(value || '').trim();
  if (!/^(?:[\da-f]{2}[:-]){5}[\da-f]{2}$|^[\da-f]{12}$|^(?:[\da-f]{4}\.){2}[\da-f]{4}$/i.test(text)) return null;
  const hex = text.replace(/[:.-]/g, '').toLowerCase();
  if (/^(0{12}|f{12})$/.test(hex) || (parseInt(hex.slice(0, 2), 16) & 1)) return null;
  return hex.match(/../g).join(':');
}

export function presenceCandidates(students) {
  const macStudents = new Map();
  let missingMac = 0, invalidMac = 0;
  for (const student of students) {
    if (!String(student.macAddress || '').trim()) { missingMac++; continue; }
    const mac = normalizeMac(student.macAddress);
    if (!mac) { invalidMac++; continue; }
    const list = macStudents.get(mac) || [];
    list.push(student); macStudents.set(mac, list);
  }
  // A shared MAC does not prove which student is present. Never mark either.
  const duplicateStudents = [...macStudents.values()].filter(list => list.length > 1).flat().length;
  const candidates = [...macStudents].filter(([, list]) => list.length === 1).map(([mac, [student]]) => ({ mac, student }));
  return { candidates, missingMac, invalidMac, duplicateStudents };
}

export function presenceConfig(env = process.env) {
  const key = String(env.MAC_PRESENCE_API_KEY || '').trim();
  const endpoint = String(env.MAC_PRESENCE_API_URL || '').trim() || DEFAULT_PRESENCE_ENDPOINT;
  if (!key || !endpoint) throw new PresenceError('not_configured');
  let url;
  try { url = new URL(endpoint); } catch { throw new PresenceError('not_configured'); }
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) throw new PresenceError('not_configured');
  const accessClientId = String(env.MAC_PRESENCE_CF_ACCESS_CLIENT_ID || '').trim();
  const accessClientSecret = String(env.MAC_PRESENCE_CF_ACCESS_CLIENT_SECRET || '').trim();
  if (Boolean(accessClientId) !== Boolean(accessClientSecret)) throw new PresenceError('not_configured');
  return { key, endpoint: url.href, accessClientId, accessClientSecret };
}

export async function checkMacPresence(macs, { config = presenceConfig(), fetcher = fetch, now = () => Date.now() } = {}) {
  if (macs.length > 6000 || new Set(macs).size !== macs.length || macs.some(mac => normalizeMac(mac) !== mac)) throw new PresenceError('invalid_macs');
  const connected = new Set();
  const started = now();
  let checkedAt = null, batches = 0;
  for (let offset = 0; offset < macs.length; offset += 200) {
    const batch = macs.slice(offset, offset + 200);
    const remaining = 20000 - (now() - started);
    if (remaining <= 0) throw new PresenceError('unavailable');
    let response, body;
    try {
      response = await fetcher(config.endpoint, {
        method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json', 'X-API-Key': config.key, 'User-Agent': 'CRM-CY-Presence/1.0',
          ...(config.accessClientId && config.accessClientSecret ? { 'CF-Access-Client-Id': config.accessClientId, 'CF-Access-Client-Secret': config.accessClientSecret } : {}) },
        body: JSON.stringify({ macs: batch }), cache: 'no-store', redirect: 'manual',
        signal: AbortSignal.timeout(Math.min(6000, remaining))
      });
      if (response.status >= 300 && response.status < 400) {
        let login;
        try { login = new URL(response.headers.get('location'), config.endpoint); } catch { /* no valid redirect */ }
        throw new PresenceError(login?.protocol === 'https:' && login.hostname.endsWith('.cloudflareaccess.com') ? 'access_required' : 'unexpected_redirect');
      }
      if (!response.ok) throw new PresenceError(response.status === 429 ? 'rate_limited' : response.status === 401 ? 'auth_failed' : response.status === 403 ? 'access_denied' : 'unavailable');
      if (!response.headers.get('content-type')?.toLowerCase().includes('application/json')) throw new PresenceError('invalid_response');
      if (Number(response.headers.get('content-length') || 0) > 100000) throw new PresenceError('invalid_response');
      const raw = await response.text();
      if (raw.length > 100000) throw new PresenceError('invalid_response');
      body = JSON.parse(raw);
    } catch (error) {
      throw error instanceof PresenceError ? error : new PresenceError('unavailable');
    }
    const timestamp = Date.parse(body?.checkedAt);
    if (body?.ok !== true || !Array.isArray(body.results) || body.results.length !== batch.length || !Number.isFinite(timestamp) || Math.abs(now() - timestamp) > 300000) throw new PresenceError('invalid_response');
    const expected = new Set(batch), seen = new Set();
    for (const result of body.results) {
      const mac = normalizeMac(result?.mac);
      if (!expected.has(mac) || seen.has(mac) || typeof result.connected !== 'boolean') throw new PresenceError('invalid_response');
      seen.add(mac);
      if (result.connected) connected.add(mac);
    }
    checkedAt = checkedAt ? new Date(Math.min(Date.parse(checkedAt), timestamp)).toISOString() : new Date(timestamp).toISOString();
    batches++;
  }
  return { connected, checkedAt, batches };
}

