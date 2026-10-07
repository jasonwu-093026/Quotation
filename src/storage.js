import {assertValid,validateStore} from './validation.js';
import {calculateQuote} from './calculator.js';
import {calculateDevelopment} from './devcost.js';
export const STORAGE_KEY='quotation.v1';
function checked(data){
  assertValid(validateStore(data));
  for(const q of data.quotes){
    const result=calculateQuote(q.settingsSnapshot,q.order);
    if('dev' in q && q.dev!=null)calculateDevelopment(q.order,q.dev,result);
  }
  return data;
}
export function serializeBackup(store){return JSON.stringify(checked(store),null,2);}
export function parseBackup(text){let data;try{data=JSON.parse(text);}catch{throw new Error('備份不是有效的 JSON 檔案');}return checked(data);}
export function createStorage(storageLike){return {
  load(){const value=storageLike.getItem(STORAGE_KEY);return value===null?{schemaVersion:1,settings:null,quotes:[]}:parseBackup(value);},
  save(store){const text=serializeBackup(store);storageLike.setItem(STORAGE_KEY,text);}
};}
