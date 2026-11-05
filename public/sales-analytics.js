import {salesShares,shareLabel,salesShareDonut,bindSalesShareTooltip} from './sales-share.js';
const money=n=>n===null?'—':Math.round(n).toLocaleString('ko-KR')+'원';
const quantity=n=>n===null?'—':n.toLocaleString('ko-KR',{maximumFractionDigits:1});
export function createSalesAnalytics({api,escape:esc,getUser}){
 bindSalesShareTooltip(document);
 let data=null,error='',loading=false,request=0,owner='',stamp=0,period=1,expanded=false;
 function repaint(){const root=document.querySelector('#sales-analytics');if(root)root.outerHTML=render();}
 async function load(){if(loading)return;const ticket=++request,user=getUser()?.id;loading=true;error='';try{const result=await api('/api/daily-sales/summary');if(ticket!==request||user!==getUser()?.id)return;data=result;stamp=Date.now();}catch(e){if(ticket===request)error=e.message;}finally{if(ticket===request){loading=false;repaint();}}}
 function render(){
  const key=getUser()?.id+'|'+new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Seoul'}).format(new Date());
  if(owner!==key){clear();owner=key;}
  if(!loading&&!error&&(!data||Date.now()-stamp>60000))queueMicrotask(load);
  const periods=data?.periods||[],selected=periods.find(p=>p.days===period);
  const titles={1:'어제',7:'최근 7일',30:'최근 30일'};
  function overview(p){
   const missing=!p.enteredDays;
   return `<article class="revenue-card"><h3>${titles[p.days]}</h3><p class="privacy">${p.start} ~ ${p.end}</p><dl class="sales-kpis"><div><dt>총 판매 건수 <small>(상품 수량)</small></dt><dd>${missing?'—':quantity(p.sold)+'<small>개</small>'}</dd></div><div><dt>총 매출</dt><dd>${missing?'—':money(p.revenue)}</dd></div></dl>${p.days>1?`<p class="sales-daily-average">일평균 <b>${quantity(p.averageSold)}개</b> · <b>${money(p.averageRevenue)}</b></p>`:''}<details class="sales-refund-details"><summary>취소·환불 및 차감 후 금액</summary><dl class="revenue-details"><div><dt>취소·환불 수량</dt><dd>${missing?'—':quantity(p.cancelled)+'개'}</dd></div><div><dt>취소·환불 차감액</dt><dd>${missing?'—':money(p.refundAmount)}</dd></div><div><dt>차감 후 금액</dt><dd>${missing?'—':money(p.netRevenue)}</dd></div></dl></details><p class="privacy">${p.enteredDays}/${p.days}일 입력 · 사이트 ${p.enteredSites}/${p.expectedSites}건</p></article>`;
  }
  function rankings(p){
   const shares=salesShares(p.optionRankings),rows=shares.rows,visible=expanded?rows:rows.filter((o,i)=>i<5||o.rank===rows[4]?.rank);
   return `<div class="sales-ranking-head"><div><h3>옵션별 판매 비중 · 순위</h3><p class="privacy">${titles[p.days]} · 전체 판매 수량 대비 비중 · 동률은 공동 순위</p></div><div class="sales-period-tabs" role="group" aria-label="순위 집계 기간">${periods.map(v=>`<button type="button" data-revenue-period="${v.days}" aria-pressed="${period===v.days}" class="${period===v.days?'selected':''}">${titles[v.days]}</button>`).join('')}</div></div>${!p.enteredDays?'<p class="empty">입력된 기록이 없습니다.</p>':!rows.length?'<p class="empty">저장된 판매 수량이 0개입니다.</p>':`<div class="sales-share-layout">${salesShareDonut(shares,esc)}<div class="sales-share-legend"><p class="privacy">원 전체 = ${quantity(shares.total)}개 (100%) · 모든 판매 옵션 포함</p><ol class="sales-rank-list">${visible.map(o=>`<li class="sales-rank-row sales-share-row"><span class="sales-rank-number ${o.rank<=3?'sales-rank-top':''}">${o.rank}<small>위</small></span><div class="sales-rank-product"><b><svg class="sales-share-key" viewBox="0 0 12 12" aria-hidden="true"><circle cx="6" cy="6" r="5" fill="${o.color}"/></svg>${esc(o.label)}</b><small>판매 ${quantity(o.sold)}개 · ${money(o.revenue)}</small></div><strong class="sales-rank-value">${shareLabel(o.share)}</strong></li>`).join('')}</ol>${rows.length>visible.length||expanded?`<button type="button" data-revenue-expand class="sales-rank-expand" aria-expanded="${expanded}">${expanded?'상위 5개만 보기':'전체 '+rows.length+'개 옵션 보기'}</button>`:''}</div></div>`}`;
  }
  return `<section id="sales-analytics" class="panel sales-panel"><div class="panel-head"><h2>판매 · 매출 한눈에</h2><button type="button" data-revenue-reload ${loading?'disabled':''}>새로고침</button></div><p class="privacy">전체 판매 사이트 합산 · 한국 날짜 기준 어제까지 · 저장된 수량 기준</p>${error?`<p class="form-error" role="alert">${esc(error)}</p>`:''}${data?`<div class="revenue-grid">${periods.map(overview).join('')}</div>${selected?`<div class="sales-rankings">${rankings(selected)}</div>`:''}<details class="sales-calculation-note"><summary>매출·평균 계산 기준</summary><p class="privacy">총 판매 건수는 주문 수가 아닌 상품 판매 수량입니다. 매출은 색상별 동일 고정 단가 × 판매 수량이며 할인·배송비·수수료는 제외합니다. 7일·30일 일평균은 입력된 날짜 수로 나눕니다. 미입력을 0으로 취급하지 않으며 일부 사이트가 미입력이면 합계가 불완전할 수 있습니다. 원형 그래프의 각 조각은 옵션 판매 수량 ÷ 전체 판매 수량의 비율입니다. 순위는 색상을 포함한 옵션별 판매 수량 기준이며 판매 0개는 제외합니다. 7일·30일 그래프도 기간 전체 판매 수량의 비중입니다. 과거 주문의 취소·환불 처리로 차감 후 금액이 음수일 수 있습니다.</p></details>`:!error?'<p role="status">매출을 불러오는 중…</p>':''}</section>`;
 }
 function clear(){request++;data=null;error='';loading=false;stamp=0;owner='';period=1;expanded=false;}
 document.addEventListener('click',e=>{if(e.target.closest('[data-revenue-reload]'))load();const tab=e.target.closest('[data-revenue-period]');if(tab){period=Number(tab.dataset.revenuePeriod);expanded=false;repaint();document.querySelector(`[data-revenue-period="${period}"]`)?.focus({preventScroll:true});}if(e.target.closest('[data-revenue-expand]')){expanded=!expanded;repaint();document.querySelector('[data-revenue-expand]')?.focus({preventScroll:true});}});
 return {render,clear,invalidate(){stamp=0;error='';if(document.querySelector('#sales-analytics'))load();}};
}
