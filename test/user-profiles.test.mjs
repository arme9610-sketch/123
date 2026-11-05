import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {createApp} from '../server.mjs';
import {openStorage} from '../lib/database.mjs';
import {backupSnapshot,rehearseBackup} from '../lib/backup.mjs';
const png='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aQ1kAAAAASUVORK5CYII=';

test('each user uploads only their own avatar; authenticated peers can view it; images and monthly tiers persist',async t=>{
 const dir=await mkdtemp('/tmp/dayon-profile-');let app,base,clock=new Date('2026-11-05T03:00:00Z'),auth={};
 async function start(){app=await createApp({dataDir:dir,setupToken:'profile-fixture',now:()=>clock});await new Promise(r=>app.server.listen(0,'127.0.0.1',r));base='http://127.0.0.1:'+app.server.address().port;}
 await start();t.after(async()=>{await app.close();await rm(dir,{recursive:true,force:true});});
 async function req(path,method='GET',body,headers=auth){const res=await fetch(base+path,{method,headers:{'Content-Type':'application/json',...headers},body:body===undefined?undefined:JSON.stringify(body)});const bytes=Buffer.from(await res.arrayBuffer());return {status:res.status,data:res.headers.get('content-type')?.includes('application/json')?JSON.parse(bytes.toString()):bytes,cookie:res.headers.get('set-cookie')?.split(';')[0],headers:res.headers};}
 const setup=await req('/api/setup','POST',{setupToken:'profile-fixture',name:'이기정',username:'owner',password:'Profile-test-password'});auth={cookie:setup.cookie,'X-CSRF-Token':setup.data.csrfToken};
 const invite=await req('/api/invitations','POST',{name:'김진솔',username:'jinsol'}),joined=await req('/api/join','POST',{inviteToken:invite.data.inviteToken,password:'Profile-test-password'},{}),worker={cookie:joined.cookie,'X-CSRF-Token':joined.data.csrfToken};
 const url='/api/user-profiles/'+setup.data.user.id+'/avatar',body={data:png,mime:'image/png',version:0};
 assert.equal((await req(url,'GET',undefined,{})).status,401);assert.equal((await req(url)).status,404);
 assert.equal((await req(url,'PUT',body,worker)).status,403);assert.equal((await req(url,'PUT',body,{cookie:setup.cookie})).status,403);
 assert.equal((await req(url,'PUT',{...body,mime:'image/svg+xml'})).status,422);assert.equal((await req(url,'PUT',{...body,data:Buffer.from('<svg>bad</svg>').toString('base64')})).status,422);
 assert.equal((await req(url,'PUT',body)).status,200);assert.equal((await req('/api/user-profiles/'+joined.data.user.id+'/avatar','PUT',body,worker)).status,200);const image=await req(url,'GET',undefined,worker);assert.equal(image.status,200);assert.equal(image.headers.get('content-type'),'image/png');assert.ok(image.headers.get('cache-control').includes('no-store'));assert.equal(image.data.toString('base64'),png);
 assert.equal((await req(url,'PUT',body)).status,409);
 for(let i=0;i<9;i++)assert.equal((await req('/api/contributions/manual','POST',{requestId:randomUUID(),description:'업무 '+i})).status,201);
 let state=(await req('/api/state')).data,user=state.users.find(user=>user.id===setup.data.user.id);assert.ok(user.avatarUrl.includes('/avatar?v=1'));assert.equal(user.avatarVersion,1);assert.equal(user.contribution.level,10);assert.equal(user.contribution.tier,'silver');assert.equal(user.contribution.required,2);
 const db=await openStorage({dataDir:dir,databaseUrl:''});try{const snapshot=await backupSnapshot(db);assert.equal(snapshot.tables.user_profiles.length,2);assert.equal((await rehearseBackup(snapshot)).ok,true);}finally{await db.close();}
 await app.close();await start();assert.equal((await req(url)).data.toString('base64'),png);
 clock=new Date('2026-12-01T00:00:00Z');state=(await req('/api/state')).data;user=state.users.find(user=>user.id===setup.data.user.id);assert.equal(user.contribution.tier,'bronze');assert.equal(user.contribution.xp,0);assert.ok(user.avatarUrl);
});
