export function createTaskDetails({api,escape:esc,getItem,refresh,edit,stop,toast}) {
  const dialog = document.querySelector('#task-detail-dialog');
  let current = null, checklist = [];
  function list() {
    dialog.querySelector('#task-checklist').innerHTML = checklist.map((c,i)=>`<li><input type="checkbox" data-check="${i}" aria-label="${esc(c.text)} 완료" ${c.done?'checked':''}><input data-text="${i}" aria-label="체크리스트 ${i+1}" maxlength="200" required value="${esc(c.text)}"><button type="button" data-remove="${i}" aria-label="체크리스트 ${i+1} 삭제">✕</button></li>`).join('');
  }
  function open(id) {
    const item = getItem(id); if (!item) return;
    current = {...item}; checklist = (item.checklist || []).map(c=>({...c}));
    dialog.innerHTML = `<form id="task-detail-form"><div class="dialog-title"><h2>업무 상세</h2><button type="button" data-detail-close aria-label="업무 상세 닫기">✕</button></div><h3>${esc(item.title)}</h3><p>${item.seriesId?'반복업무 · ':''}${esc(item.date)} · ${item.done?'완료':'진행 중'}</p><dl class="task-people"><dt>요청자</dt><dd>${esc(item.requester)}</dd><dt>담당자</dt><dd>${esc(item.owner)}</dd></dl>${item.type==='shipment'?`<p>운송장: ${esc(item.tracking)||'미등록'}</p>`:''}<label>메모<textarea name="note" maxlength="2000">${esc(item.note)}</textarea></label><div class="task-checklist-heading"><h3>체크리스트</h3><button type="button" data-check-add>＋ 항목 추가</button></div><ul id="task-checklist" class="task-checklist"></ul><p id="task-detail-error" class="form-error" role="alert"></p><div class="task-detail-actions"><button type="submit" class="primary">메모·체크리스트 저장</button><button type="button" data-detail-edit ${item.done?'disabled':''}>업무 수정</button>${item.seriesActive?'<button type="button" data-detail-stop>반복 중지</button>':''}</div><p class="privacy">메모와 체크리스트는 이 날짜의 업무에 저장되고 팀원과 공유됩니다.${item.done?' 업무를 수정하려면 목록에서 완료를 취소해 주세요.':''}</p></form>`;
    list(); if(!dialog.open)dialog.showModal();
  }
  dialog.addEventListener('input',event=>{
    if(event.target.dataset.text!==undefined)checklist[Number(event.target.dataset.text)].text=event.target.value;
    if(event.target.dataset.check!==undefined)checklist[Number(event.target.dataset.check)].done=event.target.checked;
  });
  dialog.addEventListener('click',async event=>{
    const button=event.target.closest('button');if(!button)return;
    if(button.hasAttribute('data-detail-close'))dialog.close();
    if(button.hasAttribute('data-check-add')){
      if(checklist.length>=30){dialog.querySelector('#task-detail-error').textContent='최대 30개까지 추가할 수 있어요.';return;}
      checklist.push({text:'',done:false});list();dialog.querySelector('#task-checklist li:last-child input[data-text]').focus();
    }
    if(button.dataset.remove!==undefined){checklist.splice(Number(button.dataset.remove),1);list();}
    if(button.hasAttribute('data-detail-edit')){dialog.close();edit(getItem(current.id));}
    if(button.hasAttribute('data-detail-stop')){
      button.disabled=true;
      try{await stop(current.seriesId);button.hidden=true;current.seriesActive=false;}
      catch(error){dialog.querySelector('#task-detail-error').textContent=error.message;button.disabled=false;}
    }
  });
  dialog.addEventListener('submit',async event=>{
    event.preventDefault();event.stopPropagation();const button=dialog.querySelector('[type=submit]');button.disabled=true;
    try{
      const result=await api('/api/items/'+encodeURIComponent(current.id)+'/details',{method:'PATCH',body:{version:current.version,note:new FormData(event.target).get('note'),checklist}});
      current=result.item;await refresh();toast('메모와 체크리스트를 저장했어요.');dialog.querySelector('#task-detail-error').textContent='';
    }catch(error){
      if(error.status===409)await refresh().catch(()=>{});
      dialog.querySelector('#task-detail-error').textContent=error.message+(error.status===409?' 입력을 복사한 뒤 창을 다시 열어 주세요.':'');
    }finally{button.disabled=false;}
  });
  return {open};
}
