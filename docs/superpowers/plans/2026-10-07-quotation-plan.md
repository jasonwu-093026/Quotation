# Quotation 第一版 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 交付可自行輸入月成本、計算訂單報價、保存與備份的繁體中文網頁工具。

**Architecture:** 靜態網頁，計算、驗證、保存與畫面分離；無後端與帳號。舊報價保留設定快照，所有業務資料僅存瀏覽器及使用者匯出的備份。

**Tech Stack:** HTML、CSS、原生 JavaScript ES modules、BigInt 有理數計算、Node.js 內建 node:test。開發驗證使用 Node.js 22 或更新版本；瀏覽器支援 ES modules、BigInt、localStorage。

**Spec:** `docs/superpowers/specs/2026-10-07-quotation-design.md`；來源檔為已於 2026-10-07 經使用者確認的 `2026-10-07-quotation-design.md`。執行時將該文件放入上述位置，內容不改。

## Global Constraints

- 繁體中文靜態網頁，以 HTML、CSS、JavaScript 實作，電腦優先並可在手機閱讀。
- 第一版無帳號、伺服器或共用資料庫；計算在使用者瀏覽器內執行。
- 使用同一網站來源下的 localStorage 保存設定與報價，並以 JSON 匯出／匯入完整備份。
- 部署方案另行確認，不在本規格中開通或發布網站。
- 原始碼只帶明確標示的示範資料，預設不內嵌公司真實資料，也不把使用者輸入上傳 GitHub。不使用分析追蹤或第三方資料傳輸。
- 件數、機台數、人數、工作天數為正整數；每日時數大於 0 且不超過 24。
- 有效使用率／投入率介於大於 0 至 100%；毛利率為 0% 至小於 100%。
- 金額與訂單時間皆須是有限且非負數；必填空白不自動視為零。
- 保留既有 README 與 `.github/ISSUE_TEMPLATE`，不覆寫協作者工作。未讀到目前倉庫內容前，不聲稱已整合或提交。
- 成本兩位小數顯示，單價向上取到分；整批報價等於取整單價乘數量。機台費率不含直接人工。

## Review Focus

1. 精確整分不得因浮點誤差多收一分；非整分單價向上取整（Task 1）。
2. 備份結構損壞、重複 id、未知版本，拒絕且不改舊資料（Task 2）。
3. 儲存空間不足或讀取被禁止時，不顯示已保存，仍可匯出目前有效工作（Task 2、4）。
4. 修改全域設定或操作未儲存表單不得偷偷改寫舊報價快照（Task 3）。
5. 匯入含 HTML 的料號只顯示文字，取消匯入或刪除不改資料（Task 4）。

## 檔案與資料契約

| 檔案 | 責任 |
|---|---|
| `index.html`, `styles.css`, `src/app.js` | 表單、狀態、結果與紀錄畫面 |
| `src/decimal.js`, `src/calculator.js` | 精確算術及純計算 |
| `src/validation.js` | 輸入、快照與備份格式檢查 |
| `src/storage.js` | 單一鍵保存及備份 |
| `src/quotes.js` | 新增、更新、刪除與快照規則 |
| `tests/fixtures.js`, `tests/*.test.js` | 假資料與 Node 驗證 |
| `package.json`, `README.md`, `docs/acceptance.md` | 測試指令、使用方式及人工驗收紀錄 |

所有數值輸入與 JSON 數值欄位用十進位字串，比例採 0–100（75 表示 75%）。運算轉成 BigInt 分數，JSON 不保存 BigInt。數字字串限 30 字元、最多 6 位小數，整数不得超過 Number.MAX_SAFE_INTEGER；超出時回傳明確欄位錯誤，不靜默截斷。金額極端值若超出安全顯示範圍亦拒絕。

`Settings`：machineCount, machineDays, machineHours, machineUtilization, depreciation, maintenance, rent, electricity, consumables, workerCount, workerDays, workerHours, workerUtilization, laborMonthly。

`Order`：name, partNumber, date（有效 YYYY-MM-DD）, quantity, machineMinutes, laborMinutes, setupMachineMinutes, setupLaborMinutes, materialUnit, outsourceUnit, toolingBatch, marginPercent, notes。name 必填；partNumber、notes 可空白。

`Quote`：id, createdAt, updatedAt（ISO 時間）, calculationVersion: 1, settingsSnapshot: Settings, order: Order。

`Store`：schemaVersion: 1, settings: Settings|null, quotes: Quote[]。

`Issue`：{field: string, message: string}。驗證函式回傳 Issue[]；運算只接受驗證成功資料，錯誤拋出帶 issues 的 Error。畫面捕捉錯誤並隱藏舊結果。

