import {officeCatalog,officeOperations,officeBuckets,stockBucket} from '../public/office-catalog.js';
import {AppError,jsonBody} from './security.mjs';
export const officeSchema=`CREATE TABLE IF NOT EXISTS office_stock(sku TEXT PRIMARY KEY,good_qty INTEGER NOT NULL DEFAULT 0 CHECK(good_qty>=0),returned_qty INTEGER NOT NULL DEFAULT 0 CHECK(returned_qty>=0),service_qty INTEGER NOT NULL DEFAULT 0 CHECK(service_qty>=0),defective_qty INTEGER NOT NULL DEFAULT 0 CHECK(defective_qty>=0),version INTEGER NOT NULL DEFAULT 1);`;
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
export const officeStockColumns=['returned_qty','service_qty'];
export function officeRoutes({db,auth,json,changed,publish}){return async(req,res,url)=>{
 const match=url.pathname.match(/^\/api\/office-stock\/([^/]+)$/);
 if(!match || req.method!=='PUT')return false;
 await auth(req,true);const body=await jsonBody(req),sku=match[1];
 if(!officeCatalog.some(s=>s.id===sku))throw new AppError(422,'알 수 없는 사무실 상품 옵션입니다.');
 if(!Number.isSafeInteger(body.version))throw new AppError(422,'최신 재고 버전이 필요합니다.');
 const quantities=[body.goodQty,body.returnedQty,body.serviceQty,body.defectiveQty];
 if(quantities.some(n=>!Number.isSafeInteger(n)||n<0||n>1000000000))throw new AppError(422,'재고는 0~1,000,000,000의 정수로 입력해 주세요.');
 const stock=await db.transaction(async connection=>{
  const current=await connection.get('SELECT version FROM office_stock WHERE sku=?',[sku]);
  if(!current)throw new AppError(404,'사무실 재고를 찾을 수 없습니다.');
  if(current.version!==body.version)throw new AppError(409,'다른 직원이 먼저 수정했습니다. 창을 다시 열어 최신 수량을 확인해 주세요.');
  await connection.run('UPDATE office_stock SET good_qty=?,returned_qty=?,service_qty=?,defective_qty=?,version=version+1 WHERE sku=?',[...quantities,sku]);
  await changed(connection);return {...body,version:current.version+1};
 });
 await publish();json(res,200,{stock});return true;
};}
