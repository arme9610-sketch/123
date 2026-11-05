const order=['천광흠','이기정','김진솔','윤호정'];
export function createUserWorklists({api,escape:esc,getState,getUser,refresh,toast}){
 const dialog=document.createElement('dialog');dialog.className='worklist-dialog';dialog.setAttribute('aria-label','출근 후 할 일 편집');document.body.append(dialog);
 let editing=null,busy=false;
 function renderHome(){
  const state=getState(),users=[...state.users].filter(user=>user.active!==0).sort((a,b)=>{
   const rank=user=>order.includes(user.name)?order.indexOf(user.name):order.length;
   return rank(a)-rank(b)||a.name.localeCompare(b.name,'ko');
  });
  return `<section class="home-worklists" aria-label="사용자별 출근 후 할 일"><div class="worklist-grid">${users.map(user=>{
   const record=state.worklists?.find(row=>row.user_id===user.id),entries=record?.entries||[];
   return `<article class="worklist-card"><div class="worklist-card-top"><span class="worklist-avatar">${esc(user.name[0])}</span><div><h3>${esc(user.name)}님${user.id===getUser()?.id?'<small>나</small>':''}</h3><p>출근 후 할 일 · ${entries.length}개</p></div><button type="button" data-worklist-edit="${esc(user.id)}" aria-label="${esc(user.name)}님 할 일 편집">편집 <span aria-hidden="true">↗</span></button></div>${entries.length?`<ol class="worklist-entries">${entries.map((line,index)=>`<li><span aria-hidden="true">${String(index+1).padStart(2,'0')}</span><p>${esc(line)}</p></li>`).join('')}</ol>`:`<button type="button" class="worklist-empty" data-worklist-edit="${esc(user.id)}"><span aria-hidden="true">＋</span>출근 후 할 일을 입력해 주세요.</button>`}${record?`<p class="worklist-updated">${esc(record.author)}님이 수정 · ${esc(new Date(record.updated_at).toLocaleDateString('ko-KR',{timeZone:'Asia/Seoul'}))}</p>`:''}</article>`;
  }).join('')}</div></section>`;
 }
 document.addEventListener('click',event=>{
  const button=event.target.closest('[data-worklist-edit]');
  if(button&&!busy){
   const user=getState().users.find(user=>user.id===button.dataset.worklistEdit);if(!user)return;
   const record=getState().worklists?.find(row=>row.user_id===user.id);editing={userId:user.id,version:record?.version||0,actor:getUser()?.id};
   dialog.innerHTML=`<div class="dialog-title"><h2>${esc(user.name)}님<br>출근 후 할 일</h2><button type="button" data-worklist-close aria-label="닫기">✕</button></div><form id="worklist-form"><label>어떤 업무로 하루를 시작하나요?<textarea name="entries" maxlength="4200" rows="8" placeholder="CS 업무&#10;카카오톡 채널 확인&#10;재고 수량 파악">${esc((record?.entries||[]).join('\n'))}</textarea></label><p class="privacy">한 줄에 하나씩, 최대 20개 업무를 입력하세요. 저장한 기본 업무는 다음 날에도 유지되며 모두에게 공유됩니다.</p><p id="worklist-error" class="form-error" role="alert"></p><button type="submit" class="primary">할 일 저장</button></form>`;
   dialog.showModal();dialog.querySelector('textarea').focus();
  }
  if(event.target.closest('[data-worklist-close]')&&!busy)dialog.close();
 });
 dialog.addEventListener('cancel',event=>{if(busy)event.preventDefault();});
 dialog.addEventListener('submit',async event=>{
  event.preventDefault();if(busy||!editing)return;
  const target={...editing},entries=event.target.elements.entries.value.split(/\r?\n/).map(line=>line.trim()).filter(Boolean),button=event.target.querySelector('[type=submit]');busy=true;button.disabled=true;
  try{
   await api('/api/user-worklists/'+encodeURIComponent(target.userId),{method:'PUT',body:{entries,version:target.version}});
   if(getUser()?.id!==target.actor)return;dialog.close();await refresh();toast('출근 후 할 일을 저장했어요.');
  }catch(error){if(getUser()?.id===target.actor&&dialog.open)dialog.querySelector('#worklist-error').textContent=error.message;}
  finally{busy=false;button.disabled=false;}
 });
 return {renderHome,clear(){editing=null;dialog.close();dialog.replaceChildren();}};
}
