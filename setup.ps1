# ============================================================
#  VTuber Song Queue — First-time Setup Wizard
#  Run once: Right-click → "Run with PowerShell"
# ============================================================

$ErrorActionPreference = "Stop"
$HOST.UI.RawUI.WindowTitle = "VTuber Song Queue Setup"

function Write-Header($text) {
    Write-Host ""
    Write-Host "  ======================================" -ForegroundColor DarkMagenta
    Write-Host "  $text" -ForegroundColor Magenta
    Write-Host "  ======================================" -ForegroundColor DarkMagenta
    Write-Host ""
}

function Write-Step($text)  { Write-Host "  >> $text" -ForegroundColor Cyan }
function Write-OK($text)    { Write-Host "  [OK] $text" -ForegroundColor Green }
function Write-Warn($text)  { Write-Host "  [!] $text" -ForegroundColor Yellow }
function Write-Err($text)   { Write-Host "  [X] $text" -ForegroundColor Red }
function Ask($prompt)       { Write-Host "  --> $prompt" -ForegroundColor White -NoNewline; return (Read-Host " ") }
function Pause-Key           { Write-Host "  Press any key to continue..." -ForegroundColor DarkGray; $null = $Host.UI.RawUI.ReadKey("NoEcho,IncludeKeyDown") }

Clear-Host
Write-Host ""
Write-Host "  VTuber Song Queue - Setup Wizard" -ForegroundColor Magenta
Write-Host "  --------------------------------------" -ForegroundColor DarkMagenta
Write-Host ""

# ── Check Node.js ────────────────────────────────────────────────────────────
Write-Header "Step 1 — Checking Prerequisites"
Write-Step "Checking Node.js..."
try {
    $nodeVer = node --version 2>&1
    Write-OK "Node.js found: $nodeVer"
} catch {
    Write-Err "Node.js not found. Please install from https://nodejs.org (LTS version)"
    Write-Host "  After installing, re-run this script." -ForegroundColor Yellow
    Pause-Key; exit 1
}

# ── npm install ───────────────────────────────────────────────────────────────
Write-Step "Installing npm packages..."
npm install --silent
Write-OK "npm packages installed"

# ── Check/create .env ─────────────────────────────────────────────────────────
Write-Header "Step 2 — Configuration"
$envPath = Join-Path $PSScriptRoot ".env"
if (-not (Test-Path $envPath)) {
    Copy-Item (Join-Path $PSScriptRoot ".env.example") $envPath
    Write-OK "Created .env from template"
} else {
    Write-Warn ".env already exists — will update missing values only"
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

# ── Twitch credentials ────────────────────────────────────────────────────────
Write-Header "Step 3 — Twitch App Credentials"
Write-Host "  Go to: https://dev.twitch.tv/console/apps" -ForegroundColor DarkCyan
Write-Host "  Register an app (Name: anything, Redirect: http://localhost, Category: Other)" -ForegroundColor DarkGray
Write-Host ""

$clientId = Get-EnvValue "TWITCH_CLIENT_ID"
if (-not $clientId -or $clientId -eq "your_client_id_here") {
    $clientId = Ask "Paste your Client ID"
    Set-EnvValue "TWITCH_CLIENT_ID" $clientId
}
Write-OK "Client ID: $clientId"

$clientSecret = Get-EnvValue "TWITCH_CLIENT_SECRET"
if (-not $clientSecret -or $clientSecret -eq "your_client_secret_here") {
    Write-Host "  On the same page click [New Secret] — copy it immediately, it will only be shown once." -ForegroundColor DarkGray
    $clientSecret = Ask "Paste your Client Secret"
    Set-EnvValue "TWITCH_CLIENT_SECRET" $clientSecret
}
Write-OK "Client Secret saved"

# ── Get app token ─────────────────────────────────────────────────────────────
Write-Step "Getting Twitch app token..."
try {
    $tokenRes = Invoke-RestMethod -Method Post `
        -Uri "https://id.twitch.tv/oauth2/token?client_id=$clientId`&client_secret=$clientSecret`&grant_type=client_credentials"
    $appToken = $tokenRes.access_token
    Write-OK "App token obtained"
} catch {
    Write-Err "Failed to get app token. Check your Client ID and Secret."
    Pause-Key; exit 1
}

# ── Get broadcaster ID ────────────────────────────────────────────────────────
Write-Header "Step 4 — Broadcaster ID"
$broadcasterId = Get-EnvValue "TWITCH_BROADCASTER_ID"
if (-not $broadcasterId -or $broadcasterId -eq "your_numeric_user_id_here") {
    $username = Ask "Enter your Twitch username"
    try {
        $userRes = Invoke-RestMethod -Uri "https://api.twitch.tv/helix/users?login=$username" `
            -Headers @{ "Client-Id" = $clientId; "Authorization" = "Bearer $appToken" }
        $broadcasterId = $userRes.data[0].id
        Set-EnvValue "TWITCH_BROADCASTER_ID" $broadcasterId
        Write-OK "Broadcaster ID: $broadcasterId ($($userRes.data[0].display_name))"
    } catch {
        Write-Err "Could not find Twitch user '$username'"
        Pause-Key; exit 1
    }
} else {
    Write-OK "Broadcaster ID already set: $broadcasterId"
}

