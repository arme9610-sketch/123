import test from 'node:test';
import assert from 'node:assert/strict';
import {readSalesCsv,parseCsv,matchSalesOption,aggregateSalesRows,decodeSalesCsv} from '../public/sales-csv.js';
import {salesTotals,rateLabel} from '../public/sales-math.js';
const csv=rows=>rows.map(row=>row.map(value=>'"'+String(value).replaceAll('"','""')+'"').join(',')).join('\r\n');
const headers=['상품명','옵션','결제수량','환불수량','판매수량'];
test('secret links, cabin naming, pouch and missing options match the office catalog',()=>{
 assert.equal(matchSalesOption('🔒비밀 링크🔒아르메 에센셜 캐리어','사이즈 : 28인치\n컬러 : 크림 화이트'),'essential-28-cream');
 assert.equal(matchSalesOption('🔒스레드 전용 비밀 링크🔒아르메 에센셜 캐리어','사이즈 : 20인치\n컬러 : 트리플 블랙'),'essential-20-black');
 assert.equal(matchSalesOption('메트론 카빈 캐리어','메트론 카빈 : 20인치\n색상 : 다크 그레이'),'cabin-20-gray');
 assert.equal(matchSalesOption('메트론 카빈 캐리어','메트론 카빈 : 20인치\n색상 : 바토리 레드'),'cabin-20-red');
 assert.equal(matchSalesOption('[캐리어와 찰떡궁합] 아르메 여행용 압축 파우치 6종',''),'pouch-set');
 assert.equal(matchSalesOption('에센셜 캐리어 28인치 트리플 블랙',''),'essential-28-black');
 assert.equal(matchSalesOption('메트론 캐리어','26인치 스페이스 실버'),'metron-26-silver');
 assert.equal(matchSalesOption('에센셜 캐리어','28인치'),null);
 assert.equal(matchSalesOption('에센셜 카빈 캐리어','20인치 트리플블랙'),null);
 assert.equal(matchSalesOption('카빈 캐리어','24인치 트리플블랙'),null);
});
test('uses payment and refund quantities, combines duplicate SKUs, and keeps refund-only rows',()=>{
 const rows=readSalesCsv('\ufeff'+csv([headers,
  ['비밀 링크 에센셜','28인치 트리플 블랙',7,2,5],
  ['에센셜 캐리어 28인치 트리플 블랙','',3,0,3],
  ['에센셜','28인치 다크 그레이',0,1,-1],
  ['파우치 6종','',2,0,2]
 ]));
 const entries=aggregateSalesRows(rows);assert.equal(entries.length,32);
 assert.deepEqual(entries.find(e=>e.sku==='essential-28-black'),{sku:'essential-28-black',sold:10,cancelled:2,refunded:0});
 assert.equal(entries.find(e=>e.sku==='essential-28-gray').cancelled,1);
 const t=salesTotals(entries);assert.equal(t.sold,12);assert.equal(t.cancelled,3);assert.equal(rateLabel(t.sold,t.cancelled),'25%');
 assert.equal(entries.find(e=>e.sku==='metron-20-red').sold,0);
});
test('preserves multiline CSV cells and escaped quotes, supports reordered columns and grouped numbers',()=>{
 assert.deepEqual(parseCsv('a,b\r\n"문구 ""따옴표""\n다음줄",1'),[['a','b'],['문구 "따옴표"\n다음줄','1']]);
 const rows=readSalesCsv(csv([['환불수량','옵션','상품명','결제수량'],[3,'20인치\n트리플 블랙','에센셜','1,234']]));assert.equal(rows[0].sold,1234);assert.equal(rows[0].cancelled,3);
 assert.equal(decodeSalesCsv(Buffer.from('bbf3c7b0b8ed2cbfc9bcc72cb0e1c1a6bcf6b7ae2cc8afbad2bcf6b7ae','hex')),'상품명,옵션,결제수량,환불수량');
 const utf8=new TextEncoder().encode(csv([headers,['파우치','',1,0,1]]));assert.equal(readSalesCsv(decodeSalesCsv(utf8))[0].sku,'pouch-set');
});
test('rejects malformed quantities and incomplete input; unresolved rows require an explicit mapping',()=>{
 for(const bad of ['-1','1.5','','NaN','1,00','=1+1','1000001'])assert.throws(()=>readSalesCsv(csv([headers,['파우치','',bad,0,0]])));
 for(const bad of ['a,b\n1,2','상품명,옵션,결제수량,환불수량,상품명\n파우치,,1,0,파우치','상품명,옵션,결제수량,환불수량\n파우치,,1'])assert.throws(()=>readSalesCsv(bad));
 assert.throws(()=>parseCsv('a,b\n"open,1'));
 const rows=readSalesCsv(csv([headers,['알 수 없는 상품','',1,0,1]]));assert.equal(rows[0].sku,null);assert.throws(()=>aggregateSalesRows(rows));rows[0].sku='pouch-set';assert.equal(aggregateSalesRows(rows).at(-1).sold,1);
});

test('preview waits for option resolution and applies only after the user clicks',async()=>{
 const {createSalesImport}=await import('../public/sales-import.js');
 const previous=globalThis.document,events=new Map(),errorNode={textContent:''};let applied=0,result;
 const dialog={innerHTML:'',open:false,setAttribute(){},addEventListener(type,fn){events.set(type,fn);},querySelector(){return errorNode;},replaceChildren(){this.innerHTML='';},showModal(){this.open=true;},close(){this.open=false;events.get('close')?.();}};
 globalThis.document={createElement(){return dialog;},body:{append(){}}};
 try{
  const importer=createSalesImport({escape:s=>String(s).replaceAll('<','&lt;'),onApply:(target,entries)=>{applied++;result={target,entries};},toast(){}});
  const text=csv([headers,['<알수없는상품>','',2,1,1]]),bytes=new TextEncoder().encode(text);
  const target={day:'2026-11-03',siteId:'sales-cafe24',siteName:'카페24'};
  await importer.open({name:'report.csv',size:bytes.length,arrayBuffer:async()=>bytes.buffer},target);
  assert.equal(applied,0);assert.equal(dialog.open,true);assert.ok(dialog.innerHTML.includes('1개 행'));assert.ok(dialog.innerHTML.includes('data-import-apply class="primary" disabled'));assert.ok(!dialog.innerHTML.includes('<알수없는상품>'));
  events.get('change')({target:{matches:()=>true,dataset:{importRow:'0'},value:'pouch-set'}});
  assert.ok(dialog.innerHTML.includes('모든 행의 옵션을 연결'));assert.equal(applied,0);
  events.get('click')({target:{closest:selector=>selector==='[data-import-apply]'?{}:null}});
  assert.equal(applied,1);assert.equal(result.target,target);assert.equal(result.entries.at(-1).sold,2);assert.equal(result.entries.at(-1).cancelled,1);assert.equal(dialog.open,false);
  importer.clear();
 }finally{globalThis.document=previous;}
});
