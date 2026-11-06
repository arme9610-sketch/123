export const attachmentAccept='.xlsx,.xls,.csv,.pdf,.png,.jpg,.jpeg,.webp,.gif';
export function attachmentLinks(item,esc,{removable=false}={}){
 return (item.attachments||[]).map(file=>`<div class="inbound-file"><span class="inbound-file-icon" aria-hidden="true">${esc(file.filename.split('.').pop().toUpperCase())}</span><div><b>${esc(file.filename)}</b><small>${(file.size/1024).toFixed(1)} KB · ${esc(file.author||'')}</small></div><a class="inbound-file-download" href="/api/items/${encodeURIComponent(item.id)}/attachments/${encodeURIComponent(file.id)}/download">다운로드 ↓</a>${removable?`<button type="button" class="delete-link" data-inbound-file-remove="${esc(file.id)}" aria-label="${esc(file.filename)} 첨부 삭제">삭제</button>`:''}</div>`).join('');
}
export async function readAttachmentFiles(files){
 if(files.length>5)throw new Error('입고 일정당 파일은 최대 5개까지 첨부할 수 있습니다.');
 for(const file of files)if(!/\.(xlsx|xls|csv|pdf|png|jpe?g|webp|gif)$/i.test(file.name)||file.size===0||file.size>5*1024*1024)throw new Error('내용이 있는 5MB 이하 엑셀·CSV·이미지·PDF 파일을 선택해 주세요.');
 return Promise.all(files.map(file=>new Promise((resolve,reject)=>{
  const reader=new FileReader();reader.onload=()=>resolve({filename:file.name,data:reader.result.split(',')[1]});reader.onerror=()=>reject(new Error('파일을 읽지 못했습니다. 다시 선택해 주세요.'));reader.readAsDataURL(file);
 })));
}
export function createInboundAttachmentForm({root,escape:esc}){
 let item=null,removed=new Set(),files=[];
 function render(){
  const visible={...item,attachments:(item?.attachments||[]).filter(file=>!removed.has(file.id))};
  root.querySelector('[data-inbound-existing]').innerHTML=attachmentLinks(visible,esc,{removable:true});
  root.querySelector('[data-inbound-pending]').innerHTML=files.map((file,i)=>`<div class="inbound-file is-pending"><span class="inbound-file-icon" aria-hidden="true">＋</span><div><b>${esc(file.name)}</b><small>저장 시 첨부 · ${(file.size/1024).toFixed(1)} KB</small></div><button type="button" data-inbound-pending-remove="${i}" aria-label="${esc(file.name)} 선택 취소">취소</button></div>`).join('');
 }
 root.addEventListener('change',event=>{
  if(!event.target.matches('[data-inbound-files]'))return;
  const selected=[...event.target.files];event.target.value='';
  const count=(item?.attachments||[]).length-removed.size+files.length+selected.length;
  const error=root.querySelector('[data-inbound-error]');error.textContent='';
  if(count>5){error.textContent='입고 일정당 파일은 최대 5개까지 첨부할 수 있습니다.';return;}
  if(selected.some(file=>! /\.(xlsx|xls|csv|pdf|png|jpe?g|webp|gif)$/i.test(file.name)||!file.size||file.size>5*1024*1024)){error.textContent='내용이 있는 5MB 이하 엑셀·CSV·이미지·PDF 파일을 선택해 주세요.';return;}
  files.push(...selected);render();
 });
 root.addEventListener('click',event=>{
  const remove=event.target.closest('[data-inbound-file-remove]');if(remove){removed.add(remove.dataset.inboundFileRemove);render();}
  const cancel=event.target.closest('[data-inbound-pending-remove]');if(cancel){files.splice(Number(cancel.dataset.inboundPendingRemove),1);render();}
 });
 return {reset(value){item=value;removed=new Set();files=[];root.querySelector('[data-inbound-error]').textContent='';render();},async changes(){return {newAttachments:await readAttachmentFiles(files),removeAttachmentIds:[...removed]};}};
}
export function inboundAttachmentCell(item,esc){
 return `<div class="inbound-cell-files">${attachmentLinks(item,esc,{removable:true})||'<span class="inbound-no-files">첨부된 파일 없음</span>'}</div><label class="inbound-upload inbound-table-upload">＋ 자료 업로드<input type="file" data-inbound-table-files="${esc(item.id)}" accept="${attachmentAccept}" multiple></label><small class="inbound-cell-note">엑셀·이미지·PDF · 파일당 5MB · 최대 5개</small><small data-inbound-table-status="${esc(item.id)}" role="status"></small>`;
}
export function bindInboundTable({api,getItems,getUser,refresh,toast}){
 const busy=new Set();
 async function update(item,files,remove=[]){
  if(busy.has(item.id))return;busy.add(item.id);const actor=getUser()?.id;
  const cell=document.querySelector(`[data-inbound-table-files="${item.id}"]`)?.closest('td');
  const controls=cell?.querySelectorAll('button,input')||[];controls.forEach(node=>node.disabled=true);
  const status=cell?.querySelector('[role=status]');if(status)status.textContent='저장 중…';
  try{
   if((item.attachments||[]).length+files.length-remove.length>5)throw new Error('입고 일정당 파일은 최대 5개까지 첨부할 수 있습니다.');
   const newAttachments=await readAttachmentFiles(files);
   if(getUser()?.id!==actor)return;
   await api('/api/items/'+encodeURIComponent(item.id)+'/attachments',{method:'POST',body:{version:item.version,newAttachments,removeAttachmentIds:remove}});
   if(getUser()?.id!==actor)return;
   await refresh();toast(remove.length?'첨부파일을 삭제했어요.':'입고 자료를 업로드했어요.');
  }catch(error){if(getUser()?.id===actor){if(status)status.textContent=error.message;toast(error.message);}}
  finally{busy.delete(item.id);controls.forEach(node=>node.disabled=false);}
 }
 document.addEventListener('change',event=>{
  const input=event.target.closest('[data-inbound-table-files]');if(!input)return;
  const item=getItems().find(i=>i.id===input.dataset.inboundTableFiles),files=[...input.files];input.value='';
  if(item&&files.length)update(item,files);
 });
 document.addEventListener('click',event=>{
  const button=event.target.closest('.inbound-attachment-cell [data-inbound-file-remove]');if(!button)return;
  const item=getItems().find(i=>(i.attachments||[]).some(file=>file.id===button.dataset.inboundFileRemove));
  if(item&&!busy.has(item.id)&&confirm('이 첨부파일을 삭제할까요?'))update(item,[],[button.dataset.inboundFileRemove]);
 });
}
