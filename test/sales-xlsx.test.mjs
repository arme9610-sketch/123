import test from 'node:test';
import assert from 'node:assert/strict';
import {utils,write} from '../public/vendor/xlsx.js';
import {readSalesXlsx} from '../public/sales-xlsx.js';
import {aggregateSalesRows} from '../public/sales-csv.js';
import {summarizeRevenue} from '../public/sales-prices.js';

function file(rows,edit=()=>{}){
 const sheet=utils.aoa_to_sheet(rows);edit(sheet);
 const book=utils.book_new();utils.book_append_sheet(book,sheet,'카페24');
 return write(book,{type:'array',bookType:'xlsx'});
}
test('xlsx uses combined names and quantities, ignoring payment, prices and personal data',()=>{
 const rows=readSalesXlsx(file([
  ['총 결제금액','수량','수령인','주문상품명(옵션포함)','판매가'],
  [1,2,'PRIVATE','🔒비밀 링크🔒아르메 에센셜 캐리어(사이즈=28인치, 컬러=트리플 블랙)',1],
  ['invalid',3,'PRIVATE','아르메 에센셜 캐리어(사이즈=28인치, 컬러=트리플 블랙)',999999],
 ]));
 assert.equal(rows.length,2);assert.ok(!JSON.stringify(rows).includes('PRIVATE'));
 const entries=aggregateSalesRows(rows).map(e=>({...e,cancelled:0}));
 assert.equal(entries.find(e=>e.sku==='essential-28-black').sold,5);
 assert.equal(summarizeRevenue(entries,1).revenue,695000);
 assert.equal(summarizeRevenue([{sku:'essential-28-black',sold:2,cancelled:0}],1).revenue,278000);
});
test('xlsx rejects missing and duplicate headers, invalid quantities and required formulas',()=>{
 const headers=['주문상품명(옵션포함)','수량'];
 for(const value of [-1,1.5,'',true,'=2',1000001])assert.throws(()=>readSalesXlsx(file([headers,['파우치',value]])));
 assert.throws(()=>readSalesXlsx(file([['상품명','수량'],['파우치',2]])));
 assert.throws(()=>readSalesXlsx(file([[...headers,'수량'],['파우치',2,2]])));
 assert.throws(()=>readSalesXlsx(file([headers,['파우치',2]],s=>{s.B2.f='1+1';})));
 assert.throws(()=>readSalesXlsx(new TextEncoder().encode('not an Excel file').buffer));
 assert.throws(()=>readSalesXlsx(file([headers,['파우치',2]],s=>{s['!ref']='A1:B10002';})));
});
test('xlsx skips empty rows and preserves unknown options for manual resolution',()=>{
 const rows=readSalesXlsx(file([['주문상품명(옵션포함)','수량'],[],['알 수 없는 상품',2],['파우치',0]]));
 assert.equal(rows.length,2);assert.equal(rows[0].row,2);assert.equal(rows[0].sku,null);assert.equal(rows[1].sold,0);
 assert.throws(()=>aggregateSalesRows(rows));
});

test('xlsx import previews price times quantity and waits for apply',async()=>{
 const {createSalesImport}=await import('../public/sales-import.js');
 const previous=globalThis.document,events=new Map();let result=null;const messages=[];
 const dialog={innerHTML:'',open:false,setAttribute(){},addEventListener(t,f){events.set(t,f);},replaceChildren(){this.innerHTML='';},showModal(){this.open=true;},close(){this.open=false;events.get('close')?.();}};
 globalThis.document={createElement:()=>dialog,body:{append(){}}};
 try{
  const bytes=file([['주문상품명(옵션포함)','수량','결제금액'],['에센셜(28인치 트리플 블랙)',2,1]]);
  const importer=createSalesImport({escape:String,onApply:(target,entries)=>{result=entries;},toast:message=>messages.push(message)});
  await importer.open({name:'cafe24.xlsx',size:bytes.byteLength,arrayBuffer:async()=>bytes},{day:'2026-11-04',siteName:'카페24'});
  assert.equal(dialog.open,true);assert.equal(result,null);assert.equal(messages.length,0);
  assert.ok(dialog.innerHTML.includes('278,000원'));assert.ok(dialog.innerHTML.includes('판매 수량 2개'));
  assert.ok(new Uint8Array(bytes).every(b=>b===0));
  events.get('click')({target:{closest:selector=>selector==='[data-import-apply]'?{}:null}});
  assert.equal(result.find(e=>e.sku==='essential-28-black').sold,2);
 }finally{globalThis.document=previous;}
});
