# 私人投資曝險管理工具

獨立於加工報價工具，入口由私人 Node.js 伺服器驗證擁有者。
僅手動價格、Beta 及 USD/TWD 匯率；沒有行情、券商連線、真實交易或自動同步。

## 啟動與私人部署

需要 Node.js 22 或更新版本。**GitHub Pages 不能部署此私人入口**；Pages 上的
靜態檔案沒有登入 API，工具不會開啟。正式私人網址仍需自行部署以下伺服器。

1. 在自己的電腦／伺服器產生密碼雜湊，密碼不要放在命令列、程式碼或 Git：
   在 Bash 輸入 `read -rs -p '私人密碼：' INVEST_SECRET`，再執行
   `printf '%s' "$INVEST_SECRET" | node investment/server.js --hash-password`，最後
   `unset INVEST_SECRET`。密碼需 12–256 字；把輸出的雜湊存入部署平台的秘密設定。
2. 設定 `INVEST_OWNER`（唯一擁有者登入名稱）及 `INVEST_PASSWORD_HASH`（步驟 1 的雜湊）。
3. 執行 `node investment/server.js`；在同一電腦開啟 `http://127.0.0.1:9006`。
   可用 `PORT` 更換埠號。伺服器只綁定 loopback，不直接暴露外部網路。
4. 手機／正式遠端使用：把私人主機透過 HTTPS 反向代理連到此 loopback 埠；設定
   `INVEST_ORIGIN=https://你的私人網域`（不含結尾斜線或路徑）。代理需保留瀏覽器 Origin。
   可設定代理基本限制／防火牆；禁止把此入口當成公開靜態網站。

非 loopback 網址必須是 HTTPS。擁有者以外帳號拒絕登入；未登入不能讀取工具頁面、
程式模組或登入狀態。密碼使用隨機 salt 與 scrypt，session 為伺服器端記憶體資料，
cookie 為 HttpOnly、SameSite=Strict，HTTPS 下加 Secure。每分鐘全站最多 10 次登入嘗試，
避免密碼猜測；登入有效 8 小時，重啟伺服器會使登入失效。登出撤銷該 session。
私人伺服器只提供指定網頁資產，不提供伺服器程式、備份、環境設定或檔案目錄。

## 計算與操作

- 台幣總資產 = 台幣持股市值 + 美元持股市值 × 匯率 + 台幣現金 + 美元現金 × 匯率。
- 整體 Beta = Σ（各持股台幣市值 × Beta）÷ 總資產；現金 Beta = 0。
- 金額採既有精確十進位計算，顯示及現金保存至 0.01 元。
- 目標容忍區間 = 目標 Beta ± |目標 Beta| × 容忍百分比，含邊界。
  目標為零時，以絕對 Beta 容忍度判斷（10% = ±0.1）。
- 再平衡改變單一持股，總資產在買賣前後保持不變（忽略手續費、稅與滑價）。
  目標股數差額 = 總資產 ×（新目標 − 現有 Beta）÷（每股台幣價格 × 該股 Beta）。
  四捨五入為整股，再限制於可買股數及可賣股數。只使用同幣別現金，不自動換匯。
  零價格／零 Beta／零資產不能調整；負 Beta 及負目標可用，但不允許負股數或融資。
- 「確認套用」會再次確認並同時保存持股與現金；「復原」保存上一筆套用前狀態，
  重新載入後也能使用。手動修改持股或設定會清除舊復原點，避免覆蓋後續修改。
- 同日再次保存快照先確認覆蓋；快照保存當日的完整持股、設定及現金，日後計算不改寫。

## 資料與限制

資料只存於該網址在目前瀏覽器的 `investment.exposure.v1`，與 `quotation.v1` 分離。
清除網站資料會刪除持股；不同網址、瀏覽器、電腦及手機不會同步。
匯出明文 JSON，包含設定、持股、現金、歷史及復原點。備份大小限 2 MB，
最多 2000 檔持股、5000 筆快照；匯入完整驗證後還需確認，不接受錯誤 JSON 或未知版本。
讀取損壞時停止覆寫；成功匯入可恢復。儲存失敗不更新畫面為已保存。
另一分頁寫入後，本頁拒絕覆寫；請先匯出目前保存的資料再重新載入。
未送出的表單內容並非已保存資料，匯出前請先按儲存。

登出不刪除該裝置的持股。私人存取保護的是遠端網站入口；本機保存不是加密保管庫。
只在自己管理的瀏覽器／裝置登入；共享裝置可在匯出備份後清除網站資料。

## 可執行驗收

```bash
node --test tests/investment.test.js
npm install --no-save --package-lock=false playwright
npx playwright install chromium webkit
python3 tools/check_investment.py
```

檢查器自動啟動專屬埠 9006 的測試入口，在隔離瀏覽器使用虛構帳號與資料，
逐列列出 Chromium 1440px、390px 與 WebKit 390px 的真實 DOM／操作結果。
具備 WebKit 系統相依套件時，驗收目標為 **24/24 PASS、0 FAIL**，另加核心測試全部通過。
若主機缺少 WebKit 相依套件，可執行 `python3 tools/check_investment.py --chromium-only`；
此範圍目標為 **16/16 PASS、0 FAIL**，WebKit 與實體 Safari 明確保持待驗證。
WebKit 自動化不代表實體 iPhone Safari 已驗證；正式部署與實體 iPhone 操作仍需擁有者確認。
測試不使用真實持股、密碼或個人資料；不會連到原參考網站。

## 本輪觀察（2026-10-11 UTC）

- Node.js 22.23.3：核心／HTTP 測試 20 項通過、0 失敗，約 0.41 秒。
- Chromium 桌面 1440px／手機 390px：16/16 真實頁面檢查通過、0 失敗，全流程 2.57 秒。
- 再平衡實際畫面：買入 1000 股、支出 TWD 100000、剩餘 TWD 400000、Beta 1.2；重新載入後復原成功。
- CentOS Stream 8 缺少 WebKit 所需 GTK4、ICU74 等函式庫，WebKit 尚未驗證；未修改共用主機系統套件。
- 正式 HTTPS 網址尚未部署；未在實體 iPhone 或 Windows Chrome 驗證。
