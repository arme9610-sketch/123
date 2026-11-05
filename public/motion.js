// Enhancements are opt-in: the workspace stays readable when this module cannot run.
const preference=matchMedia('(prefers-reduced-motion: reduce)');
const seen=new Set(),watched=new Set();let frame=0;
const selector='#main > .heading,#main .dayon-hero,#main .worklists-heading,#main .worklist-card,#main .sales-change-card,#main > .panel,#main > .stats,#main > .dashboard-grid,#main .sales-panel,#main .revenue-card,#main .sales-overview-card,#main .contribution-member,#main .contribution-tier-guide,#main .contribution-log-section';
let observer=null;
function finish(target){
 target.dataset.uiReveal='shown';seen.add(target.dataset.motionKey);
 observer?.unobserve(target);watched.delete(target);
}
function write(target){
 if(target.dataset.writingReady)return;
 target.dataset.writingReady='true';
 const text=target.textContent,visual=document.createElement('span');visual.className='writing-visual';visual.setAttribute('aria-hidden','true');
 const accessible=document.createElement('span');accessible.className='sr-only';accessible.textContent=text;
 const segments=typeof Intl.Segmenter==='function'?[...new Intl.Segmenter('ko',{granularity:'grapheme'}).segment(text)].map(part=>part.segment):Array.from(text);
 for(const character of segments){const glyph=document.createElement('span');glyph.className='writing-glyph';glyph.textContent=character===' '?'\u00a0':character;visual.append(glyph);}
 target.replaceChildren(accessible,visual);
}
function scan(){
 frame=0;
 for(const node of watched)if(!node.isConnected){observer?.unobserve(node);watched.delete(node);}
 const page=document.querySelector('#breadcrumb')?.textContent||'';
 document.querySelectorAll(selector).forEach((target,index)=>{
  if(target.dataset.uiReveal)return;
  const title=target.querySelector('h1,h2,h3')?.textContent||'',key=page+'|'+(target.id||target.className)+'|'+title+'|'+index;
  target.dataset.motionKey=key;
  // Live updates and returning to a tab should not replay an entrance animation.
  if(preference.matches||!observer||seen.has(key)){target.dataset.uiReveal='shown';return;}
  target.dataset.uiReveal='waiting';watched.add(target);observer.observe(target);
 });
 if(!preference.matches&&!seen.has('hero-writing')){
  document.querySelectorAll('[data-writing]').forEach(write);
  const heading=document.querySelector('[data-writing]');
  if(heading)setTimeout(()=>{if(heading.isConnected)seen.add('hero-writing');},1500);
 }
}
function schedule(){if(!frame)frame=requestAnimationFrame(scan);}
if('IntersectionObserver' in window){
 observer=new IntersectionObserver(entries=>{
  for(const entry of entries)if(entry.isIntersecting){finish(entry.target);}
 },{threshold:0,rootMargin:'0px 0px -24px 0px'});
}
new MutationObserver(records=>{
 if(records.some(record=>record.addedNodes.length||record.removedNodes.length))schedule();
}).observe(document.body,{childList:true,subtree:true});
preference.addEventListener('change',()=>{
 if(preference.matches)for(const target of [...watched])finish(target);
 schedule();
});
// Keyboard users should never land on an element that is still fading in.
document.addEventListener('focusin',event=>{
 for(let node=event.target;node;node=node.parentElement)if(node.dataset?.uiReveal==='waiting')finish(node);
});
schedule();
