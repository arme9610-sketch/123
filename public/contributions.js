import {contributionTiers} from './contribution-tiers.js';
const dateLabel=at=>new Date(at).toLocaleString('ko-KR',{timeZone:'Asia/Seoul'});
export function createContributions({api,escape:esc,getUser,getToday}){
 let owner='',month='',userId='',epoch=0;
 const dialog=document.createElement('dialog');dialog.className='contribution-manual-dialog';dialog.setAttribute('aria-label','업무기록하고 경험치 받기');document.body.append(dialog);
 let manualRequest='',manualBusy=false;
 const cache=new Map(),loading=new Set(),errors=new Map();
 const currentMonth=()=>getToday().slice(0,7),key=(m,u)=>m+'|'+u;
 function sync(){const next=getUser()?.id+'|'+currentMonth();if(owner!==next){clear();owner=next;month=currentMonth();}}
 function repaint(){const page=document.querySelector('#contribution-page');if(page)page.outerHTML=render();}
 async function load(m,u,more=false){
  const k=key(m,u);if(loading.has(k))return;
  const generation=epoch,offset=more?cache.get(k)?.nextOffset:0;if(offset===null)return;
  loading.add(k);errors.delete(k);
  try{
   const next=await api('/api/contributions?'+new URLSearchParams({month:m,userId:u,offset:String(offset||0)}));
   if(generation!==epoch)return;
   if(more)next.logs=[...cache.get(k).logs,...next.logs];cache.set(k,{...next,stamp:Date.now()});
  }catch(error){if(generation===epoch)errors.set(k,error.message);}
  finally{if(generation===epoch){loading.delete(k);repaint();}}
 }
 function ensure(m,u){const k=key(m,u),data=cache.get(k);if(!loading.has(k)&&!errors.has(k)&&(!data||Date.now()-data.stamp>60000))queueMicrotask(()=>load(m,u));return data;}
 function render(){
  sync();const data=ensure(month,userId),k=key(month,userId),error=errors.get(k),busy=loading.has(k);
  return `<div id="contribution-page"><div class="heading"><div><p class="eyebrow">TEAM CONTRIBUTION</p><h1>업무 기여도</h1><p class="subtitle">완료한 업무와 재고·판매 수정을 경험치로 기록합니다. 한국 시간 기준 매월 1일 새로 시작합니다.</p></div></div><section class="panel contribution-panel"><div class="contribution-toolbar"><label>조회 월<input type="month" id="contribution-month" value="${month}" min="2000-01" max="${currentMonth()}"></label><button type="button" class="primary" data-contribution-add>업무기록하고 경험치 받기</button><button type="button" data-contribution-reload ${busy?'disabled':''}>새로고침</button></div>${error?`<p role="alert" class="form-error">${esc(error)}</p>`:''}${!data?'<p role="status">기여도를 불러오는 중…</p>':`<div class="contribution-members">${data.members.map(u=>`<article class="contribution-member ${u.id===getUser()?.id?'contribution-me':''}"><div class="contribution-member-head"><h2>${esc(u.name)}${u.id===getUser()?.id?'<small>나</small>':''}</h2><span>${u.rank?u.rank+'위':'—'}</span></div><div class="contribution-tier-row"><img class="contribution-medal" src="/tiers/${u.tier}.svg" alt="${esc(u.tierName)} 티어 메달" width="88" height="104"><div><span class="contribution-tier-name tier-${u.tier}">${esc(u.tierName)}</span><p class="contribution-level">Lv.${u.level}</p></div></div><p class="contribution-activity-counts">업무 완료 <b>${u.completed}건</b> · 재고 수정 <b>${u.stockEdits}건</b> · 판매 수정 <b>${u.salesEdits}건</b> · 직접 등록 <b>${u.manual}건</b></p><p>이달의 경험치 <b>${u.xp} XP</b></p>${u.required===null?'<p class="contribution-max">최고 레벨을 달성했어요.</p>':`<progress value="${u.progress}" max="${u.required}" aria-label="${esc(u.name)} 다음 레벨 경험치 ${u.progress}/${u.required}"></progress><p class="privacy">${u.progress} / ${u.required} XP · Lv.${u.level+1}까지 ${u.remaining} XP 남음</p>`}${u.nextTier?`<p class="contribution-next-tier">다음 단계 <b>${esc(u.nextTier.name)}</b>까지 <b>${u.nextTier.remaining} XP</b></p>`:'<p class="contribution-next-tier">최고 단계 <b>신</b> 달성</p>'}</article>`).join('')}</div><div class="contribution-tier-guide" aria-label="티어별 레벨 안내">${contributionTiers.map(tier=>`<div><img src="/tiers/${tier.id}.svg" alt="" width="48" height="56"><b>${tier.name}</b><span>Lv.${tier.min}–${tier.max}</span><small>레벨당 ${tier.required} XP</small></div>`).join('')}</div><section class="contribution-log-section"><div class="contribution-log-head"><h2>경험치 획득 로그</h2><label>사용자<select id="contribution-user"><option value="">전체 사용자</option>${data.members.map(u=>`<option value="${esc(u.id)}" ${userId===u.id?'selected':''}>${esc(u.name)}</option>`).join('')}</select></label></div><p class="privacy">${data.total}개 기록 · 완료·저장·등록한 시각 기준 · 기존 업무는 완료 시각이 남아 있는 기록을 포함합니다.</p><div class="contribution-log-list">${data.logs.length?data.logs.map(log=>`<article class="contribution-log ${log.reversed_at?'contribution-reversed':''}"><div><b>${esc(log.item_title)}</b><p>${log.item_type==='manual'?'직접 등록':(['stock-edit','sales-edit'].includes(log.item_type)?'수정자':'담당자')} ${esc(log.owner_name)} · ${log.item_type==='manual'?'등록':(['stock-edit','sales-edit'].includes(log.item_type)?'저장':'완료 처리')} ${esc(log.actor_name)}</p><small>${esc(dateLabel(log.completed_at))}${log.reversed_at?' · '+esc(dateLabel(log.reversed_at))+' 완료 취소':''}</small></div><strong>${log.reversed_at?'회수됨':'+'+(log.xp??1)+' XP'}</strong></article>`).join(''):'<p class="empty">이달에 기록된 활동이 없습니다.</p>'}</div>${data.nextOffset!==null?`<button type="button" data-contribution-more ${busy?'disabled':''}>${busy?'불러오는 중…':'기록 더 보기'}</button>`:''}</section>`}</section></div>`;
 }
 document.addEventListener('change',event=>{
  if(event.target.id==='contribution-month'&&event.target.value){month=event.target.value;userId='';repaint();}
  if(event.target.id==='contribution-user'){userId=event.target.value;repaint();}
 });
 document.addEventListener('click',event=>{
  if(event.target.closest('[data-contribution-add]')){
   if(manualBusy)return;
   manualRequest=crypto.randomUUID();
   dialog.innerHTML=`<div class="dialog-title"><h2>업무기록하고 경험치 받기</h2><button type="button" data-contribution-close aria-label="닫기">✕</button></div><form id="contribution-manual-form"><label>어떤 업무를 진행하셨을까요?<textarea name="description" required maxlength="500" placeholder="진행한 업무를 직접 적어 주세요."></textarea></label><p class="privacy">등록하면 본인에게 1 XP가 추가되고, 업무 내용이 공용 로그에 남습니다. 현재 월에 기록됩니다.</p><p class="form-error" role="alert" id="contribution-manual-error"></p><button type="submit" class="primary">업무 등록 · +1 XP</button></form>`;
   dialog.showModal();dialog.querySelector('textarea').focus();
  }
  if(event.target.closest('[data-contribution-close]')&&!manualBusy)dialog.close();
  if(event.target.closest('[data-contribution-reload]'))load(month,userId);
  if(event.target.closest('[data-contribution-more]'))load(month,userId,true);
 });
 dialog.addEventListener('cancel',event=>{if(manualBusy)event.preventDefault();});
 document.addEventListener('submit',async event=>{
  if(event.target.id!=='contribution-manual-form')return;event.preventDefault();if(manualBusy)return;
  const form=event.target,description=form.elements.description.value.trim(),user=getUser()?.id;
  if(!description){dialog.querySelector('#contribution-manual-error').textContent='진행한 업무를 적어 주세요.';return;}
  manualBusy=true;form.querySelector('button[type=submit]').disabled=true;
  try{
   await api('/api/contributions/manual',{method:'POST',body:{description,requestId:manualRequest}});
   if(getUser()?.id!==user)return;
   dialog.close();epoch++;cache.clear();loading.clear();errors.clear();month=currentMonth();userId='';repaint();
  }catch(error){if(getUser()?.id===user&&dialog.open)dialog.querySelector('#contribution-manual-error').textContent=error.message;}
  finally{manualBusy=false;if(dialog.open)form.querySelector('button[type=submit]').disabled=false;}
 });
 function clear(){dialog.close();dialog.replaceChildren();manualRequest='';epoch++;owner='';month='';userId='';cache.clear();loading.clear();errors.clear();}
 return {render,clear,invalidate(){epoch++;cache.clear();loading.clear();errors.clear();}};
}
