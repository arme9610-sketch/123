import test from 'node:test';
import assert from 'node:assert/strict';
import {readSalesCsv,parseCsv,matchSalesOption,aggregateSalesRows,decodeSalesCsv,mergeSalesQuantities} from '../public/sales-csv.js';
const csv=rows=>rows.map(row=>row.map(value=>'"'+String(value).replaceAll('"','""')+'"').join(',')).join('\r\n');
const headers=['주문상품명(옵션포함)','수량'];
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
test('uses only combined product names and quantities and aggregates duplicate SKUs',()=>{
 const rows=readSalesCsv('\ufeff'+csv([headers,
  ['비밀 링크 에센셜(사이즈=28인치, 컬러=트리플 블랙)',7],
  ['에센셜 캐리어 28인치 트리플 블랙',3],
  ['메트론 카빈(메트론 카빈=20인치, 색상=던 핑크)',2],
  ['파우치 6종',2]
 ]));
 const entries=aggregateSalesRows(rows);assert.equal(entries.length,32);
 assert.deepEqual(entries.find(e=>e.sku==='essential-28-black'),{sku:'essential-28-black',sold:10});
 assert.equal(entries.find(e=>e.sku==='cabin-20-pink').sold,2);
 assert.equal(entries.reduce((sum,e)=>sum+e.sold,0),14);assert.equal(entries.find(e=>e.sku==='metron-20-red').sold,0);
 assert.ok(rows.every(row=>!('cancelled' in row)&&!('refunded' in row)));
});
test('preserves multiline CSV cells and escaped quotes, supports reordered columns and grouped numbers',()=>{
 assert.deepEqual(parseCsv('a,b\r\n"문구 ""따옴표""\n다음줄",1'),[['a','b'],['문구 "따옴표"\n다음줄','1']]);
 const rows=readSalesCsv(csv([['수량','주문상품명(옵션포함)'],['1,234','에센셜(20인치\n트리플 블랙)']]));assert.equal(rows[0].sold,1234);assert.equal(rows[0].sku,'essential-20-black');
 assert.equal(decodeSalesCsv(Buffer.from('bbf3c7b0b8ed2cbfc9bcc72cb0e1c1a6bcf6b7ae2cc8afbad2bcf6b7ae','hex')),'상품명,옵션,결제수량,환불수량');
 const utf8=new TextEncoder().encode(csv([headers,['파우치',1]]));assert.equal(readSalesCsv(decodeSalesCsv(utf8))[0].sku,'pouch-set');
});
test('rejects malformed quantities and incomplete input; unresolved rows require an explicit mapping',()=>{
 for(const bad of ['-1','1.5','','NaN','1,00','=1+1','1000001'])assert.throws(()=>readSalesCsv(csv([headers,['파우치',bad]])));
 for(const bad of ['a,b\n1,2','주문상품명(옵션포함),수량,수량\n파우치,1,1','주문상품명(옵션포함),수량\n파우치'])assert.throws(()=>readSalesCsv(bad));
 assert.throws(()=>parseCsv('a,b\n"open,1'));
 const rows=readSalesCsv(csv([headers,['알 수 없는 상품',1]]));assert.equal(rows[0].sku,null);assert.throws(()=>aggregateSalesRows(rows));rows[0].sku='pouch-set';assert.equal(aggregateSalesRows(rows).at(-1).sold,1);
});

test('preview waits for option resolution and applies only after the user clicks',async()=>{
 const {createSalesImport}=await import('../public/sales-import.js');
 const previous=globalThis.document,events=new Map(),errorNode={textContent:''};let applied=0,result;
 const dialog={innerHTML:'',open:false,setAttribute(){},addEventListener(type,fn){events.set(type,fn);},querySelector(){return errorNode;},replaceChildren(){this.innerHTML='';},showModal(){this.open=true;},close(){this.open=false;events.get('close')?.();}};
 globalThis.document={createElement(){return dialog;},body:{append(){}}};
 try{
  const importer=createSalesImport({escape:s=>String(s).replaceAll('<','&lt;'),onApply:(target,entries)=>{applied++;result={target,entries};},toast(){}});
  const text=csv([headers,['<알수없는상품>',2]]),bytes=new TextEncoder().encode(text);
  const target={day:'2026-11-03',siteId:'sales-cafe24',siteName:'카페24'};
  await importer.open({name:'report.csv',size:bytes.length,arrayBuffer:async()=>bytes.buffer},target);
  assert.ok(bytes.every(byte=>byte===0),'raw upload buffer is cleared after parsing');
  assert.equal(applied,0);assert.equal(dialog.open,true);assert.ok(dialog.innerHTML.includes('1개 행'));assert.ok(dialog.innerHTML.includes('data-import-apply class="primary" disabled'));assert.ok(!dialog.innerHTML.includes('<알수없는상품>'));
  events.get('change')({target:{matches:()=>true,dataset:{importRow:'0'},value:'pouch-set'}});
  assert.ok(dialog.innerHTML.includes('모든 행의 옵션을 연결'));assert.equal(applied,0);
  events.get('click')({target:{closest:selector=>selector==='[data-import-apply]'?{}:null}});
  assert.equal(applied,1);assert.equal(result.target,target);assert.equal(result.entries.at(-1).sold,2);assert.ok(!('cancelled' in result.entries.at(-1)));assert.equal(dialog.open,false);
  importer.clear();
 }finally{globalThis.document=previous;}
});

test('ignores personal fields and cancellation columns entirely, including multiline quoted values',()=>{
 const secret='SYNTHETIC-PERSONAL-VALUE';
 const text=csv([['이름','주문상품명(옵션포함)','연락처','수량','환불수량','주소'],[secret,'에센셜(24인치 크림 화이트)',secret,3,'not-a-number',secret+'\n다음 줄, "문구"']]);
 const selected=parseCsv(text,{columns:headers});assert.deepEqual(selected,[headers,['에센셜(24인치 크림 화이트)','3']]);
 const rows=readSalesCsv(text);assert.equal(rows[0].sold,3);assert.equal(rows[0].sku,'essential-24-cream');assert.ok(!JSON.stringify(rows).includes(secret));assert.ok(!JSON.stringify(aggregateSalesRows(rows)).includes(secret));
});
test('sales replacement preserves manually entered cancellation and refund counts for every option',()=>{
 const before=[{sku:'pouch-set',sold:99,cancelled:3,refunded:2},{sku:'essential-20-black',sold:8,cancelled:4,refunded:0}];
 const imported=aggregateSalesRows(readSalesCsv(csv([headers,['파우치',7]])));
 const once=mergeSalesQuantities(before,imported),twice=mergeSalesQuantities(once,imported);
 assert.deepEqual(once,twice);assert.deepEqual(once.at(-1),{sku:'pouch-set',sold:7,cancelled:3,refunded:2});
 assert.deepEqual(once.find(e=>e.sku==='essential-20-black'),{sku:'essential-20-black',sold:0,cancelled:4,refunded:0});
});
