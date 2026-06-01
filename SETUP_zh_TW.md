# 🎵 VTuber 點歌系統 — 安裝說明

## 運作流程

```
觀眾兌換頻道點數（點歌券 或 隨機點歌券）
        ↓
Twitch Webhook → 你的本機伺服器（透過 ngrok 通道）
        ↓
🎵 點歌券：模糊比對歌名 → 加入歌單 或 待審核（控制台）
🎲 隨機點歌券：從歌曲清單中加權隨機選歌
        ↓
OBS 顯示層透過 WebSocket 即時更新
        ↓
點歌紀錄寫入 Google 試算表
```

---

## 事前準備

執行安裝腳本前，請先安裝以下工具：

- **Node.js LTS** → https://nodejs.org （安裝時記得勾選「Add to PATH」）
- **ngrok** → https://ngrok.com/download （免費註冊，解壓縮至 `C:\ngrok\`）

---

## 首次安裝

```powershell
.\setup_zh.ps1
```

> 也提供英文版：`.\setup.ps1`

腳本會以互動式引導完成所有設定：

1. 安裝 npm 套件
2. 輸入 Twitch Client ID 與 Secret → 自動取得存取金鑰
3. 透過使用者名稱自動查詢你的 Broadcaster ID
4. 自動建立 🎵 點歌券 與 🎲 隨機點歌券 頻道點數兌換項目
5. 輸入 Google 試算表 ID
6. 設定 ngrok 驗證金鑰（Authtoken）
7. 將所有設定寫入 `.env`

唯一需要手動完成的步驟是 **Google 服務帳戶** — 只需設定一次：

1. 前往 https://console.cloud.google.com → 建立新專案 → 啟用 **Google Sheets API**
2. **IAM 與管理 → 服務帳戶 → 建立** → **金鑰 → JSON**
3. 將下載的檔案重新命名為 **`google-credentials.json`** → 放入專案根目錄
4. 將 **歌曲清單試算表**（檢視者權限）與 **點歌紀錄試算表**（編輯者權限）共用給服務帳戶的電子郵件

---

## 每次直播開始

```powershell
.\start_zh.ps1
```

> 也提供英文版：`.\start.ps1`

就這樣。腳本會自動：
- 啟動 ngrok 並讀取公開網址
- 將 `PUBLIC_URL` 更新至 `.env`
- 啟動伺服器

接著在瀏覽器開啟 **http://localhost:3000/dashboard** 即可。

---

## Google 試算表設定

### 歌曲清單試算表

你現有的歌曲清單。所有分頁皆會載入，除了 `server/config.js` 中 `EXCLUDED_TABS` 所列的分頁。

第一列必須包含欄位名稱（標題列），最少需有：

| title | artist | key |
|---|---|---|
| シャルル | バルーン | 0 |
| ロキ | みきとP | -2 |

欄位名稱須與 `.env` 中的 `SHEET_SONG_COLUMN` / `SHEET_ARTIST_COLUMN` 一致。
`key` 欄為選填 — 僅接受數字，非數字值會被忽略。

### 點歌紀錄試算表

一份獨立的空白試算表。伺服器首次執行時會自動建立標題列。
請共用給服務帳戶電子郵件 → **編輯者**權限。

---

## 設定檔說明

| 檔案 | 用途 |
|---|---|
| `.env` | 金鑰、ID、網址 — 詳見 `.env.example` 的說明註解 |
| `server/config.js` | 比對門檻、排除分頁、捲動速度、隨機權重等行為設定 |
| `overlay/index.html` | 頂部 CSS 變數 — 字體大小、清單高度等外觀設定 |

---

## 控制台（Dashboard）

直播時在瀏覽器開啟 `http://localhost:3000/dashboard`。

| 功能 | 說明 |
|---|---|
| 4 個欄位 | 正在演唱 · 待唱歌單 · 已唱歌單 · 待審核 |
| 拖放排序 | 可在欄位間移動歌曲，或在欄位內調整順序 |
| ✓ 唱完了 | 將「正在演唱」移至「已唱歌單」，並自動拉入下一首 |
| 待審核欄位 | 低信心或未比對到的請求 — 手動編輯後確認加入 |
| 手動點歌欄 | 不透過頻道點數直接新增歌曲 |
| 點歌紀錄 | 每張歌曲卡片顯示上次點歌日期與點歌者 |
| 調音圓圈 | 顯示移調數值（如 +3、-2 等） |

---

## 歌名比對機制

| 結果 | 動作 |
|---|---|
| 信心度 ≥ 80% | 自動加入待唱歌單 |
| 信心度 < 80% | 加入待審核，附上建議比對結果 |
| 完全無比對 | 加入待審核，標題空白供手動輸入 |

可在 `server/config.js` 調整：`AUTO_ACCEPT_THRESHOLD`（信心度門檻）、`MATCH_THRESHOLD`（0.2 較嚴格 / 0.6 較寬鬆）。

---

## 隨機點歌模式

在 `.env` 中設定 `RANDOM_PICK_MODE`：
- `weighted` — 優先選取近期較少點到的歌曲（推薦）
- `pure` — 完全隨機

已在待唱歌單或正在演唱中的歌曲一律排除。

---

## 檔案結構

```
vtuber-song-queue/
├── setup.ps1                 ← 首次安裝精靈（只需執行一次）
├── start.ps1                 ← 每次直播開始時執行
├── .env                      ← 金鑰設定（請勿上傳至 Git！）
├── .env.example              ← 設定範本與說明
├── google-credentials.json   ← 服務帳戶金鑰（請勿上傳至 Git！）
├── song-cache.json           ← 自動產生的快取，可安全刪除
├── server/
│   ├── index.js              ← 主伺服器
│   ├── config.js             ← 可調整的行為設定
│   ├── sheets.js             ← 歌曲清單讀取器
│   ├── matcher.js            ← 模糊比對（fuse.js）
│   ├── queue.js              ← 歌單狀態 + WebSocket 廣播
│   ├── twitch.js             ← EventSub 訂閱與 Webhook 驗證
│   ├── history.js            ← 點歌紀錄寫入器
│   └── random.js             ← 隨機選歌器
├── overlay/
│   └── index.html            ← OBS 瀏覽器來源（顯示層）
└── dashboard/
    └── index.html            ← 主播控制台
```

---

## 小提醒

- 歌曲清單**每 5 分鐘自動更新** — 新增歌曲後不需重新啟動伺服器
- 點歌紀錄**約 2 秒內寫入**試算表（有防抖設計，不會頻繁呼叫 API）
- 若 ngrok 網址改變：重新執行 `.\start.ps1` 即可 — 腳本會自動更新 `.env`
- 想**永久架設**（不再需要 ngrok）：可部署至 Railway 或 Render 等平台
