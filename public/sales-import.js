import {officeCatalog} from './office-catalog.js';
import {decodeSalesCsv,readSalesCsv,aggregateSalesRows} from './sales-csv.js';
import {salesTotals,rateLabel} from './sales-math.js';
export function createSalesImport({escape:esc,onApply,toast}){
 const dialog=document.createElement('dialog');dialog.className='sales-import-dialog';dialog.setAttribute('aria-label','판매 CSV 가져오기');document.body.append(dialog);
 let preview=null,reading=0;
 function render(){
  if(!preview)return;
  const {rows,target,fileName}=preview,missing=rows.filter(r=>!r.sku).length,t=salesTotals(rows.map(r=>({...r,refunded:0})));
  const chosen=new Set(rows.filter(r=>r.sku).map(r=>r.sku));
  dialog.innerHTML=`<div class="dialog-title"><h2>CSV 가져오기 미리보기</h2><button type="button" data-import-close aria-label="미리보기 닫기">✕</button></div><p><b>${esc(target.day)} · ${esc(target.siteName)}</b></p><p class="privacy">${esc(fileName)} · 원본 ${rows.length}행 → ${chosen.size}개 옵션 · 결제 ${t.sold}개 · 환불 ${t.cancelled}개 · 환불률 ${rateLabel(t.sold,t.cancelled)}</p><p class="privacy">상품명과 옵션으로 연결하며 같은 옵션은 합산합니다. 결제수량을 판매, 환불수량을 취소·환불로 가져옵니다. 파일에 날짜와 사이트 정보가 없으므로 위 대상을 확인하세요.</p><p role="status">${missing?`확인이 필요한 ${missing}개 행의 옵션을 직접 선택하세요.`:'모든 행의 옵션을 연결했습니다.'}</p><div class="table-wrap sales-import-scroll"><table><thead><tr><th>상품명 / 옵션</th><th>연결할 옵션</th><th>결제</th><th>환불</th></tr></thead><tbody>${rows.map((r,i)=>`<tr><td><b>${esc(r.name)}</b><small class="sales-source-option">${esc(r.option)||'옵션 없음 · 상품명으로 연결'}</small></td><td><select data-import-row="${i}" aria-label="${r.row}행 연결할 옵션"><option value="">직접 선택 필요</option>${officeCatalog.map(s=>`<option value="${s.id}" ${r.sku===s.id?'selected':''}>${esc(s.label)}</option>`).join('')}</select></td><td>${r.sold}</td><td>${r.cancelled}</td></tr>`).join('')}</tbody></table></div><p class="privacy"><b>선택한 날짜·사이트의 32개 옵션 수량을 이 파일의 합계로 교체합니다.</b> 파일에 없는 옵션은 0개입니다. 같은 파일을 다시 가져와도 중복으로 더하지 않습니다. 반영 후 ‘전체 상품 저장’을 눌러야 서버에 저장됩니다.</p><p id="sales-import-error" role="alert" class="form-error"></p><div class="sales-import-actions"><button type="button" data-import-close>닫기</button><button type="button" data-import-apply class="primary" ${missing?'disabled':''}>이 수량을 입력칸에 반영</button></div>`;
 }
 dialog.addEventListener('change',e=>{if(!e.target.matches('[data-import-row]'))return;preview.rows[Number(e.target.dataset.importRow)].sku=e.target.value||null;render();});
 dialog.addEventListener('click',e=>{
  if(e.target.closest('[data-import-close]'))dialog.close();
  if(!e.target.closest('[data-import-apply]'))return;
  try{const entries=aggregateSalesRows(preview.rows);onApply(preview.target,entries);dialog.close();toast('CSV 수량을 반영했어요. 확인 후 전체 상품 저장을 눌러 주세요.');}
  catch(error){dialog.querySelector('#sales-import-error').textContent=error.message;}
 });
 dialog.addEventListener('close',()=>{preview=null;dialog.replaceChildren();});
 return {
  async open(file,target){
   const request=++reading;
   try{
    if(!/\.csv$/i.test(file.name))throw new Error('엑셀에서 내려받은 CSV 파일을 선택해 주세요. (.xlsx는 CSV로 저장 후 가져오기)');
    if(file.size>2*1024*1024)throw new Error('CSV 파일은 2MB 이하로 선택해 주세요.');
    const buffer=await file.arrayBuffer();if(request!==reading)return;
    preview={rows:readSalesCsv(decodeSalesCsv(buffer)),target,fileName:file.name};render();if(!dialog.open)dialog.showModal();
   }catch(error){if(request===reading)toast(error.message);}
  },
  clear(){reading++;preview=null;if(dialog.open)dialog.close();dialog.replaceChildren();}
 };
}