# ── Webhook secret ────────────────────────────────────────────────────────────
$webhookSecret = Get-EnvValue "TWITCH_WEBHOOK_SECRET"
if (-not $webhookSecret -or $webhookSecret -eq "make_up_any_random_string_here") {
    # Generate ASCII-only secret to avoid any encoding issues
    $chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789"
    $webhookSecret = -join (1..32 | ForEach-Object { $chars[(Get-Random -Maximum $chars.Length)] })
    Set-EnvValue "TWITCH_WEBHOOK_SECRET" $webhookSecret
    # Verify it was written correctly
    $verify = Get-EnvValue "TWITCH_WEBHOOK_SECRET"
    if ($verify -ne $webhookSecret) {
        Write-Warn "Webhook secret write verification failed. Please manually set TWITCH_WEBHOOK_SECRET= in .env (any alphanumeric string)"
    } else {
        Write-OK "Webhook secret generated and verified"
    }
}

# ── Channel Points rewards ────────────────────────────────────────────────────
Write-Header "Step 5 — Channel Points Rewards"
Write-Host "  You need a User Token (not the app token) to create rewards." -ForegroundColor DarkGray
Write-Host ""
Write-Host "  Open this URL in your browser while logged in as your broadcaster account:" -ForegroundColor DarkCyan
Write-Host "  https://id.twitch.tv/oauth2/authorize?client_id=$clientId`&redirect_uri=http://localhost`&response_type=token`&scope=channel:read:redemptions+channel:manage:redemptions" -ForegroundColor DarkCyan
Write-Host ""
Write-Host "  After clicking Authorize, copy the token from the URL bar" -ForegroundColor DarkGray
Write-Host "  (between access_token= and `&token_type)" -ForegroundColor DarkGray
Write-Host ""
$userToken = Ask "Paste your User Token"

$rewardHeaders = @{ "Client-Id" = $clientId; "Authorization" = "Bearer $userToken"; "Content-Type" = "application/json" }

# Check existing rewards
try {
    $existingRewards = Invoke-RestMethod `
        -Uri "https://api.twitch.tv/helix/channel_points/custom_rewards?broadcaster_id=$broadcasterId" `
        -Headers $rewardHeaders
} catch {
    Write-Warn "Could not fetch existing rewards (channel may not be Affiliate yet)"
    $existingRewards = @{ data = @() }
}

