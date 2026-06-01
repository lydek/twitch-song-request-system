# ============================================================
#  VTuber 點歌系統 — 直播啟動腳本
#  每次直播開始時執行：對檔案按右鍵 -> 以 PowerShell 執行
# ============================================================

$ErrorActionPreference = "Stop"
$HOST.UI.RawUI.WindowTitle = "VTuber 點歌系統"
chcp 65001 | Out-Null

function Write-Step($text) { Write-Host "  >> $text" -ForegroundColor Cyan }
function Write-OK($text)   { Write-Host "  [OK] $text" -ForegroundColor Green }
function Write-Warn($text) { Write-Host "  [!] $text" -ForegroundColor Yellow }
function Write-Err($text)  { Write-Host "  [X] $text" -ForegroundColor Red }

function Get-EnvValue($key) {
    $envPath = Join-Path $PSScriptRoot ".env"
    $lines = [System.IO.File]::ReadAllLines($envPath, [System.Text.UTF8Encoding]::new($false))
    $line = $lines | Where-Object { $_ -match "^$key=" }
    if ($line) { return ($line -split "=", 2)[1].Trim() }
    return ""
}

function Set-EnvValue($key, $value) {
    $envPath = Join-Path $PSScriptRoot ".env"
    $content = [System.IO.File]::ReadAllText($envPath, [System.Text.UTF8Encoding]::new($false))
    if ($content -match "(?m)^$key=.*$") {
        $content = $content -replace "(?m)^$key=.*$", "$key=$value"
    } else {
        $content += "`n$key=$value"
    }
    [System.IO.File]::WriteAllText($envPath, $content, [System.Text.UTF8Encoding]::new($false))
}

Clear-Host
Write-Host ""
Write-Host "  VTuber 點歌系統 - 啟動中..." -ForegroundColor Magenta
Write-Host "  --------------------------------------" -ForegroundColor DarkMagenta
Write-Host ""

# -- 尋找 ngrok ------------------------------------------------------------------
$ngrokPath = Get-EnvValue "NGROK_PATH"
if (-not $ngrokPath -or -not (Test-Path $ngrokPath -ErrorAction SilentlyContinue)) {
    if (Get-Command ngrok -ErrorAction SilentlyContinue) { $ngrokPath = "ngrok" }
    elseif (Test-Path "C:\ngrok\ngrok.exe") { $ngrokPath = "C:\ngrok\ngrok.exe" }
    else {
        Write-Err "找不到 ngrok。"
        Write-Host "  請先執行 setup_zh.ps1，或至 https://ngrok.com/download 下載" -ForegroundColor DarkGray
        Write-Host "  並解壓縮至 C:/ngrok/ 目錄。" -ForegroundColor DarkGray
        Read-Host "按 Enter 離開"; exit 1
    }
}

# -- 啟動 ngrok ------------------------------------------------------------------
Write-Step "啟動 ngrok..."
$ngrokJob = Start-Process -FilePath $ngrokPath -ArgumentList "http 3000" -PassThru -WindowStyle Minimized

# 等待 ngrok 啟動並取得公開網址
$ngrokUrl = ""
$attempts = 0
while (-not $ngrokUrl -and $attempts -lt 20) {
    Start-Sleep -Milliseconds 500
    $attempts++
    try {
        $tunnels = Invoke-RestMethod -Uri "http://localhost:4040/api/tunnels" -ErrorAction SilentlyContinue
        $ngrokUrl = ($tunnels.tunnels | Where-Object { $_.proto -eq "https" })[0].public_url
    } catch {}
}

if (-not $ngrokUrl) {
    Write-Err "無法取得 ngrok 網址。"
    Write-Host "  可能原因：" -ForegroundColor DarkGray
    Write-Host "  - ngrok 尚未完成身份驗證，請執行 setup_zh.ps1 設定 Authtoken。" -ForegroundColor DarkGray
    Write-Host "  - 連接埠 3000 或 4040 已被其他程式佔用。" -ForegroundColor DarkGray
    Read-Host "按 Enter 離開"; exit 1
}

Write-OK "ngrok 網址：$ngrokUrl"

# -- 更新 .env -------------------------------------------------------------------
Set-EnvValue "PUBLIC_URL" $ngrokUrl
Write-OK "已更新 .env 中的 PUBLIC_URL"

# -- 啟動伺服器 ------------------------------------------------------------------
Write-Step "啟動伺服器..."
Write-Host ""
Write-Host "  ---------------------------------------------" -ForegroundColor DarkMagenta
Write-Host "  控制台：http://localhost:3000/dashboard" -ForegroundColor White
Write-Host "  顯示層：http://localhost:3000/overlay/index.html" -ForegroundColor White
Write-Host "  ---------------------------------------------" -ForegroundColor DarkMagenta
Write-Host ""
Write-Host "  直播結束後按 Ctrl+C 停止伺服器。" -ForegroundColor DarkGray
Write-Host ""

Set-Location $PSScriptRoot
npm start
