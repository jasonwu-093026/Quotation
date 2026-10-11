// 議題 #6：虛構持股與現金驗收；執行 node --test tests/investment.test.js。
// 同一檔案鎖住計算、交易限制、備份、保存失敗及真正 HTTP 私人存取。
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {once} from 'node:events';
import {randomBytes} from 'node:crypto';
const ephemeralPassword=()=>randomBytes(32).toString('hex');
const coreURL=new URL('../investment/core.js',import.meta.url);
let core;
test('私人投資工具的計算與保存模組必須存在',async()=>{core=await import(coreURL);assert.equal(typeof core.summary,'function');});
const sample=()=>({version:1,settings:{target:1,tolerance:10,fx:32},holdings:[{id:'demo',symbol:'虛構標的',currency:'TWD',category:'股票',shares:5000,price:100,beta:2}],cash:{TWD:500000,USD:0},history:[],undo:null});
test('5000 股與現金：資產一百萬元、Beta 一',()=>{const r=core.summary(sample());assert.equal(r.total,1000000);assert.equal(r.beta,1);assert.equal(r.inRange,true);assert.equal(r.allocation[0].ratio,.5);});
test('美元持股與美元現金均換算',()=>{const s=sample();s.holdings[0]={...s.holdings[0],currency:'USD',shares:10,price:100};s.cash={TWD:0,USD:100};assert.equal(core.summary(s).total,35200);});
test('容忍區間包含邊界，1.2 超出 10%，零目標使用絕對容忍度',()=>{const s=sample();s.holdings[0].beta=2.2;assert.equal(core.summary(s).inRange,true);s.holdings[0].beta=2.4;assert.equal(core.summary(s).inRange,false);s.settings.target=0;s.holdings[0].beta=0;assert.equal(core.summary(s).inRange,true);});
test('再平衡買入 1000 股、十萬元、剩四十萬元、Beta 1.2',()=>{const r=core.rebalance(sample(),'demo',1.2);assert.equal(r.delta,1000,'整股買入 1000');assert.equal(r.amount,100000);assert.equal(r.remaining,400000);assert.equal(r.beta,1.2);});
test('買入限制使用同幣別現金，不借用台幣買美元',()=>{const s=sample();s.holdings[0].currency='USD';s.cash.USD=0;const r=core.rebalance(s,'demo',3);assert.equal(r.delta,0);assert.equal(r.limited,true);});
test('賣出不得超過持股，負目標受到持股限制',()=>{const r=core.rebalance(sample(),'demo',-1);assert.equal(r.delta,-5000);assert.equal(r.remaining,1000000);assert.equal(r.limited,true);});
test('零 Beta 或零價格不能改變曝險，清楚拒絕試算',()=>{for(const key of ['beta','price']){const s=sample();s.holdings[0][key]=0;assert.throws(()=>core.rebalance(s,'demo',1.2),/不能/);}});
test('空資產顯示「尚無資料」，不產生 NaN 或 Infinity',()=>{const s=core.emptyState();const r=core.summary(s);assert.equal(r.beta,null);assert.equal(r.message,'尚無資料');assert.equal(JSON.stringify(r).includes('NaN'),false);});
test('負股數、負價格、零匯率及非有限數值不能保存',()=>{for(const [path,value] of [['shares',-1],['price',-1],['shares',.5],['beta',Infinity]]){const s=sample();s.holdings[0][path]=value;assert.throws(()=>core.validate(s));}const s=sample();s.settings.fx=0;assert.throws(()=>core.validate(s));});
test('套用再平衡後保存並可在重新載入後復原',()=>{const s=sample();const next=core.applyRebalance(s,'demo',1.2);assert.equal(next.holdings[0].shares,6000);assert.equal(next.cash.TWD,400000);const back=core.restoreUndo(core.parseBackup(JSON.stringify(next)));assert.equal(back.holdings[0].shares,5000);assert.equal(back.cash.TWD,500000);assert.equal(s.holdings[0].shares,5000);});
test('同日快照必須明確覆蓋，歷史及備份完整往返',()=>{const a=core.snapshot(sample(),'2026-10-11');assert.throws(()=>core.snapshot(a,'2026-10-11'),/確認/);const b=core.snapshot(a,'2026-10-11',true);assert.equal(b.history.length,1);assert.deepEqual(core.parseBackup(JSON.stringify(b)),b);});
test('壞 JSON、未知版本、重複代號 id、無效歷史、不存在日期拒絕',()=>{assert.throws(()=>core.parseBackup('{broken'),/JSON/);for(const change of [s=>s.version=99,s=>s.holdings.push({...s.holdings[0]}),s=>s.history=[{date:'2026-02-30',portfolio:{settings:s.settings,holdings:s.holdings,cash:s.cash}}],s=>s.cash.USD=-1]){const s=sample();change(s);assert.throws(()=>core.parseBackup(JSON.stringify(s)));}});
test('小數價格買入不透支，負 Beta 可透過賣出提高曝險',()=>{const s=sample();s.holdings[0].price=.1;s.cash.TWD=.3;const r=core.rebalance(s,'demo',2);assert.equal(r.delta,3);assert.equal(r.remaining,0);const n=sample();n.holdings[0].beta=-2;assert.ok(core.rebalance(n,'demo',-.8).delta<0);});
test('保存失敗不改記憶體，損壞舊資料不自動覆寫，多分頁衝突拒絕',()=>{let raw=null;const db=core.createStore({getItem:()=>raw,setItem:(_,v)=>{raw=v;}});db.load();db.save(sample());const prior=raw;raw='broken';assert.throws(()=>db.save(sample()),/其他分頁/);assert.equal(raw,'broken');raw=prior;const bad=core.createStore({getItem:()=>prior,setItem:()=>{throw Error('quota');}});bad.load();assert.throws(()=>bad.save(sample()),/quota/);assert.equal(raw,prior);});
test('HTML 代號以資料保留、巨大輸入拒絕、重複名稱可有不同 id',()=>{const s=sample();s.holdings[0].symbol='<img src=x onerror=alert(1)>';assert.equal(core.validate(s).holdings[0].symbol,s.holdings[0].symbol);s.holdings.push({...s.holdings[0],id:'second'});assert.equal(core.summary(s).total,1500000);s.holdings[0].shares=1e15;assert.throws(()=>core.validate(s));});
test('持股反向排列不改總資產，全部现金 Beta 為零',()=>{const s=sample();s.holdings.push({...s.holdings[0],id:'other',beta:-1});assert.equal(core.summary(s).beta,core.summary({...s,holdings:[...s.holdings].reverse()}).beta);s.holdings=[];assert.equal(core.summary(s).beta,0);});
test('HTTP：未登入、非擁有者、CSRF、登出後不能讀取工具',async()=>{
 const {createPrivateServer,passwordHash}=await import('../investment/server.js');
 const password=ephemeralPassword();let clock=Date.now();const server=createPrivateServer({owner:'test-owner',hash:passwordHash(password),origin:'http://127.0.0.1:9006',now:()=>clock});
 server.listen(0,'127.0.0.1');await once(server,'listening');const url=`http://127.0.0.1:${server.address().port}`;
 const post=(body,cookie='',origin='http://127.0.0.1:9006')=>fetch(url+'/api/login',{method:'POST',headers:{'Content-Type':'application/json',Origin:origin,Cookie:cookie},body:JSON.stringify(body),redirect:'manual'});
 try{
  assert.equal((await fetch(url+'/app.html')).status,401,'未登入不可讀取工具');
  assert.equal((await fetch(url+'/core.js')).status,401);
  assert.equal((await post({username:'other',password})).status,401);
  assert.equal((await post({username:'test-owner',password:'wrong'})).status,401);
  assert.equal((await post({username:'test-owner',password},'','https://attacker.invalid')).status,403);
  const login=await post({username:'test-owner',password});assert.equal(login.status,200);const cookie=login.headers.get('set-cookie').split(';')[0];assert.match(login.headers.get('set-cookie'),/HttpOnly/);
  const page=await fetch(url+'/app.html',{headers:{Cookie:cookie}});assert.equal(page.status,200);assert.match(await page.text(),/投資曝險/);assert.equal(page.headers.get('cache-control'),'no-store');
  assert.equal((await fetch(url+'/server.js',{headers:{Cookie:cookie}})).status,404);
  assert.equal((await fetch(url+'/api/logout',{method:'POST',headers:{Cookie:cookie,Origin:'http://127.0.0.1:9006'}})).status,200);
  assert.equal((await fetch(url+'/app.html',{headers:{Cookie:cookie}})).status,401);
  const again=await post({username:'test-owner',password});const expired=again.headers.get('set-cookie').split(';')[0];clock+=8*3600000+1;assert.equal((await fetch(url+'/api/session',{headers:{Cookie:expired}})).status,401);
  for(let i=0;i<10;i++)assert.equal((await post({username:'other',password:null})).status,401);assert.equal((await post({username:'test-owner',password})).status,429,'登入嘗試受限');
 }finally{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
});
test('私人伺服器缺少雜湊或不安全遠端 origin 不能啟動',async()=>{const {createPrivateServer,passwordHash}=await import('../investment/server.js');assert.throws(()=>createPrivateServer({owner:'test',hash:'plaintext',origin:'http://127.0.0.1'}),/雜湊/);assert.throws(()=>createPrivateServer({owner:'test',hash:passwordHash(ephemeralPassword()),origin:'http://private.invalid'}),/HTTPS/);});
test('超大備份拒絕，匯出與重新載入使用同一格式',()=>{assert.throws(()=>core.parseBackup(' '.repeat(2*1024*1024+1)),/2 MB/);assert.deepEqual(core.parseBackup(core.serializeBackup(sample())),sample());});
