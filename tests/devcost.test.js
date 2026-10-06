// issue #3｜增加打樣開發費用
// 重現步驟：於「訂單試算」新增打樣與開發費用明細，分別以工時／數量／固定金額計價，
// 選擇獨立收取或分攤至本次訂單，驗證金額計算、進位與資料持久化（儲存／備份）皆正確。
// 本檔鎖住 issue #3 驗收條件（docs 規格六項情境）及額外邊界case，任何一項變更行為都會讓對應測試變紅。
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {calculateQuote} from '../src/calculator.js';
import {validateDev,validateDevItem,calculateDevCost,calculateDevelopment,emptyDevItem,defaultDev} from '../src/devcost.js';
import {createQuote,updateQuote,saveQuote} from '../src/quotes.js';
import {parseBackup,serializeBackup} from '../src/storage.js';
import {settings100 as s,order100 as o} from './fixtures.js';

function item(overrides){return {...emptyDevItem(overrides.id||'i1'),...overrides};}

const acceptanceItems=[
  item({id:'program',category:'program',method:'hours',name:'加工程式撰寫',hours:'4',rate:'800'}),
  item({id:'fixtureDesign',category:'fixtureDesign',method:'hours',name:'夾治具設計',hours:'3',rate:'700'}),
  item({id:'fixtureBuild',category:'fixtureBuild',method:'fixed',name:'夾治具委外製作',amount:'2500'}),
  item({id:'material',category:'material',method:'quantity',name:'夾治具材料',quantity:'2',unitPrice:'600'}),
  item({id:'trialTest',category:'trialTest',method:'hours',name:'測試人工',hours:'2',rate:'500'}),
  item({id:'inspection',category:'inspection',method:'hours',name:'內部檢測',hours:'1',rate:'600'}),
  item({id:'outsourceTest',category:'outsourceTest',method:'fixed',name:'委外驗證',amount:'4000',vendor:'第三方實驗室'}),
];

// 情境 1：明細計算正確（毛利率 0%）
test('情境1：七筆明細加總為開發總成本與收費 14,600 元',()=>{
  const dev={items:acceptanceItems,marginPercent:'0',chargeMode:'separate'};
  const machining=calculateQuote(s,o);
  const result=calculateDevelopment(o,dev,machining);
  assert.equal(result.devCost,'14600.00');
  assert.equal(result.devPrice,'14600.00');
});

// 情境 2：毛利率計算正確（20%）
test('情境2：開發費目標毛利率20%時，開發收費為 18,250 元（14600÷0.8）',()=>{
  const dev={items:acceptanceItems,marginPercent:'20',chargeMode:'separate'};
  const machining=calculateQuote(s,o);
  const result=calculateDevelopment(o,dev,machining);
  assert.equal(result.devCost,'14600.00');
  assert.equal(result.devPrice,'18250.00');
});

// 情境 3：獨立收取不改變加工單價
test('情境3：獨立收取時加工單價與總額不變，報價總額為加工報價總額加開發收費',()=>{
  const order={...o,quantity:'100',marginPercent:'0'};
  const settings={...s};
  const machining=calculateQuote(settings,{...order,materialUnit:'0',outsourceUnit:'0',toolingBatch:'0',machineMinutes:'0',laborMinutes:'0',setupMachineMinutes:'0',setupLaborMinutes:'0'});
  // 建一個可控制單價為 100、數量 100 的簡化加工結果用以比對規格數字
  const simpleMachining={unitPrice:'100.00',batchPrice:'10000.00'};
  const dev={items:acceptanceItems,marginPercent:'20',chargeMode:'separate'};
  const result=calculateDevelopment({...order,quantity:'100'},dev,simpleMachining);
  assert.equal(result.devPrice,'18250.00');
  assert.equal(simpleMachining.unitPrice,'100.00');
  assert.equal(result.grandTotal,'28250.00');
});

