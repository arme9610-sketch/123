import {contributionTier} from './contribution-tiers.js';
const order=['천광흠','이기정','김진솔','윤호정'];
export function createUserWorklists({api,escape:esc,getState,getUser,refresh,toast,onRequest}){
 const dialog=document.createElement('dialog');dialog.className='worklist-dialog';dialog.setAttribute('aria-label','업무우선순위 편집');document.body.append(dialog);
 let editing=null,busy=false,uploading=false;
 function renderHome(){
  const state=getState(),users=[...state.users].filter(user=>user.active!==0).sort((a,b)=>{
   const rank=user=>order.includes(user.name)?order.indexOf(user.name):order.length;
   return rank(a)-rank(b)||a.name.localeCompare(b.name,'ko');
  });
  return `<section class="home-worklists" aria-label="사용자별 출근 후 할 일"><div class="worklist-grid">${users.map(user=>{
   const record=state.worklists?.find(row=>row.user_id===user.id),entries=record?.entries||[],self=user.id===getUser()?.id;
   const level=user.contribution?.level||1,tier=contributionTier(level),photo=user.avatarUrl?`<img src="${esc(user.avatarUrl)}" alt="${esc(user.name)}님의 프로필 사진" width="48" height="48">`:esc(user.name[0]);
   const avatar=self?`<button type="button" class="worklist-avatar worklist-photo-pick" data-profile-pick="${esc(user.id)}" aria-label="내 프로필 사진 변경">${photo}<span aria-hidden="true">＋</span></button><input type="file" data-profile-file accept="image/png,image/jpeg,image/webp" hidden>`:`<span class="worklist-avatar">${photo}</span>`;
   return `<article class="worklist-card worklist-tier-${tier.id}"><div class="worklist-card-top">${avatar}<div><h3>${esc(user.name)}님${self?'<small>나</small>':''}</h3><p class="worklist-tier-label">${tier.name}<span>Lv.${level}</span></p></div><img class="worklist-medal" src="/tiers/${tier.id}.svg" alt="${tier.name} 등급" width="28" height="34"></div><div class="worklist-priority-heading"><b>업무우선순위</b><span>${entries.length}개</span></div>${entries.length?`<ol class="worklist-entries">${entries.map((line,index)=>`<li><span aria-hidden="true">${String(index+1).padStart(2,'0')}</span><p>${esc(line)}</p></li>`).join('')}</ol>`:`<button type="button" class="worklist-empty" data-worklist-edit="${esc(user.id)}"><span aria-hidden="true">＋</span>업무우선순위</button>`}<div class="worklist-card-actions"><button type="button" data-worklist-edit="${esc(user.id)}" aria-label="${esc(user.name)}님 업무우선순위 편집">편집</button>${self?`<button type="button" data-profile-pick="${esc(user.id)}">${uploading?'사진 저장 중…':'사진 변경'}</button>`:`<button type="button" class="worklist-request" data-worklist-request="${esc(user.id)}">업무 요청하기 <span aria-hidden="true">↗</span></button>`}</div>${record?`<p class="worklist-updated">${esc(record.author)}님이 수정 · ${esc(new Date(record.updated_at).toLocaleDateString('ko-KR',{timeZone:'Asia/Seoul'}))}</p>`:''}</article>`;
  }).join('')}</div></section>`;
 }
 document.addEventListener('click',event=>{
  const request=event.target.closest('[data-worklist-request]');if(request)onRequest?.(request.dataset.worklistRequest);
  const photo=event.target.closest('[data-profile-pick]');if(photo&&!uploading)photo.closest('.worklist-card').querySelector('[data-profile-file]')?.click();
  const button=event.target.closest('[data-worklist-edit]');
  if(button&&!busy){
   const user=getState().users.find(user=>user.id===button.dataset.worklistEdit);if(!user)return;
   const record=getState().worklists?.find(row=>row.user_id===user.id);editing={userId:user.id,version:record?.version||0,actor:getUser()?.id};
   dialog.innerHTML=`<div class="dialog-title"><h2>${esc(user.name)}님<br>업무우선순위</h2><button type="button" data-worklist-close aria-label="닫기">✕</button></div><form id="worklist-form"><label>어떤 업무를 먼저 진행하나요?<textarea name="entries" maxlength="4200" rows="8" placeholder="CS 업무&#10;카카오톡 채널 확인&#10;재고 수량 파악">${esc((record?.entries||[]).join('\n'))}</textarea></label><p class="privacy">한 줄에 하나씩, 최대 20개 업무를 입력하세요. 저장한 기본 업무는 다음 날에도 유지되며 모두에게 공유됩니다.</p><p id="worklist-error" class="form-error" role="alert"></p><button type="submit" class="primary">업무우선순위 저장</button></form>`;
   dialog.showModal();dialog.querySelector('textarea').focus();
  }
  if(event.target.closest('[data-worklist-close]')&&!busy)dialog.close();
 });
 document.addEventListener('change',async event=>{
  if(!event.target.matches('[data-profile-file]')||uploading)return;
  const file=event.target.files?.[0];event.target.value='';if(!file)return;
  const actor=getUser()?.id,user=getState().users.find(u=>u.id===actor);if(!user)return;uploading=true;
  try{
   const image=await prepareAvatar(file);
   await api('/api/user-profiles/'+encodeURIComponent(actor)+'/avatar',{method:'PUT',body:{...image,version:user.avatarVersion||0}});
   if(getUser()?.id!==actor)return;uploading=false;await refresh();toast('프로필 사진을 저장했어요.');
  }catch(error){if(getUser()?.id===actor)toast(error.message);}
  finally{uploading=false;}
 });
 dialog.addEventListener('cancel',event=>{if(busy)event.preventDefault();});
 dialog.addEventListener('submit',async event=>{
  event.preventDefault();if(busy||!editing)return;
  const target={...editing},entries=event.target.elements.entries.value.split(/\r?\n/).map(line=>line.trim()).filter(Boolean),button=event.target.querySelector('[type=submit]');busy=true;button.disabled=true;
  try{
   await api('/api/user-worklists/'+encodeURIComponent(target.userId),{method:'PUT',body:{entries,version:target.version}});
   if(getUser()?.id!==target.actor)return;dialog.close();await refresh();toast('업무우선순위를 저장했어요.');
  }catch(error){if(getUser()?.id===target.actor&&dialog.open)dialog.querySelector('#worklist-error').textContent=error.message;}
  finally{busy=false;button.disabled=false;}
 });
 return {renderHome,clear(){editing=null;dialog.close();dialog.replaceChildren();}};
}

export async function prepareAvatar(file){
 if(file.size>5*1024*1024||!['image/png','image/jpeg','image/webp'].includes(file.type))throw new Error('5MB 이하의 PNG·JPG·WebP 사진을 선택해 주세요.');
 let bitmap;try{bitmap=await createImageBitmap(file);}catch{throw new Error('사진을 읽을 수 없습니다. 다른 이미지 파일을 선택해 주세요.');}
 try{
  const canvas=document.createElement('canvas');canvas.width=256;canvas.height=256;const context=canvas.getContext('2d');
  const size=Math.min(bitmap.width,bitmap.height);context.drawImage(bitmap,(bitmap.width-size)/2,(bitmap.height-size)/2,size,size,0,0,256,256);
  const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/webp',.88));if(!blob)throw new Error('사진을 처리할 수 없습니다.');
  const bytes=new Uint8Array(await blob.arrayBuffer());let raw='';for(let offset=0;offset<bytes.length;offset+=32768)raw+=String.fromCharCode(...bytes.subarray(offset,offset+32768));
  return {data:btoa(raw),mime:blob.type};
 }finally{bitmap.close();}
}
