const $ = selector => document.querySelector(selector);
const today = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Seoul' }).format(new Date());
const base = new Date(today + 'T12:00:00');
const types = { task: ['업무', 'blue'], inbound: ['입고', 'purple'], shipment: ['발송', 'orange'], meeting: ['일정', 'green'] };
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
let state = { items: [], users: [], messages: [], stock: {}, revision: -1 };
let currentUser = null, csrfToken = '', eventStream = null;
let page = '오늘', month = new Date(base.getFullYear(), base.getMonth(), 1), view = '달력', filter = '전체', taskTab = '전체 업무';
let invitations = [], inviteResult = null, authMode = 'login', toastTimer;
let inviteToken = new URLSearchParams(location.hash.slice(1)).get('invite') || '';
if (inviteToken) history.replaceState(null, '', location.pathname + location.search);

class ApiError extends Error {
  constructor(message, status) { super(message); this.status = status; }
}
async function api(url, { method = 'GET', body, signal } = {}) {
  const headers = { Accept: 'application/json' };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (method !== 'GET' && csrfToken) headers['X-CSRF-Token'] = csrfToken;
  let response;
  try {
    response = await fetch(url, { method, headers, signal, credentials: 'same-origin', body: body === undefined ? undefined : JSON.stringify(body) });
  } catch (error) {
    if (error.name === 'AbortError') throw error;
    throw new ApiError('서버에 연결할 수 없어요. 연결을 확인한 후 다시 시도해 주세요.', 0);
  }
  const result = await response.json().catch(() => ({}));
  if (!response.ok) {
    if (response.status === 401 && currentUser) signedOut('로그인이 만료되었어요. 다시 로그인해 주세요.');
    throw new ApiError(result.error || '요청을 처리하지 못했어요.', response.status);
  }
  return result;
}
function toast(text) {
  clearTimeout(toastTimer);
  $('#toast').textContent = text;
  $('#toast').classList.add('show');
  toastTimer = setTimeout(() => $('#toast').classList.remove('show'), 3500);
}
function connection(text, connected = false) {
  $('#connection').textContent = text;
  $('#connection').classList.toggle('connected', connected);
}
function signedOut(message = '') {
  eventStream?.close(); eventStream = null;
  currentUser = null; csrfToken = ''; state = { items: [], users: [], messages: [], stock: {}, revision: -1 };
  invitations = []; inviteResult = null; page = '오늘';searches={};collectionData={};chatSearchActive=false;collectionRequest++;
  $('#manual-dialog').close();$('#resource-dialog').close();
  $('#dialog').close(); $('#main').replaceChildren(); $('#workspace-screen').hidden = true;
  showAuth(inviteToken ? 'join' : 'login', message);
}
function showAuth(mode, error = '') {
  authMode = mode; $('#boot').hidden = true; $('#auth-screen').hidden = false;
  const setup = mode === 'setup', join = mode === 'join';
  $('#auth-screen').innerHTML = `<div class="auth-intro"><a class="brand" href="/">데이온<span>DAYON workspace</span></a><h1>우리 팀의 하루를,<br>데이온에서 함께.</h1><p>업무, 일정, 입고와 택배 발송까지.<br>함께 보고 함께 움직이는 우리 회사의 공간입니다.</p><div class="auth-art">✦<span>TEAM WORKSPACE</span></div></div>
    <div class="auth-card"><p class="eyebrow">WELCOME TO DAYON</p><h2>${setup ? '우리 회사 공간 만들기' : join ? '우리 팀에 합류하기' : '다시 만나 반가워요'}</h2><p class="subtitle">${setup ? '관리자 계정으로 팀의 첫 시작을 준비하세요.' : join ? '관리자가 전달한 초대로 직원 계정을 만드세요.' : '직원 계정으로 로그인해 오늘의 흐름을 확인하세요.'}</p>
    <form id="auth-form">
      ${setup ? '<label>초기 설정 키<input name="setupToken" type="password" autocomplete="off" required placeholder="서버의 초기 설정 키"></label><label>이름<input name="name" required maxlength="30" autocomplete="name" placeholder="표시할 이름"></label>' : ''}
      ${join ? `<label>직원 초대 코드<input name="inviteToken" type="password" autocomplete="off" required value="${esc(inviteToken)}" placeholder="관리자에게 받은 코드"></label>` : '<label>아이디<input name="username" autocomplete="username" required minlength="3" maxlength="40" pattern="[a-zA-Z0-9_.-]+" placeholder="영문, 숫자 3~40자"></label>'}
      <label>${setup || join ? '새 비밀번호' : '비밀번호'}<input name="password" type="password" autocomplete="${setup || join ? 'new-password' : 'current-password'}" required minlength="10" maxlength="128" placeholder="${setup || join ? '10자 이상의 비밀번호' : '비밀번호를 입력하세요'}"></label>
      ${setup || join ? '<label>비밀번호 확인<input name="confirmPassword" type="password" autocomplete="new-password" required minlength="10" maxlength="128" placeholder="비밀번호를 한 번 더 입력하세요"></label>' : ''}
      <p id="auth-error" class="form-error" role="alert">${esc(error)}</p><button class="primary submit">${setup ? '워크스페이스 시작하기' : join ? '가입하고 시작하기' : '로그인'}</button>
    </form>${setup ? '<p class="auth-note">초기 설정 키는 서버의 data/setup-token 파일 또는 서버 관리자가 설정한 키를 사용하세요. 관리자 생성 후에는 사용할 수 없습니다.</p>' : `<button class="auth-switch" data-auth="${join ? 'login' : 'join'}">${join ? '이미 계정이 있나요? 로그인' : '직원 초대를 받으셨나요? 계정 만들기'}</button>`}</div>`;
}
async function authenticate(form) {
  const data = Object.fromEntries(new FormData(form));
  if ('confirmPassword' in data && data.password !== data.confirmPassword) {
    $('#auth-error').textContent = '비밀번호가 서로 일치하지 않아요.'; return;
  }
  const submit = form.querySelector('button[type=submit], button.submit'); submit.disabled = true;
  $('#auth-error').textContent = '';
  try {
    const endpoint = authMode === 'setup' ? 'setup' : authMode === 'join' ? 'join' : 'login';
    delete data.confirmPassword;
    const result = await api(`/api/${endpoint}`, { method: 'POST', body: data });
    currentUser = result.user; csrfToken = result.csrfToken; inviteToken = ''; page = '오늘';
    form.reset(); await startWorkspace();
  } catch (error) {
    if (currentUser) { currentUser = null; csrfToken = ''; }
    $('#auth-error').textContent = error.message;
  } finally { submit.disabled = false; }
}
let fetchingState = null, refreshAgain = false;
async function refreshState() {
  if (fetchingState) { refreshAgain = true; return fetchingState; }
  const userId = currentUser?.id;
  fetchingState = (async () => {
    do {
      refreshAgain = false;
      const next = await api('/api/state');
      if (currentUser?.id === userId && next.revision >= state.revision) { state = next; render(); }
    } while (refreshAgain && currentUser?.id === userId);
  })();
  try { await fetchingState; } finally { fetchingState = null; }
}
async function startWorkspace() {
  await refreshState();
  $('#boot').hidden = true; $('#auth-screen').hidden = true; $('#auth-screen').replaceChildren();
  $('#workspace-screen').hidden = false;
  connectEvents();
}
function connectEvents() {
  eventStream?.close();
  const stream = new EventSource('/api/events'); eventStream = stream;
  connection('실시간 연결 중');
  stream.onopen = () => connection('실시간 연결됨', true);
  stream.addEventListener('change', () => {
    refreshState().then(() => { if (collections[page]) loadCollection(page); if (currentUser?.role === 'admin' && page === '팀 관리') return refreshInvitations(); }).catch(error => { if (currentUser) connection('동기화 지연 · 재연결 중'); });
  });
  stream.onerror = async () => {
    if (eventStream !== stream || !currentUser) return;
    connection('연결이 끊겼어요 · 자동 재연결 중');
    try { await api('/api/session'); } catch { /* 401 transitions to login; network failure will reconnect. */ }
  };
}
const icons = ['◫', '☑', '▦', '▤', '▧', '◌', '▣', '▤', '▧', '⚙'];
function nav() {
  const pages = ['오늘', '업무', '공용 달력', '입고 · 재고', '택배 발송', '팀 채팅', '아카이브', '매뉴얼', '자료실', ...(currentUser.role === 'admin' ? ['팀 관리'] : [])];
  $('#nav').innerHTML = pages.map((p, i) => `<button class="${page === p ? 'active' : ''}" data-page="${p}"><span aria-hidden="true">${icons[i]}</span>${p}</button>`).join('');
  $('#breadcrumb').textContent = page;
  $('#profile-avatar').textContent = currentUser.name[0];
  $('#profile-name').textContent = currentUser.name;
  $('#profile-role').textContent = currentUser.role === 'admin' ? '워크스페이스 관리자' : '팀 멤버';
  $('#team-size').textContent = `팀 워크스페이스 · ${state.users.length}명`;
}
function renderTeam() {
  return `<div class="members">${state.users.map((user, i) => `<div><div class="avatar av${i}">${esc(user.name[0])}</div><b>${esc(user.name)}</b><small>${user.id === currentUser.id ? '나 · ' : ''}${user.role === 'admin' ? '관리자' : '팀 멤버'}</small></div>`).join('')}</div>`;
}
function teamSettings() {
  return heading('함께할 팀원을 초대하세요', '직원별 계정으로 안전하게 접속하고, 같은 업무와 일정을 공유하세요.') +
    `<section class="panel"><div class="panel-head"><h2>우리 팀</h2><span class="muted">${state.users.length} / 4명 가입</span></div>${renderTeam()}</section>
    <section class="panel invite-panel"><div class="panel-head"><h2>직원 초대</h2><span class="muted">초대는 24시간 동안 유효해요</span></div>
    ${state.users.length + invitations.length >= 4 ? '<div class="empty">팀 정원 4명에 도달했어요. 대기 중인 초대도 정원에 포함됩니다.</div>' : '<form id="invite-form" class="invite-form"><label>직원 이름<input name="name" required maxlength="30" placeholder="초대할 직원 이름"></label><label>로그인 아이디<input name="username" required minlength="3" maxlength="40" pattern="[a-zA-Z0-9_.-]+" placeholder="영문, 숫자 3~40자"></label><button class="primary">초대 만들기</button></form>'}
    ${inviteResult ? `<div class="invite-result"><b>${esc(inviteResult.name)}님 초대가 준비되었어요.</b><p>초대 링크를 직원에게 직접 전달해 주세요. 직원이 자신의 비밀번호를 설정합니다.</p><div class="copy-row"><input id="invite-link" readonly aria-label="직원 초대 링크" value="${esc(location.origin + '/#invite=' + encodeURIComponent(inviteResult.inviteToken))}"><button id="copy-invite" class="primary">복사</button></div><small>이 링크는 지금만 확인할 수 있어요. 분실하면 초대를 취소하고 다시 만들어 주세요.</small></div>` : ''}
    <div class="pending-invites">${invitations.length ? invitations.map(i => `<div class="pending-invite"><div><b>${esc(i.name)}</b><small>${esc(i.username)} · ${esc(new Date(i.expiresAt).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' }))}까지</small></div><button data-revoke="${esc(i.id)}">초대 취소</button></div>`).join('') : empty('대기 중인 초대가 없습니다.')}</div></section>`;
}
async function refreshInvitations() {
  const result = await api('/api/invitations'); invitations = result.invitations;
  if (page === '팀 관리' && currentUser) render();
}

function badge(i){return `<span class="badge ${types[i.type][1]}">${types[i.type][0]}</span>`}
function row(i){return `<div class="item"><button class="check ${i.done?'checked':''}" data-done="${i.id}" aria-label="${esc(i.title)} ${i.done?'완료 취소':'완료 처리'}">${i.done?'✓':''}</button><div class="item-text"><b class="${i.done?'strike':''}">${esc(i.title)}</b><small>${esc(i.note)||'등록된 메모가 없습니다.'}</small></div>${badge(i)}<span class="person">${esc(i.owner)}</span><button class="dots" data-edit="${i.id}" aria-label="상세 보기">↗</button></div>`}
function heading(title,sub,extra=''){return `<div class="heading"><div><p class="eyebrow">OUR TEAM, ONE FLOW</p><h1>${title}</h1><p class="subtitle">${sub}</p></div>${extra}</div>`}
function render(){if(!currentUser)return;const preserved=captureDraft();nav();let html='';const due=state.items.filter(i=>i.date===today), pending=due.filter(i=>!i.done), completed=due.filter(i=>i.done).length;
if(page==='오늘'){html=heading(`좋은 하루예요, ${esc(currentUser.name)}님 <span class="wave">☀</span>`,'오늘도 우리 팀의 하루를 한눈에 확인하세요.',`<div class="date-pill">${base.getFullYear()}년 ${base.getMonth()+1}월 ${base.getDate()}일 <b>${['일','월','화','수','목','금','토'][base.getDay()]}요일</b></div>`)+`<section class="welcome"><div><span class="tag">TEAM WORKSPACE</span><h2>함께하면, 오늘도 가볍게.</h2><p>할 일부터 입고와 발송까지.<br>우리 팀의 모든 흐름을 한눈에.</p><button data-page="공용 달력">팀 일정 살펴보기 <span>↗</span></button></div><div class="art" aria-hidden="true"><div class="art-card"><span>THIS IS OUR DAY</span><strong>${base.getDate()}</strong><div>✦ &nbsp; Make it happen</div></div><div class="art-check">✓</div><span class="spark">✦</span><div class="art-line"></div></div></section><section class="stats">${[['오늘 할 일',pending.filter(i=>i.type==='task').length,'건','blue','☑','업무'],['입고 예정',pending.filter(i=>i.type==='inbound').reduce((a,i)=>a+i.qty,0),'개','purple','↓','입고 · 재고'],['발송할 택배',pending.filter(i=>i.type==='shipment').length,'건','orange','▧','택배 발송'],['오늘 완료',completed,'건','green','✓','업무']].map(a=>`<button class="stat" data-page="${a[5]}"><div><span>${a[0]}</span><i class="${a[3]}">${a[4]}</i></div><strong>${a[1]}<small>${a[2]}</small></strong><p>${a[0]==='오늘 완료'?'차근차근 잘하고 있어요':'우리 팀이 함께 확인해요'} <span>↗</span></p></button>`).join('')}</section><div class="dashboard-grid"><section class="panel"><div class="panel-head"><h2>오늘의 업무 <span>${due.filter(i=>i.type==='task').length}</span></h2><button data-page="업무">전체 보기 →</button></div>${due.filter(i=>i.type==='task').map(row).join('')||empty('오늘 등록된 업무가 없어요.')}<button class="add-row" data-new="task">＋ 새로운 업무 추가</button></section><section class="panel"><div class="panel-head"><h2>함께하는 팀</h2><span class="muted">${state.users.length}명의 멤버</span></div>${renderTeam()}<div class="team-note">${state.users.length<4&&currentUser.role==='admin'?'직원을 초대하고 함께 시작해 보세요.<button data-page="팀 관리">팀원 초대하기 ↗</button>':'작은 공유가 더 나은 협업을 만들어요.<button data-page="팀 채팅">팀 채팅 열기 ↗</button>'}</div></section></div><section class="panel schedule"><div class="panel-head"><h2>오늘의 입고 & 발송 <span>${due.filter(i=>['inbound','shipment'].includes(i.type)).length}</span></h2><button data-page="공용 달력">달력에서 보기 →</button></div>${table(due.filter(i=>['inbound','shipment'].includes(i.type)))}</section>`;
}else if(page==='공용 달력'){html=heading('우리 팀의 일정','입고, 발송, 업무 일정을 함께 확인하고 준비하세요.',`<button class="primary" data-new="meeting">＋ 일정 등록</button>`)+`<section class="panel"><div class="calendar-toolbar"><div class="month-controls"><button id="prev" aria-label="이전 달">‹</button><h2>${month.getFullYear()}년 ${month.getMonth()+1}월</h2><button id="next" aria-label="다음 달">›</button><button id="this-month">이번 달</button></div><div class="segmented">${['달력','표'].map(v=>`<button data-view="${v}" class="${view===v?'selected':''}">${v}</button>`).join('')}</div></div><div class="filters">${['전체',...Object.values(types).map(v=>v[0])].map(f=>`<button data-filter="${f}" class="${f===filter?'selected':''}">${f}</button>`).join('')}<span>● 입고 &nbsp; ● 발송 &nbsp; ● 업무 &nbsp; ● 일정</span></div>${view==='달력'?calendar():table(filtered().filter(i=>i.date.startsWith(`${month.getFullYear()}-${String(month.getMonth()+1).padStart(2,'0')}`)))}</section>`;
}else if(page==='업무'){const items=state.items.filter(i=>i.type==='task'&&(taskTab!=='내 업무'||i.ownerId===currentUser.id));html=heading('업무를 함께, 차근차근','담당자와 마감일을 정하고 진행 상황을 공유하세요.',`<button class="primary" data-new="task">＋ 업무 요청</button>`)+`<div class="tabs">${['전체 업무','내 업무','부탁한 업무'].map(t=>`<button data-tab="${t}" class="${taskTab===t?'selected':''}">${t}</button>`).join('')}</div><section class="panel">${(taskTab==='부탁한 업무'?items.filter(i=>i.requesterId===currentUser.id):items).map(row).join('')||empty('아직 등록된 업무가 없어요.')}</section>`;
}else if(page==='입고 · 재고'||page==='택배 발송'){let type=page==='택배 발송'?'shipment':'inbound';html=heading(page==='택배 발송'?'꼼꼼하게, 택배 발송':'미리 보는 입고, 정확한 재고',type==='shipment'?'발송 예정부터 운송장까지 한곳에서 관리하세요.':'입고 예정 수량은 실제 입고를 완료한 뒤 재고에 반영됩니다.',`<button class="primary" data-new="${type}">＋ ${type==='shipment'?'발송':'입고'} 등록</button>`)+`<section class="panel">${table(state.items.filter(i=>i.type===type))}</section>`+(type==='inbound'?`<section class="panel stock"><div class="panel-head"><h2>입고 완료 재고</h2><span class="muted">등록된 입고의 누적 수량 · 출고 차감 미지원</span></div>${Object.entries(state.stock).map(([k,v])=>`<div class="stock-row"><b>${esc(k)}</b><span>${v}개</span></div>`).join('')||empty('입고를 완료하면 확인된 수량이 이곳에 표시됩니다.')}</section>`:'');
}else if(page==='팀 관리'){html=teamSettings();}else if(page==='아카이브'){html=archivePage();}else if(['매뉴얼','자료실'].includes(page)){html=libraryPage(page);}else{html=chatPage();}
$('#main').innerHTML=html;restoreDraft(preserved);
}
function empty(t){return `<div class="empty">${t}</div>`}
function filtered(){return state.items.filter(i=>filter==='전체'||types[i.type][0]===filter)}
function table(items){return `<div class="table-wrap"><table><thead><tr><th>일정 / 내용</th><th>날짜</th><th>수량</th><th>담당자</th><th>상태</th><th></th></tr></thead><tbody>${items.map(i=>`<tr><td>${badge(i)} <button class="text-button" data-edit="${i.id}">${esc(i.title)}</button>${i.tracking?`<small class="tracking">${esc(i.tracking)}</small>`:''}</td><td>${esc(i.date.slice(5).replace('-','.'))}</td><td>${i.qty}${i.type==='shipment'?'건':'개'}</td><td><span class="mini-avatar">${esc(i.owner[0])}</span> ${esc(i.owner)}</td><td><span class="status ${i.done?'done':''}">${i.done?'완료':'예정'}</span></td><td><button class="complete" data-done="${i.id}">${i.done?'완료 취소':'완료 처리'}</button></td></tr>`).join('')}</tbody></table>${items.length?'':empty('등록된 일정이 없습니다.')}</div>`}
function calendar(){let start=new Date(month);start.setDate(1-start.getDay());return `<div class="weekdays">${['일','월','화','수','목','금','토'].map(w=>`<span>${w}</span>`).join('')}</div><div class="calendar">${Array.from({length:42},(_,n)=>{let d=new Date(start);d.setDate(d.getDate()+n);let date=`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;return `<div class="day ${d.getMonth()!==month.getMonth()?'outside':''}"><button class="day-number ${date===today?'is-today':''}" data-date="${date}" aria-label="${date} 일정 추가">${d.getDate()}</button>${filtered().filter(i=>i.date===date).map(i=>`<button class="event ${types[i.type][1]} ${i.done?'finished':''}" data-edit="${i.id}">${esc(i.title)}${i.type==='inbound'?` · ${i.qty}개`:''}</button>`).join('')}</div>`}).join('')}</div>`}

// Preserve unsent messages and invitations when another teammate changes shared data.
function captureDraft() {
  const active = document.activeElement;
  const forms = [...document.querySelectorAll('#main form')].map(form => ({
    id: form.id,
    fields: [...form.elements].filter(el => el.name).map(el => [el.name, el.value]),
  }));
  const focus = active?.closest('#main form') && active.name ? {
    form: active.form.id, name: active.name,
    start: active.selectionStart, end: active.selectionEnd,
  } : null;
  const messages = $('.messages');
  return { forms, focus, scroll: messages?.scrollTop, nearEnd: !messages || messages.scrollHeight - messages.scrollTop - messages.clientHeight < 60 };
}
function restoreDraft(draft) {
  for (const saved of draft.forms) {
    const form = document.getElementById(saved.id);
    for (const [name, value] of saved.fields) if (form?.elements[name]) form.elements[name].value = value;
  }
  if (draft.focus) {
    const input = document.getElementById(draft.focus.form)?.elements[draft.focus.name];
    if (input) { input.focus({ preventScroll: true }); if (draft.focus.start !== null && typeof input.setSelectionRange==='function' && ['text','search','textarea'].includes(input.type)) input.setSelectionRange(draft.focus.start, draft.focus.end); }
  }
  const messages = $('.messages');
  if (messages) messages.scrollTop = chatSearchActive ? (draft.scroll||0) : draft.nearEnd ? messages.scrollHeight : draft.scroll;
}

let editing = null, editingVersion = null;
function openForm(type = 'task', date = today, id = null) {
  const item = state.items.find(i => i.id === id), form = $('#form');
  editing = id; editingVersion = item?.version ?? null;
  form.reset(); $('#form-error').textContent = '';
  form.querySelector('.submit').disabled = false;
  form.elements.type.value = item?.type || type;
  form.elements.date.value = item?.date || date;
  form.elements.ownerId.innerHTML = state.users.map(user => `<option value="${esc(user.id)}">${esc(user.name)}</option>`).join('');
  form.elements.ownerId.value = item?.ownerId || currentUser.id;
  for (const field of ['title', 'qty', 'note', 'tracking']) if (item) form.elements[field].value = item[field] ?? '';
  $('#form-title').textContent = item ? '일정 상세 · 수정' : '새로운 일정 등록';
  if (item?.done) { $('#form-error').textContent = '수정하려면 먼저 완료를 취소해 주세요.'; form.querySelector('.submit').disabled = true; }
  $('#dialog').showModal();
}
async function saveItem(form) {
  const data = Object.fromEntries(new FormData(form));
  data.title = data.title.trim(); data.qty = Number(data.qty);
  if (!data.title) { $('#form-error').textContent = '내용을 입력해 주세요.'; return; }
  const button = form.querySelector('.submit'); button.disabled = true;
  $('#form-error').textContent = '';
  let stale = false;
  try {
    if (editing) data.version = editingVersion;
    await api(editing ? `/api/items/${encodeURIComponent(editing)}` : '/api/items', { method: editing ? 'PUT' : 'POST', body: data });
    $('#dialog').close();
    await refreshState(); toast('일정을 저장했어요.');
  } catch (error) {
    if (error.status === 409) { stale = true; await refreshState().catch(() => {}); }
    $('#form-error').textContent = error.message + (stale ? ' 창을 닫고 다시 열어 최신 내용을 확인해 주세요.' : '');
  } finally { button.disabled = stale; }
}
async function navigate(nextPage) {
  page = nextPage; render();
  if (page === '팀 관리') await refreshInvitations();
  if (collections[page]) await loadCollection(page);
}
async function handleClick(button) {
  if (button.dataset.auth) { showAuth(button.dataset.auth); return; }
  if (!currentUser) return;
  await collectionClick(button);
  if (button.dataset.page) await navigate(button.dataset.page);
  if (button.dataset.new) openForm(button.dataset.new);
  if (button.dataset.edit) openForm('task', today, button.dataset.edit);
  if (button.dataset.date) openForm('meeting', button.dataset.date);
  if (button.dataset.view) { view = button.dataset.view; render(); }
  if (button.dataset.filter) { filter = button.dataset.filter; render(); }
  if (button.dataset.tab) { taskTab = button.dataset.tab; render(); }
  if (['prev', 'next', 'this-month'].includes(button.id)) {
    month = button.id === 'this-month' ? new Date(base.getFullYear(), base.getMonth(), 1) : new Date(month.getFullYear(), month.getMonth() + (button.id === 'next' ? 1 : -1), 1);
    render();
  }
  if (button.dataset.done) {
    const item = state.items.find(i => i.id === button.dataset.done); button.disabled = true;
    try {
      await api(`/api/items/${encodeURIComponent(item.id)}/toggle`, { method: 'POST', body: { version: item.version } });
      await refreshState();if(page==='아카이브')await loadCollection(page); toast(item.done ? '완료를 취소했어요.' : '완료 처리했어요.');
    } catch (error) {
      if (error.status === 409) await refreshState().catch(() => {});
      throw error;
    } finally { button.disabled = false; }
  }
  if (button.dataset.revoke) {
    button.disabled = true;
    try {
      await api(`/api/invitations/${encodeURIComponent(button.dataset.revoke)}`, { method: 'DELETE' });
      inviteResult = null; await refreshInvitations(); toast('초대를 취소했어요.');
    } finally { button.disabled = false; }
  }
  if (button.id === 'copy-invite') {
    try { await navigator.clipboard.writeText($('#invite-link').value); toast('초대 링크를 복사했어요. 직원에게 전달해 주세요.'); }
    catch { $('#invite-link').focus(); $('#invite-link').select(); toast('선택된 초대 링크를 복사해 주세요.'); }
  }
}
document.addEventListener('click', event => {
  const button = event.target.closest('button');
  if (button) handleClick(button).catch(error => toast(error.message));
});
$('#add-top').onclick = () => ['매뉴얼','자료실'].includes(page)?(currentUser.role==='admin'?openLibrary(page):toast('등록은 관리자에게 요청해 주세요.')):openForm(page === '택배 발송' ? 'shipment' : page === '입고 · 재고' ? 'inbound' : 'task');
$('#close').onclick = () => $('#dialog').close();
$('#logout').onclick = async () => {
  try { await api('/api/logout', { method: 'POST', body: {} }); signedOut(); }
  catch (error) { toast(error.message); }
};
document.addEventListener('submit', async event => {
  const form = event.target; event.preventDefault();
  if (currentUser && await collectionSubmit(form)) return;
  if (form.id === 'auth-form') { await authenticate(form); return; }
  if (form.id === 'form') { await saveItem(form); return; }
  if (!currentUser) return;
  const button = form.querySelector('button');
  if (button.disabled) return;
  button.disabled = true;
  try {
    if (form.id === 'chat-form') {
      const text = form.elements.message.value.trim(); if (!text) return;
      await api('/api/messages', { method: 'POST', body: { text } });
      // Clear only after a successful send, including the live form if SSE rendered it again.
      const input = $('#chat-form')?.elements.message;
      if (input?.value.trim() === text) input.value = '';
      await refreshState();
      if ($('.messages')) $('.messages').scrollTop = $('.messages').scrollHeight;
    }
    if (form.id === 'invite-form') {
      inviteResult = await api('/api/invitations', { method: 'POST', body: Object.fromEntries(new FormData(form)) });
      $('#invite-form')?.reset(); await refreshInvitations();
      toast('초대를 만들었어요. 링크를 직원에게 전달해 주세요.');
    }
  } catch (error) { toast(error.message); }
  finally { button.disabled = false; }
});
document.addEventListener('visibilitychange', () => {
  if (!document.hidden && currentUser) refreshState().catch(error => { if (currentUser) connection('서버 연결을 확인해 주세요'); });
});
async function initialize() {
  try {
    const status = await api('/api/status');
    if (!status.initialized) { showAuth('setup'); return; }
    if (inviteToken) { showAuth('join'); return; }
    try {
      const session = await api('/api/session'); currentUser = session.user; csrfToken = session.csrfToken;
      await startWorkspace();
    } catch (error) {
      if (error.status === 401) showAuth('login'); else throw error;
    }
  } catch (error) {
    $('#boot').hidden = true; $('#auth-screen').hidden = false;
    $('#auth-screen').innerHTML = `<div class="auth-card"><h2>연결을 확인해 주세요</h2><p class="subtitle">${esc(error.message)}</p><button id="retry-init" class="primary submit">다시 연결</button></div>`;
    $('#retry-init').onclick = initialize;
  }
}
// Shared archive, manual, resource and complete chat-history search.
const collections = {'아카이브':'archive','매뉴얼':'manuals','자료실':'resources','팀 채팅':'messages/search'};
let searches = {}, collectionData = {}, collectionRequest = 0, chatSearchActive = false;
const dateLabel = value => value ? new Date(value).toLocaleString('ko-KR',{timeZone:'Asia/Seoul',year:'numeric',month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'}) : '완료일 미기록';
function searchFields(kind) {
 const query=searches[kind]||{}, chat=kind==='팀 채팅', detailed=chat||kind==='아카이브';
 return `<form id="collection-search" data-kind="${kind}" class="collection-search"><label class="query-field">검색어<input name="q" value="${esc(query.q||'')}" maxlength="100" placeholder="${chat?'대화 내용 검색':kind==='아카이브'?'제목, 메모, 운송장 검색':'제목, 분류, 내용 검색'}"></label>${detailed?`<label>${chat?'작성자':'담당자'}<select name="${chat?'authorId':'ownerId'}"><option value="">전체 직원</option>${state.users.map(u=>`<option value="${esc(u.id)}" ${query[chat?'authorId':'ownerId']===u.id?'selected':''}>${esc(u.name)}</option>`).join('')}</select></label>${chat?'':`<label>구분<select name="type"><option value="">전체</option>${Object.entries(types).map(([k,v])=>`<option value="${k}" ${query.type===k?'selected':''}>${v[0]}</option>`).join('')}</select></label>`}<label>${chat?'대화':'업무 예정'} 시작일<input name="from" type="date" value="${esc(query.from||'')}"></label><label>종료일<input name="to" type="date" value="${esc(query.to||'')}"></label>`:''}<button class="primary">검색</button><button type="button" data-reset-search="${kind}" class="reset-search">초기화</button></form>`;
}
async function loadCollection(kind=page, append=false) {
 if(!collections[kind] || (kind==='팀 채팅'&&!chatSearchActive))return;
 const request=++collectionRequest,user=currentUser?.id,params={...(searches[kind]||{})};
 const old=collectionData[kind];params.offset=append?(old?.results.length||0):0;
 collectionData[kind]={...old,loading:true,error:''};if(page===kind)render();
 try{
  const next=await api('/api/'+collections[kind]+'?'+new URLSearchParams(params));
  if(request!==collectionRequest||currentUser?.id!==user)return;
  collectionData[kind]={...next,results:append?[...(old?.results||[]),...next.results]:next.results};
 }catch(error){if(request===collectionRequest&&currentUser?.id===user)collectionData[kind]={...old,error:error.message};}
 if(currentUser&&page===kind)render();
}
function collectionBody(kind, renderItem) {
 const data=collectionData[kind];
 if(data?.error)return `<p class="form-error collection-note" role="alert">${esc(data.error)}</p>`;
 if(!data||(!data.results&&data.loading))return empty('기록을 불러오고 있어요…');
 return (data.results?.length?data.results.map(renderItem).join(''):empty('조건에 맞는 기록이 없습니다.'))+(data.hasMore?`<button class="add-row" data-more="${kind}" ${data.loading?'disabled':''}>${data.loading?'불러오는 중…':'다음 기록 더 보기'}</button>`:'');
}
function archivePage() {
 return heading('완료한 일도, 언제든 다시','완료된 업무·입고·발송·일정을 찾아보고 필요한 내용을 확인하세요.')+`<section class="panel">${searchFields('아카이브')}<div class="collection-note">날짜는 업무 예정일 기준입니다. 완료를 취소하면 아카이브에서 빠지고 입고 재고에도 반영됩니다.</div>${collectionBody('아카이브',i=>`<div class="archive-entry">${row(i)}<small>예정일 ${esc(i.date)} · 완료 ${esc(dateLabel(i.completedAt))}</small></div>`)}</section>`;
}
function libraryPage(kind) {
 const manual=kind==='매뉴얼';
 return heading(manual?'우리 팀의 업무 매뉴얼':'함께 사용하는 자료실',manual?'업무 절차와 기준을 정리하고 함께 확인하세요.':'양식과 문서를 올리고 필요한 파일을 내려받으세요.',currentUser.role==='admin'?`<button class="primary" data-library-new="${kind}">＋ ${manual?'매뉴얼 작성':'파일 올리기'}</button>`:'')+`<section class="panel">${searchFields(kind)}${manual?'':`<div class="collection-note">파일당 5MB · 자료실 전체 25MB · 현재 ${((collectionData[kind]?.usedBytes||0)/1024/1024).toFixed(1)}MB 사용</div>`}${collectionBody(kind,i=>manual?`<button class="library-card" data-manual="${esc(i.id)}"><span class="badge green">${esc(i.category)}</span><h2>${esc(i.title)}</h2><p>${esc(i.content.slice(0,130))}</p><small>${esc(i.editor)} · ${esc(dateLabel(i.updated_at))}</small><span class="card-arrow">↗</span></button>`:`<div class="resource-entry"><div><span class="badge blue">${esc(i.category)}</span><b>${esc(i.title)}</b><small>${esc(i.filename)} · ${(i.size/1024).toFixed(1)}KB · ${esc(i.author)} · ${esc(dateLabel(i.created_at))}</small></div><a class="download" href="/api/resources/${encodeURIComponent(i.id)}/download">다운로드 ↓</a>${currentUser.role==='admin'?`<button class="delete-link" data-resource-delete="${esc(i.id)}">삭제</button>`:''}</div>`)}</section>`;
}
function messageMarkup(message) {
 return `<div class="message"><span class="avatar">${esc(message.name[0])}</span><div><small>${esc(message.name)} · ${esc(dateLabel(message.createdAt))}</small><p>${esc(message.text)}</p></div></div>`;
}
function chatPage() {
 return heading('가볍게 나누는 팀 이야기','팀 대화와 지난 기록을 한곳에서 확인하세요.')+`<section class="panel chat"><div class="panel-head"><h2>우리 팀 전체방</h2><span class="muted">${chatSearchActive?'전체 대화 기록 검색':'최근 대화 500개'}</span></div>${searchFields('팀 채팅')}<div class="messages">${chatSearchActive?collectionBody('팀 채팅',messageMarkup):(state.messages.map(messageMarkup).join('')||empty('첫 번째 팀 이야기를 남겨보세요.'))}</div><form id="chat-form"><input name="message" required maxlength="2000" placeholder="팀원에게 남길 메시지를 입력하세요" aria-label="메시지"><button class="primary">보내기 ↗</button></form></section>`;
}
let manualEditing=null;
function openLibrary(kind,id=null) {
 if(kind==='자료실') {$('#resource-form').reset();$('#resource-error').textContent='';$('#resource-dialog').showModal();return;}
 const item=collectionData['매뉴얼']?.results?.find(i=>i.id===id),form=$('#manual-form');
 manualEditing=item||null;form.reset();$('#manual-error').textContent='';
 for(const field of ['title','category','content']) {form.elements[field].value=item?.[field]||(field==='category'?'일반':'');form.elements[field].readOnly=currentUser.role!=='admin';}
 $('#manual-save').hidden=currentUser.role!=='admin';$('#manual-delete').hidden=!item||currentUser.role!=='admin';
 $('#manual-heading').textContent=item?'매뉴얼 상세':'새 매뉴얼 작성';$('#manual-dialog').showModal();
}
async function collectionClick(button) {
 if(button.dataset.more)await loadCollection(button.dataset.more,true);
 if(button.dataset.resetSearch){const kind=button.dataset.resetSearch;searches[kind]={};if(kind==='팀 채팅')chatSearchActive=false;for(const input of ($('#collection-search')?.elements||[]))if(input.name)input.value='';render();if(kind!=='팀 채팅')await loadCollection(kind);}
 if(button.dataset.libraryNew)openLibrary(button.dataset.libraryNew);
 if(button.dataset.manual)openLibrary('매뉴얼',button.dataset.manual);
 if(button.dataset.closeDialog)document.getElementById(button.dataset.closeDialog).close();
 if(button.dataset.resourceDelete&&confirm('이 자료를 삭제할까요? 삭제한 파일은 복구할 수 없습니다.')){
  await api('/api/resources/'+encodeURIComponent(button.dataset.resourceDelete),{method:'DELETE'});await loadCollection('자료실');toast('자료를 삭제했어요.');
 }
 if(button.id==='manual-delete'&&manualEditing&&confirm('이 매뉴얼을 삭제할까요?')){
  await api('/api/manuals/'+encodeURIComponent(manualEditing.id),{method:'DELETE',body:{version:manualEditing.version}});$('#manual-dialog').close();await loadCollection('매뉴얼');toast('매뉴얼을 삭제했어요.');
 }
}
async function collectionSubmit(form) {
 if(form.id==='collection-search'){
  const kind=form.dataset.kind;searches[kind]=Object.fromEntries(new FormData(form));if(kind==='팀 채팅')chatSearchActive=true;
  await loadCollection(kind);if(kind==='팀 채팅'&&$('.messages'))$('.messages').scrollTop=0;return true;
 }
 if(!['manual-form','resource-form'].includes(form.id))return false;
 const button=form.querySelector('button[type=submit]'),error=form.id==='manual-form'?$('#manual-error'):$('#resource-error');button.disabled=true;error.textContent='';
 try{
  if(form.id==='manual-form'){
   const body=Object.fromEntries(new FormData(form));if(manualEditing)body.version=manualEditing.version;
   await api('/api/manuals'+(manualEditing?'/'+encodeURIComponent(manualEditing.id):''),{method:manualEditing?'PUT':'POST',body});$('#manual-dialog').close();await loadCollection('매뉴얼');
  }else{
   const file=form.elements.file.files[0];if(!file||file.size===0||file.size>5*1024*1024)throw new Error('내용이 있는 5MB 이하 파일을 선택해 주세요.');
   const data=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result.split(',')[1]);reader.onerror=()=>reject(new Error('파일을 읽지 못했습니다.'));reader.readAsDataURL(file);});
   await api('/api/resources',{method:'POST',body:{title:form.elements.title.value,category:form.elements.category.value,filename:file.name,data}});$('#resource-dialog').close();await loadCollection('자료실');
  }toast('저장했어요.');
 }catch(e){error.textContent=e.message;}finally{button.disabled=false;}
 return true;
}

initialize();
