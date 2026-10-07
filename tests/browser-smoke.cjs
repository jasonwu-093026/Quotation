const assert=require('node:assert/strict');
const fs=require('node:fs');
const {chromium}=require(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES?process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES+'/playwright':'playwright');
(async()=>{
 const browser=await chromium.launch({headless:true, ...(process.env.QUOTATION_CHROMIUM_PATH ? {executablePath:process.env.QUOTATION_CHROMIUM_PATH,args:["--no-sandbox","--disable-dev-shm-usage"]} : {})});
 const context=await browser.newContext({viewport:{width:1440,height:1000},acceptDownloads:true});
 const page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
 const url=process.env.QUOTATION_TEST_URL||'http://127.0.0.1:8080';
 await page.goto(url);await page.locator('#demo').click({timeout:3000});
 assert.equal(await page.locator('#unit-price').textContent(),'86.75');
 // issue #3｜打樣與開發費用：新增一筆工時計價、一筆固定金額，確認即時試算、毛利率、
 // 獨立收取的整筆總額，以及輸入過程中不會因重繪而打斷游標（焦點安全）。
 await page.locator('#dev-add').click();
 const dev1=page.locator('.dev-item').first();
 await dev1.locator('select[aria-label="計算方式"]').selectOption('hours');
 await dev1.locator('[data-dev-field="name"]').fill('加工程式撰寫');
 const devHours=dev1.locator('[data-dev-field="hours"]');
 await devHours.pressSequentially('4',{delay:20});assert.equal(await devHours.inputValue(),'4');
 await dev1.locator('[data-dev-field="rate"]').fill('800');
 assert.equal(await page.locator('#dev-cost').textContent(),'3,200.00');
 await page.locator('#dev-add').click();
 const dev2=page.locator('.dev-item').nth(1);
 await dev2.locator('select[aria-label="計算方式"]').selectOption('fixed');
 await dev2.locator('[data-dev-field="name"]').fill('委外驗證');
 await dev2.locator('[data-dev-field="amount"]').fill('4000');
 assert.equal(await page.locator('#dev-cost').textContent(),'7,200.00');
 await page.locator('#dev-marginPercent').fill('20');
 assert.equal(await page.locator('#dev-price').textContent(),'9,000.00');
 assert.equal(await page.locator('#unit-price').textContent(),'86.75');
 assert.equal(await page.locator('#dev-grand-total').textContent(),'NT$ 17,675.00');
 assert.equal(await page.locator('#dev-unit-with-dev').count(),0);
 await page.locator('input[name="dev-chargeMode"][value="amortized"]').check();
 assert.equal(await page.locator('#dev-perunit').textContent(),'90.00');
 assert.equal(await page.locator('#dev-unit-with-dev').textContent(),'176.75');
 assert.equal(await page.locator('#dev-grand-total').textContent(),'NT$ 17,675.00');
 const devCardText=await page.locator('#dev-result-card').innerText();
 for(const label of ['內部開發成本','對客戶收取的開發費','每件分攤開發費','含開發費單價'])assert.ok(devCardText.includes(label),label);
 await dev2.locator('button.danger-button').click();
 assert.equal(await page.locator('.dev-item').count(),1);
 assert.equal(await page.locator('#dev-cost').textContent(),'3,200.00');
 await page.locator('input[name="dev-chargeMode"][value="separate"]').check();
 await page.locator('#save-new').click();assert.match(await page.locator('#notice').textContent(),/已保存/);
 // 持久化檢查沿用既有做法（讀本機儲存原始 JSON），不重新整理頁面，避免打斷後續情境共用的表單狀態。
 const devRaw=await page.evaluate(()=>JSON.parse(localStorage.getItem('quotation.v1')).quotes[0].dev);
 assert.equal(devRaw.items.length,1);
 assert.equal(devRaw.items[0].name,'加工程式撰寫');
 assert.equal(devRaw.items[0].hours,'4');
 assert.equal(devRaw.items[0].rate,'800');
 assert.equal(devRaw.marginPercent,'20');
 assert.equal(devRaw.chargeMode,'separate');
 await page.locator('#o-quantity').fill('200');assert.equal(await page.locator('#unit-price').textContent(),'80.25');
 page.once('dialog',d=>d.dismiss());await page.locator('#save-update').click();
 const raw=await page.evaluate(()=>JSON.parse(localStorage.getItem('quotation.v1')));assert.equal(raw.quotes[0].order.quantity,'100');
 page.once('dialog',d=>d.accept());await page.locator('#save-update').click();
 await page.locator('#o-quantity').fill('0');assert.equal(await page.locator('#result-content').isVisible(),false);assert.equal(await page.locator('#o-quantity').getAttribute('aria-invalid'),'true');await page.locator('#o-quantity').fill('200');
 page.once('dialog',d=>d.accept());await page.locator('#save-update').click();
 await page.locator('nav [data-view="settings"]').click();await page.locator('#s-laborMonthly').fill('115200');await page.locator('#save-settings').click();
 await page.locator('nav [data-view="quote"]').click();assert.equal(await page.locator('#unit-price').textContent(),'80.25');
 await page.locator('#apply-settings').click();assert.equal(await page.locator('#unit-price').textContent(),'86.75');
 // saved historical snapshot still unchanged
 assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('quotation.v1')).quotes[0].settingsSnapshot.laborMonthly),'57600');
 page.once('dialog',d=>d.accept());await page.locator('#save-update').click();
 await page.locator('#o-partNumber').fill('<img src=x onerror=alert(1)>');page.once('dialog',d=>d.accept());await page.locator('#save-update').click();
 const downloadPromise=page.waitForEvent('download');await page.locator('#export').click();const download=await downloadPromise;const backupPath=await download.path();const backup=JSON.parse(fs.readFileSync(backupPath,'utf8'));assert.equal(backup.quotes.length,1);
 await page.locator('nav [data-view="records"]').click();assert.equal(await page.locator('#records-list img').count(),0);
 page.once('dialog',d=>d.dismiss());await page.locator('[data-delete]').click();assert.equal(await page.locator('[data-delete]').count(),1);
 page.once('dialog',d=>d.accept());await page.locator('[data-delete]').click();assert.equal(await page.locator('[data-delete]').count(),0);
 await page.locator('#import-file').setInputFiles({name:'bad.json',mimeType:'application/json',buffer:Buffer.from('{broken')});await page.waitForFunction(()=>document.querySelector('#notice').textContent.includes('JSON'));assert.match(await page.locator('#notice').textContent(),/JSON/);
 page.once('dialog',d=>d.dismiss());await page.locator('#import-file').setInputFiles(backupPath);await page.waitForFunction(()=>document.querySelector('#import-file').value==='');assert.equal(await page.locator('[data-delete]').count(),0);
 page.once('dialog',d=>d.accept());await page.locator('#import-file').setInputFiles(backupPath);await page.locator('[data-delete]').waitFor();assert.equal(await page.locator('[data-delete]').count(),1);
 await page.reload();await page.locator('nav [data-view="records"]').click();await page.locator('[data-load]').click();assert.equal(await page.locator('#o-quantity').inputValue(),'200');assert.equal(await page.locator('#unit-price').textContent(),'86.75');
 await page.screenshot({path:process.env.QUOTATION_SCREENSHOT||'/tmp/quotation-desktop.png',fullPage:true});
 await page.setViewportSize({width:390,height:844});await page.locator('nav [data-view="records"]').click();assert.equal(await page.getByRole('button',{name:'匯出完整備份',exact:true}).last().isVisible(),true);await page.locator('nav [data-view="quote"]').click();assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);await page.locator('input[name="dev-chargeMode"][value="amortized"]').check();assert.equal(await page.locator('#dev-unit-with-dev').isVisible(),true);assert.equal(await page.locator('#dev-unit-with-dev').textContent(),'106.75');assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);await page.screenshot({path:'/tmp/quotation-mobile.png',fullPage:true});
 assert.deepEqual(errors,[]);
 // Write failure must preserve draft export without showing a false success.
 const blocked=await context.newPage();await blocked.goto(url);await blocked.locator('#demo').click();await blocked.evaluate(()=>{Storage.prototype.setItem=function(){throw new Error('quota');};});await blocked.locator('#save-new').click();assert.match(await blocked.locator('#notice').textContent(),/尚未保存/);
 const d2=blocked.waitForEvent('download');await blocked.locator('#export').click();const b2=JSON.parse(fs.readFileSync(await (await d2).path(),'utf8'));assert.ok(b2.quotes.length>=2);
 // Corrupted data stays intact; import is the explicit recovery action.
 const bad=await context.newPage();await bad.goto(url);await bad.evaluate(()=>localStorage.setItem('quotation.v1','broken'));await bad.reload();await bad.locator('#demo').click();await bad.locator('#save-new').click();assert.equal(await bad.evaluate(()=>localStorage.getItem('quotation.v1')),'broken');
 const blockedContext=await browser.newContext();await blockedContext.addInitScript(()=>{Storage.prototype.getItem=function(){throw new Error('blocked');};});const denied=await blockedContext.newPage();await denied.goto(url);await denied.locator('#demo').click();await denied.locator('#save-new').click();assert.match(await denied.locator('#notice').textContent(),/尚未保存/);
 const d3=denied.waitForEvent('download');await denied.locator('#export').click();assert.equal(JSON.parse(fs.readFileSync(await (await d3).path(),'utf8')).quotes.length,1);
 // issue #3｜負責人留言 6031222444：儲存與匯出保留計算結果；改成本設定後重新開啟仍顯示存下的數字。
 const keepCtx=await browser.newContext({viewport:{width:1440,height:1000},acceptDownloads:true});const keep=await keepCtx.newPage();keep.on('pageerror',e=>errors.push(e.message));
 await keep.goto(url);await keep.locator('#demo').click();
 for(const [k,v] of [['machineMinutes','16'],['laborMinutes','0'],['setupMachineMinutes','0'],['setupLaborMinutes','0'],['materialUnit','0'],['outsourceUnit','0'],['toolingBatch','0']])await keep.locator('#o-'+k).fill(v);
 assert.equal(await keep.locator('#unit-price').textContent(),'100.00');
 await keep.locator('#dev-add').click();const keepItem=keep.locator('.dev-item').first();
 await keepItem.locator('select[aria-label="計算方式"]').selectOption('fixed');await keepItem.locator('[data-dev-field="name"]').fill('開發費合計');await keepItem.locator('[data-dev-field="amount"]').fill('14600');
 await keep.locator('#dev-marginPercent').fill('20');await keep.locator('input[name="dev-chargeMode"][value="amortized"]').check();
 const keepShown=async()=>[await keep.locator('#dev-cost').textContent(),await keep.locator('#dev-price').textContent(),await keep.locator('#dev-unit-with-dev').textContent(),await keep.locator('#dev-grand-total').textContent()];
 const accepted=['14,600.00','18,250.00','282.50','NT$ 28,250.00'];
 assert.deepEqual(await keepShown(),accepted);
 await keep.locator('#save-new').click();assert.match(await keep.locator('#notice').textContent(),/已保存/);
 const keepDl=keep.waitForEvent('download');await keep.locator('#export').click();const keepBackup=JSON.parse(fs.readFileSync(await (await keepDl).path(),'utf8'));
 const kr=keepBackup.quotes[0].devResult;assert.deepEqual([kr.devCost,kr.devPrice,kr.unitPriceWithDev,kr.grandTotal],['14600.00','18250.00','282.50','28250.00']);
 await keep.locator('nav [data-view="settings"]').click();await keep.locator('#s-depreciation').fill('80000');await keep.locator('#save-settings').click();
 const reopenKeep=async()=>{await keep.reload();await keep.locator('nav [data-view="records"]').click();await keep.locator('[data-load]').click();};
 await reopenKeep();assert.deepEqual(await keepShown(),accepted);
 await keep.evaluate(()=>{const d=JSON.parse(localStorage.getItem('quotation.v1'));d.quotes[0].devResult.grandTotal='28888.88';localStorage.setItem('quotation.v1',JSON.stringify(d));});
 await reopenKeep();assert.equal(await keep.locator('#dev-grand-total').textContent(),'NT$ 28,888.88');
 await keep.locator('#o-notes').fill('改動草稿後即時重算');assert.equal(await keep.locator('#dev-grand-total').textContent(),'NT$ 28,250.00');
 await keep.evaluate(()=>{const d=JSON.parse(localStorage.getItem('quotation.v1'));delete d.quotes[0].devResult;localStorage.setItem('quotation.v1',JSON.stringify(d));});
 keep.once('dialog',d=>d.accept());await reopenKeep();assert.deepEqual(await keepShown(),accepted);
 await keep.setViewportSize({width:390,height:844});assert.equal(await keep.locator('#dev-unit-with-dev').isVisible(),true);assert.equal(await keep.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
 // issue #3｜負責人留言 6034461365：開發費項目的「分類」「計算方式」選單在 390px 與 1440px 都完整顯示選取的文字；
 // 手機上兩個選單各占一整行、「刪除」點得到；電腦版維持同一列；頁面沒有水平捲軸。
 for(const width of [1440,390]){
  const sp=await (await browser.newContext({viewport:{width,height:900}})).newPage();sp.on('pageerror',e=>errors.push(e.message));await sp.goto(url);
  for(const [category,method] of [['program','hours'],['outsourceTest','fixed']]){await sp.locator('#dev-add').click();const it=sp.locator('.dev-item').last();await it.locator('select[aria-label="開發費分類"]').selectOption(category);await it.locator('select[aria-label="計算方式"]').selectOption(method);}
  const heads=await sp.evaluate(()=>[...document.querySelectorAll('.dev-item-head')].map(h=>{const r=e=>e.getBoundingClientRect();const [cat,met]=h.querySelectorAll('select');const del=h.querySelector('.danger-button');
   const need=s=>{const c=s.cloneNode(false);c.append(s.selectedOptions[0].cloneNode(true));c.style.cssText='width:auto;min-width:0;max-width:none;flex:none;position:absolute';h.append(c);const w=r(c).width;c.remove();return w;};
   del.scrollIntoView({block:'center'});const d=r(del);
   return {texts:[cat,met].map(s=>s.selectedOptions[0].textContent),fits:[cat,met].map(s=>r(s).width+0.5>=need(s)),widths:[cat,met].map(s=>Math.round(r(s).width)),head:Math.round(r(h).width),stacked:r(met).top>=r(cat).bottom,sameRow:Math.abs(r(cat).top-r(met).top)<2,delHit:document.elementFromPoint(d.left+d.width/2,d.top+d.height/2)===del};}));
  assert.deepEqual(heads.map(h=>h.texts),[['加工程式撰寫與修改','工時計價（小時 × 費率）'],['委外測試、檢測及第三方機構驗證','固定金額']]);
  for(const h of heads){assert.deepEqual(h.fits,[true,true],`${width}px ${h.texts} 選單文字被截斷 ${h.widths}`);assert.equal(h.delHit,true,`${width}px 刪除點不到`);
   if(width===390)assert.ok(h.stacked&&h.widths.every(w=>w===h.head),`390px 選單應各占一整行 ${h.widths}/${h.head}`);else assert.ok(h.sameRow&&h.widths[0]===h.widths[1],`1440px 應維持同一列等寬 ${h.widths}`);}
  assert.equal(await sp.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
 }
 assert.deepEqual(errors,[]);
 await browser.close();console.log('PASS: browser calculations, CRUD, snapshots, backups, validation, text safety, mobile, storage failure and recovery');
})().catch(e=>{console.error(e);process.exit(1);});
