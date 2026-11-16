import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, sign } from 'node:crypto';
import { authorizePresenceCron, presenceCronAudience } from '../lib/attendance-presence-cron-auth.mjs';
test('cron requires a valid signed OIDC token scoped to the exact main workflow', async () => {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const jwk = {...publicKey.export({format:'jwk'}),kid:'test'};
  const now = Date.now()/1000;
  const claims = {iss:'https://token.actions.githubusercontent.com',aud:presenceCronAudience,iat:now,exp:now+300,repository_id:'1176067153',ref:'refs/heads/main',workflow_ref:'Netanelz525/crm-cy/.github/workflows/attendance-presence.yml@refs/heads/main',event_name:'schedule'};
  function request(changes={}, corrupt=false) {
    const head=Buffer.from(JSON.stringify({alg:'RS256',kid:'test'})).toString('base64url');
    const body=Buffer.from(JSON.stringify({...claims,...changes})).toString('base64url');
    const signature=sign('RSA-SHA256',Buffer.from(`${head}.${body}`),privateKey).toString('base64url');
    return new Request('https://example.test',{headers:{authorization:`Bearer ${head}.${body}.${corrupt?'AAAA':signature}`}});
  }
  assert.equal(await authorizePresenceCron(request(),async()=>[jwk]),true);
  for (const changes of [{repository_id:'other'},{ref:'refs/heads/other'},{workflow_ref:'other'},{exp:now-1},{aud:'other'},{event_name:'pull_request'}]) assert.equal(await authorizePresenceCron(request(changes),async()=>[jwk]),false);
  assert.equal(await authorizePresenceCron(request({},true),async()=>[jwk]),false);
  assert.equal(await authorizePresenceCron(new Request('https://example.test')),false);
});