# Song Request reward
$rewardId = Get-EnvValue "TWITCH_REWARD_ID"
if (-not $rewardId -or $rewardId -eq "your_song_request_reward_id_here") {
    $existing = $existingRewards.data | Where-Object { $_.title -like "*Song Request*" -or $_.title -like "*點歌*" }
    if ($existing) {
        $rewardId = $existing[0].id
        Write-OK "Found existing Song Request reward: '$($existing[0].title)'"
    } else {
        Write-Step "Creating 🎵 Song Request reward..."
        $body = '{"title":"🎵 Song Request","cost":500,"is_user_input_required":true,"prompt":"Type a song title to request!"}'
        try {
            $newReward = Invoke-RestMethod -Method Post `
                -Uri "https://api.twitch.tv/helix/channel_points/custom_rewards?broadcaster_id=$broadcasterId" `
                -Headers $rewardHeaders -Body $body
            $rewardId = $newReward.data[0].id
            Write-OK "Created 🎵 Song Request reward (500 points)"
        } catch {
            Write-Warn "Could not create reward automatically. To create it manually:"
            Write-Host "  Go to https://dashboard.twitch.tv -> Viewer Rewards -> Channel Points -> Manage Rewards -> +" -ForegroundColor DarkGray
            Write-Host "  Name: Song Request, check [Require Viewer to Enter Text]" -ForegroundColor DarkGray
            $rewardId = Ask "Paste the Song Request reward ID (or press Enter to skip)"
        }
    }
    Set-EnvValue "TWITCH_REWARD_ID" $rewardId
}
Write-OK "Song Request reward ID: $rewardId"

# Random Song reward
$randomRewardId = Get-EnvValue "TWITCH_RANDOM_REWARD_ID"
if (-not $randomRewardId -or $randomRewardId -eq "your_random_reward_id_here") {
    $existing = $existingRewards.data | Where-Object { $_.title -like "*Random*" -or $_.title -like "*隨機*" }
    if ($existing) {
        $randomRewardId = $existing[0].id
        Write-OK "Found existing Random Song reward: '$($existing[0].title)'"
    } else {
        Write-Step "Creating 🎲 Random Song reward..."
        $body = '{"title":"🎲 Random Song","cost":300,"is_user_input_required":false}'
        try {
            $newReward = Invoke-RestMethod -Method Post `
                -Uri "https://api.twitch.tv/helix/channel_points/custom_rewards?broadcaster_id=$broadcasterId" `
                -Headers $rewardHeaders -Body $body
            $randomRewardId = $newReward.data[0].id
            Write-OK "Created 🎲 Random Song reward (300 points)"
        } catch {
            Write-Warn "Could not create reward automatically. To create it manually:"
            Write-Host "  Go to https://dashboard.twitch.tv -> Viewer Rewards -> Channel Points -> Manage Rewards -> +" -ForegroundColor DarkGray
            Write-Host "  Name: Random Song, no text input needed" -ForegroundColor DarkGray
            $randomRewardId = Ask "Paste the Random Song reward ID (or press Enter to skip)"
        }
    }
    Set-EnvValue "TWITCH_RANDOM_REWARD_ID" $randomRewardId
}
Write-OK "Random Song reward ID: $randomRewardId"

# ── Google Sheets ─────────────────────────────────────────────────────────────
Write-Header "Step 6 — Google Sheets"

$credPath = Join-Path $PSScriptRoot "google-credentials.json"
if (-not (Test-Path $credPath)) {
    Write-Host "  No google-credentials.json found." -ForegroundColor Yellow
    Write-Host "  Follow these steps:" -ForegroundColor DarkGray
    Write-Host "    1. Go to https://console.cloud.google.com" -ForegroundColor DarkGray
    Write-Host "    2. Enable Google Sheets API" -ForegroundColor DarkGray
    Write-Host "    3. IAM `& Admin -> Service Accounts -> Create -> Keys -> JSON" -ForegroundColor DarkGray
    Write-Host "    4. Rename the downloaded file to google-credentials.json" -ForegroundColor DarkGray
    Write-Host "    5. Place it in: $PSScriptRoot" -ForegroundColor DarkGray
    Write-Host ""
    Pause-Key
    if (-not (Test-Path $credPath)) {
        Write-Warn "google-credentials.json still not found — you can add it later"
    } else {
        Write-OK "google-credentials.json found!"
    }
} else {
    Write-OK "google-credentials.json found"
}

$sheetId = Get-EnvValue "GOOGLE_SHEET_ID"
if (-not $sheetId -or $sheetId -eq "your_sheet_id_here") {
    Write-Host "  Your sheet URL looks like:" -ForegroundColor DarkGray
    Write-Host "  https://docs.google.com/spreadsheets/d/THIS_PART/edit" -ForegroundColor DarkCyan
    $sheetId = Ask "Paste your Song List Sheet ID"
    Set-EnvValue "GOOGLE_SHEET_ID" $sheetId
}
Write-OK "Song list sheet ID saved"

