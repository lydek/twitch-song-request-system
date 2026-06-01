﻿# ============================================================
#  VTuber - First-time Setup (Traditional Chinese)
#  Run once: right-click -> Run with PowerShell
# ============================================================

$ErrorActionPreference = "Stop"
$HOST.UI.RawUI.WindowTitle = "VTuber Setup"

function Write-Header($text) {
    Write-Host ""
    Write-Host "  ======================================" -ForegroundColor DarkMagenta
    Write-Host "  $text" -ForegroundColor Magenta
    Write-Host "  ======================================" -ForegroundColor DarkMagenta
    Write-Host ""
}
function Write-Step($text) { Write-Host "  >> $text" -ForegroundColor Cyan }
function Write-OK($text)   { Write-Host "  [OK] $text" -ForegroundColor Green }
function Write-Warn($text) { Write-Host "  [!] $text" -ForegroundColor Yellow }
function Write-Err($text)  { Write-Host "  [X] $text" -ForegroundColor Red }
function Ask($prompt)      { Write-Host "  --> $prompt" -ForegroundColor White -NoNewline; return (Read-Host " ") }
function Pause-Key         { Write-Host "  按任意鍵繼續..." -ForegroundColor DarkGray; $null = $Host.UI.RawUI.ReadKey("NoEcho,IncludeKeyDown") }

Clear-Host
Write-Host ""
Write-Host "  VTuber 點歌系統 - 安裝精靈" -ForegroundColor Magenta
Write-Host "  --------------------------------------" -ForegroundColor DarkMagenta
Write-Host ""

# ---- Step 1: Check Node.js -----------------------------------------------
Write-Header "步驟 1 - 檢查必要工具"
Write-Step "檢查 Node.js..."
$nodeVer = node --version 2>&1
if ($LASTEXITCODE -ne 0) {
    Write-Err "找不到 Node.js，請至 https://nodejs.org 安裝 LTS 版本"
    Pause-Key
    exit 1
}
Write-OK "Node.js 已安裝：$nodeVer"

Write-Step "安裝 npm 套件..."
npm install --silent
Write-OK "npm 套件安裝完成"

# ---- Step 2: .env --------------------------------------------------------
Write-Header "步驟 2 - 設定檔"
$envPath = Join-Path $PSScriptRoot ".env"
if (-not (Test-Path $envPath)) {
    Copy-Item (Join-Path $PSScriptRoot ".env.example") $envPath
    Write-OK "已從範本建立 .env"
} else {
    Write-Warn ".env 已存在，僅補填空白欄位"
}

function Get-EnvValue($key) {
    $lines = [System.IO.File]::ReadAllLines($envPath, [System.Text.UTF8Encoding]::new($false))
    $line = $lines | Where-Object { $_ -match "^$key=" }
    if ($line) { return ($line -split "=", 2)[1].Trim() }
    return ""
}
function Set-EnvValue($key, $value) {
    $content = [System.IO.File]::ReadAllText($envPath, [System.Text.UTF8Encoding]::new($false))
    if ($content -match "(?m)^$key=.*$") {
        $content = $content -replace "(?m)^$key=.*$", "$key=$value"
    } else {
        $content += "`n$key=$value"
    }
    [System.IO.File]::WriteAllText($envPath, $content, [System.Text.UTF8Encoding]::new($false))
}

# ---- Step 3: Twitch App Credentials -------------------------------------
Write-Header "步驟 3 - Twitch 應用程式憑證"
Write-Host "  前往：https://dev.twitch.tv/console/apps" -ForegroundColor DarkCyan
Write-Host "  建立應用程式（名稱隨意，OAuth 轉址：http://localhost，類別：Other）" -ForegroundColor DarkGray
Write-Host ""

$clientId = Get-EnvValue "TWITCH_CLIENT_ID"
if (-not $clientId -or $clientId -eq "your_client_id_here") {
    $clientId = Ask "貼上你的 Client ID"
    Set-EnvValue "TWITCH_CLIENT_ID" $clientId
}
Write-OK "Client ID：$clientId"

