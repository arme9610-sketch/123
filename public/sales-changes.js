import {officeCatalog} from './office-catalog.js';
import {summarizeRevenue} from './sales-prices.js';
const money=n=>Math.round(n).toLocaleString('ko-KR')+'원';
const signedMoney=n=>(n>0?'+':'')+money(n);
const percent=(current,previous)=>previous?Math.round((current-previous)/previous*1000)/10:null;
export function compareDailySales(records,sites,currentDay,previousDay){
 const current=records.filter(r=>r.day===currentDay),previous=records.filter(r=>r.day===previousDay);
 const comparedSites=sites.filter(s=>current.some(r=>r.site_id===s.id)&&previous.some(r=>r.site_id===s.id));
 const ids=new Set(comparedSites.map(s=>s.id));
 const count=(rows,sku)=>rows.filter(r=>ids.has(r.site_id)).reduce((sum,r)=>sum+(r.entries.find(e=>e.sku===sku)?.sold||0),0);
 const prices=new Map(summarizeRevenue([],0).optionRankings.map(o=>[o.id,o.price]));
 const options=officeCatalog.map(s=>{
  const yesterday=count(current,s.id),before=count(previous,s.id),delta=yesterday-before,price=prices.get(s.id);
  return {id:s.id,label:s.label,current:yesterday,previous:before,delta,percent:percent(yesterday,before),price,currentRevenue:yesterday*price,previousRevenue:before*price,revenueDelta:delta*price};
 }).sort((a,b)=>Math.abs(b.revenueDelta)-Math.abs(a.revenueDelta)||a.id.localeCompare(b.id));
 const currentRevenue=options.reduce((n,o)=>n+o.currentRevenue,0),previousRevenue=options.reduce((n,o)=>n+o.previousRevenue,0);
 const report={currentDay,previousDay,comparedSites,expectedSites:sites.length,currentSites:current.length,previousSites:previous.length,options,currentTotal:options.reduce((n,o)=>n+o.current,0),previousTotal:options.reduce((n,o)=>n+o.previous,0),currentRevenue,previousRevenue,revenueDelta:currentRevenue-previousRevenue,revenuePercent:percent(currentRevenue,previousRevenue)};
 return {...report,insight:analyzeSalesChanges(report)};
}
export function analyzeSalesChanges(report){
 const {comparedSites,expectedSites,currentRevenue,previousRevenue,revenueDelta,revenuePercent,options}=report;
 if(!comparedSites.length)return {title:'비교 데이터 부족',summary:'두 날짜에 모두 입력된 사이트가 없어 매출 변화를 분석할 수 없습니다.',drivers:[],actions:[]};
 const decline=revenueDelta<0;
 const title=decline?(revenuePercent<=-30?'매출 급감 · 긴급 점검 필요':'매출 감소 · 원인 점검 필요'):revenueDelta>0?'매출 증가 · 성장 요인 확인':'총 매출 유지';
 const summary=`2일 전 매출 ${money(previousRevenue)}에서 어제 ${money(currentRevenue)}으로 ${money(Math.abs(revenueDelta))} ${decline?'감소했습니다':revenueDelta>0?'증가했습니다':'변동했습니다'}${revenuePercent===null?' (이전 매출이 0원이므로 증감률은 계산하지 않습니다).':` (${revenuePercent>0?'+':''}${revenuePercent}%).`}`;
 const direction=options.filter(o=>decline?o.revenueDelta<0:revenueDelta>0?o.revenueDelta>0:o.revenueDelta!==0);
 const drivers=direction.slice(0,3).map(o=>`${o.label}: ${signedMoney(o.revenueDelta)} (${o.previous}개 → ${o.current}개)${decline?`, 전체 감소 옵션 매출 중 ${Math.round(Math.abs(o.revenueDelta)/options.filter(v=>v.revenueDelta<0).reduce((n,v)=>n+Math.abs(v.revenueDelta),0)*1000)/10}%`:''}`);
 const actions=decline?['매출 감소가 큰 상품부터 광고 ROAS·광고비·전환율을 전일과 비교해 효율 저하 여부를 확인하세요.','해당 상품의 판매 채널별 품절·옵션 재고·노출 중단 여부와 판매량 감소 시점이 겹치는지 확인하세요.','유입량·구매 전환율, 프로모션 종료와 가격 변경 여부를 함께 점검하세요.']:revenueDelta>0?['증가 상품의 광고 ROAS·유입·전환율과 프로모션 효과를 확인하세요.','판매 증가 상품의 재고와 품절 가능성을 점검해 상승 흐름을 유지하세요.']:['총액이 같아도 상품별 증감이 상쇄되었는지 아래 비교를 확인하세요.'];
 if(comparedSites.length<expectedSites)actions.unshift(`공통 사이트 ${comparedSites.length}/${expectedSites}개 기준입니다. 미입력 사이트를 보완한 뒤 전체 매출 판단을 확인하세요.`);
 return {title,summary,drivers,actions};
}
export function createSalesChanges({api,escape:esc,getUser,getToday}){
 let data=null,error='',loading=false,owner='',epoch=0,stamp=0,expanded=false;
 function repaint(){const root=document.querySelector('#home-sales-changes');if(root)root.outerHTML=render();}
 async function load(){if(loading)return;const ticket=epoch;loading=true;error='';try{const next=await api('/api/daily-sales/changes');if(ticket===epoch){data=next;stamp=Date.now();}}catch(e){if(ticket===epoch)error=e.message;}finally{if(ticket===epoch){loading=false;repaint();}}}
 const signed=n=>(n>0?'+':'')+n;
 function render(){
  const key=getUser()?.id+'|'+getToday();if(owner!==key){clear();owner=key;}
  if(!loading&&!error&&(!data||Date.now()-stamp>60000))queueMicrotask(load);
  const compared=data?.comparedSites.length||0,changed=data?.options.filter(o=>o.revenueDelta!==0)||[],insight=data?.insight;
  const rate=n=>n===null?'이전 매출 0원 · 증감률 계산 불가':(n>0?'+':'')+n+'%';
  const card=(o,index)=>`<button type="button" data-page="판매 · 취소/환불" data-ui-reveal="shown" style="--reveal-order:${Math.min(Math.max(index-4,0),7)}" class="sales-change-card ${o.revenueDelta>0?'is-up':'is-down'}"><span class="sales-change-card-top"><span class="sales-change-rank">${String(index+1).padStart(2,'0')}</span><span class="sales-change-direction">${o.revenueDelta>0?'매출 증가 ↗':'매출 감소 ↘'}</span></span><span class="sales-change-product">${esc(o.label)}</span><strong>${signedMoney(o.revenueDelta)}</strong><span class="sales-change-rate">${rate(o.percent)}</span><span class="sales-change-values"><span>2일 전<b>${money(o.previousRevenue)}</b></span><span aria-hidden="true">→</span><span>1일 전<b>${money(o.currentRevenue)}</b></span></span><small>판매 ${o.previous}개 → ${o.current}개 · ${signed(o.delta)}개</small><span class="sales-change-open">판매 내역 확인 <span aria-hidden="true">↗</span></span></button>`;
  const highlights=changed.length?`<div class="sales-change-highlights">${changed.slice(0,4).map(card).join('')}</div>${changed.length>4?`<div id="sales-changes-more" class="sales-change-remainder ${expanded?'is-expanded':''}" ${expanded?'':'inert'}><div class="sales-change-remainder-inner"><div class="sales-change-highlights">${changed.slice(4).map((o,i)=>card(o,i+4)).join('')}</div></div></div><button type="button" class="sales-changes-expand" data-sales-changes-expand aria-expanded="${expanded}" aria-controls="sales-changes-more"><span data-sales-expand-label>${expanded?'TOP 4만 보기':`나머지 ${changed.length-4}개 변화 펼쳐보기`}</span><span class="sales-expand-chevron" aria-hidden="true">⌄</span></button>`:''}`:'<p class="sales-changes-quiet">두 날짜의 옵션별 매출이 같습니다.</p>';
  return `<section class="panel sales-changes-panel" id="home-sales-changes"><div class="panel-head"><h2>판매량 분석</h2><button type="button" data-sales-changes-reload ${loading?'disabled':''}>새로고침</button></div>${error?`<p class="form-error">${esc(error)}</p>`:!data?'<p class="empty" role="status">1일 전과 2일 전의 매출을 비교하고 있어요.</p>':`<div class="sales-changes-body"><p class="sales-changes-dates">2일 전 ${esc(data.previousDay)} → 1일 전 ${esc(data.currentDay)} · 매출 기준</p>${!compared?'<p class="empty">두 날짜에 모두 입력된 사이트가 없습니다. 판매 · 취소/환불에서 두 날짜의 수량을 저장해 주세요.</p>':`<div class="sales-changes-summary"><span>2일 전 매출 <b>${money(data.previousRevenue)}</b></span><span>1일 전 매출 <b>${money(data.currentRevenue)}</b></span><span class="${data.revenueDelta<0?'sales-change-down':'sales-change-up'}">${signedMoney(data.revenueDelta)} (${rate(data.revenuePercent)})</span><small>수량 ${data.previousTotal}개 → ${data.currentTotal}개</small></div>${insight?`<article class="sales-insight"><h3>자동 분석 요약 · ${esc(insight.title)}</h3><p>${esc(insight.summary)}</p>${insight.drivers.length?`<h4>매출 변화 주요 상품</h4><ul>${insight.drivers.map(v=>`<li>${esc(v)}</li>`).join('')}</ul>`:''}<h4>우선 점검할 사항</h4><ul>${insight.actions.map(v=>`<li>${esc(v)}</li>`).join('')}</ul><p class="privacy">판매 데이터 기반 자동 계산 요약입니다. 광고 ROAS·유입·채널 재고 데이터는 연결되지 않아 감소 원인이나 품절 여부를 확정할 수 없습니다.</p></article>`:''}<div class="sales-change-feature-head"><div><span class="sales-change-eyebrow">REVENUE MOVEMENT</span><h3>주목할 변화 <span class="sales-top-badge">TOP ${Math.min(4,changed.length)}</span></h3></div><span>매출 변동액이 큰 순서 · ${changed.length}개 옵션</span></div>${highlights}<details class="sales-change-details"><summary>전체 옵션별 비교 보기</summary><div class="table-wrap"><table><thead><tr><th>상품 옵션</th><th>2일 전 매출</th><th>1일 전 매출</th><th>매출 증감</th><th>증감률</th><th>판매 수량</th></tr></thead><tbody>${data.options.map(o=>`<tr><td>${esc(o.label)}</td><td>${money(o.previousRevenue)}</td><td>${money(o.currentRevenue)}</td><td class="${o.revenueDelta<0?'sales-change-down':o.revenueDelta>0?'sales-change-up':''}">${signedMoney(o.revenueDelta)}</td><td>${rate(o.percent)}</td><td>${o.previous}개 → ${o.current}개</td></tr>`).join('')}</tbody></table></div></details>`}<p class="privacy">두 날짜 모두 저장된 ${compared}/${data.expectedSites}개 공통 사이트 · 한국 날짜 기준. 매출은 상품 고정 단가 × 판매 수량으로 계산하며 취소·환불, 할인·배송비·수수료는 반영하지 않습니다. 미입력 사이트는 0원으로 간주하지 않습니다.</p></div>`}</section>`;
 }
 document.addEventListener('click',e=>{
  if(e.target.closest('[data-sales-changes-reload]'))load();
  const button=e.target.closest('[data-sales-changes-expand]');if(!button)return;
  const region=document.querySelector('#sales-changes-more');if(!region)return;
  expanded=!expanded;button.setAttribute('aria-expanded',String(expanded));
  region.inert=!expanded;region.classList.toggle('is-expanded',expanded);
  const count=data.options.filter(o=>o.revenueDelta!==0).length-4;
  button.querySelector('[data-sales-expand-label]').textContent=expanded?'TOP 4만 보기':`나머지 ${count}개 변화 펼쳐보기`;
 });
 function clear(){epoch++;data=null;error='';loading=false;owner='';stamp=0;expanded=false;}
 return {render,clear,invalidate(){epoch++;data=null;error='';loading=false;stamp=0;}};
}
