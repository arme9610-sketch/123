import test from 'node:test';
import assert from 'node:assert/strict';
import {calendarEntries,calendarDayItems,createCalendarDay} from '../public/calendar.js';
import {createApp} from '../server.mjs';
import {mkdtemp,rm} from 'node:fs/promises';
const items=[{id:'import',type:'inbound',title:'수입',date:'2026-11-02',warehouseDate:'2026-11-04',owner:'담당자'},...['task','office','shipment','meeting'].map(type=>({id:type,type,title:type,date:'2026-11-04',owner:'담당자'}))];
test('ETA and warehouse arrivals appear on their own dates, including equal dates and different months',()=>{
 const events=calendarEntries(items);assert.equal(events.length,6);assert.equal(events.find(e=>e.item.id==='import'&&e.date==='2026-11-04').milestone,'창고 입고');assert.equal(calendarDayItems(items,'2026-11-04').length,5);
 const same=[{...items[0],warehouseDate:'2026-11-02'}];assert.equal(calendarEntries(same).length,2);assert.deepEqual(calendarDayItems(same,'2026-11-02')[0].milestones,['인천 ETA','창고 입고']);
 const later=[{...items[0],warehouseDate:'2026-12-01'}];assert.equal(calendarDayItems(later,'2026-12-01').length,1);assert.equal(calendarEntries([{...items[0],warehouseDate:null}]).length,1);
});
test('whole day cells and keyboard open date management; empty cells offer adding a schedule',async()=>{
 const original=globalThis.document,events=new Map(),dialogEvents=new Map();let added,edited,dropped;
 const dialog={open:false,innerHTML:'',showModal(){this.open=true;},close(){this.open=false;},addEventListener:(type,fn)=>dialogEvents.set(type,fn)};
 globalThis.document={querySelector:()=>dialog,addEventListener:(type,fn)=>events.set(type,fn)};
 try{
  createCalendarDay({escape:String,getItems:()=>items,add:date=>added=date,edit:id=>edited=id,remove:async id=>dropped=id});
  const cell={dataset:{calendarDay:'2026-11-04'}};events.get('click')({target:{closest:()=>cell}});assert.equal(dialog.open,true);assert.ok(dialog.innerHTML.includes('창고 입고'));assert.ok(dialog.innerHTML.includes('data-calendar-delete'));
  const click=(selector,data)=>dialogEvents.get('click')({target:{closest:s=>s===selector?{dataset:data}:null}});
  await click('[data-calendar-edit]',{calendarEdit:'import'});assert.equal(edited,'import');
  cell.dataset.calendarDay='2026-11-05';let prevented=false;events.get('keydown')({key:'Enter',preventDefault(){prevented=true;},target:{closest:()=>cell}});assert.ok(prevented);assert.ok(dialog.innerHTML.includes('등록된 일정이 없습니다'));
  await click('[data-calendar-add]',{});assert.equal(added,'2026-11-05');
 }finally{globalThis.document=original;}
});
test('schedule deletion checks login, CSRF and version, removes both import milestones, and retains office stock',async t=>{
 const dir=await mkdtemp('/tmp/dayon-delete-'),setupToken='delete-fixture-key',app=await createApp({dataDir:dir,setupToken,now:()=>new Date('2026-11-03T03:00:00Z')});await new Promise(r=>app.server.listen(0,'127.0.0.1',r));t.after(async()=>{await app.close();await rm(dir,{recursive:true,force:true});});
 const base='http://127.0.0.1:'+app.server.address().port;let auth={};
 async function req(path,method='GET',body,headers=auth){const res=await fetch(base+path,{method,headers:{'Content-Type':'application/json',...headers},body:body===undefined?undefined:JSON.stringify(body)});return {status:res.status,data:await res.json(),cookie:res.headers.get('set-cookie')?.split(';')[0]};}
 const setup=await req('/api/setup','POST',{setupToken,name:'테스트',username:'tester',password:'Test-password-only-123'});auth={cookie:setup.cookie,'X-CSRF-Token':setup.data.csrfToken};
 let item=(await req('/api/items','POST',{title:'검증 수입',type:'inbound',date:'2026-11-02',warehouseDate:'2026-11-04',qty:8,ownerId:setup.data.user.id})).data.item;
 const endpoint='/api/items/'+item.id;
 assert.equal((await req(endpoint,'DELETE',{version:1},{})).status,401);assert.equal((await req(endpoint,'DELETE',{version:1},{cookie:setup.cookie})).status,403);
 item=(await req(endpoint+'/toggle','POST',{version:1})).data.item;
 assert.equal((await req(endpoint,'DELETE',{version:1})).status,409);
 assert.equal((await req('/api/state')).data.stock['검증 수입'],8);
 assert.equal((await req(endpoint,'DELETE',{version:item.version})).status,200);
 const state=(await req('/api/state')).data;assert.ok(!state.items.some(i=>i.id===item.id));assert.equal(state.stock['검증 수입'],undefined);assert.ok(state.officeStock.every(s=>s.goodQty===0));
 for(const type of ['task','office','shipment','meeting']){
  const body={title:type,type,date:'2026-11-03',qty:1,ownerId:setup.data.user.id,...(type==='office'?{officeSku:'pouch-set',officeOperation:'return'}:{})};const result=await req('/api/items','POST',body);assert.equal(result.status,201);assert.equal((await req('/api/items/'+result.data.item.id,'DELETE',{version:1})).status,200);
 }
 const recurring=await req('/api/recurring','POST',{title:'반복',ownerId:setup.data.user.id,date:'2026-11-03',dueDate:'2026-11-03',priority:'normal',note:'',checklist:[]});assert.equal(recurring.status,201);
 const occurrence=(await req('/api/state')).data.items.find(i=>i.seriesId);assert.ok(occurrence);assert.equal((await req('/api/items/'+occurrence.id,'DELETE',{version:occurrence.version})).status,200);assert.ok(!(await req('/api/state')).data.items.some(i=>i.id===occurrence.id));
});
