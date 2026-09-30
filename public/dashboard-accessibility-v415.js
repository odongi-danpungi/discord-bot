const FOCUSABLE_SELECTOR=[
  'a[href]','button:not([disabled])','input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])','textarea:not([disabled])','[tabindex]:not([tabindex="-1"])'
].join(',');

export function isEditableShortcutTarget(target){
  if(!target)return false;
  const tag=String(target.tagName||'').toUpperCase();
  if(['INPUT','TEXTAREA','SELECT'].includes(tag))return true;
  if(target.isContentEditable===true)return true;
  const contenteditable=target.getAttribute?.('contenteditable');
  return contenteditable===''||String(contenteditable).toLowerCase()==='true';
}

export function getFocusableElements(container){
  if(!container?.querySelectorAll)return [];
  return [...container.querySelectorAll(FOCUSABLE_SELECTOR)].filter(el=>{
    if(el.disabled||el.hidden||el.getAttribute?.('aria-hidden')==='true')return false;
    if(el.closest?.('[hidden]'))return false;
    return true;
  });
}

export function trapTabKey(container,event,{activeElement=globalThis.document?.activeElement}={}){
  if(event?.key!=='Tab')return false;
  const items=getFocusableElements(container);
  if(!items.length){event.preventDefault?.();container?.focus?.();return true;}
  const first=items[0],last=items.at(-1),index=items.indexOf(activeElement);
  if(event.shiftKey&&(index<=0)){event.preventDefault?.();last.focus?.();return true;}
  if(!event.shiftKey&&(index<0||index===items.length-1)){event.preventDefault?.();first.focus?.();return true;}
  return false;
}

export function pageChangeAnnouncement(meta={}){
  const section=String(meta.section||'대시보드').trim();
  const title=String(meta.title||'화면').trim();
  return `${section} · ${title} 화면으로 이동했습니다.`;
}

export function safeFocus(target,{preventScroll=true}={}){
  if(!target?.focus)return false;
  try{target.focus({preventScroll});}catch{target.focus();}
  return true;
}