$clientSecret = Get-EnvValue "TWITCH_CLIENT_SECRET"
if (-not $clientSecret -or $clientSecret -eq "your_client_secret_here") {
    Write-Host "  在同一頁面點擊 [New Secret] 按鈕，複製後貼上（只會顯示一次）" -ForegroundColor DarkGray
    $clientSecret = Ask "貼上你的 Client Secret"
    Set-EnvValue "TWITCH_CLIENT_SECRET" $clientSecret
}
Write-OK "Client Secret 已儲存"

Write-Step "取得 Twitch App Token..."
$tokenUrl = "https://id.twitch.tv/oauth2/token"
$tokenParams = @{ client_id = $clientId; client_secret = $clientSecret; grant_type = "client_credentials" }
$tokenRes = Invoke-RestMethod -Method Post -Uri $tokenUrl -Body $tokenParams
$appToken = $tokenRes.access_token
Write-OK "App Token 取得成功"

# ---- Step 4: Broadcaster ID ---------------------------------------------
Write-Header "步驟 4 - 頻道 ID"
$broadcasterId = Get-EnvValue "TWITCH_BROADCASTER_ID"
if (-not $broadcasterId -or $broadcasterId -eq "your_numeric_user_id_here") {
    $username = Ask "輸入你的 Twitch 使用者名稱"
    $userRes = Invoke-RestMethod `
        -Uri "https://api.twitch.tv/helix/users?login=$username" `
        -Headers @{ "Client-Id" = $clientId; "Authorization" = "Bearer $appToken" }
    if (-not $userRes.data -or $userRes.data.Count -eq 0) {
        Write-Err "找不到使用者：$username"
        Pause-Key
        exit 1
    }
    $broadcasterId = $userRes.data[0].id
    Set-EnvValue "TWITCH_BROADCASTER_ID" $broadcasterId
    Write-OK "Broadcaster ID：$broadcasterId ($($userRes.data[0].display_name))"
} else {
    Write-OK "Broadcaster ID 已設定：$broadcasterId"
}

$webhookSecret = Get-EnvValue "TWITCH_WEBHOOK_SECRET"
if (-not $webhookSecret -or $webhookSecret -eq "make_up_any_random_string_here") {
    # Generate ASCII-only secret to avoid any encoding issues
    $chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789"
    $webhookSecret = -join (1..32 | ForEach-Object { $chars[(Get-Random -Maximum $chars.Length)] })
    Set-EnvValue "TWITCH_WEBHOOK_SECRET" $webhookSecret
    # Verify it was written correctly
    $verify = Get-EnvValue "TWITCH_WEBHOOK_SECRET"
    if ($verify -ne $webhookSecret) {
        Write-Warn "Webhook Secret 寫入驗證失敗，請手動在 .env 中設定 TWITCH_WEBHOOK_SECRET=（任意英數字串）"
    } else {
        Write-OK "Webhook Secret 已自動產生並驗證"
    }
}

# ---- Step 5: Channel Points Rewards -------------------------------------
Write-Header "步驟 5 - 頻道點數兌換項目"
Write-Host "  需要使用者 Token 才能建立兌換項目。" -ForegroundColor DarkGray
Write-Host "  請在瀏覽器以主播帳號開啟下方網址並點擊授權：" -ForegroundColor DarkCyan
$authUrl = 'https://id.twitch.tv/oauth2/authorize?client_id=' + $clientId + '&redirect_uri=http://localhost&response_type=token&scope=channel:read:redemptions+channel:manage:redemptions'
Write-Host "  $authUrl" -ForegroundColor DarkCyan
Write-Host ""
Write-Host "  點擊授權後，瀏覽器會跳轉到 http://localhost 並顯示無法連線——這是正常的。" -ForegroundColor DarkGray
    Write-Host "  此時看網址列，格式如下：" -ForegroundColor DarkGray
    Write-Host "  http://localhost/#access_token=這裡是Token" -ForegroundColor DarkCyan
    Write-Host "  複製 access_token= 後面、第一個 # 符號前的這段文字。" -ForegroundColor DarkGray