$songCol = Get-EnvValue "SHEET_SONG_COLUMN"
if (-not $songCol -or $songCol -eq "title") {
    Write-Host "  Enter the column header in your sheet that contains song titles (row 1)." -ForegroundColor DarkGray
    Write-Host "  e.g. title, song, 曲名 (default: title)" -ForegroundColor DarkGray
    $input = Ask "Song title column name (press Enter to use default: title)"
    if ($input) { Set-EnvValue "SHEET_SONG_COLUMN" $input } else { Set-EnvValue "SHEET_SONG_COLUMN" "title" }
    $songCol = if ($input) { $input } else { "title" }
}
Write-OK "Song title column: $songCol"

$artistCol = Get-EnvValue "SHEET_ARTIST_COLUMN"
if (-not $artistCol -or $artistCol -eq "artist") {
    Write-Host "  Enter the column header for artist names. (default: artist)" -ForegroundColor DarkGray
    $input = Ask "Artist column name (press Enter to use default: artist)"
    if ($input) { Set-EnvValue "SHEET_ARTIST_COLUMN" $input } else { Set-EnvValue "SHEET_ARTIST_COLUMN" "artist" }
    $artistCol = if ($input) { $input } else { "artist" }
}
Write-OK "Artist column: $artistCol"

Write-Host "  Note: the key (transposition) column must be named exactly 'key' in your sheet." -ForegroundColor DarkGray

$historyId = Get-EnvValue "HISTORY_SHEET_ID"
if (-not $historyId -or $historyId -eq "your_history_sheet_id_here") {
    Write-Host "  Create a new blank Google Sheet for request history." -ForegroundColor DarkGray
    Write-Host "  Then share it: click [Share] in the sheet, paste your service account email" -ForegroundColor DarkGray
    Write-Host "  (find it in google-credentials.json under client_email), set role to Editor." -ForegroundColor DarkGray
    $historyId = Ask "Paste your History Sheet ID (or press Enter to skip)"
    if ($historyId) { Set-EnvValue "HISTORY_SHEET_ID" $historyId }
}
if ($historyId) { Write-OK "History sheet ID saved" }

# ── ngrok ─────────────────────────────────────────────────────────────────────
Write-Header "Step 7 — ngrok"
Write-Step "Checking ngrok..."
$ngrokPath = ""
if (Get-Command ngrok -ErrorAction SilentlyContinue) {
    $ngrokPath = "ngrok"
    Write-OK "ngrok found in PATH"
} elseif (Test-Path "C:\ngrok\ngrok.exe") {
    $ngrokPath = "C:\ngrok\ngrok.exe"
    Write-OK "ngrok found at C:\ngrok\ngrok.exe"
} else {
    Write-Warn "ngrok not found. Download from https://ngrok.com/download"
    Write-Host "  Unzip to C:/ngrok/ and run this script again, or add ngrok to PATH." -ForegroundColor DarkGray
}

if ($ngrokPath) {
    Write-Host "  The authtoken authenticates your ngrok account. To get one:" -ForegroundColor DarkGray
    Write-Host "  1. Sign up for a free account at https://ngrok.com" -ForegroundColor DarkGray
    Write-Host "  2. Go to https://dashboard.ngrok.com/authtokens after logging in" -ForegroundColor DarkGray
    Write-Host "  3. Copy the authtoken shown on that page" -ForegroundColor DarkGray
    Write-Host ""
    $ngrokToken = Ask "Paste your ngrok authtoken"
    if ($ngrokToken) {
        & $ngrokPath config add-authtoken $ngrokToken
        Write-OK "ngrok authtoken configured"
    }
    # Save ngrok path to .env for use by start.ps1
    Set-EnvValue "NGROK_PATH" $ngrokPath
}

# ── Done ──────────────────────────────────────────────────────────────────────
Write-Header "Setup Complete! 🎉"
Write-OK ".env is configured"
Write-OK "npm packages installed"
Write-Host ""
Write-Host "  To start streaming, run:" -ForegroundColor White
Write-Host "  .\start.ps1" -ForegroundColor Cyan
Write-Host ""
Pause-Key
