// Regression: a failed write must never create an apparently saved record.
const assert=require('node:assert/strict');
const {chromium}=require(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES?process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES+'/playwright':'playwright');
(async()=>{const browser=await chromium.launch({headless:true,...(process.env.QUOTATION_CHROMIUM_PATH?{executablePath:process.env.QUOTATION_CHROMIUM_PATH,args:['--no-sandbox','--disable-dev-shm-usage']}:{})});const page=await browser.newPage();try{
 await page.goto(process.env.QUOTATION_TEST_URL||'http://127.0.0.1:8080');await page.locator('#demo').click();await page.locator('nav [data-view="settings"]').click();await page.locator('#save-settings').click();await page.locator('nav [data-view="quote"]').click();
 await page.evaluate(()=>{Object.defineProperty(crypto,'randomUUID',{value:undefined,configurable:true});});await page.locator('#save-new').click();assert.match(await page.locator('#notice').textContent(),/已保存/,'saving must work without secure-context randomUUID');
 await page.locator('#new-quote').click();await page.locator('#demo').click();
 await page.evaluate(()=>{Storage.prototype.setItem=function(){throw Error('quota');};});await page.locator('#save-new').click();assert.match(await page.locator('#notice').textContent(),/尚未保存/);await page.locator('nav [data-view="records"]').click();assert.equal(await page.locator('[data-load]').count(),1,'failed saves must not appear as saved records');assert.equal(await page.locator('#record-count').textContent(),'1');
 console.log('PASS: failed save retains only unsaved draft, not saved records');
 }finally{await browser.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
