import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import * as firestore from 'firebase/firestore';

const { doc, setDoc, getDoc, updateDoc, deleteDoc, writeBatch, serverTimestamp, setLogLevel } = firestore;
setLogLevel('silent');
const editor = { uid: 'M5qscStYVWcZsm1gSFF2sMmN3Ek1', email: 'msilva@leker.cl', displayName: 'Jefe de Bodega' };
let env;
before(async () => {
  env = await initializeTestEnvironment({ projectId: 'demo-leker-security', firestore: { host: '127.0.0.1', port: 8086, rules: fs.readFileSync('firestore.rules','utf8') } });
});
after(async () => { await env?.cleanup(); });
beforeEach(async () => {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async (context) => {
    await setDoc(doc(context.firestore(),'authorized_users/viewer'),{enabled:true});
  });
});
const userDb = (user = editor) => env.authenticatedContext(user.uid, { email: user.email, firebase: { sign_in_provider: 'password' } }).firestore();
const viewerDb = () => userDb({ uid: 'viewer', email: 'msilva.attacker@example.com' });
async function seed(data = { 'products/p1': {sku:'P1', name:'Plancha', category:'ALVEOLAR', quantity:10} }) {
  await env.withSecurityRulesDisabled(async (context) => {
    for (const [path,value] of Object.entries(data)) await setDoc(doc(context.firestore(),path),value);
  });
}
// Execute the production transaction implementation with the emulator database.
async function operations(db) {
  const sdk = new vm.SyntheticModule(Object.keys(firestore), function () { for (const [key,value] of Object.entries(firestore)) this.setExport(key,value); });
  const database = new vm.SyntheticModule(['db'], function () { this.setExport('db',db); });
  const auth = new vm.SyntheticModule(['getUserDisplayName'], function () { this.setExport('getUserDisplayName',user=>user.displayName || user.email); });
  const validation = new vm.SourceTextModule(fs.readFileSync('src/lib/validation.js','utf8'));
  const module = new vm.SourceTextModule(fs.readFileSync('src/lib/inventoryOperations.js','utf8'));
  await module.link(async (specifier) => specifier === 'firebase/firestore' ? sdk : specifier.includes('firebase') ? database : specifier.includes('AuthContext') ? auth : validation);
  await module.evaluate();
  return module.namespace;
}

async function library(path) {
  const sdk = new vm.SyntheticModule(Object.keys(firestore), function () { for (const [key,value] of Object.entries(firestore)) this.setExport(key,value); });
  const validation = new vm.SourceTextModule(fs.readFileSync('src/lib/validation.js','utf8'));
  const module = new vm.SourceTextModule(fs.readFileSync(path,'utf8'));
  await module.link(async (specifier) => specifier === 'firebase/firestore' ? sdk : validation);
  await module.evaluate();
  return module.namespace;
}

test('physical count preserves 563 and rejects stale overwrite; simultaneous increments are retained', async () => {
  await seed({'active_physical_audit/current':{counts:{p1:0},updatedByMap:{},lastUpdated:new Date()}});
  const {savePhysicalCount} = await library('src/lib/physicalCountOperations.js');
  const user = {uid:'viewer',email:'viewer@example.com'};
  const db = userDb(user);
  assert.equal(await savePhysicalCount(db,user,'p1',563,{expected:0}),563);
  await assert.rejects(savePhysicalCount(db,user,'p1',0,{expected:0}),/Otro usuario/);
  assert.equal((await getDoc(doc(db,'active_physical_audit/current'))).data().counts.p1,563);
  await Promise.all([savePhysicalCount(db,user,'p1',564,{delta:1}),savePhysicalCount(db,user,'p1',564,{delta:1})]);
  assert.equal((await getDoc(doc(db,'active_physical_audit/current'))).data().counts.p1,565);
});

