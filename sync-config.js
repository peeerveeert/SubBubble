const SUBBUBBLE_SYNC_TOKEN_KEY='subbubble:sync-token';
const SUBBUBBLE_STATE_KEY='subbubble:v2';
const SUBBUBBLE_LEGACY_STATE_KEY='subbubble:v1';
const DEFAULT_RATES={USD:90,TRY:2.25,SGD:70};
const DEFAULTS=[
  {id:'server',name:'Аренда сервака',amount:2.4,currency:'USD',period:'month',nextPayment:'',category:'Работа'},
  {id:'telegram',name:'Telegram Premium',amount:1990,currency:'RUB',period:'year',nextPayment:'',category:'Связь'},
  {id:'tmobile',name:'T-Mobile',amount:174,currency:'RUB',period:'month',nextPayment:'',category:'Связь'},
  {id:'yota',name:'Yota',amount:81,currency:'RUB',period:'month',nextPayment:'',category:'Связь'},
  {id:'chatgpt',name:'ChatGPT',amount:23,currency:'USD',period:'month',nextPayment:'',category:'Работа'}
];

function cleanSyncToken(value){
  return String(value||'').trim().replace(/^SYNC_TOKEN\s*=\s*/i,'').trim();
}
function generateSpaceKey(){
  const bytes=new Uint8Array(24);crypto.getRandomValues(bytes);
  return Array.from(bytes,b=>b.toString(16).padStart(2,'0')).join('');
}
function ensureSpaceKey(){
  const current=cleanSyncToken(localStorage.getItem(SUBBUBBLE_SYNC_TOKEN_KEY)||'');
  if(current)return current;
  const next=generateSpaceKey();localStorage.setItem(SUBBUBBLE_SYNC_TOKEN_KEY,next);return next;
}
function isValidSpaceKey(value){
  const key=cleanSyncToken(value);
  return key.length>0;
}
function currentStateHasExpenses(){
  try{return JSON.parse(localStorage.getItem(SUBBUBBLE_STATE_KEY)||'{}').subscriptions?.length>0}catch{return false}
}
function emptyLocalState(){
  localStorage.setItem(SUBBUBBLE_STATE_KEY,JSON.stringify({version:2,rates:{},ratesUpdatedAt:0,subscriptions:[],tombstones:{}}));
}

// First-time visitors must start empty. Existing v2/v1 state is never overwritten.
try{
  if(!localStorage.getItem(SUBBUBBLE_STATE_KEY)&&!localStorage.getItem(SUBBUBBLE_LEGACY_STATE_KEY)){
    const ts=Date.now();
    localStorage.setItem(SUBBUBBLE_STATE_KEY,JSON.stringify({
      version:2,
      rates:{...DEFAULT_RATES},
      ratesUpdatedAt:ts,
      ratesMode:'auto',
      manualRates:{...DEFAULT_RATES},
      manualRatesUpdatedAt:ts,
      autoRates:{...DEFAULT_RATES},
      autoRatesUpdatedAt:0,
      subscriptions:[],
      tombstones:{}
    }));
  }
}catch(err){console.warn('SubBubble empty-state initialization skipped:',err)}

const existingToken=localStorage.getItem(SUBBUBBLE_SYNC_TOKEN_KEY);
if(existingToken){
  const cleaned=cleanSyncToken(existingToken);
  if(cleaned!==existingToken)localStorage.setItem(SUBBUBBLE_SYNC_TOKEN_KEY,cleaned);
}

window.SUBBUBBLE_SYNC={
  url:'https://prvrt.ru/subbubble-sync/sync',
  get token(){return cleanSyncToken(localStorage.getItem(SUBBUBBLE_SYNC_TOKEN_KEY)||'')}
};

function sameDefault(item,def){
  return def&&item&&item.name===def.name&&Number(item.amount)===Number(def.amount)&&item.currency===def.currency&&item.period===def.period&&(item.nextPayment||'')===(def.nextPayment||'')&&(item.category||'')===(def.category||'');
}
function neutralizeUntouchedDefaults(){
  try{
    const raw=localStorage.getItem(SUBBUBBLE_STATE_KEY);if(!raw)return;
    const state=JSON.parse(raw);if(!Array.isArray(state.subscriptions))return;
    state.subscriptions=state.subscriptions.map(item=>{
      const def=DEFAULTS.find(x=>x.id===item.id);
      return sameDefault(item,def)?{...item,updatedAt:0}:item;
    });
    const rates=state.rates||{};
    if(Number(rates.USD)===DEFAULT_RATES.USD&&Number(rates.TRY)===DEFAULT_RATES.TRY&&Number(rates.SGD)===DEFAULT_RATES.SGD)state.ratesUpdatedAt=0;
    localStorage.setItem(SUBBUBBLE_STATE_KEY,JSON.stringify(state));
  }catch(err){console.warn('SubBubble default neutralization skipped:',err)}
}

