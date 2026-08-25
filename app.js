const STORAGE_KEY='subbubble:v2';
const LEGACY_STORAGE_KEY='subbubble:v1';
const BACKUP_KEY='subbubble:backup:v2';
const SYNC_META_KEY='subbubble:sync-meta:v1';
const FX_API_URL='https://open.er-api.com/v6/latest/RUB';
const FX_CURRENCIES=['USD','TRY','SGD'];
const SYNC_CONFIG=window.SUBBUBBLE_SYNC||null;
const COLORS=['#2dd4bf','#8b5cf6','#f97316','#3b82f6','#ec4899','#84cc16','#f59e0b'];
const defaults={rates:{USD:90,TRY:2.25,SGD:70},subscriptions:[
  {id:'server',name:'Аренда сервака',amount:2.4,currency:'USD',period:'month',nextPayment:'',category:'Работа'},
  {id:'telegram',name:'Telegram Premium',amount:1990,currency:'RUB',period:'year',nextPayment:'',category:'Связь'},
  {id:'tmobile',name:'T-Mobile',amount:174,currency:'RUB',period:'month',nextPayment:'',category:'Связь'},
  {id:'yota',name:'Yota',amount:81,currency:'RUB',period:'month',nextPayment:'',category:'Связь'},
  {id:'chatgpt',name:'ChatGPT',amount:23,currency:'USD',period:'month',nextPayment:'',category:'Работа'}]};
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
function renderList(){const el=$('#subscription-list');if(!state.subscriptions.length){el.innerHTML='<div class="empty">Пока пусто.<br>Добавьте первую подписку.</div>';return}el.innerHTML=state.subscriptions.map((s,i)=>`<article class="list-item" data-id="${s.id}"><div class="category-dot" style="background:${COLORS[i%COLORS.length]}">${s.name.trim()[0]?.toUpperCase()||'•'}</div><div><div class="item-name">${escapeHtml(s.name)}</div><div class="item-meta">${escapeHtml(s.category||'Без категории')}${s.nextPayment?` · ${new Date(s.nextPayment+'T00:00').toLocaleDateString('ru-RU')}`:''}</div></div><div class="item-price">${money(s.amount,s.currency,s.currency==='RUB'?0:2)}<small>в ${s.period==='year'?'год':'месяц'}</small></div></article>`).join('');el.querySelectorAll('.list-item').forEach(x=>x.onclick=()=>openEditor(x.dataset.id))}
function escapeHtml(v){return String(v).replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]))}
function bubbleLayout(values,rect){const count=values.length;if(!count)return {radii:[],top:125};const top=Math.min(125,Math.max(72,rect.height*.22));const usableW=Math.max(1,rect.width-12),usableH=Math.max(1,rect.height-top-8);const min=Math.min(...values),max=Math.max(...values);const norms=values.map(v=>max===min?0.5:Math.sqrt(Math.max(0,(v-min)/(max-min))));const baseRadii=norms.map(norm=>42+norm*34);const baseArea=baseRadii.reduce((sum,r)=>sum+Math.PI*r*r,0);const availableArea=usableW*usableH;const targetFill=count<=6?.5:count<=12?.44:count<=24?.38:.34;const scale=Math.min(1,Math.sqrt((availableArea*targetFill)/Math.max(1,baseArea)));return {top,norms,radii:baseRadii.map(r=>Math.max(7,r*scale))}}
function renderBubbles(){bodies=[];world.innerHTML='';const values=state.subscriptions.map(monthlyRub),rect=world.getBoundingClientRect();const {top,norms=[],radii=[]}=bubbleLayout(values,rect),usableH=Math.max(1,rect.height-top);state.subscriptions.forEach((s,i)=>{const norm=norms[i]??.5,r=radii[i]??42,el=document.createElement('div');el.className=`bubble${r<28?' bubble-compact':''}${r<19?' bubble-micro':''}`;el.dataset.id=s.id;el.style.cssText=`width:${r*2}px;height:${r*2}px;--bubble:${COLORS[i%COLORS.length]};--bubble-r:${r}px`;el.innerHTML=`<span class="bubble-name">${escapeHtml(s.name)}</span><strong class="bubble-price">${money(originalMonthly(s),s.currency,s.currency==='RUB'?0:2)}</strong><span class="bubble-period">в месяц</span>`;world.appendChild(el);const angle=i*2.399963229728653+(i%3)*.17,spread=Math.sqrt((i+.7)/Math.max(1,state.subscriptions.length));const maxRX=Math.max(0,rect.width*.46-r),maxRY=Math.max(0,usableH*.44-r);const x=rect.width/2+Math.cos(angle)*maxRX*spread;const y=top+usableH/2+Math.sin(angle)*maxRY*spread;bodies.push({id:s.id,el,r,mass:1+norm*5,x:Math.max(r,Math.min(rect.width-r,x)),y:Math.max(top+r,Math.min(rect.height-r,y)),vx:(Math.random()-.5)*38,vy:(Math.random()-.5)*38})});bindDrag()}
function bindDrag(){bodies.forEach(b=>b.el.addEventListener('pointerdown',e=>{e.preventDefault();b.el.setPointerCapture(e.pointerId);drag={b,id:e.pointerId,lastX:e.clientX,lastY:e.clientY,lastT:performance.now(),vx:0,vy:0};b.vx=b.vy=0}))}
world.addEventListener('pointermove',e=>{if(!drag||drag.id!==e.pointerId)return;const rect=world.getBoundingClientRect(),t=performance.now(),dt=Math.max(8,t-drag.lastT)/1000,nx=e.clientX-rect.left,ny=e.clientY-rect.top;drag.vx=(nx-drag.lastX+rect.left)/dt;drag.vy=(ny-drag.lastY+rect.top)/dt;drag.b.x=Math.max(drag.b.r,Math.min(rect.width-drag.b.r,nx));drag.b.y=Math.max(drag.b.r,Math.min(rect.height-drag.b.r,ny));drag.lastX=e.clientX;drag.lastY=e.clientY;drag.lastT=t});
function release(e){if(!drag||drag.id!==e.pointerId)return;drag.b.vx=Math.max(-1100,Math.min(1100,drag.vx));drag.b.vy=Math.max(-1100,Math.min(1100,drag.vy));drag=null}world.addEventListener('pointerup',release);world.addEventListener('pointercancel',release);
function physics(t){const dt=Math.min(.025,(t-lastTime)/1000);lastTime=t;const rect=world.getBoundingClientRect(),top=Math.min(125,Math.max(72,rect.height*.22));for(const b of bodies){if(drag?.b!==b){b.x+=b.vx*dt;b.y+=b.vy*dt;b.vx*=Math.pow(.985,dt*60);b.vy*=Math.pow(.985,dt*60);if(Math.abs(b.vx)<7)b.vx+=(Math.random()-.5)*8;if(Math.abs(b.vy)<7)b.vy+=(Math.random()-.5)*8}if(b.x-b.r<0){b.x=b.r;b.vx=Math.abs(b.vx)*.82}if(b.x+b.r>rect.width){b.x=rect.width-b.r;b.vx=-Math.abs(b.vx)*.82}if(b.y-b.r<top){b.y=top+b.r;b.vy=Math.abs(b.vy)*.82}if(b.y+b.r>rect.height){b.y=rect.height-b.r;b.vy=-Math.abs(b.vy)*.82}}for(let i=0;i<bodies.length;i++)for(let j=i+1;j<bodies.length;j++){const a=bodies[i],b=bodies[j],dx=b.x-a.x,dy=b.y-a.y,minD=a.r+b.r,d=Math.hypot(dx,dy)||.01;if(d>=minD)continue;const nx=dx/d,ny=dy/d,over=minD-d,total=a.mass+b.mass;if(drag?.b!==a){a.x-=nx*over*(b.mass/total);a.y-=ny*over*(b.mass/total)}if(drag?.b!==b){b.x+=nx*over*(a.mass/total);b.y+=ny*over*(a.mass/total)}const rvx=b.vx-a.vx,rvy=b.vy-a.vy,along=rvx*nx+rvy*ny;if(along<0){const impulse=-(1.7)*along/(1/a.mass+1/b.mass);if(drag?.b!==a){a.vx-=impulse*nx/a.mass;a.vy-=impulse*ny/a.mass}if(drag?.b!==b){b.vx+=impulse*nx/b.mass;b.vy+=impulse*ny/b.mass}}}bodies.forEach(b=>b.el.style.transform=`translate3d(${b.x-b.r}px,${b.y-b.r}px,0)`);raf=requestAnimationFrame(physics)}
function refresh(){totals();renderList();renderBubbles()}
document.querySelectorAll('.nav-button').forEach(btn=>btn.onclick=()=>{document.querySelectorAll('.nav-button,.screen').forEach(x=>x.classList.remove('active'));btn.classList.add('active');$('#'+btn.dataset.screen).classList.add('active');if(btn.dataset.screen==='bubbles-screen')renderBubbles()});
function openEditor(id){const s=state.subscriptions.find(x=>x.id===id);$('#editor-title').textContent=s?'Редактировать':'Новая подписка';$('#subscription-id').value=s?.id||'';$('#name').value=s?.name||'';$('#amount').value=s?.amount||'';$('#currency').value=s?.currency||'RUB';$('#period').value=s?.period||'month';$('#next-payment').value=s?.nextPayment||'';$('#category').value=s?.category||'';$('#delete-button').classList.toggle('hidden',!s);$('#editor-dialog').showModal()}
$('#add-button').onclick=()=>openEditor();document.querySelectorAll('[data-close]').forEach(x=>x.onclick=()=>x.closest('dialog').close());
$('#subscription-form').onsubmit=e=>{e.preventDefault();const id=$('#subscription-id').value||crypto.randomUUID(),item={id,name:$('#name').value.trim(),amount:Number($('#amount').value),currency:$('#currency').value,period:$('#period').value,nextPayment:$('#next-payment').value,category:$('#category').value.trim(),updatedAt:now()};const idx=state.subscriptions.findIndex(x=>x.id===id),created=idx<0;if(created)state.subscriptions.push(item);else state.subscriptions[idx]=item;delete state.tombstones[id];saveState();$('#editor-dialog').close();refresh();if(created)trackAnalytics('expense_added');queueSync()};
$('#delete-button').onclick=()=>{const id=$('#subscription-id').value;if(!id||!confirm('Удалить эту подписку?'))return;state.tombstones[id]=now();state.subscriptions=state.subscriptions.filter(x=>x.id!==id);saveState();$('#editor-dialog').close();refresh();trackAnalytics('expense_deleted');queueSync()};
$('#rate-button').onclick=()=>{$('#rates-mode').checked=state.ratesMode!=='manual';$('#usd-rate').value=state.rates.USD;$('#try-rate').value=state.rates.TRY;$('#sgd-rate').value=state.rates.SGD;$('#rates-updated').textContent=state.autoRatesUpdatedAt?`Авто обновлено: ${formatWhen(state.autoRatesUpdatedAt)}`:'Авто ещё не обновлялось';$('#rate-dialog').showModal()};
$('#refresh-rates-button').onclick=()=>updateAutoRates({force:true});
$('#rate-form').onsubmit=e=>{e.preventDefault();const mode=$('#rates-mode').checked?'auto':'manual';if(mode==='manual')applyRates({USD:Number($('#usd-rate').value),TRY:Number($('#try-rate').value),SGD:Number($('#sgd-rate').value)},{mode:'manual'});else if(state.autoRatesUpdatedAt)applyRates(state.autoRates,{mode:'auto',autoUpdatedAt:state.autoRatesUpdatedAt});state.ratesMode=mode;state.ratesUpdatedAt=now();saveState();$('#rate-dialog').close();refresh();queueSync();if(mode==='auto')updateAutoRates({force:true})};
window.addEventListener('resize',renderBubbles);window.addEventListener('online',()=>{syncNow();updateAutoRates()});window.addEventListener('offline',renderSyncStatus);document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible'){syncNow();updateAutoRates()}});if('serviceWorker'in navigator)window.addEventListener('load',()=>navigator.serviceWorker.register('./sw.js'));
refresh();renderSyncStatus();updateAutoRates();syncNow();fxTimer=setInterval(updateAutoRates,6*60*60*1000);cancelAnimationFrame(raf);raf=requestAnimationFrame(physics);
