// 議題 #6：檢查真正頁面輸出；只使用隔離瀏覽器與虛構資料。
import assert from 'node:assert/strict';
import {once} from 'node:events';
import {createRequire} from 'node:module';
import {performance} from 'node:perf_hooks';
import {createPrivateServer,passwordHash} from '../investment/server.js';
const require=createRequire(import.meta.url);const {chromium,webkit}=require('playwright');
const rows=[];const check=async(name,fn)=>{const start=performance.now();try{const result=await fn();rows.push({name,status:'PASS',result:result||'符合',ms:Math.round(performance.now()-start)});}catch(e){rows.push({name,status:'FAIL',result:e.message,ms:Math.round(performance.now()-start)});throw e;}};
const sample={version:1,settings:{target:1,tolerance:10,fx:32},holdings:[{id:'demo',symbol:'虛構標的',currency:'TWD',category:'股票',shares:5000,price:100,beta:2}],cash:{TWD:500000,USD:0},history:[],undo:null};
const port=Number(process.env.PORT||9006);const url=`http://127.0.0.1:${port}`;const server=createPrivateServer({owner:'fictional-owner',hash:passwordHash('fictional-test-only'),origin:url});server.listen(port,'127.0.0.1');await once(server,'listening');
let browser;const started=performance.now();
try{
 const cases=process.argv.includes('--chromium-only')?[[chromium,1440],[chromium,390]]:[[chromium,1440],[chromium,390],[webkit,390]];
 for(const [engine,width] of cases){
  try{browser=await engine.launch({headless:true});}catch(e){rows.push({name:engine.name()+' 啟動前置條件',status:'FAIL',result:e.message,ms:0});throw e;}const context=await browser.newContext({viewport:{width,height:900},acceptDownloads:true});const page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
  const tag=`${engine.name()} ${width}px`;
  await check(tag+' 未登入不可讀取工具',async()=>{assert.equal((await context.request.get(url+'/app.html')).status(),401);});
  await page.goto(url);await page.locator('[name=username]').fill('fictional-owner');await page.locator('[name=password]').fill('fictional-test-only');await page.getByRole('button',{name:'登入',exact:true}).click();await page.locator('#workspace').waitFor();
  await check(tag+' 零資產與表單新增',async()=>{
   assert.equal(await page.locator('#beta').textContent(),'尚無資料');
   await page.locator('#settings-form [name=TWD]').fill('500000');await page.getByRole('button',{name:'儲存設定與現金'}).click();
   for(const [k,v] of Object.entries({symbol:'虛構標的',shares:'5000',price:'100',beta:'2'}))await page.locator('#holding-form [name='+k+']').fill(v);
   await page.getByRole('button',{name:'新增持股',exact:true}).click();assert.equal(await page.locator('#total').textContent(),'1,000,000.00');assert.equal(await page.locator('#beta').textContent(),'1');return '總資產 1,000,000.00；Beta 1';
  });
  await check(tag+' 不重建輸入焦點、編輯與輸入驗證',async()=>{
   await page.getByRole('button',{name:'編輯',exact:true}).click();const symbol=page.locator('#holding-form [name=symbol]');await symbol.fill('');await symbol.pressSequentially('測試標的');assert.equal(await symbol.inputValue(),'測試標的');
   await page.locator('#holding-form [name=shares]').fill('-1');await page.getByRole('button',{name:'儲存持股修改'}).click();assert.match(await page.locator('#notice').textContent(),/股數/);assert.equal(await page.locator('#total').textContent(),'1,000,000.00');
   await page.getByRole('button',{name:'取消編輯'}).click();
   await page.locator('#settings-form [name=fx]').fill('0');await page.getByRole('button',{name:'儲存設定與現金'}).click();assert.match(await page.locator('#notice').textContent(),/匯率/);await page.locator('#settings-form [name=fx]').fill('32');
  });
  await check(tag+' 試算、確認套用、重新載入及復原',async()=>{
   await page.locator('#rebalance-form [name=target]').fill('1.2');await page.getByRole('button',{name:'試算',exact:true}).click();const text=await page.locator('#simulation').textContent();assert.match(text,/買入 1,000 股/);assert.match(text,/支出 TWD 100,000.00/);assert.match(text,/400,000.00/);assert.match(text,/Beta 1.2/);
   page.once('dialog',d=>d.accept());await page.locator('#apply').click();await page.reload();await page.locator('#workspace').waitFor();assert.equal(await page.locator('#beta').textContent(),'1.2');assert.match(await page.locator('#holding-list').textContent(),/6,000 股/);
   page.once('dialog',d=>d.accept());await page.locator('#undo').click();assert.equal(await page.locator('#beta').textContent(),'1');assert.equal(await page.locator('#settings-form [name=TWD]').inputValue(),'500000');return '買入 1000；支出 100000；現金 400000；Beta 1.2；復原 5000 / 500000';
  });
  await check(tag+' 備份與歷史，同日覆蓋需確認',async()=>{
   await page.locator('#snapshot-date').fill('2026-10-11');await page.locator('#snapshot').click();let confirmed=false;page.once('dialog',async d=>{confirmed=true;await d.dismiss();});await page.locator('#snapshot').click();assert.ok(confirmed);assert.equal(await page.locator('#history-list .record').count(),1);
   const event=page.waitForEvent('download');await page.locator('#export').click();const download=await event;const {readFile}=await import('node:fs/promises');const backup=await readFile(await download.path());const data=JSON.parse(backup);assert.equal(data.history.length,1);assert.equal(data.holdings[0].shares,5000);
   await page.locator('#import').setInputFiles({name:'bad.json',mimeType:'application/json',buffer:Buffer.from('{broken')});await page.waitForFunction(()=>document.querySelector('#notice').textContent.includes('JSON'));assert.equal(await page.locator('#beta').textContent(),'1');
   page.once('dialog',d=>d.accept());await page.locator('#import').setInputFiles({name:'backup.json',mimeType:'application/json',buffer:backup});await page.waitForFunction(()=>document.querySelector('#import').value==='');assert.equal(await page.locator('#history-list .record').count(),1);
  });
  await check(tag+' 美元、受限數量與 HTML 代號',async()=>{
   const usd=structuredClone(sample);usd.holdings[0]={...usd.holdings[0],currency:'USD',shares:10,price:100,symbol:'<img src=x onerror=alert(1)>'};usd.cash={TWD:0,USD:100};
   page.once('dialog',d=>d.accept());await page.locator('#import').setInputFiles({name:'usd.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(usd))});await page.waitForFunction(()=>document.querySelector('#total').textContent==='35,200.00');assert.equal(await page.locator('#holding-list img').count(),0);
   await page.locator('#rebalance-form [name=target]').fill('3');await page.getByRole('button',{name:'試算',exact:true}).click();assert.match(await page.locator('#simulation').textContent(),/受現金或持股數量限制/);return 'USD 資產 NT$ 35,200；受限買入；代號以文字顯示';
  });
  await check(tag+' 欄位與按鈕可操作、無水平溢出',async()=>{
   const layout=await page.evaluate(()=>({overflow:document.documentElement.scrollWidth>innerWidth,invalid:[...document.querySelectorAll('input,select,button')].filter(e=>!e.closest('[hidden]')&&e.getBoundingClientRect().width>0).filter(e=>{const r=e.getBoundingClientRect();return r.width<40||r.left<0||r.right>innerWidth+1;}).map(e=>e.id||e.name)}));assert.equal(layout.overflow,false);assert.deepEqual(layout.invalid,[]);
   await page.screenshot({path:`/tmp/i6-${engine.name()}-${width}.png`,fullPage:true});assert.deepEqual(errors,[]);
  });
  await check(tag+' 刪除與取消確認、登出後拒絕讀取',async()=>{
   page.once('dialog',d=>d.dismiss());await page.getByRole('button',{name:'刪除',exact:true}).click();assert.equal(await page.locator('#holding-list .record').count(),1);
   page.once('dialog',d=>d.accept());await page.getByRole('button',{name:'刪除',exact:true}).click();assert.equal(await page.locator('#holding-list .record').count(),0);
   await page.locator('#logout').click();await page.locator('#login').waitFor();assert.equal((await context.request.get(url+'/app.html')).status(),401);
  });
  await browser.close();browser=null;
 }
}catch(e){process.exitCode=1;}finally{if(browser)await browser.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
for(const r of rows)console.log(`${r.status}\t${r.name}\t${r.result}\t${r.ms} ms`);
console.log(`VERDICT: ${process.exitCode?'FAIL':'PASS'} — ${rows.filter(r=>r.status==='PASS').length}/${rows.length} rows; ${Math.round(performance.now()-started)} ms`);
