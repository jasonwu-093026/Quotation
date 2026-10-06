import {Decimal as D} from './decimal.js';
import {validateSettings,validateOrder,assertValid} from './validation.js';
export function calculateQuote(settings,order){
  assertValid([...validateSettings(settings),...validateOrder(order)]);
  const s=Object.fromEntries(Object.entries(settings).map(([k,v])=>[k,D.from(v)]));
  const numeric=['quantity','machineMinutes','laborMinutes','setupMachineMinutes','setupLaborMinutes','materialUnit','outsourceUnit','toolingBatch','marginPercent'];
  const o=Object.fromEntries(numeric.map(k=>[k,D.from(order[k])]));
  const hundred=D.from('100'),sixty=D.from('60'),one=D.from('1');
  const m=s.machineCount.mul(s.machineDays).mul(s.machineHours).mul(sixty).mul(s.machineUtilization).div(hundred);
  const l=s.workerCount.mul(s.workerDays).mul(s.workerHours).mul(sixty).mul(s.workerUtilization).div(hundred);
  const expenses=s.depreciation.add(s.maintenance).add(s.rent).add(s.electricity).add(s.consumables);
  const rm=expenses.div(m),rl=s.laborMonthly.div(l),q=o.quantity;
  const b={machine:o.machineMinutes.mul(rm),labor:o.laborMinutes.mul(rl),setupMachine:o.setupMachineMinutes.mul(rm).div(q),setupLabor:o.setupLaborMinutes.mul(rl).div(q),material:o.materialUnit,outsource:o.outsourceUnit,tooling:o.toolingBatch.div(q)};
  const cost=Object.values(b).reduce((sum,v)=>sum.add(v),D.from('0'));
  const price=cost.div(one.sub(o.marginPercent.div(hundred))).fixed(2,true);
  return {rates:{machineMinutes:m.fixed(6),laborMinutes:l.fixed(6),machinePerMinute:rm.fixed(6),laborPerMinute:rl.fixed(6)},unitBreakdown:Object.fromEntries(Object.entries(b).map(([k,v])=>[k,v.fixed()])),unitCost:cost.fixed(),batchCost:cost.mul(q).fixed(),unitPrice:price,batchPrice:D.from(price).mul(q).fixed()};
}
