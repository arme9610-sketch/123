export function createSalesDashboard({api,escape:esc,getUser,getToday}){
 let data=null,error='',loading=false,key='',stamp=0,request=0;
 function repaint(){const root=document.querySelector('#sales-dashboard');if(root)root.outerHTML=render();}
 async function load(){if(loading)return;const ticket=++request,user=getUser()?.id;loading=true;error='';try{const next=await api('/api/daily-sales/summary');if(ticket!==request||user!==getUser()?.id)return;data=next;stamp=Date.now();}catch(e){if(ticket===request)error=e.message;}finally{if(ticket===request){loading=false;repaint();}}}
 function card(p){
  const title=p.days===1?'어제':p.days===7?'최근 7일 평균':'최근 30일 평균',rate=p.rate===null?'—':p.rate+'%',fill=p.rate===null?0:Math.min(100,Math.max(0,p.rate));
  const sold=p.enteredDays===0?null:p.days===1?p.sold:p.averageSold,refund=p.enteredDays===0?null:p.days===1?p.cancelled:p.averageCancelled,unit=p.days===1?'개':'개 / 일';
  return `<article class="sales-overview-card"><div class="sales-overview-text"><h3>${title}</h3><p>${esc(p.days===1?p.end:p.start+' ~ '+p.end)}</p><dl><div><dt>판매${p.days>1?' 일평균':''}</dt><dd>${sold===null?'—':sold}<small>${unit}</small></dd></div><div><dt>취소·환불${p.days>1?' 일평균':''}</dt><dd>${refund===null?'—':refund}<small>${unit}</small></dd></div></dl></div><div class="sales-donut"><svg viewBox="0 0 120 120" role="img" aria-label="${esc(title)} 취소·환불률 ${rate}"><circle class="sales-donut-base" cx="60" cy="60" r="48"/><circle class="sales-donut-value" cx="60" cy="60" r="48" pathLength="100" stroke-opacity="${fill>0?1:0}" stroke-dasharray="${fill} 100" transform="rotate(-90 60 60)"/></svg><div><b>${rate}</b><span>취소·환불률</span></div></div><p class="sales-overview-coverage">${p.enteredDays===0?'입력된 기록이 없습니다.':`${p.enteredDays}/${p.days}일 입력 · 사이트 입력 ${p.enteredSites}/${p.expectedSites}건`}${p.rate>100?' · 과거 주문 환불 포함':''}</p>${p.days>1&&p.enteredDays>0?`<p class="sales-overview-total">기간 합계 · 판매 ${p.sold}개 / 취소·환불 ${p.cancelled}개</p>`:''}</article>`;
 }
 function render(){
  const next=(getUser()?.id||'')+'|'+getToday();if(key!==next){key=next;request++;data=null;error='';loading=false;stamp=0;}
  if(!loading&&!error&&(!data||Date.now()-stamp>60000))queueMicrotask(load);
  return `<section id="sales-dashboard" class="panel sales-dashboard"><div class="panel-head"><h2>판매 · 환불 한눈에</h2><div><button type="button" id="sales-dashboard-reload" ${loading?'disabled':''}>새로고침</button><button type="button" data-page="판매 · 취소/환불">입력 내역 보기 →</button></div></div>${error?`<p class="form-error">${esc(error)}</p>`:data?`<div class="sales-overview-grid">${data.periods.map(card).join('')}</div><p class="sales-overview-note">판매 · 취소/환불의 저장된 기록 기준입니다. 주간·월간 일평균은 입력된 날짜만 계산하며, 환불률은 기간 전체 취소·환불 ÷ 전체 판매입니다. 미입력 사이트가 있으면 집계가 불완전할 수 있습니다.</p>`:'<p class="empty">판매 현황을 불러오는 중…</p>'}</section>`;
 }
 document.addEventListener('click',e=>{if(e.target.closest('#sales-dashboard-reload'))load();});
 return {render,invalidate(){stamp=0;error='';},clear(){request++;key='';data=null;error='';loading=false;stamp=0;}};
}
