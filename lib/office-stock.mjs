import {randomUUID} from 'node:crypto';
import {officeCatalog,officeOperations,officeBuckets,stockBucket} from '../public/office-catalog.js';
import {AppError,jsonBody} from './security.mjs';
export const officeSchema=`CREATE TABLE IF NOT EXISTS office_stock(sku TEXT PRIMARY KEY,good_qty INTEGER NOT NULL DEFAULT 0 CHECK(good_qty>=0),returned_qty INTEGER NOT NULL DEFAULT 0 CHECK(returned_qty>=0),service_qty INTEGER NOT NULL DEFAULT 0 CHECK(service_qty>=0),defective_qty INTEGER NOT NULL DEFAULT 0 CHECK(defective_qty>=0),version INTEGER NOT NULL DEFAULT 1);
CREATE TABLE IF NOT EXISTS office_stock_logs(id TEXT PRIMARY KEY,sku TEXT NOT NULL REFERENCES office_stock(sku),bucket TEXT NOT NULL,before_qty INTEGER NOT NULL,after_qty INTEGER NOT NULL,user_id TEXT NOT NULL REFERENCES users(id),author TEXT NOT NULL,stock_version INTEGER NOT NULL,created_at TEXT NOT NULL,UNIQUE(sku,stock_version,bucket));
CREATE INDEX IF NOT EXISTS office_stock_logs_order ON office_stock_logs(created_at,id);`;
export function validateOffice(body){
 if(!officeCatalog.some(s=>s.id===body.officeSku)||!Object.hasOwn(officeOperations,body.officeOperation))throw new AppError(422,'사무실 상품 옵션과 입·출고 구분을 선택해 주세요.');
 const bucket=stockBucket(body.officeOperation,body.officeBucket);
 if(!Object.hasOwn(officeBuckets,bucket))throw new AppError(422,'출고할 재고를 선택해 주세요.');
 return {officeSku:body.officeSku,officeOperation:body.officeOperation,officeBucket:bucket};
}
export async function officeSnapshot(connection){
 const rows=await connection.all('SELECT * FROM office_stock');
 return officeCatalog.map(s=>{const r=rows.find(r=>r.sku===s.id);return {...s,goodQty:r?.good_qty||0,returnedQty:r?.returned_qty||0,serviceQty:r?.service_qty||0,defectiveQty:r?.defective_qty||0,version:r?.version||1};});
}
export async function officeLogs(connection,cursor=null){
 const rows=await connection.all('SELECT * FROM office_stock_logs'+(cursor?' WHERE created_at<? OR (created_at=? AND id<?)':'')+' ORDER BY created_at DESC,id DESC LIMIT 51',cursor?[cursor.time,cursor.time,cursor.id]:[]);
 const entries=rows.slice(0,50),last=entries.at(-1);
 return {entries,hasMore:rows.length>50,nextCursor:rows.length>50?{time:last.created_at,id:last.id}:null};
}
export const officeStockColumns=['returned_qty','service_qty'];
export function officeRoutes({db,auth,json,changed,publish}){return async(req,res,url)=>{
 if(url.pathname==='/api/office-stock-logs'&&req.method==='GET'){
  await auth(req);const time=url.searchParams.get('beforeTime'),id=url.searchParams.get('beforeId');
  if((time||id)&&(!time||!id||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(time)||!Number.isFinite(Date.parse(time))||!/^[-a-f0-9]{36}$/.test(id)))throw new AppError(422,'올바른 로그 페이지를 요청해 주세요.');
  json(res,200,await officeLogs(db,time?{time,id}:null));return true;
 }
 const match=url.pathname.match(/^\/api\/office-stock\/([^/]+)$/);
 if(!match || req.method!=='PUT')return false;
 const user=await auth(req,true);const body=await jsonBody(req),sku=match[1];
 if(!officeCatalog.some(s=>s.id===sku))throw new AppError(422,'알 수 없는 사무실 상품 옵션입니다.');
 if(!Number.isSafeInteger(body.version))throw new AppError(422,'최신 재고 버전이 필요합니다.');
 const quantities=[body.goodQty,body.returnedQty,body.serviceQty,body.defectiveQty];
 if(quantities.some(n=>!Number.isSafeInteger(n)||n<0||n>1000000000))throw new AppError(422,'재고는 0~1,000,000,000의 정수로 입력해 주세요.');
 const stock=await db.transaction(async connection=>{
  const current=await connection.get('SELECT * FROM office_stock WHERE sku=?',[sku]);
  if(!current)throw new AppError(404,'사무실 재고를 찾을 수 없습니다.');
  if(current.version!==body.version)throw new AppError(409,'다른 직원이 먼저 수정했습니다. 창을 다시 열어 최신 수량을 확인해 주세요.');
  const columns=['good_qty','returned_qty','service_qty','defective_qty'],buckets=['good','returned','service','defective'];
  const changes=quantities.map((qty,i)=>({bucket:buckets[i],before:current[columns[i]],after:qty})).filter(c=>c.before!==c.after);
  if(!changes.length)return {...body,version:current.version};
  await connection.run('UPDATE office_stock SET good_qty=?,returned_qty=?,service_qty=?,defective_qty=?,version=version+1 WHERE sku=?',[...quantities,sku]);
  const createdAt=new Date().toISOString();
  for(const change of changes)await connection.run('INSERT INTO office_stock_logs(id,sku,bucket,before_qty,after_qty,user_id,author,stock_version,created_at) VALUES(?,?,?,?,?,?,?,?,?)',[randomUUID(),sku,change.bucket,change.before,change.after,user.id,user.name,current.version+1,createdAt]);
  await changed(connection);return {...body,version:current.version+1};
 });
 await publish();json(res,200,{stock});return true;
};}