test('only Franco can grant or revoke consultation access with atomic audit evidence', async () => {
  const {saveUserAccess,ADMIN_UID} = await library('src/lib/userAccess.js');
  const admin = {uid:ADMIN_UID,email:'franco.ruz.valenzuela@gmail.com'};
  const db = userDb(admin);
  const entry = {uid:'new-viewer',email:'consulta@example.com',name:'Consulta',enabled:true,isNew:true};
  await assertFails(setDoc(doc(db,'authorized_users/new-viewer'),{enabled:true}));
  await saveUserAccess(db,admin,entry);
  await seed();
  const viewer = userDb({uid:entry.uid,email:entry.email});
  await assertSucceeds(getDoc(doc(viewer,'products/p1')));
  await assertFails(firestore.getDocs(firestore.collection(viewer,'authorized_users')));
  await assertFails(updateDoc(doc(viewer,'authorized_users/new-viewer'),{enabled:false}));
  await assert.rejects(saveUserAccess(userDb(),editor,entry),/Solo Franco/);
  await saveUserAccess(db,admin,{...entry,isNew:false,expectedEnabled:true,enabled:false});
  await assertFails(getDoc(doc(viewer,'products/p1')));
  await assert.rejects(saveUserAccess(db,admin,{...entry,uid:ADMIN_UID}),/editores/);
});
test('anonymous users cannot read stock; a similar email grants no editing role', async () => {
  await seed();
  await assertFails(getDoc(doc(env.unauthenticatedContext().firestore(),'products/p1')));
  await assertSucceeds(getDoc(doc(viewerDb(),'products/p1')));
  await assertFails(updateDoc(doc(viewerDb(),'products/p1'),{quantity:9}));
  await assertFails(getDoc(doc(userDb({uid:'outsider',email:'outsider@example.com'}),'products/p1')));
});
test('direct stock changes without atomic audit evidence are denied', async () => {
  await seed();
  await assertFails(updateDoc(doc(userDb(),'products/p1'),{quantity:9,lastUpdated:serverTimestamp(),updatedBy:editor.uid,lastMutationId:'missing'}));
  await assertFails(deleteDoc(doc(userDb(),'products/p1')));
});

