import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {createApp} from '../server.mjs';
import {openStorage} from '../lib/database.mjs';
import {backupSnapshot,rehearseBackup} from '../lib/backup.mjs';

test('shared worklists persist by user, validate lines, enforce auth and conflicts, and survive a new day and backup',async t=>{
 const dir=await mkdtemp('/tmp/dayon-worklists-'),setupToken='worklist-test';let app,base,clock=new Date('2026-11-05T00:00:00Z'),auth={};
 async function start(){app=await createApp({dataDir:dir,setupToken,now:()=>clock});await new Promise(r=>app.server.listen(0,'127.0.0.1',r));base='http://127.0.0.1:'+app.server.address().port;}
 await start();t.after(async()=>{await app.close();await rm(dir,{recursive:true,force:true});});
 async function req(path,method='GET',body,headers=auth){const response=await fetch(base+path,{method,headers:{'Content-Type':'application/json',...headers},body:body===undefined?undefined:JSON.stringify(body)});return {status:response.status,data:await response.json(),cookie:response.headers.get('set-cookie')?.split(';')[0]};}
 const setup=await req('/api/setup','POST',{setupToken,name:'이기정',username:'owner',password:'Worklist-fixture-password'});auth={cookie:setup.cookie,'X-CSRF-Token':setup.data.csrfToken};
 const invitation=await req('/api/invitations','POST',{name:'김진솔',username:'jinsol'}),joined=await req('/api/join','POST',{inviteToken:invitation.data.inviteToken,password:'Worklist-fixture-password'},{}),worker={cookie:joined.cookie,'X-CSRF-Token':joined.data.csrfToken};
 const endpoint='/api/user-worklists/'+joined.data.user.id,entries=['CS 업무','카카오톡 채널 확인','재고 수량 파악'];
 assert.equal((await req(endpoint,'PUT',{version:0,entries},{})).status,401);assert.equal((await req(endpoint,'PUT',{version:0,entries},{cookie:setup.cookie})).status,403);
 for(const bad of [[''],['x'.repeat(201)],Array.from({length:21},()=> '업무')])assert.equal((await req(endpoint,'PUT',{version:0,entries:bad})).status,422);
 const saved=await req(endpoint,'PUT',{version:0,entries});assert.equal(saved.status,200);assert.deepEqual(saved.data.record.entries,entries);assert.equal(saved.data.record.author,'이기정');
 const state=(await req('/api/state','GET',undefined,worker)).data;assert.deepEqual(state.worklists[0].entries,entries);assert.equal(state.worklists[0].user_id,joined.data.user.id);
 assert.equal((await req(endpoint,'PUT',{version:0,entries:['먼저 수정']})).status,409);
 const unchanged=await req(endpoint,'PUT',{version:1,entries});assert.equal(unchanged.data.record.version,1);
 const updated=await req(endpoint,'PUT',{version:1,entries:['문의 답변','<img src=x onerror=alert(1)>']},worker);assert.equal(updated.status,200);assert.equal(updated.data.record.author,'김진솔');
 assert.equal((await req('/api/contributions')).data.members.reduce((n,u)=>n+u.xp,0),0);
 await app.close();clock=new Date('2026-11-06T00:00:00Z');await start();assert.deepEqual((await req('/api/state')).data.worklists[0].entries,updated.data.record.entries);
 const db=await openStorage({dataDir:dir,databaseUrl:''});try{const snapshot=await backupSnapshot(db);assert.equal(snapshot.tables.user_worklists.length,1);assert.equal((await rehearseBackup(snapshot)).ok,true);}finally{await db.close();}
 assert.equal((await req(endpoint,'PUT',{version:2,entries:[]})).status,200);assert.deepEqual((await req('/api/state')).data.worklists[0].entries,[]);
});
