import {officeBuckets} from './office-catalog.js';
export function createOfficeStock({api,escape:esc,getState,refresh,toast}){
 const dialog=document.querySelector('#office-stock-dialog');let selected=null,model='전체',query='';
 const fields={good:'goodQty',returned:'returnedQty',service:'serviceQty',defective:'defectiveQty'};
 function render(){
  const stocks=(getState().officeStock||[]).filter(s=>(model==='전체'||s.model===model)&&s.label.includes(query));
  return `<div class="heading"><div><p class="eyebrow">OFFICE INVENTORY</p><h1>사무실 재고</h1><p class="subtitle">상품 옵션별 수량을 직접 입력하세요. 업무 요청·완료와 재고는 자동으로 연동되지 않습니다.</p></div></div><section class="panel"><div class="office-stock-filters"><label>상품<select id="office-model">${['전체','에센셜','메트론','카빈','파우치세트'].map(m=>`<option ${m===model?'selected':''}>${m}</option>`).join('')}</select></label><label>옵션 검색<input id="office-query" value="${esc(query)}" maxlength="100" placeholder="인치 또는 색상"></label></div><div class="table-wrap"><table><thead><tr><th>상품 옵션</th>${Object.values(officeBuckets).map(label=>`<th>${label}</th>`).join('')}<th>수기 입력</th></tr></thead><tbody>${stocks.map(s=>`<tr><td>${esc(s.label)}</td>${Object.values(fields).map(key=>`<td><b>${s[key]}</b>개</td>`).join('')}<td><button type="button" class="text-button" data-office-adjust="${s.id}">수량 수정</button></td></tr>`).join('')}</tbody></table></div><p class="collection-note">정상·반품·A/S·불량은 각각 따로 입력합니다. 양품화 후 수량도 직접 수정하며, 자동으로 정상 재고에 더하지 않습니다.</p></section>`;
 }
 function open(sku){
  selected=getState().officeStock.find(s=>s.id===sku);if(!selected)return;
  dialog.innerHTML=`<form id="office-stock-form"><div class="dialog-title"><h2>사무실 재고 수정</h2><button type="button" data-office-close aria-label="재고 입력 닫기">✕</button></div><p>${esc(selected.label)}</p><div class="form-row office-adjust-values">${Object.entries(officeBuckets).map(([key,label])=>`<label>${label}<input name="${fields[key]}" type="number" min="0" max="1000000000" value="${selected[fields[key]]}" required></label>`).join('')}</div><p class="privacy">현재 수량을 직접 입력하세요. 업무를 요청하거나 완료해도 이 수량은 바뀌지 않습니다.</p><p id="office-stock-error" class="form-error" role="alert"></p><button type="submit" class="primary submit">수량 저장</button></form>`;dialog.showModal();
 }
 dialog.addEventListener('click',e=>{if(e.target.closest('[data-office-close]'))dialog.close();});
 dialog.addEventListener('submit',async e=>{
  e.preventDefault();e.stopPropagation();const button=e.target.querySelector('[type=submit]');button.disabled=true;
  try{const data=Object.fromEntries(new FormData(e.target));for(const key of Object.values(fields))data[key]=Number(data[key]);await api('/api/office-stock/'+encodeURIComponent(selected.id),{method:'PUT',body:{...data,version:selected.version}});dialog.close();await refresh();toast('사무실 재고를 저장했어요.');}
  catch(error){dialog.querySelector('#office-stock-error').textContent=error.message;if(error.status===409)await refresh().catch(()=>{});}finally{button.disabled=false;}
 });
 document.addEventListener('click',e=>{const button=e.target.closest('[data-office-adjust]');if(button)open(button.dataset.officeAdjust);});
 document.addEventListener('change',e=>{if(e.target.id==='office-model'){model=e.target.value;document.querySelector('#main').innerHTML=render();}});
 document.addEventListener('input',e=>{if(e.target.id==='office-query'){query=e.target.value;const pos=e.target.selectionStart;document.querySelector('#main').innerHTML=render();const input=document.querySelector('#office-query');input.focus();input.setSelectionRange(pos,pos);}});
 return {render};
}
