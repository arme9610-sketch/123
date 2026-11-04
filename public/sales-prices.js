import {officeCatalog} from './office-catalog.js';
export const salesOptions=Object.freeze([
 ['essential-20','에센셜 20인치',99000],['essential-24','에센셜 24인치',119000],['essential-28','에센셜 28인치',139000],
 ['cabin-20','카빈 20인치',159000],['metron-20','메트론 20인치',99000],['metron-24','메트론 24인치',119000],['metron-26','메트론 26인치',134000],['pouch-set','파우치',28900]
].map(([id,label,price])=>Object.freeze({id,label,price})));
const bySku=new Map(officeCatalog.map(s=>[s.id,salesOptions.find(o=>s.id===o.id||s.id.startsWith(o.id+'-'))]));
export function summarizeRevenue(entries,enteredDays){
 const options=salesOptions.map(o=>({...o,sold:0,cancelled:0}));
 for(const e of entries){const option=bySku.get(e.sku);if(!option)throw new Error('가격이 등록되지 않은 상품 옵션입니다.');const row=options.find(o=>o.id===option.id);row.sold+=e.sold;row.cancelled+=e.cancelled+(e.refunded||0);}
 const skuTotals=officeCatalog.map(s=>({id:s.id,label:s.model==='파우치세트'?'파우치':s.label,price:bySku.get(s.id).price,sold:0}));
 for(const e of entries)skuTotals.find(o=>o.id===e.sku).sold+=e.sold;
 let previous=null,rank=0;
 const optionRankings=skuTotals.map(o=>({...o,revenue:o.sold*o.price})).sort((a,b)=>b.revenue-a.revenue||a.id.localeCompare(b.id)).map((o,i)=>{
  if(o.revenue!==previous)rank=i+1;previous=o.revenue;
  return {...o,rank:o.revenue>0?rank:null,averageSold:enteredDays?o.sold/enteredDays:null,averageRevenue:enteredDays?o.revenue/enteredDays:null};
 });
 previous=null;rank=0;
 const rankings=options.sort((a,b)=>b.sold-a.sold||a.id.localeCompare(b.id)).map((o,i)=>{
  if(o.sold!==previous)rank=i+1;previous=o.sold;
  return {...o,rank:o.sold>0?rank:null,revenue:o.sold*o.price,averageSold:enteredDays?o.sold/enteredDays:null,averageRevenue:enteredDays?o.sold*o.price/enteredDays:null};
 });
 const revenue=rankings.reduce((n,o)=>n+o.revenue,0),refundAmount=rankings.reduce((n,o)=>n+o.cancelled*o.price,0);
 return {optionRankings,revenue,refundAmount,netRevenue:revenue-refundAmount,averageRevenue:enteredDays?revenue/enteredDays:null,averageRefundAmount:enteredDays?refundAmount/enteredDays:null,averageNetRevenue:enteredDays?(revenue-refundAmount)/enteredDays:null,rankings};
}
