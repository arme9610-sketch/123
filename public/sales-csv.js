import {officeCatalog} from './office-catalog.js';
const compact=value=>String(value).normalize('NFKC').replace(/[\s\u200b]/gu,'').toLowerCase();
const required=['상품명','옵션','결제수량','환불수량'];
export function decodeSalesCsv(buffer){
 try{return new TextDecoder('utf-8',{fatal:true}).decode(buffer);}catch{return new TextDecoder('euc-kr',{fatal:true}).decode(buffer);}
}
export function parseCsv(text){
 const rows=[];let row=[],field='',quoted=false,closed=false;
 text=text.replace(/^\uFEFF/,'');
 const pushRow=()=>{row.push(field);if(row.some(value=>value.trim()))rows.push(row);row=[];field='';closed=false;if(rows.length>10001)throw new Error('CSV는 최대 10,000개 행까지 가져올 수 있습니다.');};
 for(let i=0;i<text.length;i++){
  const char=text[i];
  if(quoted){if(char==='"'){if(text[i+1]==='"'){field+='"';i++;}else{quoted=false;closed=true;}}else field+=char;continue;}
  if(char==='"'){if(field||closed)throw new Error('CSV 따옴표 형식을 확인해 주세요.');quoted=true;}
  else if(char===','){row.push(field);field='';closed=false;}
  else if(char==='\r'||char==='\n'){if(char==='\r'&&text[i+1]==='\n')i++;pushRow();}
  else{if(closed)throw new Error('CSV 따옴표 뒤의 구분자를 확인해 주세요.');field+=char;}
 }
 if(quoted)throw new Error('CSV의 닫히지 않은 따옴표를 확인해 주세요.');
 if(field||row.length)pushRow();return rows;
}
function quantity(value,heading,row){
 const raw=String(value).trim();
 if(!/^(?:\d+|\d{1,3}(?:,\d{3})+)$/.test(raw))throw new Error(`${row}번째 데이터 행의 ${heading}은 0 이상의 정수여야 합니다.`);
 const n=Number(raw.replaceAll(',',''));
 if(!Number.isSafeInteger(n)||n>(heading==='결제수량'?1000000:2000000))throw new Error(`${row}번째 데이터 행의 ${heading}이 입력 가능한 범위를 넘습니다.`);
 return n;
}
export function matchSalesOption(name,option){
 const title=compact(name),options=compact(option),text=title+' '+options;
 let model;
 const models=[['에센셜','에센셜'],['카빈','카빈'],['메트론','메트론']].filter(([token])=>text.includes(token)).map(([,model])=>model);
 // "메트론 카빈" is the cabin product, distinct from the Metron range.
 if(models.includes('카빈')&&models.includes('메트론'))models.splice(models.indexOf('메트론'),1);
 if(models.length===1)model=models[0];
 else if(models.length===0&&title.includes('파우치'))model='파우치세트';
 else return null;
 if(model==='파우치세트')return 'pouch-set';
 const candidates=officeCatalog.filter(s=>s.model===model);
 const sizeMatches=value=>[...new Set([...value.matchAll(/(20|24|26|28)(?:인치|inch|["″])/g)].map(m=>m[1]+'인치'))];
 const optionSizes=sizeMatches(options),sizes=optionSizes.length?optionSizes:sizeMatches(title);
 const findColors=value=>[...new Set(candidates.filter(s=>value.includes(compact(s.color))).map(s=>s.color))];
 const optionColors=findColors(options),colors=optionColors.length?optionColors:findColors(title);
 if(sizes.length!==1||colors.length!==1)return null;
 return candidates.find(s=>s.size===sizes[0]&&s.color===colors[0])?.id||null;
}
export function readSalesCsv(text){
 const table=parseCsv(text);if(table.length<2)throw new Error('헤더와 상품 데이터가 있는 CSV 파일을 선택해 주세요.');
 const headers=table[0].map(compact),indexes=required.map(name=>headers.indexOf(compact(name)));
 if(indexes.some(i=>i<0)||required.some(name=>headers.filter(h=>h===compact(name)).length!==1))throw new Error('상품명·옵션·결제수량·환불수량 열이 각각 하나씩 필요합니다.');
 return table.slice(1).map((values,i)=>{
  if(values.length!==table[0].length)throw new Error(`${i+1}번째 데이터 행의 열 개수가 헤더와 다릅니다.`);
  const [name,option,paid,refund]=indexes.map(index=>values[index]);
  if(!name.trim())throw new Error(`${i+1}번째 데이터 행의 상품명이 비어 있습니다.`);
  return {row:i+1,name,option,sold:quantity(paid,'결제수량',i+1),cancelled:quantity(refund,'환불수량',i+1),sku:matchSalesOption(name,option)};
 });
}
export function aggregateSalesRows(rows){
 const entries=officeCatalog.map(s=>({sku:s.id,sold:0,cancelled:0,refunded:0}));
 for(const row of rows){
  const entry=entries.find(e=>e.sku===row.sku);if(!entry)throw new Error(`${row.row}번째 데이터 행의 상품 옵션을 선택해 주세요.`);
  entry.sold+=row.sold;entry.cancelled+=row.cancelled;
  if(entry.sold>1000000||entry.cancelled>2000000)throw new Error('옵션별 합계가 입력 가능한 범위를 넘습니다.');
 }
 return entries;
}