測試基準由 `tests/fixtures.js` 匯出 settings100、order100：機台及人工各 2、20 天、8 小時、75%；月折舊 40000、維修 2000、房租 10000、電費 15000、耗材 5000，合計 72000；人工 57600。訂單 100 件、每件機台 5／人工 1 分鐘、架機機台與人工各 60 分鐘、材料 20、外包 10、刀具 500、毛利 20%。名稱「示範報價」、日期 2026-10-07；均是假資料。

## Task 1：可驗算的成本核心

**Files:** 新增 `package.json`, `src/decimal.js`, `src/validation.js`, `src/calculator.js`, `tests/fixtures.js`, `tests/calculator.test.js`。

**Interfaces:** `validateSettings(settings): Issue[]`, `validateOrder(order): Issue[]`；`calculateQuote(settings, order): Result`。Result 含 rates（machineMinutes、laborMinutes、machinePerMinute、laborPerMinute；字串）、unitBreakdown（machine、labor、setupMachine、setupLabor、material、outsource、tooling；兩位金額字串）、unitCost、batchCost、unitPrice、batchPrice（兩位金額字串）。費率顯示六位小數但內部不採用顯示值重算。

- [ ] 先確認倉庫現有內容及 AGENTS.md，依 using-git-worktrees 建隔離工作位置；若無授權讀寫途徑，以本機交付包執行，不假造 GitHub 提交。使用新工作分支 `feat/quotation-v1`，有同名時加後綴。
- [ ] 在 package.json 設 `type: module`、`test: node --test`；寫下核心失敗測試，先建測試輸入與預期值。

```js
const r = calculateQuote(settings100, order100);
assert.equal(r.unitCost, '69.40');
assert.equal(r.batchCost, '6940.00');
assert.equal(r.unitPrice, '86.75');
assert.equal(r.batchPrice, '8675.00');
const r200 = calculateQuote(settings100, {...order100, quantity:'200'});
assert.equal(r200.unitCost, '64.20');
assert.equal(r200.unitPrice, '80.25');
assert.equal(r200.batchPrice, '16050.00');
```

- [ ] 補精度斷言：其餘訂單成本清零、材料為 0.10、毛利 0 → 單價 0.10；材料 0.100001 → 單價 0.11；材料 1.005 → 單價 1.01。獨立改人工投入率不得改機台費率；獨立改機台率不得改人工費率。
- [ ] 補無效輸入斷言：空白、NaN、Infinity、負成本、0 件、0 有效率、25 小時、100% 毛利、超長数字、無效日期均被拒絕。
- [ ] 執行 `node --test tests/calculator.test.js`，確認測試因尚缺實作失敗。
- [ ] 實作驗證及有理數十進位加減乘除；先依規格計算完整分數，單價以整數除法向上取分，顯示成本使用四捨五入，無浮點 epsilon 補丁。顯示分項四捨五入可能有尾差，UI 說明總額依未取整數值算。
- [ ] 重跑同一測試，全部通過後提交 `feat: add verified quotation calculations`。

## Task 2：可靠保存與備份

**Files:** 新增 `src/storage.js`, `tests/storage.test.js`；擴充 `src/validation.js`。

**Interfaces:** `validateStore(data): Issue[]`；`createStorage(storageLike)` 回傳 `{load(): Store, save(store): void}`；`serializeBackup(store): string`, `parseBackup(text): Store`。鍵為 `quotation.v1`，load 缺值回傳 `{schemaVersion:1, settings:null, quotes:[]}`；讀取、解析及寫入錯誤向上傳遞，禁止靜默重置損壞資料。

- [ ] 寫假 storage adapter 測試：save→load 深度相等、serialize→parse 深度相等；壞 JSON、未知版本、重複 id、錯誤快照均拒絕，原 storage 字串不變。
- [ ] 寫 adapter getItem／setItem 拋錯的測試，斷言錯誤傳至呼叫端；驗證所有報價的 calculationVersion 為 1、日期合法、必要文字有值。
- [ ] 跑 `node --test tests/storage.test.js` 確認失敗。
- [ ] 實作單一 envelope／單次 setItem 寫入。parseBackup 只驗證並建立乾淨資料，不自行保存；拒絕未知欄位以免誤解備份格式，拒絕重複識別碼。
- [ ] 同一指令全部通過後提交 `feat: add local storage and backup validation`。

## Task 3：報價紀錄與成本快照

**Files:** 新增 `src/quotes.js`, `tests/quotes.test.js`。

**Interfaces:** `createQuote(settings, order, {id, now}): Quote`；`updateQuote(quote, settingsSnapshot, order, now): Quote`；`saveQuote(store, quote): Store`（依 id 新增或替換）；`deleteQuote(store, id): Store`；`applyCurrentSettings(quote, settings): Quote`（只回傳草稿，不自動保存）。所有函式不修改輸入物件。

