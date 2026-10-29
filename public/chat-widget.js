export function incomingMessages(messages,userId,after) {
  return messages.filter(message=>message.userId!==userId && message.sequence>after);
}
export function createChatWidget({api,escape:esc,getUser,getState,getPage,refresh,openFullChat,onOpen,toast}) {
  const launcher=document.querySelector('#chat-launcher'),panel=document.querySelector('#chat-widget');
  const list=document.querySelector('#widget-messages'),form=document.querySelector('#widget-chat-form');
  const popup=document.querySelector('#chat-popup');
  let open=false,account=null,lastSequence=null,readInFlight=0,sending=false,changingNotification=false,popupTimer;
  const ephemeralPrefs=new Map(),fallbackNotifications=new Set();
  const nearEnd=element=>!element || element.scrollHeight-element.scrollTop-element.clientHeight<65;
  const visible=()=>!document.hidden&&document.hasFocus();
  function isReading(){return visible()&&((open&&nearEnd(list))||(getPage()==='채팅'&&!document.querySelector('#main [data-filtered-chat]')&&nearEnd(document.querySelector('#main .messages'))));}
  function preferences(){const key='dayon-chat-notifications-'+getUser()?.id;let value=ephemeralPrefs.get(key)||{};try{value=JSON.parse(localStorage.getItem(key))||value;}catch{}return {enabled:value.enabled===true,notified:Number.isSafeInteger(value.notified)?value.notified:0};}
  function savePrefs(value,userId=getUser()?.id){const key='dayon-chat-notifications-'+userId;ephemeralPrefs.set(key,value);try{localStorage.setItem(key,JSON.stringify(value));}catch{}}
  function supported(){return 'Notification'in window&&window.isSecureContext;}
  function render(){
    const user=getUser();if(!user)return;
    const state=getState(),unread=state.chat?.unread||0;
    if(!unread){popup.hidden=true;clearTimeout(popupTimer);}
    const badge=document.querySelector('#chat-unread');badge.hidden=!unread;badge.textContent=unread>99?'99+':String(unread);
    launcher.setAttribute('aria-label',`채팅 열기${unread?' · 읽지 않은 메시지 '+unread+'개':''}`);
    document.querySelector('#widget-unread-label').textContent=unread?`읽지 않은 메시지 ${unread}개`:'모두의 대화';
    const scroll=list.scrollTop,atEnd=nearEnd(list),messages=state.messages.slice(-100);
    const signature=messages.map(m=>m.id).join(',');
    if(list.dataset.signature!==signature){
      list.innerHTML=messages.length?messages.map(message=>`<div class="widget-message ${message.userId===user.id?'is-self':''}"><small>${esc(message.name)} <time>${esc(new Date(message.createdAt).toLocaleTimeString('ko-KR',{timeZone:'Asia/Seoul',hour:'2-digit',minute:'2-digit'}))}</time></small><p>${esc(message.text)}</p></div>`).join(''):'<div class="empty">첫 번째 이야기를 남겨보세요.</div>';
      list.dataset.signature=signature;
      list.scrollTop=atEnd?list.scrollHeight:scroll;
    }
    const prefs=preferences(),permission=supported()?Notification.permission:'unsupported';
    const toggle=document.querySelector('#chat-desktop-toggle');
    toggle.disabled=!supported()||changingNotification;toggle.textContent=!supported()?'브라우저 알림 미지원':prefs.enabled&&permission==='granted'?'브라우저 알림 끄기':'브라우저 알림 켜기';
    toggle.setAttribute('aria-pressed',String(prefs.enabled&&permission==='granted'));
  }
  function showPopup(messages){
    if(!messages.length)return;
    const last=messages.at(-1);clearTimeout(popupTimer);
    popup.innerHTML=`<button type="button" class="chat-popup-open"><span>새 메시지${messages.length>1?' '+messages.length+'개':''}</span><b>${esc(last.name)}</b><p>${esc(last.text.slice(0,120))}</p></button><button type="button" class="chat-popup-close" aria-label="새 메시지 알림 닫기">✕</button>`;
    popup.hidden=false;popupTimer=setTimeout(()=>{popup.hidden=true;},9000);
  }
  async function markRead(){
    const user=getUser(),chat=getState().chat;
    if(!user||!chat||!isReading()||chat.latest<=chat.readThrough||readInFlight>=chat.latest)return;
    const userId=user.id,through=chat.latest;readInFlight=through;
    try{await api('/api/chat/read',{method:'POST',body:{through}});if(getUser()?.id===userId){await closeReadNotifications(userId,through);await refresh();}}
    catch{/* Keep the unread badge until the server acknowledges reading. */}
    finally{if(readInFlight===through)readInFlight=0;}
  }
  function setOpen(value){
    if(!getUser())return;
    open=value;panel.hidden=!open;launcher.setAttribute('aria-expanded',String(open));
    launcher.classList.toggle('is-open',open);
    if(open){onOpen();popup.hidden=true;render();list.scrollTop=list.scrollHeight;form.elements.message.focus({preventScroll:true});markRead();}
    else launcher.focus({preventScroll:true});
  }
  async function notifyDesktop(messages){
    const user=getUser();if(!user||!messages.length||!supported()||Notification.permission!=='granted')return;
    const userId=user.id;
    async function deliver(){
      if(getUser()?.id!==userId||isReading())return;
      const prefs=preferences(),fresh=messages.filter(m=>m.sequence>prefs.notified);
      if(!prefs.enabled||!fresh.length)return;
      const previous=prefs.notified,latest=fresh.at(-1);prefs.notified=latest.sequence;savePrefs(prefs,userId);
      const options={body:latest.text.slice(0,120),tag:'dayon-chat-'+userId,data:{type:'chat',sequence:latest.sequence}};
      let delivered=false;
      try{
        if('serviceWorker'in navigator){
          const registered=await navigator.serviceWorker.register('/sw.js');const ready=registered.active?registered:await navigator.serviceWorker.ready;
          if(getUser()?.id!==userId||!preferences().enabled)return;
          await ready.showNotification(`${latest.name} · Dayon 채팅${fresh.length>1?' ('+fresh.length+'개)':''}`,options);delivered=true;
          if(getUser()?.id!==userId||!preferences().enabled)for(const notification of await ready.getNotifications({tag:options.tag}))notification.close();
        }else{
          const notification=new Notification(`${latest.name} · Dayon 채팅`,options);delivered=true;fallbackNotifications.add(notification);
          notification.onclose=()=>fallbackNotifications.delete(notification);
          notification.onclick=()=>{window.focus();notification.close();if(getUser()?.id===userId)setOpen(true);};
        }
      }catch{/* App banners and unread counts remain available when OS delivery fails. */}
      finally{if(!delivered){let value=ephemeralPrefs.get('dayon-chat-notifications-'+userId)||prefs;try{value=JSON.parse(localStorage.getItem('dayon-chat-notifications-'+userId))||value;}catch{}value.notified=previous;savePrefs(value,userId);}}
    }
    if(navigator.locks)await navigator.locks.request('dayon-chat-notify-'+userId,{ifAvailable:true},lock=>lock?deliver():undefined);else await deliver();
  }
  function update(){
    const user=getUser();if(!user)return;
    const state=getState(),latest=state.chat?.latest||0;
    if(account!==user.id){account=user.id;lastSequence=latest;open=false;panel.hidden=true;launcher.setAttribute('aria-expanded','false');form.reset();list.dataset.signature='';}
    const reading=isReading();
    const fresh=lastSequence===null?[]:incomingMessages(state.messages,user.id,lastSequence);
    lastSequence=Math.max(lastSequence||0,latest);
    render();
    if(fresh.length&&!reading){if(!open||!visible())showPopup(fresh);notifyDesktop(fresh).catch(()=>{});}
    markRead();
  }
  async function closeReadNotifications(userId,through){
    for(const notification of fallbackNotifications)if((notification.data?.sequence||0)<=through)notification.close();
    if('serviceWorker'in navigator){try{const registration=await navigator.serviceWorker.getRegistration('/sw.js');if(registration)for(const notification of await registration.getNotifications({tag:'dayon-chat-'+userId}))if((notification.data?.sequence||0)<=through)notification.close();}catch{}}
  }
  async function clear(){
    open=false;account=null;lastSequence=null;readInFlight=0;clearTimeout(popupTimer);popup.hidden=true;popup.replaceChildren();panel.hidden=true;launcher.classList.remove('is-open');launcher.setAttribute('aria-expanded','false');form.reset();list.replaceChildren();list.dataset.signature='';document.querySelector('#chat-unread').hidden=true;
    for(const notification of fallbackNotifications)notification.close();fallbackNotifications.clear();
  }
  launcher.addEventListener('click',()=>setOpen(!open));
  document.querySelector('#widget-close').addEventListener('click',()=>setOpen(false));
  document.querySelector('#widget-expand').addEventListener('click',()=>{setOpen(false);openFullChat();});
  popup.addEventListener('click',event=>{if(event.target.closest('.chat-popup-close'))popup.hidden=true;else if(event.target.closest('.chat-popup-open'))setOpen(true);});
  list.addEventListener('scroll',()=>{if(nearEnd(list))markRead();},{passive:true});
  form.addEventListener('submit',async event=>{
    event.preventDefault();event.stopPropagation();const input=form.elements.message,text=input.value.trim();if(!text||sending||!getUser())return;
    const userId=getUser().id;sending=true;form.querySelector('button').disabled=true;
    try{await api('/api/messages',{method:'POST',body:{text}});if(getUser()?.id===userId){if(input.value.trim()===text)input.value='';await refresh();list.scrollTop=list.scrollHeight;markRead();}}
    catch(error){toast(error.message);}
    finally{sending=false;form.querySelector('button').disabled=false;}
  });
  form.elements.message.addEventListener('keydown',event=>{if(event.key==='Enter'&&!event.shiftKey&&!event.isComposing){event.preventDefault();form.requestSubmit();}});
  document.querySelector('#chat-desktop-toggle').addEventListener('click',async()=>{
    if(!getUser()||!supported()||changingNotification)return;changingNotification=true;const userId=getUser().id,prefs=preferences(),button=document.querySelector('#chat-desktop-toggle');button.disabled=true;
    try{
      if(prefs.enabled){prefs.enabled=false;savePrefs(prefs);for(const notification of fallbackNotifications)notification.close();fallbackNotifications.clear();if('serviceWorker'in navigator){const reg=await navigator.serviceWorker.getRegistration('/sw.js');if(reg)for(const notification of await reg.getNotifications({tag:'dayon-chat-'+userId}))notification.close();}}
      else{const permission=await Notification.requestPermission();if(getUser()?.id!==userId)return;if(permission==='granted'){prefs.enabled=true;prefs.notified=getState().chat?.latest||0;savePrefs(prefs);toast('새 채팅의 브라우저 알림을 켰어요.');}else toast('브라우저 사이트 설정에서 알림을 허용해 주세요. 앱 안의 새 메시지 알림은 계속 표시됩니다.');}
    }catch{toast('이 브라우저에서는 앱 안의 채팅 알림을 이용해 주세요.');}finally{changingNotification=false;button.disabled=false;render();}
  });
  document.addEventListener('visibilitychange',()=>{if(visible())markRead();});
  window.addEventListener('focus',()=>markRead());
  document.addEventListener('keydown',event=>{if(event.key==='Escape'&&open&&!document.querySelector('dialog[open]'))setOpen(false);});
  navigator.serviceWorker?.addEventListener('message',event=>{if(event.data?.type==='open-chat'&&getUser())setOpen(true);});
  return {update,clear,open:()=>setOpen(true),close:()=>setOpen(false),refreshView(){render();markRead();},setConnection(text){document.querySelector('#widget-connection').textContent=text;}};
}
