const STORAGE_KEY='subbubble:v2';
const LEGACY_STORAGE_KEY='subbubble:v1';
const BACKUP_KEY='subbubble:backup:v2';
const SYNC_META_KEY='subbubble:sync-meta:v1';
const FX_API_URL='https://open.er-api.com/v6/latest/RUB';
const FX_CURRENCIES=['USD','TRY','SGD'];
const SYNC_CONFIG=window.SUBBUBBLE_SYNC||null;
const COLORS=['#2dd4bf','#8b5cf6','#f97316','#3b82f6','#ec4899','#84cc16','#f59e0b'];
const defaults={rates:{USD:90,TRY:2.25,SGD:70},subscriptions:[]};
let state=loadState(),bodies=[],raf,lastTime=performance.now(),drag=null,syncTimer=null,syncMeta=loadSyncMeta(),isSyncing=false,fxTimer=null;
const $=s=>document.querySelector(s), world=$('#bubble-world');
function now(){return Date.now()}
function freshDefaults(){const ts=now();return {version:2,rates:{...defaults.rates},ratesUpdatedAt:ts,ratesMode:'auto',manualRates:{...defaults.rates},manualRatesUpdatedAt:ts,autoRates:{...defaults.rates},autoRatesUpdatedAt:0,subscriptions:defaults.subscriptions.map(s=>({...s,updatedAt:ts})),tombstones:{}}}
function normalizeState(raw){
  const ts=now();
  if(!raw||!Array.isArray(raw.subscriptions))return freshDefaults();
  const rates={...defaults.rates,...raw.rates};if(Number.isFinite(raw.rate))rates.USD=raw.rate;
  const manualRates={...rates,...raw.manualRates},autoRates={...rates,...raw.autoRates};
  return {version:2,rates,ratesUpdatedAt:Number(raw.ratesUpdatedAt)||ts,ratesMode:raw.ratesMode==='manual'?'manual':'auto',manualRates,manualRatesUpdatedAt:Number(raw.manualRatesUpdatedAt)||Number(raw.ratesUpdatedAt)||ts,autoRates,autoRatesUpdatedAt:Number(raw.autoRatesUpdatedAt)||0,subscriptions:raw.subscriptions.map(s=>({...s,updatedAt:Number(s.updatedAt)||ts})),tombstones:{...(raw.tombstones||{})}};
}
function loadState(){
  try{const current=localStorage.getItem(STORAGE_KEY);if(current)return normalizeState(JSON.parse(current))}catch{}
  try{const legacy=localStorage.getItem(LEGACY_STORAGE_KEY);if(legacy){const migrated=normalizeState(JSON.parse(legacy));localStorage.setItem(STORAGE_KEY,JSON.stringify(migrated));return migrated}}catch{}
  return freshDefaults();
}
function saveState({backup=true}={}){if(backup){try{localStorage.setItem(BACKUP_KEY,localStorage.getItem(STORAGE_KEY)||JSON.stringify(state))}catch{}}localStorage.setItem(STORAGE_KEY,JSON.stringify(state))}
function loadSyncMeta(){try{return {...{status:'idle',lastSuccessAt:0,lastError:''},...JSON.parse(localStorage.getItem(SYNC_META_KEY)||'{}')}}catch{return {status:'idle',lastSuccessAt:0,lastError:''}}}
function saveSyncMeta(){try{localStorage.setItem(SYNC_META_KEY,JSON.stringify(syncMeta))}catch{}}
function mergeStates(a,b){
  const local=normalizeState(a),remote=normalizeState(b),byId=new Map();
  const ids=new Set([...local.subscriptions.map(x=>x.id),...remote.subscriptions.map(x=>x.id),...Object.keys(local.tombstones),...Object.keys(remote.tombstones)]);
  for(const id of ids){
    const la=local.subscriptions.find(x=>x.id===id),rb=remote.subscriptions.find(x=>x.id===id);
    const deletedAt=Math.max(Number(local.tombstones[id])||0,Number(remote.tombstones[id])||0);
    const newest=!la?rb:!rb?la:(Number(la.updatedAt)||0)>=(Number(rb.updatedAt)||0)?la:rb;
    if(newest&&Number(newest.updatedAt)>deletedAt)byId.set(id,{...newest});
  }
  const tombstones={};
  for(const id of ids){const deletedAt=Math.max(Number(local.tombstones[id])||0,Number(remote.tombstones[id])||0);const live=byId.get(id);if(deletedAt&&(!live||deletedAt>=Number(live.updatedAt)))tombstones[id]=deletedAt}
  const ratesFromRemote=(remote.ratesUpdatedAt||0)>(local.ratesUpdatedAt||0);
  return {...local,version:2,...(ratesFromRemote?{rates:{...remote.rates},ratesMode:remote.ratesMode,manualRates:{...remote.manualRates},manualRatesUpdatedAt:remote.manualRatesUpdatedAt,autoRates:{...remote.autoRates},autoRatesUpdatedAt:remote.autoRatesUpdatedAt}:{rates:{...local.rates}}),ratesUpdatedAt:Math.max(local.ratesUpdatedAt||0,remote.ratesUpdatedAt||0),subscriptions:[...byId.values()].sort((x,y)=>(x.updatedAt||0)-(y.updatedAt||0)),tombstones};
}
function setSyncStatus(status,message=''){syncMeta={...syncMeta,status,lastError:message};saveSyncMeta();renderSyncStatus()}
function renderSyncStatus(){const statusEl=$('#sync-label'),timeEl=$('#sync-last-time');if(!statusEl||!timeEl)return;const enabled=Boolean(SYNC_CONFIG?.url),offline=!navigator.onLine;const label=!enabled?'Синхронизация выкл.':isSyncing?'Синхронизация…':syncMeta.status==='error'?'Ошибка':syncMeta.lastSuccessAt?'Синхронизировано':'Ожидает синхронизации';statusEl.textContent=label;statusEl.className=`sync-status ${isSyncing?'syncing':syncMeta.status==='error'?'error':syncMeta.lastSuccessAt?'ok':''}`;const when=syncMeta.lastSuccessAt?`последняя: ${formatWhen(syncMeta.lastSuccessAt)}`:offline?'нет сети':'ещё не было';timeEl.textContent=syncMeta.status==='error'&&syncMeta.lastError?`${when} · ${syncMeta.lastError}`:when}
function analyticsMeta(){const ua=navigator.userAgent||'',platform=/iphone|ipad|ipod/i.test(ua)?'ios':/android/i.test(ua)?'android':/mac|win|linux/i.test(ua)?'desktop':'unknown';const standalone=window.matchMedia?.('(display-mode: standalone)')?.matches||navigator.standalone===true;return {platform,pwa:Boolean(standalone)}}
async function trackAnalytics(event){
  if(!SYNC_CONFIG?.url||!SYNC_CONFIG.token||!navigator.onLine)return;
  try{
    const url=SYNC_CONFIG.url.replace(/\/sync(?:\?.*)?$/,'/analytics');
    await fetch(url,{method:'POST',headers:{'Content-Type':'application/json','Authorization':`Bearer ${SYNC_CONFIG.token}`},body:JSON.stringify({event,meta:analyticsMeta()}),keepalive:true});
  }catch(err){console.warn('SubBubble analytics skipped:',err)}
}
trackAnalytics('app_open');
async function syncNow(){
  if(!SYNC_CONFIG?.url){renderSyncStatus();return}
  if(!navigator.onLine){setSyncStatus('error','нет сети');return}
  isSyncing=true;setSyncStatus('syncing');
  try{
    const res=await fetch(SYNC_CONFIG.url,{method:'POST',headers:{'Content-Type':'application/json',...(SYNC_CONFIG.token?{'Authorization':`Bearer ${SYNC_CONFIG.token}`}:{})},body:JSON.stringify({state,meta:analyticsMeta()})});
    if(!res.ok)throw new Error(res.status===401||res.status===403?'ошибка ключа':`ошибка ${res.status}`);
    const payload=await res.json();if(!payload?.state)throw new Error('пустой ответ');
    const merged=mergeStates(state,payload.state);
    if(JSON.stringify(merged)!==JSON.stringify(state)){state=merged;saveState();refresh()}
    syncMeta.lastSuccessAt=now();isSyncing=false;setSyncStatus('ok');
  }catch(err){console.warn('SubBubble sync skipped:',err);isSyncing=false;setSyncStatus('error',err?.message||'сбой сети')}
}
function queueSync(){if(!SYNC_CONFIG?.url)return;clearTimeout(syncTimer);syncTimer=setTimeout(syncNow,350)}
function applyRates(rates,{mode=state.ratesMode||'auto',autoUpdatedAt=state.autoRatesUpdatedAt||0,manualUpdatedAt=state.manualRatesUpdatedAt||0}={}){state.rates={...defaults.rates,...rates};state.ratesMode=mode;state.ratesUpdatedAt=now();if(mode==='auto'){state.autoRates={...state.rates};state.autoRatesUpdatedAt=autoUpdatedAt||state.ratesUpdatedAt}else{state.manualRates={...state.rates};state.manualRatesUpdatedAt=manualUpdatedAt||state.ratesUpdatedAt}}
async function updateAutoRates({force=false}={}){if((state.ratesMode==='manual'&&!force)||!navigator.onLine)return;if(!force&&state.autoRatesUpdatedAt&&now()-state.autoRatesUpdatedAt<6*60*60*1000)return;try{const res=await fetch(FX_API_URL,{cache:'no-store'});if(!res.ok)throw new Error(`rates ${res.status}`);const data=await res.json(),next={};for(const code of FX_CURRENCIES){const rubToCurrency=Number(data?.rates?.[code]);if(!rubToCurrency)throw new Error(`missing ${code}`);next[code]=Number((1/rubToCurrency).toFixed(4))}applyRates(next,{mode:'auto',autoUpdatedAt:now()});saveState();refresh();queueSync()}catch(err){console.warn('SubBubble rates update skipped:',err);renderRatesMeta()}}
function monthlyRub(s){return (s.amount*(s.currency==='RUB'?1:(state.rates[s.currency]||1)))/(s.period==='year'?12:1)}
function money(value,currency='RUB',digits=0){return new Intl.NumberFormat('ru-RU',{style:'currency',currency,maximumFractionDigits:digits}).format(value)}
function originalMonthly(s){return s.amount/(s.period==='year'?12:1)}
function formatWhen(ts){return new Date(ts).toLocaleString('ru-RU',{day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'})}
function renderRatesMeta(){const source=state.ratesMode==='manual'?'ручные':'авто',updated=state.ratesMode==='manual'?state.manualRatesUpdatedAt:state.autoRatesUpdatedAt;const label=updated?`${source} · ${formatWhen(updated)}`:`${source} · ждём обновления`;const el=$('#rate-meta');if(el)el.textContent=label}
function totals(){const month=state.subscriptions.reduce((n,s)=>n+monthlyRub(s),0);$('#monthly-total').textContent=money(month);$('#yearly-total').textContent=`${money(month*12)} в год`;$('#rate-value').textContent=`$ ${state.rates.USD} ₽`;renderRatesMeta()}