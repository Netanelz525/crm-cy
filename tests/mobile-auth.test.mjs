import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs/promises';
import * as crypto from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';

async function load(path, stubs) {
  const context = vm.createContext({ URL, Response, Request, Buffer, console });
  const module = new vm.SourceTextModule(await fs.readFile(new URL(path, import.meta.url), 'utf8'), { context });
  await module.link(key => new vm.SyntheticModule(Object.keys(stubs[key]), function () {
    for (const [name, value] of Object.entries(stubs[key])) this.setExport(name, value);
  }, { context }));
  await module.evaluate(); return module.namespace;
}

test('mobile codes require the originating device verifier, expire, and can be redeemed only once', async () => {
  const db = new PGlite();
  try {
    const sql = async (strings, ...values) => {
      const query = strings.reduce((result, part, i) => result + (i ? `$${i}` : '') + part, '');
      return (await db.query(query, values)).rows;
    };
    const service = await load('../lib/mobile-auth.js', {
      'node:crypto': crypto, './db': { sql, ensureDbFeature: async (_key, _version, migrate) => migrate() }
    });
    const verifier = crypto.randomBytes(32).toString('base64url');
    const code = await service.issueMobileCode('synthetic-user', service.hashMobileSecret(verifier));
    assert.equal(code.length, 43);
    const stored = (await db.query('SELECT * FROM mobile_auth_codes')).rows[0];
    assert.notEqual(stored.code_hash, code);
    assert.equal(await service.consumeMobileCode(code, crypto.randomBytes(32).toString('base64url')), null);
    const results = await Promise.all([service.consumeMobileCode(code, verifier), service.consumeMobileCode(code, verifier)]);
    assert.equal(results.filter(value => value === 'synthetic-user').length, 1);
    assert.equal(await service.consumeMobileCode(code, verifier), null);
    const expired = await service.issueMobileCode('expired-user', service.hashMobileSecret(verifier));
    await db.query("UPDATE mobile_auth_codes SET expires_at=NOW()-INTERVAL '1 second'");
    assert.equal(await service.consumeMobileCode(expired, verifier), null);
    assert.equal(await service.consumeMobileCode('invalid', verifier), null);
    await assert.rejects(service.issueMobileCode('user', 'invalid'));
  } finally { await db.close(); }
});

test('redemption rejects foreign origins and never asks Clerk for an unverified user', async () => {
  let consumed = 0, minted = 0;
  const route = await load('../app/api/mobile/redeem/route.js', {
    '@clerk/nextjs/server': { clerkClient: async () => ({ signInTokens: { createSignInToken: async ({userId, expiresInSeconds}) => {
      minted++; assert.equal(userId, 'verified-user'); assert.equal(expiresInSeconds,30); return {token:'short-ticket'};
    } } }) },
    '../../../../lib/mobile-auth': { consumeMobileCode: async (code, verifier) => { consumed++; return code==='valid' && verifier==='proof' ? 'verified-user' : null; } }
  });
  const request = (body, origin='https://crm.example') => new Request('https://crm.example/api/mobile/redeem', {
    method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify(body)
  });
  assert.equal((await route.POST(request({code:'valid',verifier:'proof'},'https://evil.example'))).status,403);
  assert.equal(consumed,0); assert.equal(minted,0);
  assert.equal((await route.POST(request({code:'invalid',verifier:'proof'}))).status,401);
  assert.equal(minted,0);
  const response = await route.POST(request({code:'valid',verifier:'proof'}));
  assert.equal(response.status,200); assert.equal(response.headers.get('cache-control'),'no-store');
  assert.equal((await response.json()).ticket,'short-ticket'); assert.equal(minted,1);
});
