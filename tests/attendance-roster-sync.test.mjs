import test from 'node:test';
import assert from 'node:assert/strict';
import {mergeAttendanceRows} from '../lib/attendance-roster-sync.mjs';
import {buildAttendanceDashboard} from '../lib/attendance-dashboard.mjs';

test('old save refresh and polling cannot replace text typed after a save started', () => {
  const drafts = new Map([['s1', {saved:false}]]);
  const latest = [{id:'s1',status:'available',noteText:'טקסט חדש תוך כדי הקלדה'}];
  for (const incoming of [
    [{id:'s1',status:'missing',noteText:''}],
    [{id:'s1',status:'available',noteText:'טקסט חדש',whatsappReplies:[{text:'new reply'}]}]
  ]) {
    const merged = mergeAttendanceRows(incoming, latest, drafts);
    assert.equal(merged[0].noteText,latest[0].noteText);
    assert.equal(merged[0].status,'available');
    assert.deepEqual(merged[0].whatsappReplies,incoming[0].whatsappReplies);
    assert(drafts.has('s1'));
  }
});
test('acknowledged saves keep trailing whitespace while typing and release after blur and server acknowledgement', () => {
  const drafts = new Map([['s1',{saved:true}]]);
  const current = [{id:'s1',status:'found',noteText:'מילה '}];
  const stale = [{id:'s1',status:'found',noteText:'ישן'}];
  assert.equal(mergeAttendanceRows(stale,current,drafts)[0].noteText,'מילה ');
  const ack = [{id:'s1',status:'found',noteText:'מילה'}];
  assert.equal(mergeAttendanceRows(ack,current,drafts,new Set(['s1']))[0].noteText,'מילה ');
  assert(drafts.has('s1'));
  mergeAttendanceRows(ack,current,drafts);
  assert.equal(drafts.has('s1'),false);
  assert.equal(mergeAttendanceRows([{...ack[0],noteText:'עדכון חיצוני'}],current,drafts)[0].noteText,'עדכון חיצוני');
});
test('untouched and newly added students accept server updates', () => {
  const incoming=[{id:'s1',noteText:'server'},{id:'s2',noteText:'new'}];
  assert.deepEqual(mergeAttendanceRows(incoming,[{id:'s1',noteText:'old'}],new Map()),incoming);
});
test('dashboard counts all attendance statuses with percentages and handles empty meetings', () => {
  const roster={session:{statusOptions:[['found','נמצא'],['missing','לא נמצא'],['available','זמין']]},students:[{status:'found'},{status:'found'},{status:'missing'},{status:'custom'}]};
  const result=buildAttendanceDashboard(roster);
  assert.equal(result.total,4);
  assert.equal(result.statuses.find(s=>s.value==='found').percentage,50);
  assert.equal(result.statuses.find(s=>s.value==='missing').percentage,25);
  assert.equal(result.statuses.find(s=>s.value==='custom').count,1);
  assert.equal(result.statuses.find(s=>s.value==='available').count,0);
  const empty=buildAttendanceDashboard({...roster,students:[]});
  assert.equal(empty.total,0);assert(empty.statuses.every(s=>s.percentage===0));
});
