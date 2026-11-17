import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';

const file = await fs.readFile(new URL('../app/attendance/actions.js', import.meta.url), 'utf8');
const start = file.indexOf('export async function sendAttendanceSessionWhatsAppAction(');
const end = file.indexOf('\nexport async function ', start + 1);
const source = file.slice(start, end).replace(/^export /, '');
async function submit(result, options = {}) {
  let completed = false;
  const calls = [];
  const saved=[];
  const action = vm.runInNewContext(`(${source})`, {
    URLSearchParams,
    clean: value => String(value || '').trim(),
    cleanList: values => values.map(value => String(value || '').trim()).filter(Boolean),
    requireAttendanceUser: async () => ({clerk_user_id: 'user-1'}),
    redirect: url => { const error = new Error('redirect'); error.url = url; throw error; },
    revalidatePath: () => {},
    after: () => { throw new Error('must wait for provider result'); },
    savedWhatsAppMedia: async()=>({attachment:null,upload:async()=>''}),
    recordAttendanceMessagePreset: async(...args)=>saved.push(args),
    getAttendanceSessionById: async()=>({emailSubject:'kept subject',emailResponseStatuses:['found']}),
    updateAttendanceSessionMessaging: async()=>{},
    sendAttendanceSessionWhatsApp: async args => {
      assert.equal(saved.length,1);
      calls.push(args);
      await Promise.resolve();
      completed = true;
      if (options.error) throw new Error(options.error);
      return result;
    },
    console: {error() {}}
  });
  const form = new FormData();
  form.set('sessionId', 'meeting-A');
  form.set('personalMessage', 'edited message');
  for (const status of options.statuses || ['available', 'unavailable']) form.append('whatsappResponseStatuses', status);
  try { await action(form); assert.fail('expected redirect'); }
  catch (error) {
    if (!error.url) throw error;
    return {query: new URL(error.url, 'https://crm.test').searchParams, completed, calls,saved};
  }
}
test('form waits for provider and returns success and partial failure counts', async () => {
  const response = await submit({sent: 2, failed: 1, missingPhones: 3, errors: ['provider failure']});
  assert.equal(response.completed, true);
  assert.equal(response.query.get('whatsappSent'), '2');
  assert.equal(response.query.get('whatsappFailed'), '1');
  assert.equal(response.query.get('whatsappMissingPhones'), '3');
  assert.equal(response.query.get('whatsappError'), 'provider failure');
  assert.equal(response.calls[0].personalMessage, 'edited message');
  assert.equal(response.saved[0][1],'legacy-whatsapp');
  assert.equal(response.saved[0][2].personalMessage,'edited message');
});
test('all provider failures and thrown errors redirect with visible errors, never queued success', async () => {
  for (const response of [
    await submit({sent: 0, failed: 1, missingPhones: 0, errors: ['rejected template']}),
    await submit(null, {error: 'provider unavailable'}),
    await submit({sent: 0, failed: 0, missingPhones: 2, errors: []})
  ]) {
    assert(response.query.get('whatsappError'));
    assert.equal(response.query.has('whatsappSent'), false);
    assert.equal(response.query.has('whatsappQueued'), false);
  }
});
test('invalid status selection is rejected before sending', async () => {
  const response = await submit(null, {statuses: ['available']});
  assert.equal(response.calls.length, 0);
  assert(response.query.get('whatsappError'));
});