// 情境 4：分攤時不重複加收
test('情境4：分攤至本次訂單時，每件分攤182.50元、含開發費單價282.50元、總額28250元',()=>{
  const simpleMachining={unitPrice:'100.00',batchPrice:'10000.00'};
  const dev={items:acceptanceItems,marginPercent:'20',chargeMode:'amortized'};
  const result=calculateDevelopment({quantity:'100'},dev,simpleMachining);
  assert.equal(result.perUnitDevCost,'182.50');
  assert.equal(result.unitPriceWithDev,'282.50');
  assert.equal(result.grandTotal,'28250.00');
  assert.equal(result.roundingDiff,'0.00');
});

// 情境 5：刪除明細會更新合計
test('情境5：刪除4000元的委外驗證項目後，開發總成本與收費更新為10600元',()=>{
  const remaining=acceptanceItems.filter(i=>i.id!=='outsourceTest');
  const dev={items:remaining,marginPercent:'0',chargeMode:'separate'};
  const machining=calculateQuote(s,o);
  const result=calculateDevelopment(o,dev,machining);
  assert.equal(result.devCost,'10600.00');
  assert.equal(result.devPrice,'10600.00');
});

// 情境 6：支援小數工時及正確進位，並可辨識分攤進位差額
test('情境6a：1.5小時×800元/小時，小計為1200元',()=>{
  const {totalCost}=calculateDevCost([item({id:'x',method:'hours',name:'小數工時',hours:'1.5',rate:'800'})]);
  assert.equal(totalCost.fixed(),'1200.00');
});
test('情境6b：開發收費100元分攤3件，單價133.34元、總額400.02元、進位差額0.02元',()=>{
  const simpleMachining={unitPrice:'100.00',batchPrice:'300.00'};
  const dev={items:[item({id:'x',method:'fixed',name:'固定開發費',amount:'100'})],marginPercent:'0',chargeMode:'amortized'};
  const result=calculateDevelopment({quantity:'3'},dev,simpleMachining);
  assert.equal(result.devPrice,'100.00');
  assert.equal(result.perUnitDevCost,'33.34');
  assert.equal(result.unitPriceWithDev,'133.34');
  assert.equal(result.grandTotal,'400.02');
  assert.equal(result.roundingDiff,'0.02');
});

// ---- 額外邊界 case（≥10 項，涵蓋情境以外的輸入） ----

test('邊界：空白明細清單視為開發成本0元，不阻擋試算',()=>{
  const machining=calculateQuote(s,o);
  const result=calculateDevelopment(o,{items:[],marginPercent:'0',chargeMode:'separate'},machining);
  assert.equal(result.devCost,'0.00');
  assert.equal(result.devPrice,'0.00');
  assert.equal(result.grandTotal,machining.batchPrice);
});

test('邊界：dev為null時視為未使用此功能，createQuote可省略',()=>{
  const q=createQuote(s,o,{id:'q-null-dev',now:'2026-10-07T00:00:00.000Z'});
  assert.equal(q.dev,null);
});

test('邊界：未知分類被拒絕',()=>{
  const issues=validateDevItem(item({category:'not-a-category'}));
  assert.ok(issues.some(i=>i.field==='category'));
});

test('邊界：未知計算方式被拒絕',()=>{
  const issues=validateDevItem(item({method:'percentage'}));
  assert.ok(issues.some(i=>i.field==='method'));
});

test('邊界：項目名稱為空白被拒絕',()=>{
  const issues=validateDevItem(item({name:'   '}));
  assert.ok(issues.some(i=>i.field==='name'));
});

test('邊界：選用工時計價時仍填入固定金額欄位，視為重複加總風險並拒絕',()=>{
  const issues=validateDevItem(item({method:'hours',hours:'1',rate:'100',amount:'50'}));
  assert.ok(issues.some(i=>i.field==='amount'));
});

test('邊界：負數或格式錯誤的工時被拒絕',()=>{
  for(const bad of ['-1','abc','1.23456789','','Infinity'])
    assert.ok(validateDevItem(item({method:'hours',hours:bad,rate:'100'})).some(i=>i.field==='hours'),'應拒絕 '+JSON.stringify(bad));
});

test('邊界：開發費目標毛利率達100%被拒絕（除以零）',()=>{
  const issues=validateDev({items:[],marginPercent:'100',chargeMode:'separate'});
  assert.ok(issues.some(i=>i.field==='marginPercent'));
});

