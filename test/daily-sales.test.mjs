import {DatabaseSync} from 'node:sqlite';
import {salesSiteNames,combineSalesEntry,salesTotals,rateLabel} from '../public/sales-math.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {createApp} from '../server.mjs';
import {officeCatalog} from '../public/office-catalog.js';
test('daily manual sales: auth, complete options, conflict, date isolation, stock isolation and persistence',async t=>{
 const dir=await mkdtemp('/tmp/dayon-sales-'),setupToken=randomUUID();let app,base;async function start(){app=await createApp({dataDir:dir,setupToken,now:()=>new Date('2026-11-04T03:00:00Z')});await new Promise(r=>app.server.listen(0,'127.0.0.1',r));base='http://127.0.0.1:'+app.server.address().port;}await start();t.after(async()=>{await app.close();await rm(dir,{recursive:true,force:true});});let headers={'Content-Type':'application/json'};
 async function req(path,method='GET',body,h=headers){const r=await fetch(base+path,{method,headers:h,body:body===undefined?undefined:JSON.stringify(body)});return {status:r.status,data:await r.json(),cookie:r.headers.get('set-cookie')?.split(';')[0]};}
 assert.equal((await req('/api/daily-sales?day=2026-11-03')).status,401);
 const login=await req('/api/setup','POST',{setupToken,name:'판매 담당',username:'sales',password:randomUUID()});headers={...headers,cookie:login.cookie,'X-CSRF-Token':login.data.csrfToken};
 assert.equal((await req('/api/daily-sales/sites','POST',{name:'테스트몰'},{'Content-Type':'application/json',cookie:login.cookie})).status,403);
 const initial=(await req('/api/daily-sales?day=2026-11-03')).data;assert.deepEqual(initial.sites.map(s=>s.name),salesSiteNames);const site=initial.sites[0];
 assert.equal((await req('/api/daily-sales/sites','POST',{name:'테스트몰'})).status,405);
 const entries=officeCatalog.map(s=>({sku:s.id,sold:0,cancelled:0,refunded:0}));entries[0]={...entries[0],sold:3,cancelled:1,refunded:5};
 const body={day:'2026-11-03',siteId:site.id,version:0,entries};
 const races=await Promise.all([req('/api/daily-sales','PUT',body),req('/api/daily-sales','PUT',body)]);assert.deepEqual(races.map(r=>r.status).sort(),[200,409]);
 assert.equal((await req('/api/daily-sales/changes','GET',undefined,{})).status,401);
 const comparison=await req('/api/daily-sales/changes');assert.equal(comparison.status,200);assert.equal(comparison.data.currentDay,'2026-11-03');assert.equal(comparison.data.previousDay,'2026-11-02');assert.equal(comparison.data.comparedSites.length,0);
 const overview=await req('/api/daily-sales/summary');assert.equal(overview.status,200);assert.equal(overview.data.periods[0].sold,3);assert.equal(overview.data.periods[0].cancelled,6);assert.equal(overview.data.periods[0].rate,200);assert.equal((await req('/api/daily-sales/summary','GET',undefined,{})).status,401);
 assert.equal((await req('/api/daily-sales','PUT',{...body,version:1,entries:entries.slice(1)})).status,422);
 assert.equal((await req('/api/daily-sales','PUT',{...body,version:1,entries:entries.map((e,i)=>i===0?{...e,sold:-1}:e)})).status,422);
 assert.equal((await req('/api/daily-sales?day=2026-02-30')).status,422);
 assert.equal((await req('/api/daily-sales?day=2026-11-04')).data.records.length,0);
 assert.ok((await req('/api/state')).data.officeStock.every(s=>s.goodQty===0));
 await app.close();await start();const record=(await req('/api/daily-sales?day=2026-11-03')).data.records[0];assert.equal(record.version,1);assert.deepEqual(record.entries,entries.map(combineSalesEntry));assert.equal(record.author,'판매 담당');
 // Simulate a database written by the previously deployed version, with existing site IDs.
 await app.close();const raw=new DatabaseSync(dir+'/moa.sqlite');
 raw.prepare('UPDATE daily_sales SET entries=? WHERE day=? AND site_id=?').run(JSON.stringify(entries),'2026-11-03',site.id);
 raw.prepare('INSERT INTO sales_sites(id,name) VALUES(?,?)').run('legacy-extra','기존 기타 사이트');
 raw.exec('PRAGMA foreign_keys=OFF');raw.prepare('UPDATE daily_sales SET site_id=? WHERE site_id=?').run('legacy-cafe24',site.id);raw.prepare('UPDATE sales_sites SET id=? WHERE id=?').run('legacy-cafe24',site.id);site.id='legacy-cafe24';body.siteId=site.id;raw.close();
 await start();const restored=(await req('/api/daily-sales?day=2026-11-03')).data;
 assert.equal(restored.sites.length,4);assert.equal(restored.sites[0].id,site.id);assert.equal(restored.records[0].entries[0].cancelled,6);assert.equal(restored.records[0].entries[0].refunded,0);
 assert.equal((await req('/api/daily-sales','PUT',{...body,siteId:'legacy-extra'})).status,422);
 const update={...body,entries:restored.records[0].entries,version:restored.records[0].version};
 assert.equal((await req('/api/daily-sales','PUT',update)).status,200);
 await app.close();await start();assert.equal((await req('/api/daily-sales?day=2026-11-03')).data.records[0].entries[0].cancelled,6);
});

