import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {createApp} from '../server.mjs';
import {officeCatalog} from '../public/office-catalog.js';
test('daily manual sales: auth, complete options, conflict, date isolation, stock isolation and persistence',async t=>{
 const dir=await mkdtemp('/tmp/dayon-sales-'),setupToken=randomUUID();let app,base;async function start(){app=await createApp({dataDir:dir,setupToken});await new Promise(r=>app.server.listen(0,'127.0.0.1',r));base='http://127.0.0.1:'+app.server.address().port;}await start();t.after(async()=>{await app.close();await rm(dir,{recursive:true,force:true});});let headers={'Content-Type':'application/json'};
 async function req(path,method='GET',body,h=headers){const r=await fetch(base+path,{method,headers:h,body:body===undefined?undefined:JSON.stringify(body)});return {status:r.status,data:await r.json(),cookie:r.headers.get('set-cookie')?.split(';')[0]};}
 assert.equal((await req('/api/daily-sales?day=2026-11-03')).status,401);
 const login=await req('/api/setup','POST',{setupToken,name:'판매 담당',username:'sales',password:randomUUID()});headers={...headers,cookie:login.cookie,'X-CSRF-Token':login.data.csrfToken};
 assert.equal((await req('/api/daily-sales/sites','POST',{name:'테스트몰'},{'Content-Type':'application/json',cookie:login.cookie})).status,403);
 const site=(await req('/api/daily-sales/sites','POST',{name:'테스트몰'})).data.site;
 assert.equal((await req('/api/daily-sales/sites','POST',{name:'테스트몰'})).data.site.id,site.id);
 const entries=officeCatalog.map(s=>({sku:s.id,sold:0,cancelled:0,refunded:0}));entries[0]={...entries[0],sold:3,cancelled:1,refunded:5};
 const body={day:'2026-11-03',siteId:site.id,version:0,entries};
 const races=await Promise.all([req('/api/daily-sales','PUT',body),req('/api/daily-sales','PUT',body)]);assert.deepEqual(races.map(r=>r.status).sort(),[200,409]);
 assert.equal((await req('/api/daily-sales','PUT',{...body,version:1,entries:entries.slice(1)})).status,422);
 assert.equal((await req('/api/daily-sales','PUT',{...body,version:1,entries:entries.map((e,i)=>i===0?{...e,sold:-1}:e)})).status,422);
 assert.equal((await req('/api/daily-sales?day=2026-02-30')).status,422);
 assert.equal((await req('/api/daily-sales?day=2026-11-04')).data.records.length,0);
 assert.ok((await req('/api/state')).data.officeStock.every(s=>s.goodQty===0));
 await app.close();await start();const record=(await req('/api/daily-sales?day=2026-11-03')).data.records[0];assert.equal(record.version,1);assert.deepEqual(record.entries,entries);assert.equal(record.author,'판매 담당');
});
