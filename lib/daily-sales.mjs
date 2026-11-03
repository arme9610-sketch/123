import {randomUUID} from 'node:crypto';
import {AppError,jsonBody} from './security.mjs';
import {officeCatalog} from '../public/office-catalog.js';
export const salesSchema=`CREATE TABLE IF NOT EXISTS sales_sites(id TEXT PRIMARY KEY,name TEXT NOT NULL UNIQUE);
CREATE TABLE IF NOT EXISTS daily_sales(day TEXT NOT NULL,site_id TEXT NOT NULL REFERENCES sales_sites(id),entries TEXT NOT NULL,version INTEGER NOT NULL,author TEXT NOT NULL,updated_at TEXT NOT NULL,PRIMARY KEY(day,site_id));`;
function dayValue(value){if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value)||!Number.isFinite(Date.parse(value))||new Date(value).toISOString().slice(0,10)!==value)throw new AppError(422,'날짜를 확인해 주세요.');return value;}
export function salesRoutes({db,auth,json,changed,publish}){return async(req,res,url)=>{
 if(!url.pathname.startsWith('/api/daily-sales'))return false;
 const user=await auth(req,req.method!=='GET');
 if(url.pathname==='/api/daily-sales'&&req.method==='GET'){
  const day=dayValue(url.searchParams.get('day'));
  const result=await db.transaction(async c=>({sites:await c.all('SELECT * FROM sales_sites ORDER BY name'),records:(await c.all('SELECT * FROM daily_sales WHERE day=?',[day])).map(r=>({...r,entries:JSON.parse(r.entries)}))}));
  json(res,200,result);return true;
 }
 if(url.pathname==='/api/daily-sales/sites'&&req.method==='POST'){
  const body=await jsonBody(req);if(typeof body.name!=='string'||!body.name.trim()||body.name.trim().length>60)throw new AppError(422,'사이트명을 1~60자로 입력해 주세요.');
  const name=body.name.trim();const site=await db.transaction(async c=>{await c.run('INSERT INTO sales_sites(id,name) VALUES(?,?) ON CONFLICT(name) DO NOTHING',[randomUUID(),name]);await changed(c);return c.get('SELECT * FROM sales_sites WHERE name=?',[name]);});await publish();json(res,201,{site});return true;
 }
 if(url.pathname==='/api/daily-sales'&&req.method==='PUT'){
  const b=await jsonBody(req),day=dayValue(b.day);
  if(!Number.isSafeInteger(b.version)||b.version<0||typeof b.siteId!=='string'||!Array.isArray(b.entries)||b.entries.length!==officeCatalog.length)throw new AppError(422,'사이트와 전체 옵션 수량을 확인해 주세요.');
  const seen=new Set();const entries=b.entries.map(e=>{if(!e||!officeCatalog.some(s=>s.id===e.sku)||seen.has(e.sku)||['sold','cancelled','refunded'].some(k=>!Number.isSafeInteger(e[k])||e[k]<0||e[k]>1000000))throw new AppError(422,'각 옵션의 수량은 0~1,000,000의 정수로 입력해 주세요.');seen.add(e.sku);return {sku:e.sku,sold:e.sold,cancelled:e.cancelled,refunded:e.refunded};});
  const record=await db.transaction(async c=>{
   if(!await c.get('SELECT id FROM sales_sites WHERE id=?',[b.siteId]))throw new AppError(422,'등록된 사이트를 선택해 주세요.');
   await c.run('INSERT INTO daily_sales(day,site_id,entries,version,author,updated_at) VALUES(?,?,?,0,?,?) ON CONFLICT(day,site_id) DO NOTHING',[day,b.siteId,'[]',user.name,new Date().toISOString()]);
   const current=await c.get('SELECT * FROM daily_sales WHERE day=? AND site_id=?',[day,b.siteId]);
   if(current.version!==b.version)throw new AppError(409,'다른 직원이 먼저 저장했습니다. 입력 내용은 유지됩니다. 최신 기록을 확인한 뒤 다시 입력해 주세요.');
   const updatedAt=new Date().toISOString();await c.run('UPDATE daily_sales SET entries=?,version=version+1,author=?,updated_at=? WHERE day=? AND site_id=?',[JSON.stringify(entries),user.name,updatedAt,day,b.siteId]);await changed(c);return {day,site_id:b.siteId,entries,version:b.version+1,author:user.name,updated_at:updatedAt};
  });await publish();json(res,200,{record});return true;
 }
 return false;
};}
