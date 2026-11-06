import {attachmentSnapshot} from './inbound-attachments.mjs';
import {resourcePinHash,checkResourcePin,rejectResourceAccess} from './resource-security.mjs';
import {audit} from './admin.mjs';
import { randomUUID } from 'node:crypto';
import { AppError, requireText, jsonBody } from './security.mjs';
import { itemQuery, itemRow, messageRow } from './database.mjs';

function dateValue(value) {
 if (!value) return '';
 if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new AppError(422,'날짜 형식을 확인해 주세요.');
 const date=new Date(value+'T00:00:00Z');
 if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0,10)!==value) throw new AppError(422,'유효한 날짜를 입력해 주세요.');
 return value;
}
function parameters(url) {
 const q=(url.searchParams.get('q')||'').trim();
 if(q.length>100)throw new AppError(422,'검색어는 100자 이내로 입력해 주세요.');
 const from=dateValue(url.searchParams.get('from')),to=dateValue(url.searchParams.get('to'));
 if(from&&to&&from>to)throw new AppError(422,'시작 날짜가 종료 날짜보다 늦습니다.');
 const offset=Number(url.searchParams.get('offset')||0);
 if(!Number.isSafeInteger(offset)||offset<0||offset>1000000)throw new AppError(422,'페이지를 확인해 주세요.');
 return {q,from,to,offset};
}
function contains(q) {return '%'+q.replace(/[\\%_]/g,'\\$&')+'%';}
function paged(rows,offset) {return {results:rows.slice(0,50),hasMore:rows.length>50,offset};}
const nameQuery='SELECT d.*,u.name author,e.name editor FROM library_documents d JOIN users u ON u.id=d.author_id JOIN users e ON e.id=d.updated_by';
const resourceQuery='SELECT r.id,r.title,r.category,r.filename,r.size,r.created_at,r.version,CASE WHEN r.pin_hash IS NULL THEN 0 ELSE 1 END AS password_protected,u.name author FROM library_resources r JOIN users u ON u.id=r.author_id';

