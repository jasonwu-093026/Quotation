import {validateDev} from './devcost.js';
export const settingKeys=['machineCount','machineDays','machineHours','machineUtilization','depreciation','maintenance','rent','electricity','consumables','workerCount','workerDays','workerHours','workerUtilization','laborMonthly'];
export const orderKeys=['name','partNumber','date','quantity','machineMinutes','laborMinutes','setupMachineMinutes','setupLaborMinutes','materialUnit','outsourceUnit','toolingBatch','marginPercent','notes'];
const integers=new Set(['machineCount','machineDays','workerCount','workerDays','quantity']);
const hours=new Set(['machineHours','workerHours']);
const rates=new Set(['machineUtilization','workerUtilization']);
const textKeys=new Set(['name','partNumber','date','notes']);
export const labels={machineCount:'機台數',machineDays:'機台每月工作天數',machineHours:'每日機台工時',machineUtilization:'機台有效使用率',depreciation:'設備月折舊',maintenance:'月維修費',rent:'分配房租',electricity:'分配電費',consumables:'共用耗材',workerCount:'直接人員數',workerDays:'人工每月工作天數',workerHours:'每日人工工時',workerUtilization:'人工有效投入率',laborMonthly:'直接人工月總成本',name:'報價名稱',partNumber:'料號',date:'報價日期',quantity:'訂單數量',machineMinutes:'每件機台占用時間',laborMinutes:'每件人工操作時間',setupMachineMinutes:'整批架機占機時間',setupLaborMinutes:'整批架機人工時間',materialUnit:'每件材料費',outsourceUnit:'每件外包費',toolingBatch:'整批專用刀具費',marginPercent:'目標估算毛利率',notes:'備註'};
export function isObject(v){return v!==null && typeof v==='object' && !Array.isArray(v);}
function fields(data,keys){
  if(!isObject(data))return [{field:'form',message:'資料格式不正確'}];
  const errors=[];
  for(const key of keys){
    const v=data[key];let message='';
    if(typeof v!=='string')message='資料必須是文字格式';
    else if(textKeys.has(key)){
      if(key==='name'&&!v.trim())message='請填寫報價名稱';
      else if(v.length>(key==='notes'?5000:200))message='文字過長';
      else if(key==='date'&&(!/^\d{4}-\d{2}-\d{2}$/.test(v)||!Number.isFinite(Date.parse(v))||new Date(v).toISOString().slice(0,10)!==v))message='請填寫有效日期';
    }else{
      const n=Number(v);
      if(!v.trim())message='此欄必填（沒有費用請填 0）';
      else if(v.length>30 || !/^\d+(\.\d{1,6})?$/.test(v)||!Number.isFinite(n)||n>Number.MAX_SAFE_INTEGER)message='請輸入有效非負數，最多 6 位小數';
      else if(integers.has(key)&&(!/^\d+(\.0+)?$/.test(v)||!Number.isSafeInteger(n)||n<=0))message='請填正整數';
      else if(hours.has(key)&&(n<=0||n>24))message='每日時數須大於 0 且不超過 24';
      else if(rates.has(key)&&(n<=0||n>100))message='有效率須大於 0 且不超過 100%';
      else if(key==='marginPercent'&&n>=100)message='毛利率須小於 100%';
    }
    if(message)errors.push({field:key,message:(labels[key]||key)+'：'+message});
  }
  for(const key of Object.keys(data))if(!keys.includes(key))errors.push({field:key,message:'不支援的欄位：'+key});
  return errors;
}
export const validateSettings=s=>fields(s,settingKeys);
export const validateOrder=o=>fields(o,orderKeys);
export function assertValid(issues){if(issues.length){const e=new Error(issues[0].message);e.issues=issues;throw e;}}
const quoteKeys=['id','createdAt','updatedAt','calculationVersion','settingsSnapshot','order','dev'];
export function validateStore(data){
  const errors=[];
  if(!isObject(data))return [{field:'backup',message:'備份必須是資料物件'}];
  if(data.schemaVersion!==1)errors.push({field:'backup',message:'不支援的備份版本'});
  if(Object.keys(data).some(k=>!['schemaVersion','settings','quotes'].includes(k)))errors.push({field:'backup',message:'備份包含不支援欄位'});
  if(data.settings!==null)errors.push(...validateSettings(data.settings));
  if(!Array.isArray(data.quotes))return [...errors,{field:'backup',message:'報價清單格式不正確'}];
  const ids=new Set();
  for(const q of data.quotes){
    if(!isObject(q)){errors.push({field:'backup',message:'報價格式不正確'});continue;}
    if(typeof q.id!=='string'||!q.id.trim()||q.id.length>200||ids.has(q.id))errors.push({field:'backup',message:'報價識別碼無效或重複'});
    ids.add(q.id);
    if(q.calculationVersion!==1)errors.push({field:'backup',message:'不支援的計算版本'});
    for(const k of ['createdAt','updatedAt'])if(typeof q[k]!=='string'||!Number.isFinite(Date.parse(q[k]))||new Date(q[k]).toISOString()!==q[k])errors.push({field:'backup',message:'報價時間格式不正確'});
    if(q.updatedAt<q.createdAt)errors.push({field:'backup',message:'報價修改時間早於建立時間'});
    if(Object.keys(q).some(k=>!quoteKeys.includes(k)))errors.push({field:'backup',message:'報價包含不支援欄位'});
    errors.push(...validateSettings(q.settingsSnapshot),...validateOrder(q.order));
    if('dev' in q && q.dev!=null)errors.push(...validateDev(q.dev));
  }
  return errors;
}
