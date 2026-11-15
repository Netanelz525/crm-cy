import test from 'node:test';
import assert from 'node:assert/strict';
import {callDeskFilterKey,resolveCallDeskFilter} from '../lib/call-desk-preferences.mjs';
const statuses=[['missing','לא נמצא'],['available','זמין'],['unavailable','לא זמין'],['custom','מיוחד']];
test('reopening restores the selected status, including all and custom statuses',()=>{
  assert.equal(resolveCallDeskFilter(statuses,'','available'),'available');
  assert.equal(resolveCallDeskFilter(statuses,'missing',''),'');
  assert.equal(resolveCallDeskFilter(statuses,'','custom'),'custom');
});
test('an explicit shared link overrides saved preferences without losing an explicit all-status choice',()=>{
  assert.equal(resolveCallDeskFilter(statuses,'לא נמצא','available',true),'missing');
  assert.equal(resolveCallDeskFilter(statuses,'','available',true),'');
});
test('removed or ineligible statuses are not restored and meeting scopes remain isolated',()=>{
  assert.equal(resolveCallDeskFilter(statuses,'','unavailable'),'');
  assert.equal(resolveCallDeskFilter(statuses,'missing','removed'),'missing');
  assert.notEqual(callDeskFilterKey('meeting-a'),callDeskFilterKey('meeting-b'));
  assert.notEqual(callDeskFilterKey('meeting-a',true),callDeskFilterKey('meeting-a',false));
});