test('邊界：收費方式必須是separate或amortized',()=>{
  const issues=validateDev({items:[],marginPercent:'0',chargeMode:'other'});
  assert.ok(issues.some(i=>i.field==='chargeMode'));
});

test('邊界：明細識別碼重複被拒絕',()=>{
  const dup=item({id:'dup',method:'fixed',amount:'1'});
  const issues=validateDev({items:[dup,{...dup}],marginPercent:'0',chargeMode:'separate'});
  assert.ok(issues.some(i=>i.field.endsWith('.id')));
});

test('邊界：委外機構名稱為選填，留空仍通過驗證',()=>{
  const issues=validateDevItem(item({method:'fixed',amount:'1',vendor:'',name:'委外項目'}));
  assert.equal(issues.length,0);
});

test('邊界：大量金額（接近安全整數）仍能正確計算且不溢位',()=>{
  const {totalCost}=calculateDevCost([item({id:'big',method:'fixed',amount:'9000000000000'})]);
  assert.equal(totalCost.fixed(),'9000000000000.00');
});

test('邊界：數量計價可用小數數量（例如公斤數的材料費）',()=>{
  const {totalCost}=calculateDevCost([item({id:'kg',method:'quantity',quantity:'2.5',unitPrice:'40'})]);
  assert.equal(totalCost.fixed(),'100.00');
});

test('邊界：不支援的開發費頂層欄位被拒絕',()=>{
  const issues=validateDev({items:[],marginPercent:'0',chargeMode:'separate',extra:true});
  assert.ok(issues.some(i=>i.field==='extra'));
});

test('邊界：更新報價時省略dev參數會保留原有開發費資料，不會被清空',()=>{
  const dev={items:[item({id:'keep',method:'fixed',amount:'10',name:'保留項目'})],marginPercent:'0',chargeMode:'separate'};
  const now='2026-10-07T00:00:00.000Z',later='2026-10-07T01:00:00.000Z';
  const q=createQuote(s,o,{id:'q-keep',now},dev);
  const next=updateQuote(q,s,{...o,quantity:'200'},later);
  assert.deepEqual(next.dev,dev);
});

test('邊界：更新報價可明確清空開發費資料（傳入null）',()=>{
  const dev={items:[item({id:'clear',method:'fixed',amount:'10',name:'待清除項目'})],marginPercent:'0',chargeMode:'separate'};
  const now='2026-10-07T00:00:00.000Z',later='2026-10-07T01:00:00.000Z';
  const q=createQuote(s,o,{id:'q-clear',now},dev);
  const next=updateQuote(q,s,o,later,null);
  assert.equal(next.dev,null);
});

test('整合：含開發費的報價可儲存、匯出、匯入後資料一致',()=>{
  const dev={items:acceptanceItems,marginPercent:'20',chargeMode:'amortized'};
  const now='2026-10-07T00:00:00.000Z';
  const q=createQuote(s,o,{id:'q-full',now},dev);
  const store=saveQuote({schemaVersion:1,settings:s,quotes:[]},q);
  const restored=parseBackup(serializeBackup(store));
  assert.deepEqual(restored.quotes[0].dev,dev);
});

test('整合：含有重複加總風險欄位的報價無法儲存',()=>{
  const badDev={items:[item({id:'bad',method:'hours',hours:'1',rate:'1',amount:'1'})],marginPercent:'0',chargeMode:'separate'};
  assert.throws(()=>createQuote(s,o,{id:'q-bad',now:'2026-10-07T00:00:00.000Z'},badDev));
});

test('整合：舊版備份（沒有dev欄位）仍可開啟，視為未使用開發費功能',()=>{
  const legacyQuote={id:'legacy',createdAt:'2026-10-07T00:00:00.000Z',updatedAt:'2026-10-07T00:00:00.000Z',calculationVersion:1,settingsSnapshot:s,order:o};
  const restored=parseBackup(serializeBackup({schemaVersion:1,settings:s,quotes:[legacyQuote]}));
  assert.equal('dev' in restored.quotes[0],false);
});

test('整合：defaultDev()提供空白起始狀態，等同未使用開發費',()=>{
  const dev=defaultDev();
  const machining=calculateQuote(s,o);
  assert.equal(calculateDevelopment(o,dev,machining).devCost,'0.00');
});