Write-Host ""
$userToken = Ask "貼上你的 User Token"

$rewardHeaders = @{
    "Client-Id"     = $clientId
    "Authorization" = "Bearer $userToken"
    "Content-Type"  = "application/json"
}

$existingData = @{ data = @() }
try {
    $existingData = Invoke-RestMethod `
        -Uri "https://api.twitch.tv/helix/channel_points/custom_rewards?broadcaster_id=$broadcasterId" `
        -Headers $rewardHeaders
} catch {
    Write-Warn "無法取得現有兌換項目（頻道可能尚未成為聯盟主播）"
}

# Song Request reward
$rewardId = Get-EnvValue "TWITCH_REWARD_ID"
if (-not $rewardId -or $rewardId -eq "your_song_request_reward_id_here") {
    $found = $existingData.data | Where-Object { $_.title -like "*Song Request*" -or $_.title -like "*點歌*" }
    if ($found) {
        $rewardId = $found[0].id
        Write-OK "找到現有點歌兌換項目：$($found[0].title)"
    } else {
        Write-Step "建立點歌券兌換項目..."
        $bodyJson = '{"title":"點歌券","cost":500,"is_user_input_required":true,"prompt":"輸入想點的歌名"}'
        try {
            $r = Invoke-RestMethod -Method Post `
                -Uri "https://api.twitch.tv/helix/channel_points/custom_rewards?broadcaster_id=$broadcasterId" `
                -Headers $rewardHeaders `
                -Body ([System.Text.Encoding]::UTF8.GetBytes($bodyJson))
            $rewardId = $r.data[0].id
            Write-OK "已建立點歌券（500 點）"
        } catch {
            Write-Warn "無法自動建立。請手動至 Twitch 後台建立："
            Write-Host "  前往 https://dashboard.twitch.tv -> 觀眾獎勵 -> 頻道點數 -> 管理獎勵 -> +" -ForegroundColor DarkGray
            Write-Host "  名稱：點歌券，勾選 [需要觀眾輸入文字]" -ForegroundColor DarkGray
            $rewardId = Ask "貼上點歌券兌換項目 ID（可按 Enter 略過）"
        }
    }
    if ($rewardId) { Set-EnvValue "TWITCH_REWARD_ID" $rewardId }
}
Write-OK "點歌券 ID：$rewardId"

# Random Song reward
$randomRewardId = Get-EnvValue "TWITCH_RANDOM_REWARD_ID"
if (-not $randomRewardId -or $randomRewardId -eq "your_random_reward_id_here") {
    $found = $existingData.data | Where-Object { $_.title -like "*Random*" -or $_.title -like "*隨機*" }
    if ($found) {
        $randomRewardId = $found[0].id
        Write-OK "找到現有隨機點歌兌換項目：$($found[0].title)"
    } else {
        Write-Step "建立隨機點歌券兌換項目..."
        $bodyJson = '{"title":"隨機點歌券","cost":300,"is_user_input_required":false}'
        try {
            $r = Invoke-RestMethod -Method Post `
                -Uri "https://api.twitch.tv/helix/channel_points/custom_rewards?broadcaster_id=$broadcasterId" `
                -Headers $rewardHeaders `
                -Body ([System.Text.Encoding]::UTF8.GetBytes($bodyJson))
            $randomRewardId = $r.data[0].id
            Write-OK "已建立隨機點歌券（300 點）"
        } catch {
            Write-Warn "無法自動建立。請手動至 Twitch 後台建立："
            Write-Host "  前往 https://dashboard.twitch.tv -> 觀眾獎勵 -> 頻道點數 -> 管理獎勵 -> +" -ForegroundColor DarkGray
            Write-Host "  名稱：隨機點歌券，不需勾選輸入文字" -ForegroundColor DarkGray
            $randomRewardId = Ask "貼上隨機點歌券兌換項目 ID（可按 Enter 略過）"
        }
    }
    if ($randomRewardId) { Set-EnvValue "TWITCH_RANDOM_REWARD_ID" $randomRewardId }
}
Write-OK "隨機點歌券 ID：$randomRewardId"