- [ ] 寫測試：create 深複製輸入；update 保留 id、createdAt 並改 updatedAt；save 新增／替換不重複；delete 只移除目標。
- [ ] 寫快照測試：全域人工月費從 57600 改為 115200，已存單價仍為 86.75；明確 applyCurrentSettings 後草稿單價變 94.75，原報價仍為 86.75。
- [ ] 跑 `node --test tests/quotes.test.js` 確認失敗。
- [ ] 實作上述纯函式，引用 Task 1、2 的驗證。持久化由 UI 明確 save 操作觸發。
- [ ] 同一指令全部通過後提交 `feat: preserve historical quote snapshots`。

## Task 4：可操作的繁體中文畫面

**Files:** 新增 `index.html`, `styles.css`, `src/app.js`, `docs/acceptance.md`。

**Interfaces:** 使用 Task 1–3 的公開函式，不在 app.js 重寫公式。UI 狀態為 store、activeQuoteId、draftSettings、draftOrder、dirty、storageError。DOM 所有使用者文字皆用 textContent／value。

- [ ] 先於 docs/acceptance.md 列出以下可操作驗收步驟、預期結果及「未測」欄：初始空白／明確載入示範、基本成本保存、訂單計算、另存新報價、覆寫確認、刪除取消／確認、匯出還原、舊快照／套用最新成本、無效輸入隱藏結果。
- [ ] 加上錯誤場景：阻止 localStorage 讀写、匯入壞檔、取消匯入、料號 `<img src=x onerror=alert(1)>` 僅呈現文字；手機 390px 寬無水平溢出、表單鍵盤可達、錯誤與輸入有對應標籤。
- [ ] 建立四個區塊：基本設定與月支出、訂單輸入、結果、已存報價／備份。第一版幣別固定新台幣且未稅。清楚顯示工時單位、有效率分母、示範標記、未納入成本與本機保存限制。
- [ ] 加入 name、partNumber、date、notes 及全部規格欄位。表單輸入後重算；有錯清除有效結果、保留輸入。新報價帶最新全域設定；載入舊報價帶舊快照並標記。
- [ ] 加入所有保存／讀取／刪除／套用新成本及備份按鈕。覆寫、刪除及整批匯入須確認；切換新報價／載入其他紀錄若有未保存內容先提示。
- [ ] 寫入失敗時保留有效草稿在記憶體、顯示「尚未保存」；匯出可含此有效草稿（用其 id 取代或新增到備份），未驗證的表單不得當作有效報價匯出。讀取錯誤時不自動覆蓋原 storage，提示匯出可讀原始資料或匯入已驗證備份。
- [ ] 本機以 `python3 -m http.server 8080` 啟動，使用可用瀏覽器驗證途徑逐項驗收；記錄實測結果，不把未測項目寫為通过。執行 `npm test` 防止整合破壞計算與保存。
- [ ] 確認上述場景後提交 `feat: add quotation calculator interface`。

## Task 5：交付與 GitHub 學習步驟

**Files:** 修改 `README.md`；完成 `docs/acceptance.md`；加入 spec、plan 至既定路徑。

**Interfaces:** 不新增產品功能，交付前使用現有測試與實際畫面。

- [ ] README 保留既有說明並加入用途、啟動方式、`npm test`、成本口徑、保存與備份限制、檔案職責及假資料驗算例。
- [ ] 執行 `npm test`、`git diff --check`（有 Git 時），確認所有必要測試通过、無非預期改動；僅針對具體缺陷補測。
- [ ] 依 verification-before-completion 與 requesting-code-review 完成驗證／審查，修正會影響計價或保存的問題；更新 docs/acceptance.md 的實際結果。
- [ ] 有合法倉庫寫入能力時提交文件並交付可檢閱分支／PR；否則提供完整原始碼 ZIP 與步驟：在 Quotation 新建分支、Add file → Upload files、上傳解壓檔、提交修改、檢閱後合併。不要把 ZIP 當成網站可直接執行內容。
- [ ] 明確告知已完成與未完成的項目，網站部署仍待另行確認，不聲稱 GitHub 檔案頁能直接操作工具。

## 自我審查與執行交接

覆蓋檢查：規格 1–4 對應 Task 1／4；保存與模組分工對應 Task 2／3；錯誤處理對應 Task 1／2／4；驗收對應 Task 1–5；排除範圍維持不變。五项 Review Focus 均已有指定測試或人工驗收步驟。

本計畫尚未執行；目前未寫產品程式，也未推送 GitHub。建議由目前助理在本對話逐項實作，因計算、快照與 UI 相依，需要連續核對。另一方式為分工代理逐任務實作與審查，較耗資源。待使用者審閱計畫並選擇執行方式後開始。
