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
 await page.locator('#save-new').click();assert.match(await page.locator('#notice').textContent(),/已保存/);
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
 await page.setViewportSize({width:390,height:844});await page.locator('nav [data-view="records"]').click();assert.equal(await page.getByRole('button',{name:'匯出完整備份',exact:true}).last().isVisible(),true);await page.locator('nav [data-view="quote"]').click();assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);await page.screenshot({path:'/tmp/quotation-mobile.png',fullPage:true});
 assert.deepEqual(errors,[]);
 // Write failure must preserve draft export without showing a false success.
 const blocked=await context.newPage();await blocked.goto(url);await blocked.locator('#demo').click();await blocked.evaluate(()=>{Storage.prototype.setItem=function(){throw new Error('quota');};});await blocked.locator('#save-new').click();assert.match(await blocked.locator('#notice').textContent(),/尚未保存/);
 const d2=blocked.waitForEvent('download');await blocked.locator('#export').click();const b2=JSON.parse(fs.readFileSync(await (await d2).path(),'utf8'));assert.ok(b2.quotes.length>=2);
 // Corrupted data stays intact; import is the explicit recovery action.
 const bad=await context.newPage();await bad.goto(url);await bad.evaluate(()=>localStorage.setItem('quotation.v1','broken'));await bad.reload();await bad.locator('#demo').click();await bad.locator('#save-new').click();assert.equal(await bad.evaluate(()=>localStorage.getItem('quotation.v1')),'broken');
 const blockedContext=await browser.newContext();await blockedContext.addInitScript(()=>{Storage.prototype.getItem=function(){throw new Error('blocked');};});const denied=await blockedContext.newPage();await denied.goto(url);await denied.locator('#demo').click();await denied.locator('#save-new').click();assert.match(await denied.locator('#notice').textContent(),/尚未保存/);
 const d3=denied.waitForEvent('download');await denied.locator('#export').click();assert.equal(JSON.parse(fs.readFileSync(await (await d3).path(),'utf8')).quotes.length,1);
 await browser.close();console.log('PASS: browser calculations, CRUD, snapshots, backups, validation, text safety, mobile, storage failure and recovery');
})().catch(e=>{console.error(e);process.exit(1);});
