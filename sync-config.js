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

function makeSpaceToken(){
  const bytes=new Uint8Array(32);
  crypto.getRandomValues(bytes);
  let binary='';
  for(const byte of bytes)binary+=String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
}

let existingToken=localStorage.getItem(SUBBUBBLE_SYNC_TOKEN_KEY);
if(existingToken){
  const cleaned=cleanSyncToken(existingToken);
  if(cleaned!==existingToken)localStorage.setItem(SUBBUBBLE_SYNC_TOKEN_KEY,cleaned);
  existingToken=cleaned;
}else{
  existingToken=makeSpaceToken();
  localStorage.setItem(SUBBUBBLE_SYNC_TOKEN_KEY,existingToken);
}

// New browsers/testers start from an empty personal space. Existing installs keep
// their current local state untouched and continue syncing to their old space.
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
  dialog.innerHTML=`<form id="sync-form" method="dialog"><div class="sheet-handle"></div><div class="sheet-title"><h3>Синхронизация</h3><button class="icon-button" type="button" data-sync-close>×</button></div><p class="sheet-copy">У каждого устройства своё приватное пространство. Этот ключ нужен только если вы хотите открыть те же данные на другом устройстве.</p><label>Ключ пространства<input id="sync-token" type="password" autocomplete="off" placeholder="Ключ пространства"></label><p id="sync-status" class="sheet-copy" style="margin-top:0"></p><button class="primary-button" type="submit">Сохранить и синхронизировать</button></form>`;
  document.body.appendChild(dialog);
  const input=dialog.querySelector('#sync-token'),status=dialog.querySelector('#sync-status');
  const setStatus=msg=>{status.textContent=msg};
  btn.addEventListener('click',()=>{input.value=localStorage.getItem(SUBBUBBLE_SYNC_TOKEN_KEY)||'';setStatus('Синхронизация настроена автоматически. Не передавайте ключ посторонним.');dialog.showModal()});
  dialog.querySelector('[data-sync-close]').addEventListener('click',()=>dialog.close());
  dialog.querySelector('#sync-form').addEventListener('submit',e=>{
    e.preventDefault();const token=cleanSyncToken(input.value);if(!token){setStatus('Введите ключ пространства.');return}
    neutralizeUntouchedDefaults();localStorage.setItem(SUBBUBBLE_SYNC_TOKEN_KEY,token);setStatus('Ключ сохранён. Перезапускаю синхронизацию…');
    setTimeout(()=>location.reload(),350);
  });
}

mountSyncSettings();
