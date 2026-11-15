export { PRESENCE_MESSAGES } from "./presence-messages.mjs";
export class PresenceError extends Error {
  constructor(code) { super(code); this.code = code; }
}

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
  const endpoint = String(env.MAC_PRESENCE_API_URL || '').trim();
  if (!key || !endpoint) throw new PresenceError('not_configured');
  let url;
  try { url = new URL(endpoint); } catch { throw new PresenceError('not_configured'); }
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) throw new PresenceError('not_configured');
  return { key, endpoint: url.href };
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
        method: 'POST', headers: { 'Content-Type': 'application/json', 'X-API-Key': config.key, 'User-Agent': 'CRM-CY-Presence/1.0' },
        body: JSON.stringify({ macs: batch }), cache: 'no-store', redirect: 'error',
        signal: AbortSignal.timeout(Math.min(6000, remaining))
      });
      if (!response.ok) throw new PresenceError(response.status === 429 ? 'rate_limited' : 'unavailable');
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

