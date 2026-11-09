import {createSalesAnalytics} from './sales-analytics.js';
import {mergeSalesQuantities} from './sales-csv.js';
import {createSalesImport} from './sales-import.js';
import {officeCatalog} from './office-catalog.js';
import {combineSalesEntry,salesTotals,rateLabel} from './sales-math.js';
const groups=[['에센셜','에센셜'],['카빈','카빈'],['파우치세트','파우치(단일)'],['메트론','메트론']];
export function createDailySales({api,escape:esc,toast,getUser}){
 const analytics=createSalesAnalytics({api,escape:esc,getUser});
 const today=()=>new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Seoul'}).format(new Date());
 let day=today(),site='',group='에센셜',data=null,error='',loading=false,owner='',epoch=0,busy=false;let importer=null;const drafts=new Map();
 const leaveDialog=document.createElement('dialog');leaveDialog.setAttribute('aria-label','판매 수량 저장 확인');document.body.append(leaveDialog);
 let resolveLeave=null;
 const dirtyKeys=()=>[...drafts].filter(([,d])=>d.dirty).map(([k])=>k);
 function finishLeave(choice){const resolve=resolveLeave;resolveLeave=null;leaveDialog.close();resolve?.(choice);}
 leaveDialog.addEventListener('click',e=>{const button=e.target.closest('[data-sales-leave]');if(button)finishLeave(button.dataset.salesLeave);});
 leaveDialog.addEventListener('cancel',e=>{e.preventDefault();finishLeave('stay');});
 leaveDialog.addEventListener('close',()=>{if(!leaveDialog.open&&resolveLeave)finishLeave('stay');});
 async function saveDrafts(keys){
  if(busy)return false;
  const pending=keys.map(k=>({key:k,d:drafts.get(k)})).filter(({d})=>d);
  if(pending.some(({d})=>d.entries.some(e=>!Number.isSafeInteger(e.sold)||e.sold<0||e.sold>1000000||!Number.isSafeInteger(e.cancelled)||e.cancelled<0||e.cancelled>2000000))){error='수량을 허용 범위의 정수로 입력해 주세요.';repaint();return false;}
  const user=getUser()?.id,generation=epoch;busy=true;error='';repaint();
  try{
   for(const {key:k,d} of pending){
    const [date,siteId]=k.split('|');
    const result=await api('/api/daily-sales',{method:'PUT',body:{day:date,siteId,version:d.version,entries:d.entries}});
    if(getUser()?.id!==user||generation!==epoch)return false;
    drafts.delete(k);if(date===day&&data)data.records=data.records.filter(r=>r.site_id!==siteId).concat(result.record);
   }
   toast('전체 상품 수량을 저장했어요.');analytics.invalidate();return true;
  }catch(e){if(getUser()?.id===user&&generation===epoch)error=e.message;return false;}
  finally{if(getUser()?.id===user&&generation===epoch){busy=false;repaint();}}
 }
 async function beforeLeave(){
  if(busy){toast('수량을 저장 중입니다. 잠시 기다려 주세요.');return false;}
  const keys=dirtyKeys();if(!keys.length)return true;if(resolveLeave)return false;
  leaveDialog.innerHTML=`<div class="dialog-title"><h2>변경한 수량을 저장할까요?</h2></div><p>저장하지 않은 판매·취소/환불 수량이 있습니다.</p><div class="sales-import-actions"><button type="button" class="primary" data-sales-leave="save">저장 후 이동</button><button type="button" data-sales-leave="discard">저장하지 않고 이동</button><button type="button" data-sales-leave="stay" autofocus>계속 작성</button></div>`;
  const choice=await new Promise(resolve=>{resolveLeave=resolve;leaveDialog.showModal();});
  if(choice==='save')return saveDrafts(keys);
  if(choice==='discard'){for(const k of keys)drafts.delete(k);return true;}
  return false;
 }
 const key=()=>day+'|'+site;
 const record=()=>data?.records.find(r=>r.site_id===site);
 function draft(){if(!drafts.has(key()))drafts.set(key(),{entries:officeCatalog.map(s=>combineSalesEntry(record()?.entries.find(e=>e.sku===s.id)||{sku:s.id,sold:0,cancelled:0,refunded:0})),version:record()?.version||0,dirty:false});return drafts.get(key());}
 function repaint(){const root=document.querySelector('#daily-sales-root');if(root)root.outerHTML=render();}
 async function load(){const request=++epoch,user=getUser()?.id,date=day;loading=true;error='';try{const next=await api('/api/daily-sales?day='+date);if(request!==epoch||getUser()?.id!==user)return;data=next;if(!next.sites.some(s=>s.id===site))site=next.sites[0]?.id||'';for(const s of next.sites){const k=date+'|'+s.id;if(!drafts.get(k)?.dirty)drafts.delete(k);}}catch(e){if(request===epoch)error=e.message;}finally{if(request===epoch){loading=false;repaint();}}}
 function summary(t){return `<span>판매 <b>${t.sold}</b>개</span><span>취소·환불 <b>${t.cancelled}</b>개</span><span class="sales-rate">취소·환불률 <b>${rateLabel(t.sold,t.cancelled)}</b></span>`;}
 function cells(t){return `<td>${t.sold}</td><td>${t.cancelled}</td><td><b>${rateLabel(t.sold,t.cancelled)}</b></td>`;}
 function groupTotals(d){return salesTotals(d.entries.filter(e=>officeCatalog.find(s=>s.id===e.sku).model===group));}
 function render(){
  if(owner!==getUser()?.id){importer?.clear();owner=getUser()?.id;data=null;site='';group='에센셜';day=today();drafts.clear();epoch++;loading=false;}
  if(!data&&!loading&&!error)queueMicrotask(load);
  const d=site&&data?draft():null,r=record();
  return `<div id="daily-sales-root"><div class="heading"><div><p class="eyebrow">DAILY SALES</p><h1>판매 · 취소/환불</h1><p class="subtitle">상품별로 판매와 취소·환불 수량을 입력하세요. 취소·환불률은 판매 수량 대비 비율입니다.</p></div></div>
  ${analytics.render()}
  <section class="panel sales-panel"><div class="office-stock-filters"><label>기준 날짜<input id="sales-day" type="date" value="${day}" ${busy?'disabled':''}></label><button type="button" id="sales-today" ${busy?'disabled':''}>오늘</button><label>판매 사이트<select id="sales-site" ${busy?'disabled':''}>${(data?.sites||[]).map(s=>`<option value="${esc(s.id)}" ${s.id===site?'selected':''}>${esc(s.name)}</option>`).join('')}</select></label><button type="button" id="sales-reload" ${busy?'disabled':''}>최신 기록 확인</button><button type="button" id="sales-discard" ${busy?'disabled':''}>입력 버리고 불러오기</button></div>
  <p class="privacy">취소와 환불은 구분 없이 한 칸에 합산하세요. 취소·환불률 = 취소·환불 ÷ 판매 × 100 (판매 100개, 취소·환불 10개 → 10%). 판매가 0이면 —로 표시합니다.</p>
  <p role="alert" class="form-error">${esc(error)}</p>${loading?'<p role="status">기록을 불러오는 중…</p>':''}
  ${d?`<form id="sales-entry-form"><div class="sales-entry-toolbar"><div class="tabs sales-group-tabs" role="group" aria-label="상품 선택">${groups.map(([model,label])=>`<button type="button" data-sales-group="${model}" aria-pressed="${group===model}" class="${group===model?'selected':''}" ${busy?'disabled':''}>${label}</button>`).join('')}</div><div class="sales-entry-actions"><button type="button" id="sales-import-open" ${busy?'disabled':''}>카페24 엑셀 가져오기</button><input type="file" id="sales-csv-file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,.csv,text/csv" hidden><button class="primary" ${busy?'disabled':''}>${busy?'저장 중…':'전체 상품 저장'}</button></div></div>
  <div class="sales-group-summary" aria-live="polite">${summary(groupTotals(d))}</div>
  <div class="table-wrap sales-entry-scroll"><table class="sales-table"><thead><tr><th>상품 옵션</th><th>판매 수량</th><th>취소·환불 수량</th><th>취소·환불률</th></tr></thead><tbody>${officeCatalog.map((s,i)=>{if(s.model!==group)return '';const e=d.entries[i];return `<tr><th scope="row">${esc(s.model==='파우치세트'?'파우치(단일)':s.size+' '+s.color)}</th>${['sold','cancelled'].map((k,j)=>`<td><input type="number" min="0" max="${j?2000000:1000000}" step="1" inputmode="numeric" data-sales-index="${i}" data-sales-field="${k}" name="${s.id}-${k}" value="${e[k]||''}" placeholder="0" aria-label="${esc(s.label)} ${j?'취소·환불':'판매'} 수량" ${busy?'disabled':''}></td>`).join('')}<td data-sales-rate="${i}">${rateLabel(e.sold,e.cancelled)}</td></tr>`;}).join('')}</tbody></table></div>
  <div class="sales-total-line"><span>선택 사이트 · 전체 상품 합계</span><div class="sales-summary" aria-live="polite">${summary(salesTotals(d.entries))}</div></div>
  <p id="sales-save-status" role="status">${d.dirty?'저장하지 않은 입력이 있습니다.':r?`${esc(r.author)} · ${esc(new Date(r.updated_at).toLocaleString('ko-KR',{timeZone:'Asia/Seoul'}))} 저장`:'미입력 · 수량을 확인하고 저장하세요.'}</p>
  <p class="privacy">판매처 1곳의 변경을 저장하면 옵션 수와 관계없이 1 XP를 받습니다. 다른 상품 탭의 입력도 함께 저장됩니다. 빈칸은 0개입니다. 과거 주문의 취소·환불이 포함되면 비율이 100%를 넘을 수 있습니다. 사무실 재고는 바뀌지 않습니다.</p></form>`:!loading?'<div class="empty">날짜와 사이트를 선택해 주세요.</div>':''}</section>
  ${data?`<section class="panel sales-panel"><div class="panel-head"><h2>${day} 사이트별 저장 현황</h2></div><div class="table-wrap"><table><thead><tr><th>사이트</th><th>입력 상태</th><th>판매</th><th>취소·환불</th><th>취소·환불률</th></tr></thead><tbody>${data.sites.map(s=>{const r=data.records.find(r=>r.site_id===s.id);return `<tr><th>${esc(s.name)}</th><td>${r?'입력 완료':'미입력'}</td>${cells(salesTotals(r?.entries||[]))}</tr>`;}).join('')}</tbody><tfoot><tr><th>전체 합계</th><td>${data.records.length} / 4 사이트</td>${cells(salesTotals(data.records.flatMap(r=>r.entries)))}</tr></tfoot></table></div><p class="privacy">저장된 수량 기준입니다. 전체 비율은 전체 취소·환불 ÷ 전체 판매로 계산합니다.</p></section>`:''}</div>`;
 }
 document.addEventListener('input',e=>{
  const el=e.target;if(!el.matches('[data-sales-field]'))return;
  const d=draft(),i=Number(el.dataset.salesIndex);d.entries[i][el.dataset.salesField]=el.value===''?0:Number(el.value);d.dirty=true;
  const v=d.entries[i];document.querySelector(`[data-sales-rate="${i}"]`).textContent=rateLabel(v.sold,v.cancelled);
  document.querySelector('.sales-group-summary').innerHTML=summary(groupTotals(d));document.querySelector('.sales-summary').innerHTML=summary(salesTotals(d.entries));document.querySelector('#sales-save-status').textContent='저장하지 않은 입력이 있습니다.';
 });
 document.addEventListener('change',async e=>{if(busy)return;
  if(e.target.id==='sales-csv-file'){
   const file=e.target.files?.[0];e.target.value='';if(!file||!data||!site)return;
   const d=draft(),target={day,siteId:site,siteName:data.sites.find(s=>s.id===site)?.name,userId:getUser()?.id,version:d.version,signature:JSON.stringify(d.entries)};
   importer??=createSalesImport({escape:esc,toast,onApply:(target,entries)=>{
    if(target.userId!==getUser()?.id||target.day!==day||target.siteId!==site||!document.querySelector('#daily-sales-root'))throw new Error('대상 날짜·사이트를 다시 선택하고 파일을 가져와 주세요.');
    const current=draft();if(current.version!==target.version||JSON.stringify(current.entries)!==target.signature)throw new Error('파일을 읽는 동안 입력 또는 저장된 기록이 바뀌었습니다. 파일을 다시 가져와 주세요.');
    current.entries=mergeSalesQuantities(current.entries,entries);current.dirty=true;repaint();
   }});
   importer.open(file,target);return;
  }
  if(e.target.id==='sales-day'&&e.target.value){const next=e.target.value;if(next!==day&&await beforeLeave()){day=next;data=null;error='';}repaint();}if(e.target.id==='sales-site'){const next=e.target.value;if(next!==site&&await beforeLeave())site=next;repaint();}});
 document.addEventListener('click',async e=>{
  if(busy)return;
  if(e.target.closest('#sales-import-open'))document.querySelector('#sales-csv-file')?.click();
  const tab=e.target.closest('[data-sales-group]');if(tab){group=tab.dataset.salesGroup;repaint();document.querySelector(`[data-sales-group="${group}"]`)?.focus({preventScroll:true});}
  if(e.target.closest('#sales-today')&&day!==today()&&await beforeLeave()){day=today();data=null;error='';repaint();}
  if(e.target.closest('#sales-reload')){load();analytics.invalidate();}
  if(e.target.closest('#sales-discard')&&confirm('선택한 날짜·사이트의 저장하지 않은 입력을 버리고 최신 기록을 불러올까요?')){drafts.delete(key());load();}
 });
 document.addEventListener('submit',async e=>{
  if(e.target.id!=='sales-entry-form')return;e.preventDefault();if(busy)return;
  await saveDrafts([key()]);
 });
 window.addEventListener('beforeunload',e=>{if([...drafts.values()].some(d=>d.dirty)){e.preventDefault();e.returnValue='';}});
 return {render,beforeLeave,clear(){finishLeave('stay');analytics.clear();importer?.clear();epoch++;drafts.clear();data=null;error='';loading=false;owner='';site='';busy=false;}};
}
