import {randomUUID} from 'node:crypto';
import {AppError,jsonBody} from './security.mjs';
import {audit} from './admin.mjs';
export const attachmentSchema=`CREATE TABLE IF NOT EXISTS inbound_attachments(id TEXT PRIMARY KEY,item_id TEXT NOT NULL REFERENCES items(id) ON DELETE CASCADE,filename TEXT NOT NULL,size INTEGER NOT NULL,data TEXT NOT NULL,author_id TEXT NOT NULL REFERENCES users(id),created_at TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS inbound_attachments_item ON inbound_attachments(item_id);`;
export const attachmentBodyLimit=36*1024*1024;
const fileLimit=5*1024*1024,totalLimit=25*1024*1024;
export async function attachmentSnapshot(c,itemId){
 return c.all('SELECT a.id,a.item_id,a.filename,a.size,a.created_at,u.name author FROM inbound_attachments a JOIN users u ON u.id=a.author_id'+(itemId?' WHERE a.item_id=?':'')+' ORDER BY a.created_at,a.id',itemId?[itemId]:[]);
}
export function validateAttachments(body,type){
 const files=body.newAttachments??[],remove=body.removeAttachmentIds??[];
 if(!Array.isArray(files)||files.length>5||!Array.isArray(remove)||remove.length>5||remove.some(id=>typeof id!=='string')||new Set(remove).size!==remove.length)throw new AppError(422,'입고 일정당 파일은 최대 5개까지 첨부할 수 있습니다.');
 if(type!=='inbound'&&files.length)throw new AppError(422,'입고 자료는 입고 일정에만 첨부할 수 있습니다.');
 return {remove,files:files.map(file=>{
  const name=file?.filename;
  if(typeof name!=='string'||!name.trim()||name.length>180||/[\x00-\x1f\x7f/\\]/.test(name)||! /\.(xlsx|xls|csv|pdf|png|jpe?g|webp|gif)$/i.test(name))throw new AppError(422,'파일명이 180자 이하인 엑셀·CSV·이미지·PDF 파일을 선택해 주세요.');
  if(typeof file.data!=='string'||file.data.length>Math.ceil(fileLimit/3)*4)throw new AppError(422,'파일은 5MB 이하로 첨부해 주세요.');
  const bytes=Buffer.from(file.data,'base64');
  if(!bytes.length||bytes.length>fileLimit||bytes.toString('base64')!==file.data)throw new AppError(422,'파일이 비어 있거나 올바른 파일 데이터가 아닙니다.');
  if(/\.xlsx$/i.test(name)&&!bytes.subarray(0,4).equals(Buffer.from('504b0304','hex'))||/\.xls$/i.test(name)&&!bytes.subarray(0,8).equals(Buffer.from('d0cf11e0a1b11ae1','hex')))throw new AppError(422,'실제 엑셀 파일인지 확인해 주세요. XLSX·XLS 파일 형식이 일치하지 않습니다.');
  const extension=name.split('.').pop().toLowerCase();
  const valid=extension==='pdf'?bytes.subarray(0,5).toString()==='%PDF-':extension==='png'?bytes.subarray(0,8).equals(Buffer.from('89504e470d0a1a0a','hex')):['jpg','jpeg'].includes(extension)?bytes[0]===255&&bytes[1]===216&&bytes[2]===255:extension==='webp'?bytes.subarray(0,4).toString()==='RIFF'&&bytes.subarray(8,12).toString()==='WEBP':extension==='gif'?['GIF87a','GIF89a'].includes(bytes.subarray(0,6).toString()):true;
  if(!valid)throw new AppError(422,'확장자와 실제 파일 형식이 일치하지 않습니다. 원본 파일을 선택해 주세요.');
  return {filename:name.trim(),size:bytes.length,data:file.data};
 })};
}
// Called inside the same transaction as the parent item write: a failed upload
// must never leave a duplicate or partially saved calendar event.
export async function applyAttachments(c,itemId,type,changes,user,now){
 const existing=await c.all('SELECT id FROM inbound_attachments WHERE item_id=?',[itemId]);
 if(changes.remove.some(id=>!existing.some(file=>file.id===id)))throw new AppError(409,'첨부파일이 변경되었습니다. 일정을 다시 열어 주세요.');
 if(existing.length-changes.remove.length+changes.files.length>5)throw new AppError(422,'입고 일정당 파일은 최대 5개까지 첨부할 수 있습니다.');
 if(type!=='inbound'&&existing.length-changes.remove.length)throw new AppError(422,'입고 첨부파일을 모두 삭제한 후 일정 구분을 변경해 주세요.');
 for(const id of changes.remove)await c.run('DELETE FROM inbound_attachments WHERE id=? AND item_id=?',[id,itemId]);
 if(changes.files.length){
  const used=Number((await c.get('SELECT (SELECT COALESCE(SUM(size),0) FROM library_resources)+(SELECT COALESCE(SUM(size),0) FROM inbound_attachments) bytes')).bytes);
  if(used+changes.files.reduce((n,file)=>n+file.size,0)>totalLimit)throw new AppError(409,'자료실·입고 자료의 합산 용량 25MB를 초과합니다. 사용하지 않는 파일을 정리해 주세요.');
 }
 for(const file of changes.files)await c.run('INSERT INTO inbound_attachments(id,item_id,filename,size,data,author_id,created_at) VALUES(?,?,?,?,?,?,?)',[randomUUID(),itemId,file.filename,file.size,file.data,user.id,now.toISOString()]);
 if(changes.files.length||changes.remove.length)await audit(c,user,'inbound_attachments_changed',itemId,{added:changes.files.map(f=>f.filename),removed:changes.remove});
}
export function attachmentRoutes({db,auth,json,changed,publish,getItem,checkVersion,now}){return async(req,res,url)=>{
 const match=url.pathname.match(/^\/api\/items\/([^/]+)\/attachments(?:\/([^/]+)\/download)?$/);if(!match)return false;
 if(req.method==='GET'&&match[2]){
  await auth(req);
  const file=await db.get('SELECT filename,data FROM inbound_attachments WHERE id=? AND item_id=?',[match[2],match[1]]);
  if(!file)throw new AppError(404,'첨부파일을 찾을 수 없습니다.');
  const filename=encodeURIComponent(file.filename).replace(/['()*]/g,c=>'%'+c.charCodeAt(0).toString(16));
  res.writeHead(200,{'Content-Type':'application/octet-stream','Content-Disposition':`attachment; filename="inbound-file"; filename*=UTF-8''${filename}`,'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'});res.end(Buffer.from(file.data,'base64'));return true;
 }
 if(req.method==='POST'&&!match[2]){
  const user=await auth(req,true),body=await jsonBody(req,attachmentBodyLimit),changes=validateAttachments(body,'inbound');
  const item=await db.transaction(async c=>{
   const current=await getItem(match[1],c);checkVersion(body,current);
   if(current.type!=='inbound')throw new AppError(422,'입고 일정에만 파일을 첨부할 수 있습니다.');
   await applyAttachments(c,current.id,current.type,changes,user,now());
   if(changes.files.length||changes.remove.length){await c.run('UPDATE items SET version=version+1 WHERE id=?',[current.id]);await changed(c);}
   return getItem(current.id,c);
  });await publish();json(res,200,{item});return true;
 }
 return false;
};}
