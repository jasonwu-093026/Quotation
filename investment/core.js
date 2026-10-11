import {Decimal} from '../src/decimal.js';
export const STORAGE_KEY='investment.exposure.v1';
const clone=value=>structuredClone(value);
const D=value=>Decimal.from(value);
const money=value=>Number(value.fixed(2));
const portfolio=s=>clone({settings:s.settings,holdings:s.holdings,cash:s.cash});
export function emptyState(){return {version:1,settings:{target:1,tolerance:10,fx:32},holdings:[],cash:{TWD:0,USD:0},history:[],undo:null};}
function number(v,min,max,label){if(typeof v!=='number'||!Number.isFinite(v)||v<min||v>max)throw Error(`${label}必須是 ${min} 至 ${max} 的有效數字`);}
function text(v,label){if(typeof v!=='string'||!v.trim()||v.length>100)throw Error(`${label}不可空白且最多 100 字`);}
function validatePortfolio(s){
 if(!s||!s.settings||!s.cash||!Array.isArray(s.holdings)||s.holdings.length>2000)throw Error('持股資料格式錯誤');
 number(s.settings.target,-20,20,'目標 Beta');number(s.settings.tolerance,0,100,'容忍度');number(s.settings.fx,.000001,1000000,'匯率');
 for(const c of ['TWD','USD']){number(s.cash[c],0,1e12,c+' 現金');if(Math.abs(s.cash[c]*100-Math.round(s.cash[c]*100))>1e-4)throw Error('現金最多兩位小數');}
 const ids=new Set();for(const h of s.holdings){
  if(!h)throw Error('持股格式錯誤');for(const k of ['id','symbol','category'])text(h[k],k);
  if(ids.has(h.id))throw Error('持股 id 重複');ids.add(h.id);
  if(!['TWD','USD'].includes(h.currency))throw Error('幣別只接受 TWD / USD');
  number(h.shares,0,1e9,'股數');if(!Number.isSafeInteger(h.shares))throw Error('股數必須為整股');
  number(h.price,0,1e9,'價格');number(h.beta,-20,20,'Beta');
 }
 // 依原有精確十進位路徑換算，先限制金額可安全顯示才進行曝險計算。
 totalOf(s);return s;
}
export function validate(s){
 if(!s||s.version!==1)throw Error('不支援的備份版本');validatePortfolio(s);
 if(!Array.isArray(s.history)||s.history.length>5000)throw Error('歷史格式錯誤或超過 5000 筆');
 const dates=new Set();for(const h of s.history){if(!h||!/^\d{4}-\d{2}-\d{2}$/.test(h.date)||new Date(h.date+'T00:00:00Z').toISOString().slice(0,10)!==h.date||dates.has(h.date))throw Error('歷史日期無效或重複');dates.add(h.date);validatePortfolio(h.portfolio);}
 if(s.undo!==null)validatePortfolio(s.undo);return clone(s);
}
function holdingValue(h,fx){return money(D(h.shares).mul(D(h.price)).mul(D(h.currency==='USD'?fx:1)));}
function totalOf(s){let total=D(s.cash.TWD).add(D(s.cash.USD).mul(D(s.settings.fx)));for(const h of s.holdings)total=total.add(D(holdingValue(h,s.settings.fx)));return money(total);}
export function summary(s){
 validatePortfolio(s);const total=totalOf(s);const weighted=s.holdings.reduce((sum,h)=>sum+holdingValue(h,s.settings.fx)*h.beta,0);
 const beta=total?weighted/total:null;const width=(Math.abs(s.settings.target)||1)*s.settings.tolerance/100;
 const groups=new Map();for(const h of s.holdings)groups.set(h.category,(groups.get(h.category)||0)+holdingValue(h,s.settings.fx));groups.set('現金',(groups.get('現金')||0)+money(D(s.cash.TWD).add(D(s.cash.USD).mul(D(s.settings.fx)))));
 return {total,beta,inRange:beta!==null&&Math.abs(beta-s.settings.target)<=width+1e-10,message:total?'':'尚無資料',allocation:[...groups].map(([category,value])=>({category,value,ratio:total?value/total:0}))};
}
export function rebalance(s,id,target=s.settings.target){
 validatePortfolio(s);number(target,-20,20,'再平衡目標');const h=s.holdings.find(h=>h.id===id);if(!h)throw Error('請選擇持股');const before=summary(s);
 if(!before.total||!h.price||!h.beta)throw Error('零資產、零價格或零 Beta 不能調整曝險');
 const unit=h.price*(h.currency==='USD'?s.settings.fx:1);
 const ideal=before.total*(target-before.beta)/(unit*h.beta);
 const affordable=D(s.cash[h.currency]).div(D(h.price));const maxBuy=Number(affordable.n/affordable.d);
 const requested=Math.round(ideal);const delta=Math.max(-h.shares,Math.min(maxBuy,requested));
 const amount=money(D(Math.abs(delta)).mul(D(h.price)));const remaining=money(delta>=0?D(s.cash[h.currency]).sub(D(amount)):D(s.cash[h.currency]).add(D(amount)));
 const next=clone(s);next.holdings.find(x=>x.id===id).shares+=delta;next.cash[h.currency]=remaining;
 const after=summary(next);return {delta,amount,remaining,currency:h.currency,beta:after.beta,target,limited:delta!==requested,attained:Math.abs(after.beta-target)<1e-9};
}
export function applyRebalance(s,id,target){const r=rebalance(s,id,target);const next=clone(s);next.undo=portfolio(s);next.holdings.find(h=>h.id===id).shares+=r.delta;next.cash[r.currency]=r.remaining;return validate(next);}
export function restoreUndo(s){if(!s.undo)throw Error('沒有可復原的交易');return validate({...clone(s),...clone(s.undo),undo:null});}
export function snapshot(s,date,overwrite=false){const next=clone(s);if(next.history.some(h=>h.date===date)&&!overwrite)throw Error('同一天已有快照，請確認覆蓋');next.history=next.history.filter(h=>h.date!==date);next.history.push({date,portfolio:portfolio(s)});return validate(next);}
export function parseBackup(raw){if(typeof raw!=='string'||raw.length>2*1024*1024)throw Error('備份不得超過 2 MB');let value;try{value=JSON.parse(raw);}catch{throw Error('JSON 格式錯誤，未變更資料');}return validate(value);}
export function serializeBackup(s){const raw=JSON.stringify(validate(s),null,2);if(raw.length>2*1024*1024)throw Error('備份不得超過 2 MB，請減少歷史資料');return raw;}
export function createStore(adapter){let previous;let blocked=false;return {
 load(){try{previous=adapter.getItem(STORAGE_KEY);return previous===null?emptyState():parseBackup(previous);}catch(e){blocked=true;throw e;}},
 save(value,{recover=false}={}){const next=validate(value);if(blocked&&!recover)throw Error('既有資料無法讀取，請先匯入有效備份');if(adapter.getItem(STORAGE_KEY)!==previous)throw Error('其他分頁已變更資料，請匯出目前資料後重新載入');const raw=serializeBackup(next);adapter.setItem(STORAGE_KEY,raw);previous=raw;blocked=false;return next;}
 };}