export function featureRoutes({db,auth,json,changed,publish,beforeArchive=async()=>{}}) {
 return async (req,res,url)=>{
  const route=url.pathname,method=req.method;
  if(route==='/api/archive'&&method==='GET'){
   await auth(req);await beforeArchive();const {q,from,to,offset}=parameters(url),conditions=['items.done=1'],values=[];
   if(q){conditions.push("(LOWER(items.title) LIKE LOWER(?) ESCAPE '\\' OR LOWER(items.note) LIKE LOWER(?) ESCAPE '\\' OR LOWER(items.tracking) LIKE LOWER(?) ESCAPE '\\')");values.push(contains(q),contains(q),contains(q));}
   const type=url.searchParams.get('type'),owner=url.searchParams.get('ownerId');
   if(type){if(!['task','inbound','shipment','meeting','office'].includes(type))throw new AppError(422,'구분을 확인해 주세요.');conditions.push('items.type=?');values.push(type);}
   if(owner){conditions.push('items.owner_id=?');values.push(owner);}
   if(from){conditions.push('items.date>=?');values.push(from);}if(to){conditions.push('items.date<=?');values.push(to);}
   const rows=await db.all(`${itemQuery} WHERE ${conditions.join(' AND ')} ORDER BY COALESCE(items.completed_at,items.date) DESC,items.id DESC LIMIT 51 OFFSET ?`,[...values,offset]);
   const files=await attachmentSnapshot(db);
   json(res,200,paged(rows.map(row=>({...itemRow(row),attachments:files.filter(file=>file.item_id===row.id)})),offset));return true;
  }
  if(route==='/api/messages/search'&&method==='GET'){
   await auth(req);const {q,from,to,offset}=parameters(url),conditions=['1=1'],values=[];
   if(q){conditions.push("LOWER(m.text) LIKE LOWER(?) ESCAPE '\\'");values.push(contains(q));}
   const author=url.searchParams.get('authorId');if(author){conditions.push('m.user_id=?');values.push(author);}
   if(from){conditions.push('m.created_at>=?');values.push(new Date(from+'T00:00:00+09:00').toISOString());}
   if(to){conditions.push('m.created_at<?');values.push(new Date(new Date(to+'T00:00:00+09:00').getTime()+86400000).toISOString());}
   const rows=await db.all(`SELECT m.*,u.name FROM messages m JOIN users u ON u.id=m.user_id WHERE ${conditions.join(' AND ')} ORDER BY m.created_at DESC,m.id DESC LIMIT 51 OFFSET ?`,[...values,offset]);
   json(res,200,paged(rows.map(messageRow),offset));return true;
  }
  if(route==='/api/manuals'&&method==='GET'){
   await auth(req);const {q,offset}=parameters(url);
   const group=url.searchParams.get('group'),conditions=[],values=[];
   if(group){if(!['manual','other'].includes(group))throw new AppError(422,'문서 구분을 확인해 주세요.');conditions.push(group==='other'?"d.category='기타'":"d.category<>'기타'");}
   if(q){conditions.push("(LOWER(d.title) LIKE LOWER(?) ESCAPE '\\' OR LOWER(d.content) LIKE LOWER(?) ESCAPE '\\' OR LOWER(d.category) LIKE LOWER(?) ESCAPE '\\')");values.push(contains(q),contains(q),contains(q));}
   const where=conditions.length?' WHERE '+conditions.join(' AND '):'';
   const rows=await db.all(nameQuery+where+' ORDER BY d.updated_at DESC,d.id DESC LIMIT 51 OFFSET ?',[...values,offset]);
   json(res,200,paged(rows,offset));return true;
  }
  const manual=route.match(/^\/api\/manuals\/([^/]+)$/);
  if((route==='/api/manuals'&&method==='POST')||(manual&&['PUT','DELETE'].includes(method))){
   const user=await auth(req,true),id=manual?.[1]||randomUUID();
   const body=await jsonBody(req,96000);
   const title=method==='DELETE'?'':requireText(body.title,'제목',100);
   const category=method==='DELETE'?'':requireText(body.category||'일반','분류',40);
   const content=method==='DELETE'?'':requireText(body.content,'내용',20000);
   await db.transaction(async connection=>{
    if(manual){
     const current=await connection.get('SELECT version FROM library_documents WHERE id=?',[id]);
     if(!current)throw new AppError(404,'매뉴얼을 찾을 수 없습니다.');
     if(body.version!==current.version)throw new AppError(409,'매뉴얼이 변경되었습니다. 다시 열어 확인해 주세요.');
     if(method==='DELETE')await connection.run('DELETE FROM library_documents WHERE id=?',[id]);
     else await connection.run('UPDATE library_documents SET title=?,category=?,content=?,updated_by=?,updated_at=?,version=version+1 WHERE id=?',[title,category,content,user.id,new Date().toISOString(),id]);
    }else{
     const now=new Date().toISOString();
     await connection.run('INSERT INTO library_documents(id,title,category,content,author_id,updated_by,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)',[id,title,category,content,user.id,user.id,now,now]);
    }
    await changed(connection);
   });await publish();json(res,method==='POST'?201:200,{id});return true;
  }
  if(route==='/api/resources'&&method==='GET'){
   await auth(req);const {q,offset}=parameters(url);
   const where=q?" WHERE (LOWER(r.title) LIKE LOWER(?) ESCAPE '\\' OR LOWER(r.category) LIKE LOWER(?) ESCAPE '\\' OR LOWER(r.filename) LIKE LOWER(?) ESCAPE '\\')":'';
   const rows=await db.all(resourceQuery+where+' ORDER BY r.created_at DESC,r.id DESC LIMIT 51 OFFSET ?',[...(q?[contains(q),contains(q),contains(q)]:[]),offset]);
   const used=Number((await db.get('SELECT (SELECT COALESCE(SUM(size),0) FROM library_resources)+(SELECT COALESCE(SUM(size),0) FROM inbound_attachments) bytes')).bytes);
   json(res,200,{...paged(rows,offset),usedBytes:used,maxBytes:25*1024*1024});return true;
  }
  if(route==='/api/resources'&&method==='POST'){
   const user=await auth(req,true),body=await jsonBody(req,7100000);
   const title=requireText(body.title,'제목',100),category=requireText(body.category||'일반','분류',40),filename=requireText(body.filename,'파일명',180);
   if(/[\x00-\x1f/\\]/.test(filename)||! /\.(pdf|png|jpe?g|webp|gif|txt|csv|xlsx?|docx?|pptx?|zip)$/i.test(filename))throw new AppError(422,'PDF, 이미지, 문서, CSV, ZIP 파일을 선택해 주세요.');
   if(typeof body.data!=='string'||body.data.length>6990508||body.data.length%4!==0||/[^A-Za-z0-9+/=]/.test(body.data))throw new AppError(422,'파일 형식을 확인해 주세요.');
   const bytes=Buffer.from(body.data,'base64');if(bytes.toString('base64')!==body.data)throw new AppError(422,'파일 형식을 확인해 주세요.');if(!bytes.length||bytes.length>5*1024*1024)throw new AppError(422,'파일은 5MB 이하로 올려주세요.');
   const pinHash=await resourcePinHash(body.password);
   const id=randomUUID();await db.transaction(async connection=>{
    const used=Number((await connection.get('SELECT (SELECT COALESCE(SUM(size),0) FROM library_resources)+(SELECT COALESCE(SUM(size),0) FROM inbound_attachments) bytes')).bytes);
    if(used+bytes.length>25*1024*1024)throw new AppError(409,'자료실·입고 자료의 합산 용량 25MB를 초과합니다. 기존 파일을 정리해 주세요.');
    await connection.run('INSERT INTO library_resources(id,title,category,filename,size,data,pin_hash,author_id,created_at) VALUES(?,?,?,?,?,?,?,?,?)',[id,title,category,filename,bytes.length,body.data,pinHash,user.id,new Date().toISOString()]);await changed(connection);
   });await publish();json(res,201,{id});return true;
  }
  const resource=route.match(/^\/api\/resources\/([^/]+)(\/download)?$/);
  if(resource&&['GET','POST'].includes(method)&&resource[2]){
   const user=await auth(req,method==='POST'),body=method==='POST'?await jsonBody(req):{};
   const result=await db.transaction(async c=>{
    const file=await c.get('SELECT id,filename,pin_hash FROM library_resources WHERE id=?',[resource[1]]);
    if(!file)throw new AppError(404,'파일을 찾을 수 없습니다.');
    if(method==='GET'&&file.pin_hash)return {denied:true,status:403,message:'비밀번호가 설정된 자료입니다. 자료실에서 비밀번호를 입력해 다운로드해 주세요.'};
    const denied=await checkResourcePin(c,file,user,body.password);if(denied)return denied;
    return {...file,...await c.get('SELECT data FROM library_resources WHERE id=?',[file.id])};
   });rejectResourceAccess(result);
   res.writeHead(200,{'Content-Type':'application/octet-stream','Content-Disposition':`attachment; filename="download"; filename*=UTF-8''${encodeURIComponent(result.filename).replace(/['()*]/g,c=>'%'+c.charCodeAt(0).toString(16))}`,'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'});res.end(Buffer.from(result.data,'base64'));return true;
  }
  if(resource&&method==='PUT'&&!resource[2]){
   const user=await auth(req,true),body=await jsonBody(req),title=requireText(body.title,'제목',100);
   const hasNewPassword=Object.hasOwn(body,'newPassword'),pinHash=hasNewPassword?await resourcePinHash(body.newPassword):undefined;
   const result=await db.transaction(async c=>{
    const file=await c.get('SELECT id,pin_hash,version FROM library_resources WHERE id=?',[resource[1]]);
    if(!file)throw new AppError(404,'파일을 찾을 수 없습니다.');
    if(body.version!==file.version)throw new AppError(409,'자료가 변경되었습니다. 다시 열어 확인해 주세요.');
    const denied=await checkResourcePin(c,file,user,body.password);if(denied)return denied;
    await c.run('UPDATE library_resources SET title=?,pin_hash=?,version=version+1 WHERE id=?',[title,hasNewPassword?pinHash:file.pin_hash,file.id]);
    if(hasNewPassword)await c.run('DELETE FROM resource_access_attempts WHERE resource_id=?',[file.id]);
    await audit(c,user,'resource_updated',file.id,{title,passwordChanged:hasNewPassword});await changed(c);return {ok:true};
   });rejectResourceAccess(result);await publish();json(res,200,result);return true;
  }
  if(resource&&method==='DELETE'&&!resource[2]){
   const user=await auth(req,true),body=req.headers['content-type']?await jsonBody(req):{};
   const result=await db.transaction(async c=>{
    const file=await c.get('SELECT id,pin_hash FROM library_resources WHERE id=?',[resource[1]]);if(!file)throw new AppError(404,'파일을 찾을 수 없습니다.');
    const denied=await checkResourcePin(c,file,user,body.password);if(denied)return denied;
    await c.run('DELETE FROM library_resources WHERE id=?',[file.id]);await changed(c);return {ok:true};
   });rejectResourceAccess(result);await publish();json(res,200,result);return true;
  }
  return false;
 };
}
