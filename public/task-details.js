export function createTaskDetails({api,escape:esc,getItem,getUser,refresh,edit,stop,toast}) {
  const dialog = document.querySelector('#task-detail-dialog');
  let current = null, checklist = [], timer, saving = null, baseline = '', draftKey = '', conflict = false, session = 0;
  const signature = value => JSON.stringify({note:value.note,checklist:value.checklist});
  function content() {
    return {note:dialog.querySelector('textarea[name=note]').value.trim(),checklist:checklist.filter(c=>c.text.trim()).map(c=>({text:c.text.trim(),done:c.done}))};
  }
  function status(message) { const node=dialog.querySelector('#task-autosave-status'); if(node)node.textContent=message; }
  function remember() {
    try { localStorage.setItem(draftKey,JSON.stringify({base:baseline,...content()})); return true; } catch { return false; }
  }
  function schedule() {
    remember(); clearTimeout(timer); status('저장 대기 중…');
    timer=setTimeout(()=>save(),500);
  }
  async function save() {
    clearTimeout(timer);
    if(saving){await saving;return save();}
    if(!current || conflict)return !conflict;
    const value=content(), sent=signature(value);
    if(sent===baseline){status('자동 저장됨');return true;}
    remember();status('저장 중…');
    const id=current.id, activeSession=session;
    saving=(async()=>{
      try {
        let result;
        for(let attempt=0;attempt<2;attempt++){
          try{result=await api('/api/items/'+encodeURIComponent(id)+'/details',{method:'PATCH',body:{version:current.version,...value}});break;}
          catch(error){
            if(error.status!==409 || attempt)throw error;
            if(session!==activeSession)return true;
            await refresh();if(session!==activeSession)return true;const latest=getItem(id);
            if(!latest || signature(latest)!==baseline){conflict=true;dialog.querySelector('[data-draft-discard]').hidden=false;throw error;}
            current=latest;
          }
        }
        // A logout may have closed the panel while the request was in flight.
        if(!current || current.id!==id || session!==activeSession)return true;
        current=result.item;baseline=sent;
        if(signature(content())===sent){try{localStorage.removeItem(draftKey);}catch{}status('자동 저장됨');}
        else {remember();status('저장 대기 중…');}
        dialog.querySelector('#task-detail-error').textContent='';await refresh().catch(()=>{});return true;
      }catch(error){
        if(current?.id===id && session===activeSession){const retained=remember();status('자동 저장하지 못했어요');dialog.querySelector('#task-detail-error').textContent=error.message+(retained?(conflict?' 다른 직원의 변경과 겹쳐 자동 저장을 멈췄어요. 초안은 유지됩니다.':' 입력은 이 브라우저에 임시 보관됩니다. 다시 저장해 주세요.'):' 브라우저에 초안도 보관하지 못했어요. 창을 닫지 말고 입력을 복사해 주세요.');}
        return false;
      }finally{saving=null;}
    })();
    const ok=await saving;
    if(ok && current?.id===id && session===activeSession && signature(content())!==baseline)return save();
    return ok;
  }
  async function close(after) {
    const ok=await save();
    if(!ok && !remember())return;
    dialog.close();if(!ok)toast('서버에 저장하지 못해 이 브라우저에 초안을 보관했어요.');
    if(ok)after?.();
  }
  function list() {
    dialog.querySelector('#task-checklist').innerHTML = checklist.map((c,i)=>`<li><input type="checkbox" data-check="${i}" aria-label="${esc(c.text)} 완료" ${c.done?'checked':''}><input data-text="${i}" aria-label="체크리스트 ${i+1}" maxlength="200" value="${esc(c.text)}"><button type="button" data-remove="${i}" aria-label="체크리스트 ${i+1} 삭제">✕</button></li>`).join('');
  }
  function open(id) {
    const item = getItem(id); if (!item) return;
    clearTimeout(timer); session++;conflict=false;current = {...item}; baseline=signature(item);draftKey='dayon-task-draft-'+getUser().id+'-'+id; checklist = (item.checklist || []).map(c=>({...c}));
    dialog.innerHTML = `<form id="task-detail-form"><div class="dialog-title"><h2>업무 상세</h2><button type="button" data-detail-close aria-label="업무 상세 닫기">✕</button></div><h3>${esc(item.title)}</h3><p>${item.seriesId?'반복업무 · ':''}${esc(item.date)} · ${item.done?'완료':'진행 중'}</p><dl class="task-people"><dt>요청자</dt><dd>${esc(item.requester)}</dd><dt>담당자</dt><dd>${esc(item.owner)}</dd></dl>${item.type==='shipment'?`<p>운송장: ${esc(item.tracking)||'미등록'}</p>`:''}<label>메모<textarea name="note" maxlength="2000">${esc(item.note)}</textarea></label><div class="task-checklist-heading"><h3>체크리스트</h3><button type="button" data-check-add>＋ 항목 추가</button></div><ul id="task-checklist" class="task-checklist"></ul><p id="task-autosave-status" role="status">자동 저장됨</p><p id="task-detail-error" class="form-error" role="alert"></p><div class="task-detail-actions"><button type="button" data-draft-discard hidden>초안 버리고 최신 내용 보기</button><button type="submit" class="primary">메모·체크리스트 저장</button><button type="button" data-detail-edit ${item.done?'disabled':''}>업무 수정</button>${item.seriesActive?'<button type="button" data-detail-stop>반복 중지</button>':''}</div><p class="privacy">입력 후 자동 저장되며 닫기나 Esc로 닫을 때도 저장합니다. 메모와 체크리스트는 이 날짜의 업무에 저장되어 팀원과 공유됩니다.${item.done?' 업무를 수정하려면 목록에서 완료를 취소해 주세요.':''}</p></form>`;
    try {
      const draft=JSON.parse(localStorage.getItem(draftKey));
      if(draft && typeof draft.note==='string' && Array.isArray(draft.checklist) && draft.checklist.every(c=>c && typeof c.text==='string' && typeof c.done==='boolean')){
        if(signature(draft)!==baseline){
          checklist=draft.checklist;dialog.querySelector('textarea[name=note]').value=draft.note;
          conflict=draft.base!==baseline;
          if(conflict){dialog.querySelector('[data-draft-discard]').hidden=false;status('저장되지 않은 초안');dialog.querySelector('#task-detail-error').textContent='다른 직원의 변경과 겹치는 초안을 복원했어요. 입력을 복사한 뒤 최신 내용을 확인해 주세요.';}
          else schedule();
        }else localStorage.removeItem(draftKey);
      }
    }catch{}
    list(); if(!dialog.open)dialog.showModal();
  }
  dialog.addEventListener('input',event=>{
    if(event.target.dataset.text!==undefined)checklist[Number(event.target.dataset.text)].text=event.target.value;
    if(event.target.dataset.check!==undefined)checklist[Number(event.target.dataset.check)].done=event.target.checked;
    schedule();
  });
  dialog.addEventListener('click',async event=>{
    const button=event.target.closest('button');if(!button)return;
    if(button.hasAttribute('data-draft-discard')){try{localStorage.removeItem(draftKey);}catch{}await refresh();open(current.id);return;}
    if(button.hasAttribute('data-detail-close'))await close();
    if(button.hasAttribute('data-check-add')){
      if(checklist.length>=30){dialog.querySelector('#task-detail-error').textContent='최대 30개까지 추가할 수 있어요.';return;}
      checklist.push({text:'',done:false});list();dialog.querySelector('#task-checklist li:last-child input[data-text]').focus();
    }
    if(button.dataset.remove!==undefined){checklist.splice(Number(button.dataset.remove),1);list();schedule();}
    if(button.hasAttribute('data-detail-edit'))await close(()=>edit(getItem(current.id)));
    if(button.hasAttribute('data-detail-stop')){
      button.disabled=true;
      try{await stop(current.seriesId);button.hidden=true;current.seriesActive=false;}
      catch(error){dialog.querySelector('#task-detail-error').textContent=error.message;button.disabled=false;}
    }
  });
  dialog.addEventListener('submit',async event=>{
    event.preventDefault();event.stopPropagation();const button=dialog.querySelector('[type=submit]');button.disabled=true;
    try{await save();}finally{button.disabled=false;}
  });
  dialog.addEventListener('cancel',event=>{event.preventDefault();close();});
  dialog.addEventListener('close',()=>{clearTimeout(timer);session++;});
  window.addEventListener('pagehide',()=>{if(current && dialog.open)remember();});

  return {open};
}
