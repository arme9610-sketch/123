import {officeCatalog} from './office-catalog.js';

export function salesShares(options){
 const rows=options.filter(o=>o.sold>0).map(o=>({...o,color:`hsl(${(officeCatalog.findIndex(s=>s.id===o.id)*137.508+230)%360} 62% 48%)`})).sort((a,b)=>b.sold-a.sold||a.id.localeCompare(b.id));
 const total=rows.reduce((n,o)=>n+o.sold,0);let offset=0,rank=0,previous=null;
 return {total,rows:rows.map((o,i)=>{
  if(o.sold!==previous)rank=i+1;previous=o.sold;
  const share=o.sold/total*100,result={...o,rank,share,offset};offset+=share;return result;
 })};
}
export const shareLabel=value=>value.toLocaleString('ko-KR',{maximumFractionDigits:2})+'%';
export function salesShareDonut({total,rows},escape){
 return `<div class="sales-share-donut"><svg viewBox="0 0 240 240" role="img" aria-label="전체 판매 ${total}개 중 옵션별 판매 수량 비중"><circle class="sales-share-base" cx="120" cy="120" r="88"/>${rows.map(o=>`<circle class="sales-share-slice" cx="120" cy="120" r="88" pathLength="100" fill="none" stroke="${o.color}" stroke-width="32" stroke-dasharray="${o.share} ${100-o.share}" stroke-dashoffset="${-o.offset}" transform="rotate(-90 120 120)"><title>${escape(o.label)} · ${o.rank}위 · ${o.sold}개 / ${total}개 (${shareLabel(o.share)})</title></circle>`).join('')}<text class="sales-share-total" x="120" y="117" text-anchor="middle">${total.toLocaleString('ko-KR')}개</text><text class="sales-share-caption" x="120" y="141" text-anchor="middle">전체 판매</text></svg></div>`;
}
