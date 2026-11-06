export function createResourceAccess({api,getUser,getCsrfToken,escape:esc,refresh,toast}){
 const dialog=document.createElement('dialog');dialog.id='resource-access-dialog';dialog.className='resource-access-dialog';document.body.append(dialog);
 let active=null,busy=false,session=0;
 function clear(){session++;active=null;dialog.close();dialog.replaceChildren();}
 function open(mode,item){
  if(busy)return;
  active={mode,item,owner:getUser()?.id};session++;
  const protectedFile=!!item.password_protected;
  const heading={edit:'자료 제목 · 비밀번호 수정',download:'비밀번호 확인',remove:'자료 삭제'}[mode];
  dialog.innerHTML=`<form><div class="dialog-title"><h2>${heading}</h2><button type="button" data-resource-access-close aria-label="닫기">✕</button></div><p class="resource-access-file">${esc(item.filename)}</p>${mode==='edit'?`<label>자료 제목<input name="title" maxlength="100" required value="${esc(item.title)}"></label>`:`<h3>${esc(item.title)}</h3>`}${protectedFile?'<label>현재 간편 비밀번호<input class="resource-pin" name="password" type="password" inputmode="numeric" pattern="[0-9]{4}" minlength="4" maxlength="4" required autocomplete="off" placeholder="숫자 4자리"></label>':''}${mode==='edit'?`<label>${protectedFile?'새 간편 비밀번호':'간편 비밀번호'} <small>(선택)</small><input class="resource-pin" name="newPassword" type="password" inputmode="numeric" pattern="[0-9]{4}" minlength="4" maxlength="4" autocomplete="new-password" placeholder="숫자 4자리"></label>${protectedFile?'<label class="resource-pin-remove"><input name="removePassword" type="checkbox"> 비밀번호 보호 해제</label><p class="privacy">새 비밀번호를 비워두면 현재 비밀번호를 유지합니다.</p>':'<p class="privacy">비워두면 로그인한 직원이 비밀번호 없이 다운로드할 수 있습니다.</p>'}`:''}${mode==='remove'?'<p class="privacy">삭제한 파일은 복구할 수 없습니다.</p>':''}<p class="form-error" data-resource-access-error role="alert"></p><button type="submit" class="primary">${{edit:'변경사항 저장',download:'확인하고 다운로드',remove:'자료 삭제'}[mode]}</button></form>`;
  dialog.showModal();dialog.querySelector('input')?.focus();
 }
 async function downloadFile(item,password,owner){
  const response=await fetch('/api/resources/'+encodeURIComponent(item.id)+'/download',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json','X-CSRF-Token':getCsrfToken()},body:JSON.stringify({password})});
  if(!response.ok){const error=await response.json().catch(()=>({}));throw new Error(error.error||'다운로드하지 못했습니다. 다시 로그인하거나 비밀번호를 확인해 주세요.');}
  const blob=await response.blob();if(getUser()?.id!==owner)return;
  const url=URL.createObjectURL(blob),link=document.createElement('a');link.href=url;link.download=item.filename;document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);
 }
 dialog.addEventListener('click',event=>{if(event.target.closest('[data-resource-access-close]')&&!busy)clear();});
 dialog.addEventListener('cancel',event=>{event.preventDefault();if(!busy)clear();});
 dialog.addEventListener('change',event=>{
  if(event.target.name!=='removePassword')return;
  const input=dialog.querySelector('[name=newPassword]');input.disabled=event.target.checked;if(input.disabled)input.value='';
 });
 dialog.addEventListener('submit',async event=>{
  event.preventDefault();event.stopPropagation();if(busy||!active)return;
  const request={...active},ticket=session,form=event.target,fields=Object.fromEntries(new FormData(form)),button=form.querySelector('[type=submit]');busy=true;button.disabled=true;const label=button.textContent;button.textContent='처리 중…';
  try{
   const path='/api/resources/'+encodeURIComponent(request.item.id);
   if(request.mode==='download')await downloadFile(request.item,fields.password,request.owner);
   else if(request.mode==='remove')await api(path,{method:'DELETE',body:{password:fields.password}});
   else{
    const body={title:fields.title,version:request.item.version,password:fields.password};
    if(fields.removePassword)body.newPassword='';else if(fields.newPassword)body.newPassword=fields.newPassword;
    await api(path,{method:'PUT',body});
   }
   if(session!==ticket||getUser()?.id!==request.owner)return;
   clear();if(request.mode!=='download')await refresh();toast(request.mode==='download'?'다운로드를 시작했어요.':request.mode==='remove'?'자료를 삭제했어요.':'자료를 수정했어요.');
  }catch(error){if(session===ticket){dialog.querySelector('[data-resource-access-error]').textContent=error.message;const input=form.elements.password;if(input){input.value='';input.focus();}}}
  finally{busy=false;button.disabled=false;button.textContent=label;}
 });
 return {clear,edit:item=>open('edit',item),remove:item=>open('remove',item),async download(item){
  if(item.password_protected){open('download',item);return;}
  try{await downloadFile(item,undefined,getUser()?.id);}catch(error){toast(error.message);}
 }};
}