# ---- Step 6: Google Sheets ----------------------------------------------
Write-Header "步驟 6 - Google 試算表"
$credPath = Join-Path $PSScriptRoot "google-credentials.json"
if (-not (Test-Path $credPath)) {
    Write-Host "  找不到 google-credentials.json，請依以下步驟建立 Google 服務帳戶：" -ForegroundColor Yellow
    Write-Host ""
    Write-Host "  服務帳戶是 Google 提供給程式使用的帳號（非個人帳號），" -ForegroundColor DarkGray
    Write-Host "  讓此系統能自動讀寫你的 Google 試算表。" -ForegroundColor DarkGray
    Write-Host ""
    Write-Host "  步驟如下：" -ForegroundColor DarkGray
    Write-Host "  1. 前往 https://console.cloud.google.com 並登入 Google 帳號" -ForegroundColor DarkGray
    Write-Host "  2. 左上角下拉選單 -> 新增專案（名稱隨意，例如 song-queue）" -ForegroundColor DarkGray
    Write-Host "  3. 上方搜尋列輸入 [Google Sheets API] -> 點擊啟用" -ForegroundColor DarkGray
    Write-Host "  4. 左側選單 -> IAM 與管理 -> 服務帳戶 -> 建立服務帳戶" -ForegroundColor DarkGray
    Write-Host "  5. 名稱隨意（例如 song-queue-bot）-> 完成" -ForegroundColor DarkGray
    Write-Host "  6. 點擊剛建立的服務帳戶 -> 金鑰 -> 新增金鑰 -> JSON" -ForegroundColor DarkGray
    Write-Host "  7. 自動下載一個 JSON 檔，重新命名為 google-credentials.json" -ForegroundColor DarkGray
    Write-Host "  8. 將檔案放入：$PSScriptRoot" -ForegroundColor DarkGray
    Write-Host ""
    Write-Host "  完成後按任意鍵繼續..." -ForegroundColor Yellow
    Pause-Key
    if (Test-Path $credPath) {
        Write-OK "google-credentials.json 已找到"
    } else {
        Write-Warn "google-credentials.json 仍未找到，之後可再補齊"
    }
} else {
    Write-OK "google-credentials.json 已存在"
}

$sheetId = Get-EnvValue "GOOGLE_SHEET_ID"
if (-not $sheetId -or $sheetId -eq "your_sheet_id_here") {
    Write-Host "  試算表網址格式：https://docs.google.com/spreadsheets/d/[ID在此]/edit" -ForegroundColor DarkCyan
    $sheetId = Ask "貼上歌曲清單試算表 ID"
    Set-EnvValue "GOOGLE_SHEET_ID" $sheetId
}
Write-OK "歌曲清單試算表 ID 已儲存"

$songCol = Get-EnvValue "SHEET_SONG_COLUMN"
if (-not $songCol -or $songCol -eq "title") {
    Write-Host "  請輸入你的試算表中，歌曲名稱的欄位標題（第一列的欄名）。" -ForegroundColor DarkGray
    Write-Host "  例如：title、曲名、歌名（預設為 title）" -ForegroundColor DarkGray
    $input = Ask "歌曲名稱欄位名稱（直接按 Enter 使用預設值 title）"
    if ($input) { Set-EnvValue "SHEET_SONG_COLUMN" $input } else { Set-EnvValue "SHEET_SONG_COLUMN" "title" }
    $songCol = if ($input) { $input } else { "title" }
}
Write-OK "歌曲名稱欄位：$songCol"

