import {read,utils} from './vendor/xlsx.js';
import {matchSalesOption,quantity} from './sales-csv.js';

const compact=value=>String(value??'').normalize('NFKC').replace(/[\s\u200b]/gu,'').toLowerCase();
const required=['주문상품명(옵션포함)','수량'];

export function readSalesXlsx(buffer){
 const bytes=new Uint8Array(buffer);
 if(bytes[0]!==0x50||bytes[1]!==0x4b)throw new Error('올바른 엑셀(.xlsx) 파일을 선택해 주세요.');
 let workbook;
 try{workbook=read(bytes,{type:'array',cellFormula:true,cellHTML:false,cellStyles:false,bookVBA:false,sheetRows:10002,sheets:0});}
 catch{throw new Error('엑셀 파일을 읽을 수 없습니다. 암호 없이 .xlsx로 저장한 파일을 선택해 주세요.');}
 const sheet=workbook.Sheets[workbook.SheetNames[0]];
 if(!sheet?.['!ref'])throw new Error('첫 번째 시트에 헤더와 상품 데이터가 필요합니다.');
 const range=utils.decode_range(sheet['!fullref']||sheet['!ref']);
 if(range.e.r>10000||range.e.c>255)throw new Error('엑셀은 헤더 포함 10,001행, 256열까지 가져올 수 있습니다.');
 const columns=required.map(name=>{
  const matches=[];
  for(let col=0;col<=range.e.c;col++)if(compact(sheet[utils.encode_cell({r:0,c:col})]?.v)===compact(name))matches.push(col);
  if(matches.length!==1)throw new Error('첫 번째 시트의 첫 행에 주문상품명(옵션포함)·수량 열이 각각 하나씩 필요합니다.');
  return matches[0];
 });
 const rows=[];
 for(let r=1;r<=range.e.r;r++){
  // Only these two columns leave the workbook parser. Never use payment fields.
  const cells=columns.map(c=>sheet[utils.encode_cell({r,c})]);
  if(cells.every(cell=>cell?.v===undefined||cell.v===''))continue;
  if(cells.some(cell=>cell?.f||cell?.t==='e'))throw new Error(`${r}번째 데이터 행의 상품명·수량은 수식이나 오류 없이 값으로 저장해 주세요.`);
  const name=String(cells[0]?.v??'');
  if(!name.trim())throw new Error(`${r}번째 데이터 행의 주문상품명이 비어 있습니다.`);
  const sold=quantity(cells[1]?.v??'','수량',r);
  rows.push({row:r,name,option:'',sold,sku:matchSalesOption(name,'')});
 }
 if(!rows.length)throw new Error('첫 번째 시트에 상품 데이터가 없습니다.');
 return rows;
}
