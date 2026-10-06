import {settingKeys,orderKeys,labels,validateSettings,validateOrder,assertValid} from './validation.js';
import {calculateQuote} from './calculator.js';
import {createStorage,serializeBackup,parseBackup,STORAGE_KEY} from './storage.js';
import {createQuote,updateQuote,saveQuote,deleteQuote,applyCurrentSettings} from './quotes.js';
import {devCategories,devCategoryLabels,devMethods,devMethodLabels,emptyDevItem,defaultDev,validateDev,calculateDevelopment} from './devcost.js';
const $=selector=>document.querySelector(selector);
const copy=value=>structuredClone(value);
const today=()=>{const d=new Date();return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;};
const emptySettings=()=>Object.fromEntries(settingKeys.map(k=>[k,'']));
const emptyOrder=()=>Object.fromEntries(orderKeys.map(k=>[k,k==='date'?today():'']));
const sampleSettings={machineCount:'2',machineDays:'20',machineHours:'8',machineUtilization:'75',depreciation:'40000',maintenance:'2000',rent:'10000',electricity:'15000',consumables:'5000',workerCount:'2',workerDays:'20',workerHours:'8',workerUtilization:'75',laborMonthly:'57600'};
const sampleOrder={name:'示範報價',partNumber:'DEMO-001',date:today(),quantity:'100',machineMinutes:'5',laborMinutes:'1',setupMachineMinutes:'60',setupLaborMinutes:'60',materialUnit:'20',outsourceUnit:'10',toolingBatch:'500',marginPercent:'20',notes:'假資料，請勿直接用於實際報價。'};
let store={schemaVersion:1,settings:null,quotes:[]},activeQuoteId=null,quoteSettings=null,dirty=false,globalDirty=false,readBlocked=false,externalChange=false,rawRecovery=null,devState=defaultDev();
const adapter={getItem:key=>window.localStorage.getItem(key),setItem:(key,value)=>window.localStorage.setItem(key,value)};
const db=createStorage(adapter);
function notice(message,error=false){$('#notice').hidden=false;$('#notice').className='notice'+(error?' error':'');$('#notice').textContent=message;}
function storageAlert(message){$('#storage-alert').hidden=false;$('#storage-alert').textContent=message;}
try{store=db.load();}catch(e){readBlocked=true;try{rawRecovery=adapter.getItem(STORAGE_KEY);}catch{}storageAlert('無法讀取既有資料，已停止覆寫以保護原資料。你仍可試算及匯出草稿；請匯入有效備份還原。原因：'+e.message);}
const units={machineCount:'台',machineDays:'天／月',machineHours:'小時／天',machineUtilization:'%',depreciation:'元／月',maintenance:'元／月',rent:'元／月',electricity:'元／月',consumables:'元／月',workerCount:'人',workerDays:'天／月',workerHours:'小時／天',workerUtilization:'%',laborMonthly:'元／月',quantity:'件',machineMinutes:'機台分鐘／件',laborMinutes:'人分鐘／件',setupMachineMinutes:'機台分鐘／批',setupLaborMinutes:'人分鐘／批',materialUnit:'元／件',outsourceUnit:'元／件',toolingBatch:'元／批',marginPercent:'%'};
function addFields(target,keys,prefix){for(const key of keys){const label=document.createElement('label');label.className='field'+(key==='name'||key==='notes'?' wide':'');label.htmlFor=prefix+'-'+key;
 const title=document.createElement('span');title.className='field-label';const name=document.createElement('span');name.textContent=labels[key];const unit=document.createElement('span');unit.className='field-unit';unit.textContent=units[key]||'';title.append(name,unit);
 const input=document.createElement(key==='notes'?'textarea':'input');input.id=prefix+'-'+key;input.name=key;input.autocomplete='off';if(key==='date')input.type='date';else if(!['name','notes','partNumber'].includes(key)){input.type='text';input.inputMode='decimal';input.placeholder='請輸入';input.maxLength=30;}else{input.maxLength=key==='notes'?5000:200;input.placeholder=key==='notes'?'記錄損耗、重工或本次報價假設…':key==='partNumber'?'選填':'例如：鋁件加工報價';}
 const error=document.createElement('div');error.className='field-error';error.id=input.id+'-error';input.setAttribute('aria-describedby',error.id);label.append(title,input,error);$(target).append(label);
}}
addFields('#order-meta',['name','partNumber','date','quantity'],'o');
addFields('#order-times',['machineMinutes','laborMinutes'],'o');
addFields('#order-setup',['setupMachineMinutes','setupLaborMinutes'],'o');
addFields('#order-costs',['materialUnit','outsourceUnit','toolingBatch'],'o');
addFields('#order-notes',['notes'],'o');addFields('#margin-field',['marginPercent'],'o');
addFields('#machine-fields',['machineCount','machineDays','machineHours','machineUtilization'],'s');
addFields('#expense-fields',['depreciation','maintenance','rent','electricity','consumables'],'s');
addFields('#worker-fields',['workerCount','workerDays','workerHours','workerUtilization','laborMonthly'],'s');
function readFields(keys,prefix){return Object.fromEntries(keys.map(k=>[k,$('#'+prefix+'-'+k).value]));}
const readOrder=()=>readFields(orderKeys,'o');const readSettings=()=>readFields(settingKeys,'s');
function fillFields(data,keys,prefix){for(const key of keys)$('#'+prefix+'-'+key).value=data?.[key]??'';}
function showErrors(issues,prefix,container){const keys=prefix==='o'?orderKeys:settingKeys;for(const key of keys){const input=$('#'+prefix+'-'+key);const error=issues.find(i=>i.field===key);input.setAttribute('aria-invalid',error?'true':'false');$('#'+prefix+'-'+key+'-error').textContent=error?.message||'';}
 const box=$(container);box.replaceChildren();box.hidden=!issues.length;for(const issue of issues.slice(0,5)){const p=document.createElement('p');p.textContent=issue.message;box.append(p);}if(issues.length>5){const p=document.createElement('p');p.textContent=`另有 ${issues.length-5} 個欄位待完成。`;box.append(p);}}