$artistCol = Get-EnvValue "SHEET_ARTIST_COLUMN"
if (-not $artistCol -or $artistCol -eq "artist") {
    Write-Host "  請輸入歌手名稱的欄位標題。（預設為 artist）" -ForegroundColor DarkGray
    $input = Ask "歌手名稱欄位名稱（直接按 Enter 使用預設值 artist）"
    if ($input) { Set-EnvValue "SHEET_ARTIST_COLUMN" $input } else { Set-EnvValue "SHEET_ARTIST_COLUMN" "artist" }
    $artistCol = if ($input) { $input } else { "artist" }
}
Write-OK "歌手名稱欄位：$artistCol"

Write-Host "  注意：key（移調）欄位固定使用欄名 key，請確認試算表中的欄名一致。" -ForegroundColor DarkGray
Write-Host "  提醒：請確認已將此試算表共用給服務帳戶電子郵件（檢視者權限）" -ForegroundColor DarkGray
Write-Host "  服務帳戶電子郵件可在 google-credentials.json 的 client_email 欄位找到" -ForegroundColor DarkGray
Write-Host ""

$historyId = Get-EnvValue "HISTORY_SHEET_ID"
if (-not $historyId -or $historyId -eq "your_history_sheet_id_here") {
    Write-Host "  請先建立一份新的空白 Google 試算表作為點歌紀錄。" -ForegroundColor DarkGray
    Write-Host "  建立後，點擊右上角 [共用] -> 貼上服務帳戶電子郵件（格式如：" -ForegroundColor DarkGray
    Write-Host "  xxx@your-project.iam.gserviceaccount.com，可在 google-credentials.json 中的 client_email 欄位找到）" -ForegroundColor DarkGray
    Write-Host "  -> 設為編輯者 -> 共用" -ForegroundColor DarkGray
    $historyId = Ask "貼上點歌紀錄試算表 ID（可按 Enter 略過）"
    if ($historyId) { Set-EnvValue "HISTORY_SHEET_ID" $historyId }
}
if ($historyId) { Write-OK "點歌紀錄試算表 ID 已儲存" }

# ---- Step 7: ngrok -------------------------------------------------------
Write-Header "步驟 7 - ngrok 設定"
$ngrokPath = ""
if (Get-Command ngrok -ErrorAction SilentlyContinue) {
    $ngrokPath = "ngrok"
    Write-OK "在系統路徑找到 ngrok"
} elseif (Test-Path "C:
grok
grok.exe") {
    $ngrokPath = "C:
grok
grok.exe"
    Write-OK "在 C:
grok
grok.exe 找到 ngrok"
} else {
    Write-Warn "找不到 ngrok，請至 https://ngrok.com/download 下載並解壓縮至 C:
grok"
}

if ($ngrokPath) {
    Write-Host "  Authtoken 是 ngrok 帳號的驗證金鑰，取得方式如下：" -ForegroundColor DarkGray
    Write-Host "  1. 前往 https://ngrok.com 註冊免費帳號" -ForegroundColor DarkGray
    Write-Host "  2. 登入後前往 https://dashboard.ngrok.com/authtokens" -ForegroundColor DarkGray
    Write-Host "  3. 複製頁面上的 Authtoken" -ForegroundColor DarkGray
    Write-Host ""
    $ngrokToken = Ask "貼上你的 ngrok Authtoken"
    if ($ngrokToken) {
        & $ngrokPath config add-authtoken $ngrokToken
        Write-OK "ngrok Authtoken 設定完成"
    }
    Set-EnvValue "NGROK_PATH" $ngrokPath
}

# ---- Done ----------------------------------------------------------------
Write-Header "安裝完成"
Write-OK ".env 設定完成"
Write-OK "npm 套件已安裝"
Write-Host ""
Write-Host "  每次直播開始時，執行：" -ForegroundColor White
Write-Host "  .\start_zh.ps1" -ForegroundColor Cyan
Write-Host ""
Pause-Key
