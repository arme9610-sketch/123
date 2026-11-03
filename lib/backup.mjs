import {randomBytes,scrypt as callbackScrypt,createCipheriv,createDecipheriv} from 'node:crypto';
import {promisify} from 'node:util';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {openStorage} from './database.mjs';
import {AppError} from './security.mjs';
const scrypt=promisify(callbackScrypt);
export const backupTables=Object.freeze(['users','account_access','recurring_tasks','items','messages','chat_reads','office_stock','office_stock_logs','library_documents','library_resources','sales_sites','daily_sales','metadata','admin_audit']);
const limit=48*1024*1024;
function passwordValue(value){if(typeof value!=='string'||value.length<12||value.length>128)throw new AppError(422,'백업 암호는 12~128자로 입력해 주세요.');return value;}
export async function backupSnapshot(db){
 return db.transaction(async c=>{const tables={};for(const table of backupTables){
  // Include sequence values so unread positions and message ordering survive restore.
  const query=table==='messages'&&db.kind==='sqlite'?'SELECT rowid AS seq,* FROM messages':`SELECT * FROM ${table}`;
  tables[table]=(await c.all(query)).map(row=>Object.fromEntries(Object.entries(row).map(([key,value])=>[key,(['seq','last_seq'].includes(key)||(table==='metadata'&&key==='value'))?Number(value):value])));
 }
 return {format:'dayon-backup',version:1,createdAt:new Date().toISOString(),sourceEngine:db.kind,tables};},{readOnly:true});
}
export async function encryptBackup(snapshot,password){
 passwordValue(password);const plain=Buffer.from(JSON.stringify(snapshot));if(plain.length>limit)throw new AppError(413,'백업 크기가 48MB를 넘습니다. 관리자용 DB 백업을 사용해 주세요.');
 const salt=randomBytes(16),iv=randomBytes(12),key=await scrypt(password,salt,32),cipher=createCipheriv('aes-256-gcm',key,iv);
 const data=Buffer.concat([cipher.update(plain),cipher.final()]);key.fill(0);
 return {format:'dayon-encrypted-backup',version:1,algorithm:'aes-256-gcm',salt:salt.toString('base64'),iv:iv.toString('base64'),tag:cipher.getAuthTag().toString('base64'),data:data.toString('base64')};
}
export async function decryptBackup(file,password){
 passwordValue(password);
 try{
  if(file?.format!=='dayon-encrypted-backup'||file.version!==1||file.algorithm!=='aes-256-gcm')throw new Error();
  const values={};for(const name of ['salt','iv','tag','data']){if(typeof file[name]!=='string'||file[name].length>Math.ceil(limit*4/3)+4)throw new Error();values[name]=Buffer.from(file[name],'base64');if(values[name].toString('base64')!==file[name])throw new Error();}
  if(values.salt.length!==16||values.iv.length!==12||values.tag.length!==16||values.data.length>limit)throw new Error();
  const key=await scrypt(password,values.salt,32);let plain;
  try{const decipher=createDecipheriv('aes-256-gcm',key,values.iv);decipher.setAuthTag(values.tag);plain=Buffer.concat([decipher.update(values.data),decipher.final()]);}finally{key.fill(0);}
  const snapshot=JSON.parse(plain.toString('utf8'));
  if(snapshot.format!=='dayon-backup'||snapshot.version!==1||!snapshot.tables||Object.keys(snapshot.tables).length!==backupTables.length||!backupTables.every(t=>Array.isArray(snapshot.tables[t])))throw new Error();
  return snapshot;
 }catch{throw new AppError(422,'백업 암호가 다르거나 지원하지 않는 손상된 백업 파일입니다.');}
}
function orderedRows(rows,keepSeq=false){return rows.map(row=>JSON.stringify(Object.fromEntries(Object.entries(row).filter(([k])=>keepSeq||k!=='seq').sort(([a],[b])=>a.localeCompare(b))))).sort();}
export async function rehearseBackup(snapshot){
 const directory=await mkdtemp(join(tmpdir(),'dayon-restore-check-'));let db;
 try{
  db=await openStorage({dataDir:directory,databaseUrl:''});
  const result=await db.transaction(async c=>{
   // The only restore target is this fresh temporary SQLite database.
   for(const table of [...backupTables].reverse())await c.run(`DELETE FROM ${table}`);
   for(const table of backupTables){
    const columns=(await c.all(`PRAGMA table_info(${table})`)).map(r=>r.name);
    for(const row of snapshot.tables[table]){
     if(!row||typeof row!=='object'||Array.isArray(row)||Object.keys(row).some(k=>k!=='seq'&&!columns.includes(k)))throw new AppError(422,'백업에 지원하지 않는 테이블 열이 있습니다.');
     const keys=columns.filter(k=>Object.hasOwn(row,k));if(!keys.length)throw new AppError(422,'빈 백업 행입니다.');
     if(table==='messages'&&row.seq!==undefined){if(!Number.isSafeInteger(Number(row.seq))||Number(row.seq)<1)throw new AppError(422,'잘못된 메시지 순서입니다.');keys.unshift('rowid');}
     await c.run(`INSERT INTO ${table}(${keys.join(',')}) VALUES(${keys.map(()=>'?').join(',')})`,keys.map(k=>k==='rowid'?Number(row.seq):row[k]));
    }
   }
   if((await c.all('PRAGMA foreign_key_check')).length)throw new AppError(422,'백업의 참조 데이터가 일치하지 않습니다.');
   const integrity=await c.get('PRAGMA integrity_check');if(Object.values(integrity)[0]!=='ok')throw new AppError(422,'복원 DB의 무결성 검사에 실패했습니다.');
   const counts={};for(const table of backupTables){const restored=await c.all(table==='messages'?'SELECT rowid AS seq,* FROM messages':`SELECT * FROM ${table}`);if(JSON.stringify(orderedRows(restored,table==='messages'))!==JSON.stringify(orderedRows(snapshot.tables[table],table==='messages')))throw new AppError(422,`${table} 복원 데이터가 원본과 일치하지 않습니다.`);counts[table]=restored.length;}
   if(Number((await c.get('SELECT count(*) n FROM sessions')).n)!==0||Number((await c.get('SELECT count(*) n FROM invitations')).n)!==0)throw new AppError(422,'세션 격리 검사에 실패했습니다.');
   return {ok:true,checkedAt:new Date().toISOString(),backupCreatedAt:snapshot.createdAt,counts,liveDataChanged:false,sessionsRestored:false};
  });return result;
 }finally{if(db)await db.close();await rm(directory,{recursive:true,force:true});}
}
