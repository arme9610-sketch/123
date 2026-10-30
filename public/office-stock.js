import {officeBuckets} from './office-catalog.js';
export function createOfficeStock({api,escape:esc,getState,refresh,toast}){
 const dialog=document.querySelector('#office-stock-dialog');let selected=null,model='전체',size='전체',color='전체';
 const fields={good:'goodQty',returned:'returnedQty',service:'serviceQty',defective:'defectiveQty'};
 function render(){
  const all=getState().officeStock||[];
  const modelStocks=all.filter(s=>model==='전체'||s.model===model);
  const sizes=['전체',...new Set(modelStocks.map(s=>s.size))];
  if(!sizes.includes(size))size='전체';
  const sized=modelStocks.filter(s=>size==='전체'||s.size===size);
  const colors=['전체',...new Set(sized.map(s=>s.color))];
  if(!colors.includes(color))color='전체';
  const stocks=sized.filter(s=>color==='전체'||s.color===color);
  const totals=Object.fromEntries(Object.values(fields).map(key=>[key,stocks.reduce((sum,s)=>sum+s[key],0)]));
  return `<div class="heading"><div><p class="eyebrow">OFFICE INVENTORY</p><h1>사무실 재고</h1><p class="subtitle">상품 옵션별 수량을 직접 입력하세요. 업무 요청·완료와 재고는 자동으로 연동되지 않습니다.</p></div></div><section class="panel"><div class="office-stock-filters"><label>상품<select id="office-model">${['전체','에센셜','메트론','카빈','파우치세트'].map(m=>`<option ${m===model?'selected':''}>${m}</option>`).join('')}</select></label><label>인치<select id="office-size">${sizes.map(value=>`<option ${value===size?'selected':''}>${esc(value)}</option>`).join('')}</select></label><label>색상<select id="office-color">${colors.map(value=>`<option ${value===color?'selected':''}>${esc(value)}</option>`).join('')}</select></label></div><div class="table-wrap"><table><thead><tr><th>상품 옵션</th>${Object.values(officeBuckets).map(label=>`<th>${label}</th>`).join('')}<th>수기 입력</th></tr></thead><tbody>${stocks.map(s=>`<tr><td>${esc(s.label)}</td>${Object.values(fields).map(key=>`<td><b>${s[key]}</b>개</td>`).join('')}<td><button type="button" class="text-button" data-office-adjust="${s.id}">수량 수정</button></td></tr>`).join('')}</tbody><tfoot class="office-stock-column-totals"><tr><th scope="row">${model==='전체'&&size==='전체'&&color==='전체'?'전체 총수량':'선택 옵션 총수량'}</th>${Object.entries(officeBuckets).map(([key,label])=>`<td data-stock-total="${key}"><small>${label} 총수량</small><b>${totals[fields[key]]}</b>개</td>`).join('')}<td></td></tr></tfoot></table></div></section>`;
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
 document.addEventListener('change',e=>{
  if(!['office-model','office-size','office-color'].includes(e.target.id))return;
  const id=e.target.id;
  if(id==='office-model')model=e.target.value;
  if(id==='office-size')size=e.target.value;
  if(id==='office-color')color=e.target.value;
  document.querySelector('#main').innerHTML=render();
  document.getElementById(id).focus({preventScroll:true});
 });
 return {render};
}