function money(value){const [whole,fraction]=value.split('.');return whole.replace(/\B(?=(\d{3})+(?!\d))/g,',')+(fraction?'.'+fraction:'');}
function changeView(name){for(const section of document.querySelectorAll('.view'))section.hidden=section.id!=='view-'+name;for(const b of document.querySelectorAll('nav [data-view]')){const active=b.dataset.view===name;b.classList.toggle('active',active);if(active)b.setAttribute('aria-current','page');else b.removeAttribute('aria-current');}$('#breadcrumb').textContent={quote:'訂單試算',settings:'成本設定',records:'報價紀錄'}[name];if(name==='records')renderRecords();}
for(const button of document.querySelectorAll('[data-view]'))button.addEventListener('click',()=>changeView(button.dataset.view));
function updateStatus(){const latest=quoteSettings&&store.settings&&JSON.stringify(quoteSettings)===JSON.stringify(store.settings);$('#snapshot-label').textContent=!quoteSettings?'尚未設定成本':latest?'本筆使用最新基本成本':'本筆使用獨立成本快照';$('#draft-status').textContent=dirty?'尚未保存':activeQuoteId?'已保存':'新報價';$('#save-update').disabled=!activeQuoteId;$('#record-count').textContent=String(store.quotes.length);}
const breakdownNames={machine:'單件機台',labor:'單件人工',setupMachine:'架機機台分攤',setupLabor:'架機人工分攤',material:'材料',outsource:'外包',tooling:'專用刀具分攤'};
const devFieldLabels={name:'項目名稱',hours:'小時',rate:'每小時費率',quantity:'數量',unitPrice:'單價',amount:'固定金額',vendor:'委外機構／供應商（選填）',note:'備註'};
function devForCalc(){return {items:devState.items,marginPercent:devState.marginPercent,chargeMode:devState.chargeMode};}
// 結構變動（新增／刪除／切換計算方式／換筆報價）才重建 DOM；一般輸入只呼叫 applyDevIssues，
// 避免每次按鍵都整個重繪導致輸入焦點被打斷。
function devItemRow(item,index){
 const row=document.createElement('div');row.className='card dev-item';row.dataset.devId=item.id;
 const head=document.createElement('div');head.className='dev-item-head';
 const category=document.createElement('select');category.setAttribute('aria-label','開發費分類');for(const key of devCategories){const opt=document.createElement('option');opt.value=key;opt.textContent=devCategoryLabels[key];category.append(opt);}category.value=item.category;
 category.addEventListener('change',()=>{item.category=category.value;dirty=true;calculate();});
 const method=document.createElement('select');method.setAttribute('aria-label','計算方式');for(const key of devMethods){const opt=document.createElement('option');opt.value=key;opt.textContent=devMethodLabels[key];method.append(opt);}method.value=item.method;
 method.addEventListener('change',()=>{for(const key of ['hours','rate','quantity','unitPrice','amount'])item[key]='';item.method=method.value;dirty=true;rebuildDevItems();calculate();});
 const remove=document.createElement('button');remove.type='button';remove.className='danger-button';remove.textContent='刪除';
 remove.addEventListener('click',()=>{devState.items=devState.items.filter(i=>i.id!==item.id);dirty=true;rebuildDevItems();calculate();});
 head.append(category,method,remove);row.append(head);
 function textField(key,placeholder,wide=false){
  const label=document.createElement('label');label.className='field'+(wide?' wide':'');
  const title=document.createElement('span');title.className='field-label';title.textContent=devFieldLabels[key];
  const input=document.createElement(key==='note'?'textarea':'input');input.maxLength=key==='note'?2000:200;
  input.placeholder=placeholder||'';input.value=item[key]||'';input.dataset.devField=key;
  input.addEventListener('input',()=>{item[key]=input.value;dirty=true;calculate();});
  const error=document.createElement('div');error.className='field-error';error.dataset.devErrorFor=key;
  label.append(title,input,error);return label;
 }
 function numberField(key,unit){
  const label=document.createElement('label');label.className='field';
  const title=document.createElement('span');title.className='field-label';const name=document.createElement('span');name.textContent=devFieldLabels[key];const u=document.createElement('span');u.className='field-unit';u.textContent=unit;title.append(name,u);
  const input=document.createElement('input');input.type='text';input.inputMode='decimal';input.maxLength=30;input.placeholder='請輸入';input.value=item[key]||'';input.dataset.devField=key;
  input.addEventListener('input',()=>{item[key]=input.value;dirty=true;calculate();});
  const error=document.createElement('div');error.className='field-error';error.dataset.devErrorFor=key;
  label.append(title,input,error);return label;
 }
 const fields=document.createElement('div');fields.className='fields two';
 fields.append(textField('name','例如：加工程式撰寫',true));
 if(item.method==='hours'){fields.append(numberField('hours','小時'),numberField('rate','元／小時'));}
 else if(item.method==='quantity'){fields.append(numberField('quantity','數量'),numberField('unitPrice','元／單位'));}
 else{fields.append(numberField('amount','元'));}
 fields.append(textField('vendor','選填'));
 fields.append(textField('note','記錄依據或估算假設…',true));
 row.append(fields);
 return row;
}
function rebuildDevItems(){
 const container=$('#dev-items');container.replaceChildren();
 if(!devState.items.length){const p=document.createElement('p');p.className='muted';p.textContent='尚未新增開發費項目。新增後將顯示在此，可隨時修改或刪除。';container.append(p);}
 devState.items.forEach((item,index)=>container.append(devItemRow(item,index)));
 $('#dev-marginPercent').value=devState.marginPercent;
 for(const radio of document.querySelectorAll('input[name="dev-chargeMode"]'))radio.checked=radio.value===devState.chargeMode;
}
function applyDevIssues(issues){
 for(const row of document.querySelectorAll('#dev-items .dev-item')){
  const id=row.dataset.devId;const index=devState.items.findIndex(i=>i.id===id);
  for(const error of row.querySelectorAll('[data-dev-error-for]')){
   const key=error.dataset.devErrorFor;const msg=issues.find(i=>i.field===`items.${index}.${key}`)?.message||'';
   error.textContent=msg;const input=row.querySelector(`[data-dev-field="${key}"]`);if(input)input.setAttribute('aria-invalid',msg?'true':'false');
  }
 }
 const marginError=issues.find(i=>i.field==='marginPercent')?.message||'';$('#dev-marginPercent-error').textContent=marginError;$('#dev-marginPercent').setAttribute('aria-invalid',marginError?'true':'false');
 const otherIssues=issues.filter(i=>!i.field.startsWith('items.')&&i.field!=='marginPercent'&&i.field!=='chargeMode');
 const box=$('#dev-errors');box.replaceChildren();box.hidden=!otherIssues.length;for(const issue of otherIssues.slice(0,5)){const p=document.createElement('p');p.textContent=issue.message;box.append(p);}
}
function renderDevResult(devResult){
 const breakdown=$('#dev-breakdown');breakdown.replaceChildren();
 $('#dev-perunit-row').hidden=true;$('#dev-rounding-note').hidden=true;
 if(!devState.items.length){
  const p=document.createElement('p');p.className='muted';p.textContent='尚未新增開發費項目，視為未使用此功能。';breakdown.append(p);
  $('#dev-cost').textContent='—';$('#dev-price').textContent='—';$('#dev-grand-total').textContent='—';
  return;
 }
 if(!devResult){
  const p=document.createElement('p');p.className='muted';p.textContent='請先完成試算及修正開發費欄位，才能計算開發費與整筆報價總額。';breakdown.append(p);
  $('#dev-cost').textContent='—';$('#dev-price').textContent='—';$('#dev-grand-total').textContent='—';
  return;
 }
 for(const item of devResult.items){const source=devState.items.find(i=>i.id===item.id);if(!source)continue;const row=document.createElement('div');row.className='breakdown-row';const name=document.createElement('span');name.className='key';const dot=document.createElement('span');dot.className='legend-dot';name.append(dot,document.createTextNode(source.name||devCategoryLabels[source.category]));const amount=document.createElement('strong');amount.textContent=money(item.subtotal);row.append(name,amount);breakdown.append(row);}
 $('#dev-cost').textContent=money(devResult.devCost);
 $('#dev-price').textContent=money(devResult.devPrice);
 if(devResult.chargeMode==='amortized'){$('#dev-perunit-row').hidden=false;$('#dev-perunit').textContent=money(devResult.perUnitDevCost);}
 $('#dev-grand-total').textContent='NT$ '+money(devResult.grandTotal);
 if(devResult.roundingDiff!=='0.00'){$('#dev-rounding-note').hidden=false;$('#dev-rounding-note').textContent=`因每件分攤金額向上取至 0.01 元，整筆報價較未取整數值多 NT$ ${money(devResult.roundingDiff)}，已計入報價總額。`;}
}
function calculate(show=true){
 const order=readOrder();const issues=validateOrder(order);
 const settingsIssues=quoteSettings?validateSettings(quoteSettings):[{field:'settings',message:'請先設定基本成本，或點「載入示範」試算。'}];
 if(show)showErrors([...settingsIssues,...issues],'o','#form-errors');else showErrors([],'o','#form-errors');
 let result=null;
 if(!issues.length&&!settingsIssues.length){try{result=calculateQuote(quoteSettings,order);}catch(e){showErrors(e.issues||[{field:'calculation',message:e.message}],'o','#form-errors');}}
 $('#result-content').hidden=!result;$('#result-empty').hidden=!!result;$('#breakdown').replaceChildren();$('#unit-cost').textContent='—';$('#batch-cost').textContent='—';$('#rate-details').textContent='尚未完成有效試算';
 if(result){$('#unit-price').textContent=result.unitPrice;$('#batch-price').textContent='NT$ '+money(result.batchPrice);$('#unit-cost').textContent=money(result.unitCost);$('#batch-cost').textContent=money(result.batchCost);
 for(const [key,value] of Object.entries(result.unitBreakdown)){const row=document.createElement('div');row.className='breakdown-row';const name=document.createElement('span');name.className='key';const dot=document.createElement('span');dot.className='legend-dot';name.append(dot,document.createTextNode(breakdownNames[key]));const amount=document.createElement('strong');amount.textContent=money(value);row.append(name,amount);$('#breakdown').append(row);}
 const s=quoteSettings,r=result.rates;
 $('#rate-details').replaceChildren();for(const text of [`機台有效分鐘：${s.machineCount} 台 × ${s.machineDays} 天 × ${s.machineHours} 小時 × 60 × ${s.machineUtilization}% = ${r.machineMinutes}`,`機台月分攤費：${s.depreciation} + ${s.maintenance} + ${s.rent} + ${s.electricity} + ${s.consumables} 元；除以有效分鐘 → ${r.machinePerMinute} 元／機台分鐘（不含人工）。`,`人工有效分鐘：${s.workerCount} 人 × ${s.workerDays} 天 × ${s.workerHours} 小時 × 60 × ${s.workerUtilization}% = ${r.laborMinutes}`,`人工 ${s.laborMonthly} 元 ÷ 有效人分鐘 → ${r.laborPerMinute} 元／人分鐘。`,`費率顯示至 6 位小數，內部計算保留完整精度。`]){const p=document.createElement('p');p.textContent=text;$('#rate-details').append(p);}
 }
 const devIssues=validateDev(devForCalc());
 applyDevIssues(show?devIssues:[]);
 let devResult=null;
 if(result&&!devIssues.length){try{devResult=calculateDevelopment(order,devForCalc(),result);}catch(e){applyDevIssues(e.issues||[{field:'dev',message:e.message}]);}}
 renderDevResult(devResult);
 updateStatus();return result;
}
function newId(){
 if(typeof crypto.randomUUID==='function')return crypto.randomUUID();
 const bytes=crypto.getRandomValues(new Uint8Array(16));
 bytes[6]=(bytes[6]&15)|64;bytes[8]=(bytes[8]&63)|128;
 const hex=Array.from(bytes,b=>b.toString(16).padStart(2,'0')).join('');
 return [hex.slice(0,8),hex.slice(8,12),hex.slice(12,16),hex.slice(16,20),hex.slice(20)].join('-');
}
function devForSave(){return devState.items.length?devForCalc():null;}
function makeDraft(forceNew=false){const result=calculate();if(!result)throw new Error('請先修正欄位後再保存或匯出草稿。');const now=new Date().toISOString(),old=store.quotes.find(q=>q.id===activeQuoteId);return !forceNew&&old?updateQuote(old,quoteSettings,readOrder(),now,devForSave()):createQuote(quoteSettings,readOrder(),{id:newId(),now},devForSave());}
function persist(next,{recover=false}={}){
 try{if((readBlocked||externalChange)&&!recover)throw new Error(externalChange?'另一個分頁已修改資料，請先匯出草稿再重新整理。':'既有資料讀取異常，請先匯入有效備份。');db.save(next);store=next;if(recover){readBlocked=false;externalChange=false;rawRecovery=null;}$('#storage-alert').hidden=false;$('#storage-alert').className='notice info';$('#storage-alert').textContent='資料已保存於此瀏覽器；請定期匯出備份。';return true;}
 catch(e){notice('尚未保存：'+e.message+' 可先匯出目前有效草稿備份。',true);updateStatus();return false;}
}
function guard(){return !dirty||confirm('本筆有尚未保存的變更，確定放棄並切換嗎？');}
function loadQuote(q){activeQuoteId=q.id;quoteSettings=copy(q.settingsSnapshot);fillFields(q.order,orderKeys,'o');devState=q.dev!=null?copy(q.dev):defaultDev();rebuildDevItems();dirty=false;calculate(false);changeView('quote');}
function renderRecords(){const list=$('#records-list');list.replaceChildren();updateStatus();if(!store.quotes.length){const box=document.createElement('div');box.className='records-empty';const h=document.createElement('h2');h.textContent='第一筆報價，從試算開始。';const p=document.createElement('p');p.textContent='完成試算並保存後，紀錄就會出現在這裡。';box.append(h,p);list.append(box);return;}
 for(const q of [...store.quotes].sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt))){const card=document.createElement('article');card.className='card record-card';const info=document.createElement('div');const h=document.createElement('h2');h.textContent=q.order.name;const p=document.createElement('p');p.textContent=`${q.order.partNumber||'未填料號'} · ${q.order.date} · ${q.order.quantity} 件`;const price=document.createElement('p');price.textContent='未稅建議單價 NT$ '+money(calculateQuote(q.settingsSnapshot,q.order).unitPrice);info.append(h,p,price);const actions=document.createElement('div');actions.className='record-actions';const load=document.createElement('button');load.className='button outline';load.textContent='載入報價';load.dataset.load=q.id;load.addEventListener('click',()=>{if(guard())loadQuote(q);});const del=document.createElement('button');del.className='danger-button';del.textContent='刪除';del.dataset.delete=q.id;del.addEventListener('click',()=>{if(!confirm('確定刪除「'+q.order.name+'」？此操作會移除該筆紀錄。'))return;const ok=persist(deleteQuote(store,q.id));if(ok&&activeQuoteId===q.id){activeQuoteId=null;dirty=true;}renderRecords();if(ok)notice('已刪除報價。');});actions.append(load,del);card.append(info,actions);list.append(card);}}