test('Franco is authorized by his verified UID, without depending on the token provider', async () => {
  await seed();
  for (const provider of ['password', 'google.com', 'custom']) {
    const db = env.authenticatedContext('TadrO5T20Ka4g1vRUfDZBeNl5q22', {
      email:'franco.ruz.valenzuela@gmail.com', firebase:{sign_in_provider:provider}
    }).firestore();
    await assertSucceeds(getDoc(doc(db,'products/p1')));
  }
  await assertFails(getDoc(doc(userDb({uid:'wrong-uid',email:'franco.ruz.valenzuela@gmail.com'}),'products/p1')));
});
test('two editors discount concurrently: 10 -> 8, with two immutable movements', async () => {
  await seed();
  const first = await operations(userDb());
  const franco = {uid:'TadrO5T20Ka4g1vRUfDZBeNl5q22',email:'franco.ruz.valenzuela@gmail.com',displayName:'Franco'};
  await assertSucceeds(getDoc(doc(userDb(franco),'products/p1')));
  const second = await operations(userDb(franco));
  await Promise.all([first.adjustProductStock('p1',-1,editor),second.adjustProductStock('p1',-1,franco)]);
  assert.equal((await getDoc(doc(userDb(),'products/p1'))).data().quantity,8);
  const logs = await firestore.getDocs(firestore.collection(userDb(),'audit_log'));
  assert.equal(logs.size,2);
  await assertFails(updateDoc(logs.docs[0].ref,{action:'fake'}));
  await assertFails(deleteDoc(logs.docs[0].ref));
});
test('stale absolute changes are rejected; audit failure rolls back stock', async () => {
  await seed();
  const ops=await operations(userDb());
  await ops.adjustProductStock('p1',-1,editor);
  await assert.rejects(ops.commitInventoryChanges([{id:'p1',kind:'set',data:{quantity:5},expectedQuantity:10}],editor),/cambió/);
  await assertFails(ops.adjustProductStock('p1',-1,{...editor,email:'forged@example.com'}));
  assert.equal((await getDoc(doc(userDb(),'products/p1'))).data().quantity,9);
});
test('orders apply completely once, including concurrent retries', async () => {
  await seed({'products/p1':{sku:'P1',name:'Uno',category:'ALVEOLAR',quantity:10},'products/p2':{sku:'P2',name:'Dos',category:'ALVEOLAR',quantity:10}});
  const ops=await operations(userDb());
  const changes=[{id:'p1',kind:'delta',delta:-1},{id:'p2',kind:'delta',delta:-2}];
  const outcomes=await Promise.allSettled([ops.commitInventoryChanges(changes,editor,{orderNumber:'NP-1'}),ops.commitInventoryChanges(changes,editor,{orderNumber:'np-1'})]);
  assert.equal(outcomes.filter(result=>result.status==='fulfilled').length,1);
  assert.equal((await getDoc(doc(userDb(),'products/p1'))).data().quantity,9);
  assert.equal((await getDoc(doc(userDb(),'products/p2'))).data().quantity,8);
  await assert.rejects(ops.commitInventoryChanges([{id:'p1',kind:'delta',delta:-1},{id:'missing',kind:'delta',delta:-1}],editor,{orderNumber:'NP-2'}));
  assert.equal((await getDoc(doc(userDb(),'products/p1'))).data().quantity,9);
  assert.equal((await getDoc(doc(userDb(),'order_receipts/NP-2'))).exists(),false);
});
test('valid deletion creates an archive and an immutable audit entry atomically', async () => {
  await seed();
  const ops=await operations(userDb());
  await ops.commitInventoryChanges([{id:'p1',kind:'delete',expectedQuantity:10}],editor);
  assert.equal((await getDoc(doc(userDb(),'products/p1'))).exists(),false);
  assert.equal((await getDoc(doc(userDb(),'product_deletions/p1'))).data().productData.quantity,10);
});
test('a whole 100-product import fits the rule access budget', async () => {
  const ops=await operations(userDb());
  const changes=Array.from({length:100},(_,i)=>({id:`p${i}`,kind:'create',data:{sku:`P${i}`,name:'Plancha',category:'ALVEOLAR',quantity:1}}));
  await ops.commitInventoryChanges(changes,editor,{action:'excel_subido'});
  assert.equal((await firestore.getDocs(firestore.collection(userDb(),'products'))).size,100);
});
test('users cannot forge audit authors, edit reports or notifications', async () => {
  await seed({'notifications/n1':{type:'info',message:'Original',userId:editor.uid,userName:'Editor',timestamp:new Date(),readBy:[]},'inventory_sessions/s1':{name:'Original'}});
  await assertFails(setDoc(doc(viewerDb(),'audit_log/fake'),{action:'escaneo',userId:editor.uid,userName:'Editor',userEmail:editor.email,timestamp:serverTimestamp(),details:{}}));
  await assertFails(updateDoc(doc(viewerDb(),'notifications/n1'),{message:'Alterado'}));
  await assertFails(updateDoc(doc(viewerDb(),'notifications/n1'),{readBy:[editor.uid]}));
  await assertSucceeds(updateDoc(doc(viewerDb(),'notifications/n1'),{readBy:['viewer']}));
  await assertFails(deleteDoc(doc(viewerDb(),'notifications/n1')));
  await assertFails(updateDoc(doc(viewerDb(),'inventory_sessions/s1'),{name:'Alterado'}));
});
test('viewers can count one product, but cannot clear or replace the shared session', async () => {
  await seed({'active_physical_audit/current':{counts:{p1:2,p2:3},extraProducts:{},updatedByMap:{},lastUpdated:new Date()}});
  await assertSucceeds(updateDoc(doc(viewerDb(),'active_physical_audit/current'),{'counts.p1':3,'updatedByMap.p1':{userId:'viewer',userName:'Viewer'},lastCountProductId:'p1',lastUpdated:serverTimestamp(),lastUpdatedBy:'Viewer'}));
  await assertFails(updateDoc(doc(viewerDb(),'active_physical_audit/current'),{'counts.p1':'invalid',lastUpdated:serverTimestamp()}));
  await assertFails(updateDoc(doc(viewerDb(),'active_physical_audit/current'),{counts:{},lastUpdated:serverTimestamp()}));
});