function mountSyncSettings(){
  const header=document.querySelector('.list-header');
  const add=document.querySelector('#add-button');
  if(!header||!add||document.querySelector('#sync-button'))return;
  const wrap=document.createElement('div');wrap.style.display='flex';wrap.style.gap='8px';wrap.style.alignItems='center';
  add.parentNode.insertBefore(wrap,add);wrap.appendChild(add);
  const btn=document.createElement('button');btn.id='sync-button';btn.type='button';btn.textContent='☁';btn.setAttribute('aria-label','Настроить синхронизацию');btn.style.cssText='width:48px;height:48px;border:1px solid rgba(255,255,255,.08);border-radius:50%;background:#182136;color:#aeb9cb;font-size:21px';wrap.insertBefore(btn,add);

  const dialog=document.createElement('dialog');dialog.id='sync-dialog';dialog.className='sheet compact';
  dialog.innerHTML=`<form id="sync-form" method="dialog"><div class="sheet-handle"></div><div class="sheet-title"><h3>Синхронизация</h3><button class="icon-button" type="button" data-sync-close>×</button></div><p class="sheet-copy">Сохраните ключ. С его помощью можно открыть свои данные на другом устройстве. Не передавайте его другим людям — ключ даёт доступ к вашим данным.</p><label>Ключ восстановления<input id="sync-token" type="password" readonly autocomplete="off"></label><div class="form-row"><button id="toggle-sync-token" class="secondary-button" type="button">Показать</button><button id="copy-sync-token" class="secondary-button" type="button">Скопировать</button></div><label>Открыть существующее пространство<input id="existing-sync-token" type="password" autocomplete="off" placeholder="Вставьте ключ восстановления"></label><p id="sync-status" class="sheet-copy" style="margin-top:0"></p><button class="primary-button" type="submit">Открыть существующее пространство</button></form>`;
  document.body.appendChild(dialog);
  const input=dialog.querySelector('#sync-token'),existingInput=dialog.querySelector('#existing-sync-token'),status=dialog.querySelector('#sync-status'),toggle=dialog.querySelector('#toggle-sync-token'),copy=dialog.querySelector('#copy-sync-token');
  const setStatus=msg=>{status.textContent=msg};
  btn.addEventListener('click',()=>{input.type='password';toggle.textContent='Показать';input.value=ensureSpaceKey();existingInput.value='';setStatus('Ключ сохранён на этом устройстве.');dialog.showModal()});
  toggle.addEventListener('click',()=>{const shown=input.type==='text';input.type=shown?'password':'text';toggle.textContent=shown?'Показать':'Скрыть'});
  copy.addEventListener('click',async()=>{try{await navigator.clipboard.writeText(ensureSpaceKey());setStatus('Скопировано')}catch{setStatus('Не удалось скопировать автоматически')}});
  dialog.querySelector('[data-sync-close]').addEventListener('click',()=>dialog.close());
  dialog.querySelector('#sync-form').addEventListener('submit',e=>{
    e.preventDefault();const token=cleanSyncToken(existingInput.value);if(!isValidSpaceKey(token)){setStatus('Введите корректный ключ восстановления.');return}
    const current=ensureSpaceKey();if(token===current){setStatus('Этот ключ уже используется.');return}
    const warning=currentStateHasExpenses()?' В текущем пространстве есть расходы: сначала сохраните текущий ключ восстановления.':'';
    if(!confirm(`Открыть другое пространство? Текущий ключ на этом устройстве будет заменён.${warning}`))return;
    localStorage.setItem(SUBBUBBLE_SYNC_TOKEN_KEY,token);emptyLocalState();setStatus('Ключ сохранён. Открываю пространство…');
    setTimeout(()=>location.reload(),350);
  });
}

mountSyncSettings();
