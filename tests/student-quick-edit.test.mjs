import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
async function load(path,stubs={}){const context=vm.createContext({URLSearchParams,Date});const module=new vm.SourceTextModule(await fs.readFile(new URL(path,import.meta.url),'utf8'),{context});await module.link(async key=>new vm.SyntheticModule(Object.keys(stubs[key]),function(){for(const [name,value] of Object.entries(stubs[key]))this.setExport(name,value);},{context}));await module.evaluate();return module.namespace;}
const fields=await load('../lib/student-fields.js');
const quick=await load('../lib/student-quick-edit.js',{'./student-fields':fields});
const view=await load('../lib/student-view.js',{'./student-fields':fields});
test('legacy registration columns collapse to one column in the picker and saved selections',()=>{
 assert.equal(view.INSTITUTION_COLUMNS_FULL.filter(column=>column.label==='רישום').length,1);
 assert.deepEqual([...view.normalizeStudentColumns(['field:registration','missing','registration','missing'])],['registration','missing']);
 assert.deepEqual([...view.normalizeStudentColumns('field:registration')],['registration']);
});
test('quick edit changes only requested fields, preserving sibling names, phone metadata, notes and lists',()=>{
 const student={fullName:{firstName:'אברהם',lastName:'כהן'},phone:{primaryPhoneNumber:'0500000000',primaryPhoneCallingCode:'+972',additionalPhones:['other']},note:'keep'};
 const patch=quick.studentQuickPatch(student,'field:fullName.firstName',{'fullName.firstName':'משה'});assert.equal(patch.name,'משה כהן');assert.equal(patch.fullName.firstName,'משה');assert.equal(patch.note,undefined);
 const phone=quick.studentQuickPatch(student,'field:phone.primaryPhoneNumber',{'phone.primaryPhoneNumber':'0520000000'});assert.equal(phone.phone.primaryPhoneNumber,'0520000000');assert.equal(phone.phone.additionalPhones,undefined);assert.equal(phone.phone.primaryPhoneCallingCode,undefined);
 assert.equal(student.fullName.firstName,'אברהם');assert.equal(student.phone.additionalPhones[0],'other');
});
test('clears, enums, lists and source dates are supported; forged fields and invalid values fail',()=>{
 assert.equal(quick.studentQuickPatch({},'registration',{registration:''}).registration,null);
 assert.equal(quick.studentQuickPatch({},'field:note',{note:''}).note,'');
 assert.equal(quick.studentQuickPatch({},'field:dateofbirth',{dateofbirth:'2008-03-28'}).dateofbirth,'2008-03-28T00:00:00.000Z');
 assert.equal(quick.studentQuickPatch({},'field:phone.additionalPhones',{'phone.additionalPhones':''}).phone.additionalPhones.length,0);
 for(const [column,values]of [['registration',{registration:'FORGED'}],['field:dateofbirth',{dateofbirth:'2008-02-31'}],['name',{'__proto__.role':'admin'}],['registration',{registration:'DT',note:'unexpected'}],['field:childrenCount',{childrenCount:'-2'}],['field:role',{role:'admin'}]])assert.throws(()=>quick.studentQuickPatch({},column,values));
});
test('server action rechecks approved staff permissions, refuses unknown students and persists a narrow patch',async()=>{
 let user={access_status:'approved',is_manager:true},exists=true,writes=[];const current={id:'student',fullName:{firstName:'משה',lastName:'כהן'}};
 const actions=await load('../app/neon/quick-edit-action.js',{'next/cache':{revalidatePath:()=>{}},'../../lib/rbac':{requireAuthenticatedUser:async()=>user},'../../lib/neon-students':{getNeonStudentById:async()=>exists?current:null,updateNeonStudentViaTwenty:async(id,patch)=>{writes.push({id,patch});return {...current,...patch};}},'../../lib/student-quick-edit':quick});
 const input={studentId:'student',columnKey:'field:note',values:{note:'עדכון'}};
 user={access_status:'approved'};assert.equal((await actions.quickEditStudentAction(input)).ok,false);assert.equal(writes.length,0);
 user={access_status:'pending',is_manager:true};assert.equal((await actions.quickEditStudentAction(input)).ok,false);assert.equal(writes.length,0);
 user={access_status:'approved',is_manager:true};exists=false;assert.equal((await actions.quickEditStudentAction(input)).ok,false);assert.equal(writes.length,0);
 exists=true;const result=await actions.quickEditStudentAction(input);assert.equal(result.ok,true);assert.deepEqual(Object.keys(writes[0].patch),['note']);assert.equal(writes[0].patch.note,'עדכון');
});

test('computed full name and age never offer quick editing',()=>{
 assert.equal(quick.studentQuickFields('name').length,0);assert.equal(quick.studentQuickFields('age').length,0);
 assert.equal(quick.studentQuickFields('field:fullName.firstName')[0].key,'fullName.firstName');
 assert.equal(quick.studentQuickFields('field:fullName.lastName')[0].key,'fullName.lastName');
 assert.equal(quick.studentQuickFields('field:dateofbirth')[0].key,'dateofbirth');
});
