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
export function salesShareLayout(rows){
 const labels=rows.map((o,index)=>{const angle=(o.offset+o.share/2)/100*Math.PI*2-Math.PI/2;return {...o,index,dx:Math.cos(angle),dy:Math.sin(angle)};});
 const sides=[labels.filter(o=>o.dx<0),labels.filter(o=>o.dx>=0)],height=Math.max(360,Math.max(...sides.map(s=>s.length))*26+48),cy=height/2;
 for(const side of sides){
  side.sort((a,b)=>a.dy-b.dy);
  side.forEach((o,i)=>{o.labelY=Math.max(cy+o.dy*145,i?side[i-1].labelY+26:24);});
  if(side.length&&side.at(-1).labelY>height-24){side.at(-1).labelY=height-24;for(let i=side.length-2;i>=0;i--)side[i].labelY=Math.min(side[i].labelY,side[i+1].labelY-26);}
 }
 return {labels,height,cy};
}
export function topDonutShares({total,rows}){
 if(rows.length<=10)return {total,rows};
 const visible=rows.slice(0,10),rest=rows.slice(10),sold=rest.reduce((sum,row)=>sum+row.sold,0),share=total?sold/total*100:0;
 return {total,rows:[...visible,{id:'other',label:`기타 (${rest.length}개 옵션)`,sold,share,offset:visible.reduce((sum,row)=>sum+row.share,0),color:'#94a3b8'}]};
}
export function salesShareDonut(shares,escape){
 const {total,rows}=topDonutShares(shares);
 const {labels,height,cy}=salesShareLayout(rows),cx=420,r=110;
 return `<div class="sales-share-donut"><svg viewBox="0 0 840 ${height}" role="group" aria-label="전체 판매 ${total}개 중 옵션별 판매 수량 비중"><circle class="sales-share-base" cx="${cx}" cy="${cy}" r="${r}"/>${labels.map(o=>{
  const right=o.dx>=0,x=right?590:250,elbow=right?568:272,tipX=Math.max(10,Math.min(506,cx+o.dx*r-162)),tipY=Math.max(8,Math.min(height-76,cy+o.dy*r-76));
  return `<g class="sales-share-option" data-sales-share data-label="${escape(o.label)}" data-sold="${o.sold}" data-percent="${shareLabel(o.share)}" data-tooltip-x="${tipX}" data-tooltip-y="${tipY}" tabindex="0" role="img" aria-label="${escape(o.label)} · ${o.sold}개 / ${total}개 (${shareLabel(o.share)})"><circle class="sales-share-slice" cx="${cx}" cy="${cy}" r="${r}" pathLength="100" fill="none" stroke="${o.color}" stroke-width="44" stroke-dasharray="${o.share} ${100-o.share}" stroke-dashoffset="${-o.offset}" transform="rotate(-90 ${cx} ${cy})"/><polyline class="sales-share-leader" points="${cx+o.dx*134},${cy+o.dy*134} ${elbow},${o.labelY} ${x},${o.labelY}"/><text class="sales-share-label" x="${right?x+7:x-7}" y="${o.labelY+4}" text-anchor="${right?'start':'end'}">${escape(o.label)}</text></g>`;
 }).join('')}<text class="sales-share-total" x="${cx}" y="${cy-3}" text-anchor="middle">${total.toLocaleString('ko-KR')}개</text><text class="sales-share-caption" x="${cx}" y="${cy+22}" text-anchor="middle">전체 판매</text><g class="sales-share-tooltip" visibility="hidden" pointer-events="none" aria-hidden="true"><rect width="324" height="68" rx="8"/><text class="sales-share-tooltip-label" x="14" y="25"></text><text class="sales-share-tooltip-value" x="14" y="50"></text></g></svg><p class="sales-share-hint">판매 수량 상위 10개 옵션 · 나머지는 기타로 합산합니다. 옵션에 마우스를 올리면 판매 수량과 비율이 표시됩니다. 모바일에서는 눌러서 확인하세요.</p></div>`;
}
export function bindSalesShareTooltip(root){
 const find=target=>target?.closest?.('[data-sales-share]');
 function hide(){root.querySelector('.sales-share-tooltip')?.setAttribute('visibility','hidden');}
 function show(option){
  const tooltip=option?.closest('svg')?.querySelector('.sales-share-tooltip');if(!tooltip)return;
  tooltip.querySelector('.sales-share-tooltip-label').textContent=option.dataset.label;
  tooltip.querySelector('.sales-share-tooltip-value').textContent=`판매 ${Number(option.dataset.sold).toLocaleString('ko-KR')}개 · ${option.dataset.percent}`;
  tooltip.setAttribute('transform',`translate(${option.dataset.tooltipX} ${option.dataset.tooltipY})`);tooltip.setAttribute('visibility','visible');
 }
 root.addEventListener('pointerover',event=>{const option=find(event.target);if(option)show(option);});
 root.addEventListener('pointerout',event=>{const option=find(event.target);if(option&&option!==find(event.relatedTarget))hide();});
 root.addEventListener('focusin',event=>{const option=find(event.target);if(option)show(option);});
 root.addEventListener('focusout',event=>{if(find(event.target))hide();});
 root.addEventListener('click',event=>{const option=find(event.target);if(option)show(option);else hide();});
 root.addEventListener('keydown',event=>{if(event.key==='Escape')hide();});
}