for(const key of orderKeys)$('#o-'+key).addEventListener('input',()=>{dirty=true;calculate();});
for(const key of settingKeys)$('#s-'+key).addEventListener('input',()=>{globalDirty=true;showErrors(validateSettings(readSettings()),'s','#settings-errors');});
$('#order-form').addEventListener('submit',e=>e.preventDefault());$('#settings-form').addEventListener('submit',e=>e.preventDefault());
$('#demo').addEventListener('click',()=>{if((dirty||globalDirty)&&!confirm('載入示範將取代目前未保存的輸入，確定繼續嗎？'))return;fillFields(sampleSettings,settingKeys,'s');quoteSettings=copy(sampleSettings);fillFields({...sampleOrder,date:today()},orderKeys,'o');activeQuoteId=null;devState=defaultDev();rebuildDevItems();dirty=true;globalDirty=true;calculate();notice('目前為假資料示範。尚未寫入本機紀錄；正式報價前請改成你的成本。');});
$('#new-quote').addEventListener('click',()=>{if(!guard())return;activeQuoteId=null;quoteSettings=copy(store.settings);fillFields(emptyOrder(),orderKeys,'o');devState=defaultDev();rebuildDevItems();dirty=false;calculate(false);notice('已開啟新報價。');});
$('#dev-add').addEventListener('click',()=>{devState.items.push(emptyDevItem(newId()));dirty=true;rebuildDevItems();calculate();});
$('#dev-marginPercent').addEventListener('input',()=>{devState.marginPercent=$('#dev-marginPercent').value;dirty=true;calculate();});
for(const radio of document.querySelectorAll('input[name="dev-chargeMode"]'))radio.addEventListener('change',()=>{if(radio.checked){devState.chargeMode=radio.value;dirty=true;calculate();}});
$('#save-settings').addEventListener('click',()=>{const settings=readSettings(),issues=validateSettings(settings);showErrors(issues,'s','#settings-errors');if(issues.length){notice('請先修正基本成本欄位。',true);return;}if(persist({...copy(store),settings})){globalDirty=false;notice('基本成本已保存。既有報價快照保持原值；請到試算頁套用最新成本。');}updateStatus();});
$('#apply-settings').addEventListener('click',()=>{if(!store.settings){notice('請先到成本設定儲存基本成本。',true);return;}const old=store.quotes.find(q=>q.id===activeQuoteId);quoteSettings=old?applyCurrentSettings(old,store.settings).settingsSnapshot:copy(store.settings);dirty=true;calculate();notice('本筆草稿已套用最新基本成本，尚未更新已存紀錄。');});
function save(forceNew){try{if(!forceNew&&!confirm('確定用目前輸入覆寫這筆報價？'))return;const q=makeDraft(forceNew);const next=saveQuote(store,q);const ok=persist(next);if(ok){activeQuoteId=q.id;dirty=false;notice('報價已保存於此瀏覽器。');}else dirty=true;updateStatus();}catch(e){notice(e.message,true);}}
$('#save-new').addEventListener('click',()=>save(true));$('#save-update').addEventListener('click',()=>save(false));
function downloadText(text,name){const url=URL.createObjectURL(new Blob([text],{type:'application/json;charset=utf-8'}));const link=document.createElement('a');link.href=url;link.download=name;document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);}
function exportBackup(){try{let next=copy(store);if(globalDirty){const settings=readSettings();assertValid(validateSettings(settings));next.settings=settings;}if(dirty)next=saveQuote(next,makeDraft());downloadText(serializeBackup(next),'quotation-backup-'+today()+'.json');notice('已匯出完整備份'+(dirty||globalDirty?'，包含目前有效草稿及成本設定':'')+'。請妥善保管明文檔案。');}catch(e){notice('無法匯出：'+e.message,true);}}
$('#export').addEventListener('click',exportBackup);
$('#export-records').addEventListener('click',exportBackup);
$('#import-file').addEventListener('change',async e=>{const file=e.target.files[0];if(!file)return;try{if(file.size>10*1024*1024)throw new Error('備份檔超過 10 MB，請改用較小檔案。');const next=parseBackup(await file.text());if(!confirm(`備份有 ${next.quotes.length} 筆報價，將取代所有目前紀錄及未保存輸入。確定匯入？`))return;if(!persist(next,{recover:true}))return;fillFields(store.settings||emptySettings(),settingKeys,'s');fillFields(emptyOrder(),orderKeys,'o');quoteSettings=copy(store.settings);activeQuoteId=null;devState=defaultDev();rebuildDevItems();dirty=false;globalDirty=false;calculate(false);renderRecords();notice('備份已匯入並保存。');}catch(err){notice('匯入失敗：'+err.message,true);}finally{e.target.value='';}});
if(rawRecovery!==null){const b=document.createElement('button');b.className='button outline';b.textContent='下載原始資料以保留';b.addEventListener('click',()=>downloadText(rawRecovery,'quotation-recovery-'+today()+'.json'));$('#storage-alert').append(document.createElement('br'),b);}
window.addEventListener('beforeunload',e=>{if(dirty||globalDirty){e.preventDefault();e.returnValue='';}});
window.addEventListener('storage',e=>{if(e.key===STORAGE_KEY||e.key===null){externalChange=true;storageAlert('另一分頁已修改或清除資料。為避免覆蓋，請先匯出目前草稿，再重新整理。');}});
fillFields(store.settings||emptySettings(),settingKeys,'s');fillFields(emptyOrder(),orderKeys,'o');quoteSettings=copy(store.settings);rebuildDevItems();calculate(false);renderRecords();
