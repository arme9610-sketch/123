import {officeCatalog} from './office-catalog.js';
const compact=value=>String(value).normalize('NFKC').replace(/[\s\u200b]/gu,'').toLowerCase();
const required=['주문상품명(옵션포함)','수량'];
export function decodeSalesCsv(buffer){
 try{return new TextDecoder('utf-8',{fatal:true}).decode(buffer);}catch{return new TextDecoder('euc-kr',{fatal:true}).decode(buffer);}
}
export function parseCsv(text,{columns=null}={}){
 const rows=[];let row=[],field='',quoted=false,closed=false,column=0,selected=null,width=null,hasContent=false,started=false;
 text=text.replace(/^\uFEFF/,'');
 const keep=()=>selected===null||selected.has(column);
 const pushField=()=>{if(keep())row.push(field);field='';column++;closed=false;started=false;};
 const pushRow=()=>{
  pushField();
  if(hasContent){
   if(width===null){
    width=column;
    if(columns){
     const header=row.map(compact);selected=new Set();
     for(const name of columns){const matches=header.map((h,i)=>h===compact(name)?i:-1).filter(i=>i>=0);if(matches.length!==1)throw new Error('주문상품명(옵션포함)·수량 열이 각각 하나씩 필요합니다.');selected.add(matches[0]);}
     row=row.filter((_,i)=>selected.has(i));
    }
   }else if(columns&&column!==width)throw new Error(`${rows.length}번째 데이터 행의 열 개수가 헤더와 다릅니다.`);
   rows.push(row);if(rows.length>10001)throw new Error('CSV는 최대 10,000개 행까지 가져올 수 있습니다.');
  }
  row=[];field='';column=0;closed=false;hasContent=false;
 };
 for(let i=0;i<text.length;i++){
  const char=text[i];
  if(quoted){if(char==='"'){if(text[i+1]==='"'){if(keep())field+='"';hasContent=true;i++;}else{quoted=false;closed=true;}}else{if(keep())field+=char;if(char.trim())hasContent=true;}continue;}
  if(char==='"'){if(started||closed)throw new Error('CSV 따옴표 형식을 확인해 주세요.');quoted=true;}
  else if(char===',')pushField();
  else if(char==='\r'||char==='\n'){if(char==='\r'&&text[i+1]==='\n')i++;pushRow();}
  else{if(closed)throw new Error('CSV 따옴표 뒤의 구분자를 확인해 주세요.');if(keep())field+=char;started=true;if(char.trim())hasContent=true;}
 }
 if(quoted)throw new Error('CSV의 닫히지 않은 따옴표를 확인해 주세요.');
 if(hasContent||column||field)pushRow();return rows;
}
export function quantity(value,heading,row){
 const raw=String(value).trim();
 if(!/^(?:\d+|\d{1,3}(?:,\d{3})+)$/.test(raw))throw new Error(`${row}번째 데이터 행의 ${heading}은 0 이상의 정수여야 합니다.`);
 const n=Number(raw.replaceAll(',',''));
 if(!Number.isSafeInteger(n)||n>1000000)throw new Error(`${row}번째 데이터 행의 ${heading}이 입력 가능한 범위를 넘습니다.`);
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
 // Discard every non-required data field while parsing; do not keep full order rows.
 const table=parseCsv(text,{columns:required});if(table.length<2)throw new Error('헤더와 상품 데이터가 있는 CSV 파일을 선택해 주세요.');
 const headers=table[0].map(compact),nameIndex=headers.indexOf(compact(required[0])),quantityIndex=headers.indexOf(compact(required[1]));
 return table.slice(1).map((values,i)=>{
  const name=values[nameIndex],sold=quantity(values[quantityIndex],'수량',i+1);
  if(!name.trim())throw new Error(`${i+1}번째 데이터 행의 주문상품명이 비어 있습니다.`);
  return {row:i+1,name,option:'',sold,sku:matchSalesOption(name,'')};
 });
}
export function aggregateSalesRows(rows){
 const entries=officeCatalog.map(s=>({sku:s.id,sold:0}));
 for(const row of rows){
  const entry=entries.find(e=>e.sku===row.sku);if(!entry)throw new Error(`${row.row}번째 데이터 행의 상품 옵션을 선택해 주세요.`);
  entry.sold+=row.sold;
  if(entry.sold>1000000)throw new Error('옵션별 판매 합계가 입력 가능한 범위를 넘습니다.');
 }
 return entries;
}
export function mergeSalesQuantities(current,imported){
 return officeCatalog.map(s=>{const before=current.find(e=>e.sku===s.id),next=imported.find(e=>e.sku===s.id);return {sku:s.id,sold:next?.sold||0,cancelled:before?.cancelled||0,refunded:before?.refunded||0};});
}
