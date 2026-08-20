import http from 'node:http';
import {readFile,writeFile,rename,mkdir} from 'node:fs/promises';
import {dirname} from 'node:path';

const PORT=Number(process.env.PORT||8787);
const DATA_FILE=process.env.DATA_FILE||'./data/subbubble.json';
const SYNC_TOKEN=process.env.SYNC_TOKEN||'';
const ALLOWED_ORIGIN=process.env.ALLOWED_ORIGIN||'*';

function normalize(raw){
  if(!raw||!Array.isArray(raw.subscriptions))return {version:2,rates:{},ratesUpdatedAt:0,subscriptions:[],tombstones:{}};
  return {version:2,rates:{...(raw.rates||{})},ratesUpdatedAt:Number(raw.ratesUpdatedAt)||0,subscriptions:raw.subscriptions.filter(x=>x&&x.id).map(x=>({...x,updatedAt:Number(x.updatedAt)||0})),tombstones:{...(raw.tombstones||{})}};
}
function merge(a,b){
  const left=normalize(a),right=normalize(b),byId=new Map();
  const ids=new Set([...left.subscriptions.map(x=>x.id),...right.subscriptions.map(x=>x.id),...Object.keys(left.tombstones),...Object.keys(right.tombstones)]);
  for(const id of ids){
    const l=left.subscriptions.find(x=>x.id===id),r=right.subscriptions.find(x=>x.id===id);
    const deletedAt=Math.max(Number(left.tombstones[id])||0,Number(right.tombstones[id])||0);
    const newest=!l?r:!r?l:(Number(l.updatedAt)||0)>=(Number(r.updatedAt)||0)?l:r;
    if(newest&&Number(newest.updatedAt)>deletedAt)byId.set(id,{...newest});
  }
  const tombstones={};
  for(const id of ids){
    const deletedAt=Math.max(Number(left.tombstones[id])||0,Number(right.tombstones[id])||0),live=byId.get(id);
    if(deletedAt&&(!live||deletedAt>=Number(live.updatedAt)))tombstones[id]=deletedAt;
  }
  const remoteRatesNewer=(right.ratesUpdatedAt||0)>(left.ratesUpdatedAt||0);
  return {version:2,rates:{...(remoteRatesNewer?right.rates:left.rates)},ratesUpdatedAt:Math.max(left.ratesUpdatedAt||0,right.ratesUpdatedAt||0),subscriptions:[...byId.values()].sort((x,y)=>(x.updatedAt||0)-(y.updatedAt||0)),tombstones};
}
async function readState(){try{return normalize(JSON.parse(await readFile(DATA_FILE,'utf8')))}catch{return normalize(null)}}
async function writeState(state){await mkdir(dirname(DATA_FILE),{recursive:true});const tmp=`${DATA_FILE}.tmp`;await writeFile(tmp,JSON.stringify(state,null,2),'utf8');await rename(tmp,DATA_FILE)}
function cors(res){res.setHeader('Access-Control-Allow-Origin',ALLOWED_ORIGIN);res.setHeader('Access-Control-Allow-Headers','Content-Type, Authorization');res.setHeader('Access-Control-Allow-Methods','POST, OPTIONS')}
function json(res,status,body){cors(res);res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify(body))}

const server=http.createServer(async(req,res)=>{
  if(req.method==='OPTIONS'){cors(res);res.writeHead(204);return res.end()}
  if(req.method!=='POST'||req.url!=='/sync')return json(res,404,{error:'not_found'});
  if(SYNC_TOKEN&&req.headers.authorization!==`Bearer ${SYNC_TOKEN}`)return json(res,401,{error:'unauthorized'});
  let body='';for await(const chunk of req){body+=chunk;if(body.length>1_000_000)return json(res,413,{error:'payload_too_large'})}
  try{
    const incoming=JSON.parse(body||'{}');
    const current=await readState();
    const merged=merge(current,incoming.state);
    await writeState(merged);
    return json(res,200,{state:merged});
  }catch(err){console.error(err);return json(res,400,{error:'bad_request'})}
});
server.listen(PORT,'0.0.0.0',()=>console.log(`SubBubble sync listening on :${PORT}`));
