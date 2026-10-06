import {calculateQuote} from './calculator.js';
import {assertValid,validateStore} from './validation.js';
import {calculateDevelopment} from './devcost.js';
const copy=v=>structuredClone(v);
function verify(q){assertValid(validateStore({schemaVersion:1,settings:null,quotes:[q]}));const result=calculateQuote(q.settingsSnapshot,q.order);if('dev' in q && q.dev!=null)calculateDevelopment(q.order,q.dev,result);return q;}
export function createQuote(settings,order,{id,now},dev=null){return verify({id,createdAt:now,updatedAt:now,calculationVersion:1,settingsSnapshot:copy(settings),order:copy(order),dev:dev==null?null:copy(dev)});}
export function updateQuote(quote,settingsSnapshot,order,now,dev=undefined){return verify({...copy(quote),settingsSnapshot:copy(settingsSnapshot),order:copy(order),dev:dev===undefined?copy(quote.dev??null):(dev==null?null:copy(dev)),updatedAt:now});}
export function saveQuote(store,quote){verify(quote);const result=copy(store),i=result.quotes.findIndex(q=>q.id===quote.id);if(i<0)result.quotes.push(copy(quote));else result.quotes[i]=copy(quote);assertValid(validateStore(result));return result;}
export function deleteQuote(store,id){const result=copy(store);result.quotes=result.quotes.filter(q=>q.id!==id);return result;}
export function applyCurrentSettings(quote,settings){return verify({...copy(quote),settingsSnapshot:copy(settings)});}
