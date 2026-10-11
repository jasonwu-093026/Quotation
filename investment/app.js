import {emptyState,summary,validate,rebalance,applyRebalance,restoreUndo,snapshot,parseBackup,serializeBackup,createStore,STORAGE_KEY} from './core.js';
const $=selector=>document.querySelector(selector);const clone=x=>structuredClone(x);
let state=emptyState(),editing=null,simulation=null;const db=createStore(localStorage);
const num=value=>{if(!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(value.trim()))throw Error('請填寫有效數字，不可空白');return Number(value);};
const fmt=n=>n===null?'尚無資料':new Intl.NumberFormat('zh-TW',{maximumFractionDigits:4}).format(n);
const money=n=>new Intl.NumberFormat('zh-TW',{minimumFractionDigits:2,maximumFractionDigits:2}).format(n);
function notice(text,error=false){$('#notice').textContent=text;$('#notice').classList.toggle('error',error);}
function attempt(fn){try{fn();}catch(e){notice(e.message,true);}}
function persist(next,options){const saved=db.save(next,options);state=saved;simulation=null;render();notice('已保存於此瀏覽器。');}
function row(parent,title,description){const div=document.createElement('div');div.className='record';const heading=document.createElement('strong');heading.textContent=title;const p=document.createElement('p');p.textContent=description;div.append(heading,p);parent.append(div);return div;}
function button(parent,label,handler){const b=document.createElement('button');b.type='button';b.textContent=label;b.className='secondary';b.addEventListener('click',()=>attempt(handler));parent.append(b);}
function render(){
 const result=summary(state);$('#total').textContent=money(result.total);$('#beta').textContent=fmt(result.beta);$('#range').textContent=result.beta===null?'尚無資料':result.inRange?'範圍內':'超出範圍';
 $('#allocation').replaceChildren();for(const a of result.allocation){const div=document.createElement('div');div.className='allocation-row';const name=document.createElement('span');name.textContent=a.category;const value=document.createElement('strong');value.textContent=`NT$ ${money(a.value)} · ${fmt(a.ratio*100)}%`;div.append(name,value);$('#allocation').append(div);}
 for(const [key,value] of Object.entries({...state.settings,...state.cash}))$('#settings-form').elements[key].value=value;
 $('#holding-list').replaceChildren();const selector=$('#rebalance-holding');const selected=selector.value;selector.replaceChildren();
 for(const h of state.holdings){const div=row($('#holding-list'),h.symbol,`${h.currency} · ${h.category} · ${fmt(h.shares)} 股 · 每股 ${money(h.price)} · Beta ${fmt(h.beta)}`);const actions=document.createElement('div');actions.className='actions';div.append(actions);
  button(actions,'編輯',()=>{editing=h.id;for(const k of ['symbol','currency','category','shares','price','beta'])$('#holding-form').elements[k].value=h[k];$('#save-holding').textContent='儲存持股修改';$('#cancel-edit').hidden=false;$('#holding-form').elements.symbol.focus();});
  button(actions,'刪除',()=>{if(confirm(`刪除 ${h.symbol}？此操作只移除工具紀錄，不代表賣出。`)){const next=clone(state);next.holdings=next.holdings.filter(x=>x.id!==h.id);next.undo=null;persist(next);if(editing===h.id)cancelEdit();}});
  const opt=document.createElement('option');opt.value=h.id;opt.textContent=h.symbol+' · '+h.currency;selector.append(opt);
 }
 if(state.holdings.some(h=>h.id===selected))selector.value=selected;
 $('#simulation').replaceChildren();$('#apply').disabled=true;$('#undo').disabled=!state.undo;
 $('#history-list').replaceChildren();for(const h of [...state.history].sort((a,b)=>b.date.localeCompare(a.date))){const r=summary(h.portfolio);row($('#history-list'),h.date,`總資產 NT$ ${money(r.total)} · Beta ${fmt(r.beta)}`);}
}
function cancelEdit(){editing=null;$('#holding-form').reset();$('#save-holding').textContent='新增持股';$('#cancel-edit').hidden=true;}
$('#settings-form').addEventListener('submit',event=>{event.preventDefault();attempt(()=>{const form=event.currentTarget;const next=clone(state);for(const k of ['target','tolerance','fx'])next.settings[k]=num(form.elements[k].value);for(const k of ['TWD','USD'])next.cash[k]=num(form.elements[k].value);next.undo=null;persist(validate(next));});});
$('#holding-form').addEventListener('submit',event=>{event.preventDefault();attempt(()=>{const f=event.currentTarget;const holding={id:editing||(crypto.randomUUID?.()||Array.from(crypto.getRandomValues(new Uint8Array(16)),b=>b.toString(16).padStart(2,'0')).join(''))};for(const k of ['symbol','currency','category'])holding[k]=f.elements[k].value.trim();for(const k of ['shares','price','beta'])holding[k]=num(f.elements[k].value);const next=clone(state);if(editing)next.holdings[next.holdings.findIndex(h=>h.id===editing)]=holding;else next.holdings.push(holding);next.undo=null;persist(validate(next));cancelEdit();});});
$('#cancel-edit').addEventListener('click',cancelEdit);
$('#rebalance-form').addEventListener('submit',event=>{event.preventDefault();simulation=null;$('#apply').disabled=true;$('#simulation').replaceChildren();attempt(()=>{const f=event.currentTarget;const id=f.elements.holding.value;const target=num(f.elements.target.value);const r=rebalance(state,id,target);simulation={id,target};const div=row($('#simulation'),r.delta<0?`賣出 ${fmt(-r.delta)} 股`:`買入 ${fmt(r.delta)} 股`,`${r.delta<0?'收入':'支出'} ${r.currency} ${money(r.amount)} · 剩餘現金 ${r.currency} ${money(r.remaining)} · 調整後 Beta ${fmt(r.beta)}`);div.classList.add('simulation-result');const status=document.createElement('p');status.textContent=r.limited?'受現金或持股數量限制，無法完全達標。':r.attained?'已達試算目標。':'整股取整後無法完全達標。';div.append(status);$('#apply').disabled=r.delta===0;});});
$('#rebalance-form').addEventListener('input',()=>{simulation=null;$('#apply').disabled=true;$('#simulation').replaceChildren();});
$('#apply').addEventListener('click',()=>attempt(()=>{if(simulation&&confirm('確認更新工具內持股與現金？不會執行真實交易。'))persist(applyRebalance(state,simulation.id,simulation.target));}));
$('#undo').addEventListener('click',()=>attempt(()=>{if(confirm('復原上次套用前的持股與現金？'))persist(restoreUndo(state));}));
$('#snapshot-date').value=new Date().toLocaleDateString('sv-SE');
$('#snapshot').addEventListener('click',()=>attempt(()=>{const date=$('#snapshot-date').value;const exists=state.history.some(h=>h.date===date);if(exists&&!confirm('同一天已有快照，確認覆蓋？'))return;persist(snapshot(state,date,exists));}));
$('#export').addEventListener('click',()=>attempt(()=>{const blob=new Blob([serializeBackup(state)],{type:'application/json'});const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download='investment-backup.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);notice('已匯出目前資料，請妥善保管明文備份。');}));
$('#import').addEventListener('change',async event=>{try{const file=event.target.files[0];if(!file)return;if(file.size>2*1024*1024)throw Error('備份不得超過 2 MB');const next=parseBackup(await file.text());if(confirm('確認以備份整批取代目前持股、設定與歷史？')){persist(next,{recover:true});cancelEdit();}}catch(e){notice(e.message,true);}finally{event.target.value='';}});
window.addEventListener('storage',event=>{if(event.key===STORAGE_KEY){simulation=null;$('#apply').disabled=true;notice('其他分頁已改動資料，請匯出目前資料後重新載入。',true);}});
$('#logout').addEventListener('click',async()=>{try{const r=await fetch('/api/logout',{method:'POST'});if(!r.ok)throw Error('登出失敗，請重試');state=emptyState();$('#workspace').hidden=true;location.replace('/');}catch(e){notice(e.message,true);}});
try{const r=await fetch('/api/session',{cache:'no-store'});if(!r.ok){location.replace('/');}else{try{state=db.load();}catch(e){notice('既有資料讀取失敗，已停止覆寫；請匯入有效備份。'+e.message,true);}render();$('#access').hidden=true;$('#workspace').hidden=false;}}catch{$('#access').textContent='私人入口尚未連線，請啟動私人伺服器後登入。';}
