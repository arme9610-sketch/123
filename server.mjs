import http from 'node:http';
import {readFile, realpath} from 'node:fs/promises';
import {readFileSync, writeFileSync, existsSync, lstatSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {randomUUID} from 'node:crypto';
import {openDatabase,transaction,publicUser,itemRow,itemQuery,messageRow} from './lib/database.mjs';
import {token,hash,safeEqual,passwordHash,verifyPassword,AppError,requireText,validateUsername,validatePassword,jsonBody} from './lib/security.mjs';
const projectRoot=path.dirname(fileURLToPath(import.meta.url));
const sessionAge=7*24*60*60*1000;
const invitationAge=24*60*60*1000;
export function createApp({dataDir=process.env.MOA_DATA_DIR||path.join(projectRoot,'data'),setupToken=process.env.MOA_SETUP_TOKEN,secureCookie=process.env.MOA_SECURE_COOKIE==='1'}={}){
 const db=openDatabase(dataDir),streams=new Set(),attempts=new Map();
 const initialized=()=>!!db.prepare('SELECT 1 FROM users LIMIT 1').get();
 if(!setupToken&&!initialized()){
  const tokenFile=path.join(dataDir,'setup-token');
  if(existsSync(tokenFile)) { if(lstatSync(tokenFile).isSymbolicLink())throw new Error('Setup-token file cannot be a symlink.'); setupToken=readFileSync(tokenFile,'utf8').trim(); }
  else {setupToken=token();writeFileSync(tokenFile,setupToken+'\n',{mode:0o600,flag:'wx'});}
 }
 const revision=()=>db.prepare("SELECT value FROM metadata WHERE key='revision'").get().value;
 const sessionLookup=db.prepare('SELECT sessions.*,users.id,users.name,users.username,users.role FROM sessions JOIN users ON users.id=sessions.user_id WHERE token_hash=? AND expires_at>?');
 function session(req){const cookie=req.headers.cookie||'';const raw=cookie.split(';').map(v=>v.trim()).find(v=>v.startsWith('moa_session='))?.slice(12);if(!raw||raw.length>100)return null;return sessionLookup.get(hash(raw),Date.now())||null;}
 function json(res,status,value){res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify(value));}
 function announce(){db.prepare("UPDATE metadata SET value=value+1 WHERE key='revision'").run();for(const s of streams){if(!sessionLookup.get(s.hash,Date.now())){s.res.end();streams.delete(s);continue;}s.res.write(`event: change\ndata: ${JSON.stringify({revision:revision()})}\n\n`);}}
 function setSession(res,user){const raw=token(),csrfToken=token();db.prepare('DELETE FROM sessions WHERE expires_at<=?').run(Date.now());db.prepare('INSERT INTO sessions VALUES(?,?,?,?)').run(hash(raw),user.id,csrfToken,Date.now()+sessionAge);res.setHeader('Set-Cookie',`moa_session=${raw}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${sessionAge/1000}${secureCookie?'; Secure':''}`);return {user:publicUser(user),csrfToken};}
 function originCheck(req){const origin=req.headers.origin;const expected=`${secureCookie?'https':'http'}://${req.headers.host}`;if(origin&&origin!==expected)throw new AppError(403,'다른 사이트에서 보낸 요청은 허용되지 않습니다.');if(req.headers['sec-fetch-site']==='cross-site')throw new AppError(403,'다른 사이트에서 보낸 요청은 허용되지 않습니다.');}
 function auth(req,write=false){const user=session(req);if(!user)throw new AppError(401,'로그인이 필요합니다.');if(write){originCheck(req);if(!safeEqual(req.headers['x-csrf-token']||'',user.csrf_token))throw new AppError(403,'인증 정보를 새로 불러온 후 다시 시도해 주세요.');}return user;}
 function admin(req,write=false){const user=auth(req,write);if(user.role!=='admin')throw new AppError(403,'관리자만 사용할 수 있습니다.');return user;}
 function limit(req){const key=req.socket.remoteAddress||'unknown',now=Date.now();let hit=attempts.get(key);if(!hit||hit.until<now){hit={count:0,until:now+15*60*1000};attempts.set(key,hit);}if(++hit.count>30)throw new AppError(429,'시도가 너무 많습니다. 잠시 후 다시 시도해 주세요.');if(attempts.size>10000)for(const [k,v]of attempts)if(v.until<now)attempts.delete(k);}
 function checkCapacity(){db.prepare('DELETE FROM invitations WHERE expires_at<=?').run(Date.now());const users=db.prepare('SELECT count(*) n FROM users').get().n,invites=db.prepare('SELECT count(*) n FROM invitations').get().n;if(users+invites>=4)throw new AppError(409,'직원은 초대 대기 중인 계정을 포함해 최대 4명입니다.');}
 function getItem(id){const row=db.prepare(`${itemQuery} WHERE items.id=?`).get(id);if(!row)throw new AppError(404,'일정을 찾을 수 없습니다.');return itemRow(row);}
 function validateItem(body){const title=requireText(body.title,'내용',100),type=body.type,qty=body.qty,ownerId=body.ownerId,date=body.date,note=body.note??'',tracking=body.tracking??'';
  if(!['task','inbound','shipment','meeting'].includes(type))throw new AppError(422,'올바른 일정 구분을 선택해 주세요.');
  if(!Number.isSafeInteger(qty)||qty<1||qty>1000000)throw new AppError(422,'수량은 1~1,000,000 사이 정수로 입력해 주세요.');
  if(typeof ownerId!=='string'||!db.prepare('SELECT 1 FROM users WHERE id=?').get(ownerId))throw new AppError(422,'등록된 담당자를 선택해 주세요.');
  if(typeof date!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(date)||Number(date.slice(0,4))<2000||Number(date.slice(0,4))>2200)throw new AppError(422,'올바른 날짜를 입력해 주세요.');
  const parsedDate=new Date(date+'T12:00:00Z');if(!Number.isFinite(parsedDate.getTime())||parsedDate.toISOString().slice(0,10)!==date)throw new AppError(422,'올바른 날짜를 입력해 주세요.');
  if(typeof note!=='string'||note.length>2000||typeof tracking!=='string'||tracking.length>100)throw new AppError(422,'메모는 2,000자, 운송장 정보는 100자 이내로 입력해 주세요.');
  return {title,type,qty,ownerId,date,note:note.trim(),tracking:tracking.trim()};
 }
 function checkVersion(body,current){if(!Number.isSafeInteger(body.version)||body.version!==current.version)throw new AppError(409,'다른 직원이 먼저 수정했습니다. 최신 내용을 확인한 후 다시 시도해 주세요.');}
 async function api(req,res,url){const route=url.pathname,method=req.method;
  if(route==='/api/status'&&method==='GET')return json(res,200,{initialized:initialized()});
  if(route==='/api/setup'&&method==='POST'){
   originCheck(req);limit(req);const body=await jsonBody(req);if(initialized())throw new AppError(409,'이미 초기 설정이 완료되었습니다.');
   if(typeof body.setupToken!=='string'||!setupToken||!safeEqual(body.setupToken,setupToken))throw new AppError(403,'초기 설정 키가 올바르지 않습니다.');
   const name=requireText(body.name,'이름',30),username=validateUsername(body.username),password=validatePassword(body.password),password_hash=await passwordHash(password);
   const user={id:randomUUID(),name,username,role:'admin'};transaction(db,()=>{if(initialized())throw new AppError(409,'이미 초기 설정이 완료되었습니다.');db.prepare('INSERT INTO users VALUES(?,?,?,?,?,?)').run(user.id,name,username,password_hash,'admin',new Date().toISOString());});announce();return json(res,201,setSession(res,user));
  }
  if(route==='/api/login'&&method==='POST'){
   originCheck(req);limit(req);const body=await jsonBody(req),username=validateUsername(body.username),password=validatePassword(body.password);const user=db.prepare('SELECT * FROM users WHERE username=?').get(username);
   // Always perform the password derivation to keep unknown-user attempts comparable.
   const valid=await verifyPassword(password,user?.password_hash||'00000000000000000000000000000000:'+('0'.repeat(128)));
   if(!user||!valid)throw new AppError(401,'아이디 또는 비밀번호를 확인해 주세요.');return json(res,200,setSession(res,user));
  }
  if(route==='/api/join'&&method==='POST'){
   originCheck(req);limit(req);const body=await jsonBody(req),password=validatePassword(body.password),inviteToken=requireText(body.inviteToken,'초대 코드',100);
   const invitation=db.prepare('SELECT * FROM invitations WHERE token_hash=? AND expires_at>?').get(hash(inviteToken),Date.now());if(!invitation)throw new AppError(403,'만료되었거나 사용할 수 없는 초대 코드입니다.');const encoded=await passwordHash(password);const user={id:randomUUID(),name:invitation.name,username:invitation.username,role:'member'};
   transaction(db,()=>{const current=db.prepare('SELECT * FROM invitations WHERE id=? AND expires_at>?').get(invitation.id,Date.now());if(!current)throw new AppError(409,'초대 코드가 이미 사용되었거나 만료되었습니다.');if(db.prepare('SELECT count(*) n FROM users').get().n>=4)throw new AppError(409,'직원은 최대 4명입니다.');db.prepare('INSERT INTO users VALUES(?,?,?,?,?,?)').run(user.id,user.name,user.username,encoded,'member',new Date().toISOString());db.prepare('DELETE FROM invitations WHERE id=?').run(invitation.id);});announce();return json(res,201,setSession(res,user));
  }
  if(route==='/api/session'&&method==='GET'){const user=auth(req);return json(res,200,{user:publicUser(user),csrfToken:user.csrf_token});}
  if(route==='/api/logout'&&method==='POST'){const user=auth(req,true);db.prepare('DELETE FROM sessions WHERE token_hash=?').run(user.token_hash);for(const stream of streams)if(stream.hash===user.token_hash){stream.res.end();streams.delete(stream);}res.setHeader('Set-Cookie',`moa_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0${secureCookie?'; Secure':''}`);return json(res,200,{ok:true});}
  if(route==='/api/state'&&method==='GET'){
   auth(req);const users=db.prepare('SELECT id,name,username,role FROM users ORDER BY created_at,id').all(),items=db.prepare(`${itemQuery} ORDER BY items.date,items.rowid`).all().map(itemRow),messages=db.prepare('SELECT m.*,u.name FROM (SELECT rowid AS seq,* FROM messages ORDER BY rowid DESC LIMIT 500) m JOIN users u ON u.id=m.user_id ORDER BY m.seq').all().map(messageRow),stock=Object.create(null);
   for(const item of items)if(item.type==='inbound'&&item.done)stock[item.title]=(stock[item.title]||0)+item.qty;return json(res,200,{users,items,messages,stock,revision:revision()});
  }
  if(route==='/api/events'&&method==='GET'){
   const user=auth(req);res.writeHead(200,{'Content-Type':'text/event-stream','Cache-Control':'no-store','Connection':'keep-alive','X-Accel-Buffering':'no'});res.write(`event: change\ndata: ${JSON.stringify({revision:revision()})}\n\n`);const entry={res,hash:user.token_hash};streams.add(entry);const heartbeat=setInterval(()=>{if(!sessionLookup.get(entry.hash,Date.now()))return res.end();res.write(': keepalive\n\n');},15000);heartbeat.unref();res.on('close',()=>{clearInterval(heartbeat);streams.delete(entry);});return;
  }
  if(route==='/api/items'&&method==='POST'){
   const user=auth(req,true),body=await jsonBody(req),item=validateItem(body),id=randomUUID();db.prepare('INSERT INTO items(id,title,type,qty,owner_id,requester_id,date,note,tracking) VALUES(?,?,?,?,?,?,?,?,?)').run(id,item.title,item.type,item.qty,item.ownerId,user.id,item.date,item.note,item.tracking);announce();return json(res,201,{item:getItem(id)});
  }
  const itemMatch=route.match(/^\/api\/items\/([^/]+)(\/toggle)?$/);
  if(itemMatch&&((method==='PUT'&&!itemMatch[2])||(method==='POST'&&itemMatch[2]))){
   auth(req,true);const body=await jsonBody(req),current=getItem(itemMatch[1]);checkVersion(body,current);
   if(itemMatch[2])db.prepare('UPDATE items SET done=?,version=version+1 WHERE id=?').run(current.done?0:1,current.id);
   else{if(current.done)throw new AppError(409,'완료를 취소한 후 수정해 주세요.');const item=validateItem(body);db.prepare('UPDATE items SET title=?,type=?,qty=?,owner_id=?,date=?,note=?,tracking=?,version=version+1 WHERE id=?').run(item.title,item.type,item.qty,item.ownerId,item.date,item.note,item.tracking,current.id);}
   announce();return json(res,200,{item:getItem(current.id)});
  }
  if(route==='/api/messages'&&method==='POST'){
   const user=auth(req,true),body=await jsonBody(req),text=requireText(body.text,'메시지',2000),id=randomUUID(),createdAt=new Date().toISOString();db.prepare('INSERT INTO messages VALUES(?,?,?,?)').run(id,user.id,text,createdAt);announce();return json(res,201,{message:messageRow({id,user_id:user.id,name:user.name,text,created_at:createdAt})});
  }
  if(route==='/api/invitations'&&method==='GET'){
   admin(req);const invitations=db.prepare('SELECT id,name,username,expires_at FROM invitations WHERE expires_at>? ORDER BY rowid').all(Date.now()).map(i=>({id:i.id,name:i.name,username:i.username,expiresAt:new Date(i.expires_at).toISOString()}));return json(res,200,{invitations});
  }
  if(route==='/api/invitations'&&method==='POST'){
   admin(req,true);const body=await jsonBody(req),name=requireText(body.name,'이름',30),username=validateUsername(body.username),inviteToken=token(),expiresAt=Date.now()+invitationAge;
   transaction(db,()=>{checkCapacity();if(db.prepare('SELECT 1 FROM users WHERE username=?').get(username)||db.prepare('SELECT 1 FROM invitations WHERE username=?').get(username))throw new AppError(409,'이미 사용 중이거나 초대된 아이디입니다.');db.prepare('INSERT INTO invitations VALUES(?,?,?,?,?)').run(randomUUID(),hash(inviteToken),name,username,expiresAt);});announce();return json(res,201,{inviteToken,name,username,expiresAt:new Date(expiresAt).toISOString()});
  }
  const inviteMatch=route.match(/^\/api\/invitations\/([^/]+)$/);
  if(inviteMatch&&method==='DELETE'){admin(req,true);const result=db.prepare('DELETE FROM invitations WHERE id=?').run(inviteMatch[1]);if(!result.changes)throw new AppError(404,'초대를 찾을 수 없습니다.');announce();return json(res,200,{ok:true});}
  throw new AppError(404,'요청한 기능을 찾을 수 없습니다.');
 }
 const server=http.createServer(async(req,res)=>{
  res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('X-Frame-Options','DENY');res.setHeader('Referrer-Policy','same-origin');res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'");
  try{
   const url=new URL(req.url,'http://localhost');if(url.pathname.startsWith('/api/'))return await api(req,res,url);
   if(!['GET','HEAD'].includes(req.method))throw new AppError(405,'허용되지 않는 요청 방식입니다.');
   const publicRoot=path.join(projectRoot,'public'),decoded=decodeURIComponent(url.pathname),file=path.resolve(publicRoot,'.'+decoded),target=file===publicRoot?path.join(publicRoot,'index.html'):file;
   if(!target.startsWith(publicRoot+path.sep))throw new AppError(403,'접근할 수 없습니다.');const actual=await realpath(target);if(!actual.startsWith(publicRoot+path.sep))throw new AppError(403,'접근할 수 없습니다.');
   const contents=await readFile(actual),mime={'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8','.svg':'image/svg+xml','.json':'application/json'}[path.extname(actual)]||'application/octet-stream';res.writeHead(200,{'Content-Type':mime,'Cache-Control':'no-cache'});res.end(req.method==='HEAD'?undefined:contents);
  }catch(error){if(res.headersSent){res.end();return;}const status=error.status||(error.code==='ENOENT'?404:500);if(status===500)console.error('Request failed:',error.code||error.name);json(res,status,{error:status===500?'서버 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.':error.status?error.message:'파일을 찾을 수 없습니다.'});}
 });
 server.requestTimeout=15000;server.headersTimeout=10000;
 let closing;
 async function close(){if(closing)return closing;closing=(async()=>{for(const stream of streams)stream.res.end();await new Promise((resolve,reject)=>server.close(error=>error&&error.code!=='ERR_SERVER_NOT_RUNNING'?reject(error):resolve()));db.close();})();return closing;}
 return {server,close,dataDir};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){const app=createApp();app.server.listen(Number(process.env.PORT)||3000,process.env.HOST||'0.0.0.0',()=>console.log('DAYON running on port '+(process.env.PORT||3000)));const shutdown=()=>app.close().then(()=>process.exit(0));process.on('SIGINT',shutdown);process.on('SIGTERM',shutdown);}
