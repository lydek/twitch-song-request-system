# ============================================================
#  VTuber Song Queue — Stream Startup
#  Run every stream: Right-click → "Run with PowerShell"
# ============================================================

$ErrorActionPreference = "Stop"
$HOST.UI.RawUI.WindowTitle = "VTuber Song Queue"

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
Write-Host "  VTuber Song Queue - Starting..." -ForegroundColor Magenta
Write-Host "  --------------------------------------" -ForegroundColor DarkMagenta
Write-Host ""

# ── Find ngrok ────────────────────────────────────────────────────────────────
$ngrokPath = Get-EnvValue "NGROK_PATH"
if (-not $ngrokPath -or -not (Test-Path $ngrokPath -ErrorAction SilentlyContinue)) {
    if (Get-Command ngrok -ErrorAction SilentlyContinue) { $ngrokPath = "ngrok" }
    elseif (Test-Path "C:\ngrok\ngrok.exe") { $ngrokPath = "C:\ngrok\ngrok.exe" }
    else {
        Write-Err "ngrok not found."
        Write-Host "  Run setup.ps1 first, or download ngrok from https://ngrok.com/download" -ForegroundColor DarkGray
        Write-Host "  and unzip it to C:/ngrok/" -ForegroundColor DarkGray
        Read-Host "Press Enter to exit"; exit 1
    }
}

# ── Start ngrok ───────────────────────────────────────────────────────────────
Write-Step "Starting ngrok..."
$ngrokJob = Start-Process -FilePath $ngrokPath -ArgumentList "http 3000" -PassThru -WindowStyle Minimized

# Wait for ngrok to start and get the public URL
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
    Write-Err "Could not get ngrok URL."
    Write-Host "  Possible causes:" -ForegroundColor DarkGray
    Write-Host "  - ngrok is not authenticated. Run setup.ps1 to configure your authtoken." -ForegroundColor DarkGray
    Write-Host "  - Another process is already using port 3000 or port 4040." -ForegroundColor DarkGray
    Read-Host "Press Enter to exit"; exit 1
}

Write-OK "ngrok URL: $ngrokUrl"

# ── Update .env ───────────────────────────────────────────────────────────────
Set-EnvValue "PUBLIC_URL" $ngrokUrl
Write-OK "Updated PUBLIC_URL in .env"

# ── Start server ──────────────────────────────────────────────────────────────
Write-Step "Starting server..."
Write-Host ""
Write-Host "  --------------------------------------───────" -ForegroundColor DarkMagenta
Write-Host "  Dashboard: http://localhost:3000/dashboard" -ForegroundColor White
Write-Host "  Overlay:   http://localhost:3000/overlay/index.html" -ForegroundColor White
Write-Host "  --------------------------------------───────" -ForegroundColor DarkMagenta
Write-Host ""
Write-Host "  Press Ctrl+C to stop the server when done streaming." -ForegroundColor DarkGray
Write-Host ""

Set-Location $PSScriptRoot
npm start
