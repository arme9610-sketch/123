const money=n=>n===null?'—':Math.round(n).toLocaleString('ko-KR')+'원';
const quantity=n=>n===null?'—':n.toLocaleString('ko-KR',{maximumFractionDigits:1});
export function createSalesAnalytics({api,escape:esc,getUser}){
 let data=null,error='',loading=false,request=0,owner='',stamp=0;
 function repaint(){const root=document.querySelector('#sales-analytics');if(root)root.outerHTML=render();}
 async function load(){if(loading)return;const ticket=++request,user=getUser()?.id;loading=true;error='';try{const result=await api('/api/daily-sales/summary');if(ticket!==request||user!==getUser()?.id)return;data=result;stamp=Date.now();}catch(e){if(ticket===request)error=e.message;}finally{if(ticket===request){loading=false;repaint();}}}
 function render(){
  const key=getUser()?.id+'|'+new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Seoul'}).format(new Date());
  if(owner!==key){clear();owner=key;}
  if(!loading&&!error&&(!data||Date.now()-stamp>60000))queueMicrotask(load);
  const max=Math.max(1,...(data?.periods||[]).map(p=>p.averageRevenue||0));
  return `<section id="sales-analytics" class="panel sales-panel"><div class="panel-head"><h2>매출 · 옵션별 판매 순위</h2><button type="button" data-revenue-reload ${loading?'disabled':''}>새로고침</button></div><p class="privacy">전체 판매 사이트 합산 · 한국 날짜 기준 어제까지 · 색상별 동일 단가 적용 · 고정 단가 × 판매 수량. 할인·배송비·수수료를 반영한 실제 정산액과는 차이가 있습니다.</p>${error?`<p class="form-error" role="alert">${esc(error)}</p>`:''}${data?`<div class="revenue-grid">${data.periods.map(p=>{
   const title=p.days===1?'어제 매출':`최근 ${p.days}일 일평균`,value=p.averageRevenue;
   const top=Math.max(1,...p.optionRankings.map(o=>o.averageRevenue||0));
   return `<article class="revenue-card"><h3>${title}</h3><p class="privacy">${p.start} ~ ${p.end}</p><strong class="revenue-amount">${money(value)}</strong><div class="revenue-track" role="img" aria-label="${title} ${money(value)}"><span style="width:${(value||0)/max*100}%"></span></div><dl class="revenue-details"><div><dt>취소·환불 차감액</dt><dd>${money(p.averageRefundAmount)}</dd></div><div><dt>차감 후 금액</dt><dd>${money(p.averageNetRevenue)}</dd></div></dl><p class="privacy">${p.enteredDays}/${p.days}일 입력 · 사이트 ${p.enteredSites}/${p.expectedSites}건${p.days>1?`<br>기간 매출 합계 ${money(p.revenue)}`:''}</p><h4>색상·옵션별 매출 순위</h4>${p.enteredDays?p.optionRankings.map(o=>`<div class="revenue-ranking"><div><b>${o.rank===null?'—':o.rank+'위'} · ${esc(o.label)}</b><span>${money(o.averageRevenue)}${p.days>1?' / 일':''}</span></div><div class="revenue-track"><span style="width:${(o.averageRevenue||0)/top*100}%"></span></div><small>단가 ${money(o.price)} · 판매 ${quantity(o.averageSold)}개${p.days>1?' / 일':''}</small></div>`).join(''):'<p class="empty">입력된 기록이 없습니다.</p>'}</article>`;
  }).join('')}</div><p class="privacy">7일·30일 평균은 입력된 날짜 수로 나눕니다. 미입력은 0으로 취급하지 않으며 일부 사이트 미입력 시 집계가 불완전할 수 있습니다. 순위는 색상을 포함한 옵션별 매출 기준이며 동률은 공동 순위, 판매 0개는 순위 없음입니다. 취소·환불 차감액은 처리일 수량에 같은 단가를 적용하므로 과거 주문 처리 시 차감 후 금액이 음수일 수 있습니다.</p>`:!error?'<p role="status">매출을 불러오는 중…</p>':''}</section>`;
 }
 function clear(){request++;data=null;error='';loading=false;stamp=0;owner='';}
 document.addEventListener('click',e=>{if(e.target.closest('[data-revenue-reload]'))load();});
 return {render,clear,invalidate(){stamp=0;error='';if(document.querySelector('#sales-analytics'))load();}};
}
