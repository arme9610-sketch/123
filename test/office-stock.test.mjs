import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {createApp} from '../server.mjs';
import {officeCatalog} from '../public/office-catalog.js';
test('office catalog has exactly 32 unique requested options',()=>{assert.equal(officeCatalog.length,32);assert.equal(new Set(officeCatalog.map(s=>s.id)).size,32);for(const [model,count] of [['에센셜',12],['메트론',12],['카빈',7],['파우치세트',1]])assert.equal(officeCatalog.filter(s=>s.model===model).length,count);assert.ok(officeCatalog.some(s=>s.label==='카빈 20인치 던핑크'));assert.deepEqual([...new Set(officeCatalog.filter(s=>s.model==='메트론').map(s=>s.size))],['20인치','24인치','26인치']);});
for(const engine of process.env.MOA_TEST_DATABASE_URL?['postgres']:['sqlite']){
 test(engine+': office stock is edited manually; creating, completing or undoing office tasks never changes inventory',async t=>{
  const dir=await mkdtemp('/tmp/dayon-office-');let app,base,pool,schema,databaseUrl='';const setupToken=randomUUID();
  if(engine==='postgres'){const url=new URL(process.env.MOA_TEST_DATABASE_URL);assert.ok(['localhost','127.0.0.1'].includes(url.hostname));const {default:pg}=await import('pg');pool=new pg.Pool({connectionString:url.toString(),ssl:false});schema='office_'+randomUUID().replaceAll('-','');await pool.query('CREATE SCHEMA '+schema);url.searchParams.set('options','-csearch_path='+schema);databaseUrl=url.toString();}
  async function start(){app=await createApp({dataDir:dir,databaseUrl,setupToken});await new Promise(r=>app.server.listen(0,'127.0.0.1',r));base='http://127.0.0.1:'+app.server.address().port;}
  await start();t.after(async()=>{await app.close();if(pool){await pool.query('DROP SCHEMA '+schema+' CASCADE');await pool.end();}await rm(dir,{recursive:true,force:true});});
  let headers={'Content-Type':'application/json'};
  async function req(path,method='GET',body,custom=headers){const r=await fetch(base+path,{method,headers:custom,body:body===undefined?undefined:JSON.stringify(body)});return {status:r.status,data:await r.json(),cookie:r.headers.get('set-cookie')?.split(';')[0]};}
  const auth=await req('/api/setup','POST',{setupToken,name:'재고 담당',username:'office',password:randomUUID()});headers={...headers,cookie:auth.cookie,'X-CSRF-Token':auth.data.csrfToken};
  const sku=officeCatalog[0].id;const state=async()=> (await req('/api/state')).data;const stock=async()=> (await state()).officeStock.find(s=>s.id===sku);
  assert.equal((await state()).officeStock.length,32);
  const initial={goodQty:10,returnedQty:4,serviceQty:3,defectiveQty:2,version:(await stock()).version};
  const path='/api/office-stock/'+sku;
  assert.equal((await req(path,'PUT',initial,{'Content-Type':'application/json'})).status,401);
  assert.equal((await req(path,'PUT',initial,{'Content-Type':'application/json',cookie:auth.cookie})).status,403);
  assert.equal((await req(path,'PUT',initial)).status,200);
  assert.equal((await req(path,'PUT',initial)).status,409);
  for(const [field,value] of [['goodQty',-1],['returnedQty',1.5],['serviceQty',null],['defectiveQty',1000000001]])assert.equal((await req(path,'PUT',{...initial,[field]:value,version:(await stock()).version})).status,422);
  for(const operation of ['return','service','defective','issue']){
   const r=await req('/api/items','POST',{type:'office',title:operation+' 표시용 업무',qty:100,date:'2026-10-30',ownerId:auth.data.user.id,officeSku:sku,officeOperation:operation,officeBucket:'good'});assert.equal(r.status,201);let item=r.data.item;
   assert.equal(item.officeSku,sku);assert.equal(item.officeOperation,operation);
   // Completion and undo are display-only: even a large outbound quantity cannot change stock.
   for(let i=0;i<2;i++){const result=await req('/api/items/'+item.id+'/toggle','POST',{version:item.version});assert.equal(result.status,200);item=result.data.item;}
  }
  let counts=await stock();assert.deepEqual([counts.goodQty,counts.returnedQty,counts.serviceQty,counts.defectiveQty],[10,4,3,2]);
  assert.equal((await req(path,'PUT',{goodQty:12,returnedQty:2,serviceQty:3,defectiveQty:2,version:counts.version})).status,200);
  counts=await stock();const race=await Promise.all([req(path,'PUT',{...initial,version:counts.version}),req(path,'PUT',{...initial,version:counts.version})]);assert.deepEqual(race.map(r=>r.status).sort(),[200,409]);
  const other=(await state()).officeStock[1];assert.deepEqual([other.goodQty,other.returnedQty,other.serviceQty,other.defectiveQty],[0,0,0,0]);
  await app.close();await start();counts=await stock();assert.deepEqual([counts.goodQty,counts.returnedQty,counts.serviceQty,counts.defectiveQty],[10,4,3,2]);
  const imported=await req('/api/items','POST',{type:'inbound',title:'수입 일정',qty:1,date:'2026-11-02',warehouseDate:'2026-11-04',ownerId:auth.data.user.id});assert.equal(imported.status,201);assert.equal(imported.data.item.warehouseDate,'2026-11-04');
  const change=await req('/api/items/'+imported.data.item.id,'PUT',{...imported.data.item,warehouseDate:'2026-11-05'});assert.equal(change.status,200);assert.equal(change.data.item.warehouseDate,'2026-11-05');
  assert.equal((await req('/api/items','POST',{type:'inbound',title:'날짜 검증',qty:1,date:'2026-11-02',warehouseDate:'2026-02-30',ownerId:auth.data.user.id})).status,422);
  await app.close();await start();assert.equal((await state()).items.find(i=>i.id===imported.data.item.id).warehouseDate,'2026-11-05');
  assert.equal((await req('/api/items','POST',{type:'office',title:'위조 옵션',qty:1,date:'2026-10-30',ownerId:auth.data.user.id,officeSku:'fake',officeOperation:'return'})).status,422);
 });
}
