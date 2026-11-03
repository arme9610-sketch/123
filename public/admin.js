const labels={owner:'총괄',admin:'공동관리자',operator:'운영자'};
export function createAdministration({api,escape:esc,getUser,getState,refresh,toast}){
 let busy=false,result=null,logs=null,loading=false,actor='';
 const allowed=()=>['owner','admin'].includes(getUser()?.accessRole);
 function repaint(){const node=document.querySelector('#administration-panel');if(node)node.outerHTML=render();}
 async function loadLogs(){if(loading||!allowed())return;loading=true;const id=getUser().id;try{const data=await api('/api/admin/summary');if(getUser()?.id===id)logs=data.logs;}catch(e){logs=[];toast(e.message);}finally{loading=false;repaint();}}
 function render(){
  if(actor!==getUser()?.id){actor=getUser()?.id;result=null;logs=null;}
  if(!allowed())return '';
  const owner=getUser().accessRole==='owner';
  if(logs===null&&!loading)queueMicrotask(loadLogs);
  return `<section id="administration-panel" class="panel admin-panel"><div class="panel-head"><h2>계정 · 보안 관리</h2><span>${labels[getUser().accessRole]}</span></div><p class="privacy">총괄은 공동관리자·운영자 권한을 부여하고 계정을 관리합니다. 공동관리자는 운영자 계정만 관리합니다. 차단·권한 변경 시 모든 기기에서 로그아웃됩니다.</p><div class="table-wrap"><table><thead><tr><th>직원</th><th>권한</th><th>상태</th><th>관리</th></tr></thead><tbody>${getState().users.map(u=>{
   const can=u.id!==getUser().id&&u.accessRole!=='owner'&&(owner||u.accessRole==='operator');
   return `<tr><th>${esc(u.name)}<small class="tracking">${esc(u.username)}</small></th><td>${owner&&can?`<select data-admin-role="${u.id}" aria-label="${esc(u.name)} 권한" ${busy?'disabled':''}>${['operator','admin'].map(role=>`<option value="${role}" ${role===u.accessRole?'selected':''}>${labels[role]}</option>`).join('')}</select><button type="button" data-admin-save="${u.id}" ${busy?'disabled':''}>권한 저장</button>`:labels[u.accessRole]||'운영자'}</td><td>${u.active===1?'사용 중':'차단됨'}</td><td>${can?`<button type="button" data-admin-toggle="${u.id}" ${busy?'disabled':''}>${u.active===1?'즉시 차단':'차단 해제'}</button><button type="button" data-admin-logout="${u.id}" ${busy?'disabled':''}>전체 기기 로그아웃</button>`:'보호된 계정'}</td></tr>`;
  }).join('')}</tbody></table></div>
  ${owner?`<div class="admin-backup"><h3>암호화 백업 · 복원 검증</h3><p class="privacy">백업 생성 시 운영 자료를 별도 임시 DB에 실제 복원하고, 원본과 일치하는지 검증합니다. 계정 비밀번호 해시·업무·문서·자료실·판매·재고·권한·관리 이력을 포함합니다. 로그인 세션과 초대 코드는 제외합니다. 운영 DB를 덮어쓰는 기능은 제공하지 않습니다.</p><form id="admin-backup-export" class="admin-backup-form"><label>현재 로그인 비밀번호<input name="currentPassword" type="password" autocomplete="current-password" required maxlength="128" ${busy?'disabled':''}></label><label>새 백업 암호 (12자 이상)<input name="backupPassword" type="password" autocomplete="new-password" required minlength="12" maxlength="128" ${busy?'disabled':''}></label><label>백업 암호 확인<input name="confirmPassword" type="password" autocomplete="new-password" required minlength="12" maxlength="128" ${busy?'disabled':''}></label><button class="primary" ${busy?'disabled':''}>백업 생성 · 검증 후 다운로드</button></form><p class="privacy">내려받은 파일과 백업 암호를 서로 다른 안전한 곳에 보관하세요. 암호를 분실하면 백업을 복호화할 수 없습니다.</p><details><summary>보관한 백업 파일 복원 검증</summary><form id="admin-backup-verify" class="admin-backup-form"><label>암호화 백업 파일<input name="backupFile" type="file" accept=".json" required ${busy?'disabled':''}></label><label>현재 로그인 비밀번호<input name="currentPassword" type="password" autocomplete="current-password" required maxlength="128" ${busy?'disabled':''}></label><label>이 파일의 백업 암호<input name="backupPassword" type="password" autocomplete="off" required minlength="12" maxlength="128" ${busy?'disabled':''}></label><button ${busy?'disabled':''}>별도 DB에 복원 검증</button></form></details><p class="privacy">서비스 제공자의 자동 백업·시점 복원 설정은 아직 확인되지 않았습니다. 이 검증은 다운로드한 데이온 논리 백업에 대한 검사입니다.</p></div>`:''}
  <div role="status" class="admin-result">${busy?'처리 중입니다. 잠시 기다려 주세요.':result?`복원 검증 성공 · ${esc(new Date(result.checkedAt).toLocaleString('ko-KR',{timeZone:'Asia/Seoul'}))}<br>운영 데이터 변경 없음 · ${Object.entries(result.counts).map(([table,n])=>`${esc(table)} ${n}행`).join(' · ')}`:''}</div>
  <details class="admin-logs"><summary>최근 관리자 작업 이력</summary><button type="button" id="admin-logs-reload" ${busy?'disabled':''}>새로 불러오기</button>${logs?.length?`<ul>${logs.map(log=>`<li>${esc(new Date(log.created_at).toLocaleString('ko-KR',{timeZone:'Asia/Seoul'}))} · ${esc(log.actor_name)} · ${esc(({item_deleted:'일정 · 업무 삭제',backup_startup_verified:'운영 자료 최초 백업·복원 검증',owner_assigned:'총괄 권한 지정',account_access:'계정 권한·상태 변경',logout_all:'전체 기기 로그아웃',backup_export_verified:'백업 생성·복원 검증',backup_restore_verified:'보관 백업 복원 검증'})[log.action]||log.action)}${log.target_id?' · '+esc(getState().users.find(u=>u.id===log.target_id)?.name||'계정'):''}</li>`).join('')}</ul>`:'<p>아직 작업 이력이 없습니다.</p>'}</details></section>`;
 }
 document.addEventListener('click',async e=>{
  if(e.target.closest('#admin-logs-reload')){logs=null;await loadLogs();return;}
  const button=e.target.closest('[data-admin-save],[data-admin-toggle],[data-admin-logout]');if(!button||busy||!allowed())return;
  const id=button.dataset.adminSave||button.dataset.adminToggle||button.dataset.adminLogout,u=getState().users.find(u=>u.id===id);if(!u)return;
  const logout=!!button.dataset.adminLogout,toggle=!!button.dataset.adminToggle,role=toggle?u.accessRole:document.querySelector(`[data-admin-role="${id}"]`)?.value;
  const action=logout?'모든 기기에서 로그아웃':toggle?(u.active===1?'즉시 차단':'차단 해제'):`${labels[role]} 권한으로 변경`;
  if(!confirm(`${u.name}님을 ${action}하시겠어요? 기존 업무 기록은 유지됩니다.`))return;
  busy=true;repaint();try{await api(`/api/admin/users/${encodeURIComponent(id)}/${logout?'logout-all':'access'}`,{method:'POST',body:{version:u.accessVersion,...(!logout?{accessRole:role,active:toggle?u.active!==1:u.active===1}:{})}});await refresh();logs=null;toast('계정 관리 작업을 적용했어요.');}catch(error){toast(error.message);await refresh().catch(()=>{});}finally{busy=false;repaint();}
 });
 document.addEventListener('submit',async e=>{
  if(!['admin-backup-export','admin-backup-verify'].includes(e.target.id))return;e.preventDefault();if(busy||getUser()?.accessRole!=='owner')return;
  const form=e.target,exporting=form.id==='admin-backup-export',fields=new FormData(form),user=getUser().id;
  const currentPassword=fields.get('currentPassword'),backupPassword=fields.get('backupPassword');
  if(exporting&&backupPassword!==fields.get('confirmPassword')){toast('백업 암호와 확인 값이 다릅니다.');return;}
  const file=fields.get('backupFile');if(!exporting&&(!file||file.size>68*1024*1024)){toast('68MB 이하의 백업 파일을 선택해 주세요.');return;}
  form.reset();busy=true;result=null;repaint();
  try{
   let backup;if(!exporting)backup=JSON.parse(await file.text());
   const response=await api('/api/admin/backups/'+(exporting?'export':'verify'),{method:'POST',body:{currentPassword,backupPassword,...(!exporting?{backup}:{})}});
   if(getUser()?.id!==user)return;result=response.verification;logs=null;
   if(exporting){const blob=new Blob([JSON.stringify(response.backup)],{type:'application/json'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download='dayon-'+new Date().toISOString().replace(/[:.]/g,'-')+'.dayon-backup.json';document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),30000);}
   toast('별도 DB 복원 검증을 완료했어요. 운영 자료는 변경하지 않았습니다.');
  }catch(error){toast(error instanceof SyntaxError?'올바른 암호화 백업 파일을 선택해 주세요.':error.message);}finally{busy=false;repaint();}
 });
 return {render,clear(){busy=false;result=null;logs=null;actor='';}};
}