test('rates use combined quantities and weighted totals; zero sales have no rate',()=>{
 assert.equal(rateLabel(100,10),'10%');assert.equal(rateLabel(0,0),'—');assert.equal(rateLabel(0,5),'—');assert.equal(rateLabel(3,1),'33.3%');assert.equal(rateLabel(5,10),'200%');
 const t=salesTotals([{sold:100,cancelled:5,refunded:5},{sold:900,cancelled:0,refunded:0}]);assert.equal(rateLabel(t.sold,t.cancelled),'1%');
});

test('product tabs keep drafts and save all hidden options together',async()=>{
 const {createDailySales}=await import('../public/daily-sales.js');
 const originalDocument=globalThis.document,originalWindow=globalThis.window;
 const events=new Map(),root={outerHTML:''},node={innerHTML:'',textContent:'',focus(){}};
 const data={sites:salesSiteNames.map((name,i)=>({id:'site-'+i,name})),records:[]};let saved;
 globalThis.document={addEventListener(type,fn){events.set(type,fn);},querySelector(selector){return selector==='#daily-sales-root'?root:node;}};
 globalThis.window={addEventListener(){}};
 try{
  const ui=createDailySales({getUser:()=>({id:'tester'}),escape:s=>String(s),toast(){},api:async(path,options)=>{if(options){saved=structuredClone(options.body);return {record:{...saved,site_id:saved.siteId,version:1,author:'담당자',updated_at:new Date().toISOString()}};}return structuredClone(data);}});
  ui.render();await new Promise(r=>setImmediate(r));
  const html=()=>ui.render();const count=()=>[...html().matchAll(/data-sales-index=/g)].length;
  assert.equal(count(),24);assert.ok(!html().includes('sales-site-form'));assert.ok(!html().includes('사이트 추가'));
  const input=(index,field,value)=>events.get('input')({target:{matches:()=>true,dataset:{salesIndex:String(index),salesField:field},value:String(value)}});
  input(0,'sold',100);input(0,'cancelled',10);assert.ok(html().includes('10%'));
  const click=model=>events.get('click')({target:{closest:selector=>selector==='[data-sales-group]'?{dataset:{salesGroup:model}}:null}});
  click('카빈');assert.equal(count(),14);click('파우치세트');assert.equal(count(),2);click('메트론');assert.equal(count(),24);click('에센셜');assert.ok(html().includes('value="100"'));
  click('파우치세트');await events.get('submit')({target:{id:'sales-entry-form'},preventDefault(){}});
  assert.equal(saved.entries.length,32);assert.equal(saved.entries[0].sold,100);assert.equal(saved.entries[0].cancelled,10);
 }finally{globalThis.document=originalDocument;globalThis.window=originalWindow;}
});
