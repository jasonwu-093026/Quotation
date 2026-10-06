// 打樣與開發費用：明細驗證與金額計算。獨立於加工報價計算，避免與其耦合。
import {Decimal as D} from './decimal.js';

export const devCategories=['program','fixtureDesign','fixtureBuild','material','trialTest','inspection','outsourceTest','other'];
export const devCategoryLabels={
  program:'加工程式撰寫與修改',
  fixtureDesign:'夾治具設計',
  fixtureBuild:'夾治具製作或委外開發',
  material:'夾治具材料、打樣額外材料及耗材',
  trialTest:'試切與測試',
  inspection:'內部檢測',
  outsourceTest:'委外測試、檢測及第三方機構驗證',
  other:'其他開發費用',
};
export const devMethods=['hours','quantity','fixed'];
export const devMethodLabels={hours:'工時計價（小時 × 費率）',quantity:'數量計價（數量 × 單價）',fixed:'固定金額'};
export const devItemKeys=['id','category','method','name','hours','rate','quantity','unitPrice','amount','vendor','note'];
export const devKeys=['items','marginPercent','chargeMode'];
export const chargeModes=['separate','amortized'];
const methodFields={hours:['hours','rate'],quantity:['quantity','unitPrice'],fixed:['amount']};
const allNumericItemFields=['hours','rate','quantity','unitPrice','amount'];
const numberPattern=/^\d+(\.\d{1,6})?$/;
function isObject(v){return v!==null && typeof v==='object' && !Array.isArray(v);}
function isNonNegativeNumber(v){return typeof v==='string'&&v.trim()!==''&&v.length<=30&&numberPattern.test(v)&&Number.isFinite(Number(v))&&Number(v)<=Number.MAX_SAFE_INTEGER;}
function isBlank(v){return v==='';}
function isText(v,max){return typeof v==='string'&&v.length<=max;}

export function validateDevItem(item){
  const errors=[];
  if(!isObject(item))return [{field:'item',message:'開發費明細格式不正確'}];
  for(const key of Object.keys(item))if(!devItemKeys.includes(key))errors.push({field:key,message:'不支援的開發費欄位：'+key});
  if(typeof item.id!=='string'||!item.id.trim()||item.id.length>200)errors.push({field:'id',message:'開發費明細缺少有效識別碼'});
  if(!devCategories.includes(item.category))errors.push({field:'category',message:'請選擇開發費分類'});
  if(!devMethods.includes(item.method))errors.push({field:'method',message:'請選擇計算方式'});
  if(!isText(item.name,200)||!(item.name||'').trim())errors.push({field:'name',message:'請填寫項目名稱'});
  if(!isText(item.vendor||'',200))errors.push({field:'vendor',message:'委外機構或供應商名稱過長'});
  if(!isText(item.note||'',2000))errors.push({field:'note',message:'備註過長'});
  const active=methodFields[item.method]||[];
  for(const key of allNumericItemFields){
    const v=item[key];
    if(active.includes(key)){
      if(!isNonNegativeNumber(v))errors.push({field:key,message:'請輸入有效非負數，最多 6 位小數'});
    }else if(!isBlank(v)){
      errors.push({field:key,message:'此計算方式不使用此欄位，請清空避免重複加總'});
    }
  }
  return errors;
}

export function validateDev(dev){
  if(!isObject(dev))return [{field:'dev',message:'開發費資料格式不正確'}];
  const errors=[];
  for(const key of Object.keys(dev))if(!devKeys.includes(key))errors.push({field:key,message:'不支援的開發費欄位：'+key});
  if(!chargeModes.includes(dev.chargeMode))errors.push({field:'chargeMode',message:'請選擇開發費收費方式'});
  if(!isNonNegativeNumber(dev.marginPercent))errors.push({field:'marginPercent',message:'請輸入有效非負數，最多 6 位小數'});
  else if(Number(dev.marginPercent)>=100)errors.push({field:'marginPercent',message:'開發費目標毛利率須小於 100%'});
  if(!Array.isArray(dev.items))errors.push({field:'items',message:'開發費明細格式不正確'});
  else{
    const ids=new Set();
    dev.items.forEach((item,index)=>{
      for(const e of validateDevItem(item))errors.push({field:`items.${index}.${e.field}`,message:e.message});
      if(isObject(item)&&typeof item.id==='string'){
        if(ids.has(item.id))errors.push({field:`items.${index}.id`,message:'開發費明細識別碼重複'});
        ids.add(item.id);
      }
    });
  }
  return errors;
}

export function assertDevValid(dev){const issues=validateDev(dev);if(issues.length){const e=new Error(issues[0].message);e.issues=issues;throw e;}}

export function calculateDevCost(items){
  const raw=items.map(item=>{
    let value;
    if(item.method==='hours')value=D.from(item.hours).mul(D.from(item.rate));
    else if(item.method==='quantity')value=D.from(item.quantity).mul(D.from(item.unitPrice));
    else value=D.from(item.amount);
    return {id:item.id,value};
  });
  const totalCost=raw.reduce((sum,r)=>sum.add(r.value),D.from('0'));
  return {subtotals:Object.fromEntries(raw.map(r=>[r.id,r.value.fixed()])),totalCost};
}

// machiningResult 必須是 calculateQuote() 的回傳值，用於獨立收取／分攤的加總。
export function calculateDevelopment(order,dev,machiningResult){
  if(dev==null)return null;
  assertDevValid(dev);
  const {subtotals,totalCost}=calculateDevCost(dev.items);
  const hundred=D.from('100'),one=D.from('1');
  const devCost=totalCost.fixed();
  const devPrice=totalCost.div(one.sub(D.from(dev.marginPercent).div(hundred))).fixed(2,true);
  const result={
    items:dev.items.map(item=>({id:item.id,subtotal:subtotals[item.id]})),
    chargeMode:dev.chargeMode,
    marginPercent:dev.marginPercent,
    devCost,
    devPrice,
    perUnitDevCost:null,
    unitPriceWithDev:null,
    grandTotal:null,
    roundingDiff:'0.00',
  };
  if(dev.chargeMode==='amortized'){
    const qty=D.from(order.quantity);
    const perUnit=D.from(devPrice).div(qty).fixed(2,true);
    const unitWithDev=D.from(machiningResult.unitPrice).add(D.from(perUnit)).fixed(2);
    const grand=D.from(unitWithDev).mul(qty).fixed(2);
    const ideal=D.from(machiningResult.batchPrice).add(D.from(devPrice));
    result.perUnitDevCost=perUnit;
    result.unitPriceWithDev=unitWithDev;
    result.grandTotal=grand;
    result.roundingDiff=D.from(grand).sub(ideal).fixed(2);
  }else{
    result.grandTotal=D.from(machiningResult.batchPrice).add(D.from(devPrice)).fixed(2);
  }
  return result;
}

export function emptyDevItem(id){return {id,category:devCategories[0],method:'hours',name:'',hours:'',rate:'',quantity:'',unitPrice:'',amount:'',vendor:'',note:''};}
export function defaultDev(){return {items:[],marginPercent:'0',chargeMode:'separate'};}
