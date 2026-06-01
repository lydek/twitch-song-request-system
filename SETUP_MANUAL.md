# 🎵 VTuber Song Queue — Manual Setup Guide

> This guide is for those who prefer to set up everything manually without scripts.
> If you prefer an automated setup, use `setup.ps1` and `start.ps1` instead — see `SETUP.md`.

---

## How it works

```
Viewer redeems Channel Points (Song Request or Random Song)
        ↓
Twitch webhook → your server (via ngrok tunnel)
        ↓
🎵 Song Request: fuzzy-match → queue or Pending (dashboard)
🎲 Random Song: weighted random pick from your sheet
        ↓
OBS overlay updates live via WebSocket
        ↓
Request recorded in history Google Sheet
```

---

## Prerequisites

- **Node.js LTS** → https://nodejs.org (check "Add to PATH" during install)
- **ngrok** → https://ngrok.com/download (sign up for free, unzip to `C:\ngrok\`)

---

## Step 1 — Install

```powershell
cd vtuber-song-queue
npm install
copy .env.example .env
```

---

## Step 2 — Google Cloud setup

You need a **Service Account** so the server can read/write your Google Sheets.

1. Go to https://console.cloud.google.com → create a new project (e.g. `song-queue`)
2. Search bar → **Google Sheets API** → **Enable**
3. Left sidebar → **IAM & Admin → Service Accounts → + Create Service Account**
4. Give it any name → click **Done**
5. Click the service account → **Keys** tab → **Add Key → Create new key → JSON**
6. A file downloads — **rename it `google-credentials.json`** and place it in the project root

---

## Step 3 — Google Sheets

### Song list sheet

Your existing sheet with songs. The server reads it at startup and every 5 minutes.

- Must have a header row with at least a title column and an artist column
- Column names must match `SHEET_SONG_COLUMN` and `SHEET_ARTIST_COLUMN` in `.env`
- Optional: a `key` column with numeric values (e.g. `3`, `-2`) for key transposition display
- Share the sheet with your service account email → **Viewer** access

**Example sheet layout:**

| title | artist | key |
|---|---|---|
| シャルル | バルーン | 0 |
| ロキ | みきとP | -2 |
| Ghost Rule | DECO*27 | 3 |

**Tabs:** All tabs are included except those listed in `EXCLUDED_TABS` in `server/config.js`.
The tab `待練勿點` is excluded by default — add others as needed.

### History sheet

A separate **blank** sheet for request history tracking.

- Create a new blank Google Sheet (no headers needed — the server creates them)
- Share it with your service account email → **Editor** access (needs write permission)
- Copy the sheet ID into `.env` as `HISTORY_SHEET_ID`

### Getting a Sheet ID

Open the sheet in your browser. The ID is the long string in the URL:
```
https://docs.google.com/spreadsheets/d/THIS_PART_HERE/edit
```

---

## Step 4 — Twitch app credentials

1. Go to https://dev.twitch.tv/console/apps → **Register Your Application**
   - Name: anything (e.g. `Song Queue Bot`)
   - OAuth Redirect URL: `http://localhost`
   - Category: **Other**
2. Click **Manage** → copy **Client ID**
3. Click **New Secret** → copy the **Client Secret** (shown once only)
4. Paste both into `.env`

### Get your Broadcaster ID

Go to https://streamweasels.com/tools/convert-twitch-username-to-user-id/ and enter your Twitch username. Paste the number into `.env` as `TWITCH_BROADCASTER_ID`.

### Get a User Token

Paste this URL into your browser while logged in as your broadcaster account (replace `YOUR_CLIENT_ID`):

```
https://id.twitch.tv/oauth2/authorize?client_id=YOUR_CLIENT_ID&redirect_uri=http://localhost&response_type=token&scope=channel:read:redemptions+channel:manage:redemptions
```

Click **Authorize**. Your browser redirects to `http://localhost` (fails to load — that's fine).
Copy the token from the URL bar between `access_token=` and `&token_type`.

### Create Channel Points rewards

Go to your Twitch Dashboard → **Viewer Rewards → Channel Points → Manage Rewards → +**

**🎵 Song Request**
- Set a point cost
- ✅ Check **"Require Viewer to Enter Text"**
- Prompt: e.g. `Type a song title to request!`

**🎲 Random Song**
- Set a point cost
- ❌ No text input needed

### Get reward IDs

```powershell
curl.exe "https://api.twitch.tv/helix/channel_points/custom_rewards?broadcaster_id=YOUR_BROADCASTER_ID" `
  -H "Client-Id: YOUR_CLIENT_ID" `
  -H "Authorization: Bearer YOUR_USER_TOKEN"
```

Copy the `id` field for each reward into `.env` as `TWITCH_REWARD_ID` and `TWITCH_RANDOM_REWARD_ID`.

---

## Step 5 — Fill in `.env`

Open `.env` and fill in all values. See `.env.example` for descriptions of each field.

Your `TWITCH_WEBHOOK_SECRET` can be any random string you make up.

---

## Step 6 — ngrok

Twitch needs a public HTTPS URL to send webhooks to your local server.

```powershell
C:\ngrok\ngrok.exe config add-authtoken YOUR_NGROK_TOKEN
```

Then each stream, in a **separate terminal**:

```powershell
C:\ngrok\ngrok.exe http 3000
```

Copy the `https://xxxx.ngrok-free.app` URL → paste into `.env` as `PUBLIC_URL`.

> **Tip:** ngrok free plan gives a new URL each restart. To avoid updating `.env` every stream,
> set up a free static domain at https://dashboard.ngrok.com/domains.

---

## Step 7 — Streamlabs / OBS Browser Source

1. Add Source → **Browser**
2. URL: `http://localhost:3000/overlay/index.html`
3. Width: `960`, Height: `800` (renders crisp at 2×, scale down in your scene)
4. Custom CSS:
   ```css
   body { background-color: rgba(0, 0, 0, 0) !important; margin: 0px auto; overflow: hidden; }
   ```
5. Uncheck **"Shutdown source when not visible"**

---

## Step 8 — Run it

After updating `PUBLIC_URL` in `.env`, start the server:

```powershell
npm start
```

Expected output:
```
🎵 VTuber Song Queue starting...
[sheets] Loaded 180 songs from Google Sheet (3 tabs)
[history] Loaded 42 songs from history sheet
[twitch] EventSub subscription registered!
✅ Server running at http://localhost:3000
   Overlay URL:  http://localhost:3000/overlay/index.html
   Dashboard:    http://localhost:3000/dashboard
[webhook] Verification challenge received — subscription confirmed!
```

---

## Every-stream startup

1. **Terminal 1** — start ngrok, copy the URL, update `PUBLIC_URL` in `.env`
2. **Terminal 2** — `npm start`
3. **Browser** — open `http://localhost:3000/dashboard`

---

## Testing without going live

```powershell
# Add a song manually
$body = [System.Text.Encoding]::UTF8.GetBytes('{"title":"シャルル","requester":"test"}')
Invoke-RestMethod -Method Post -Uri http://localhost:3000/api/add -ContentType "application/json; charset=utf-8" -Body $body

# Skip current song
Invoke-RestMethod -Method Post -Uri http://localhost:3000/api/skip

# Clear the queue
Invoke-RestMethod -Method Post -Uri http://localhost:3000/api/clear

# View current queue
Invoke-RestMethod -Uri http://localhost:3000/api/queue

# Force refresh song list
Invoke-RestMethod -Method Post -Uri http://localhost:3000/api/refresh-songs
```

---

## Configuration

| File | What to change |
|---|---|
| `.env` | Credentials, IDs, URLs — see `.env.example` for descriptions |
| `server/config.js` | Matching thresholds, excluded tabs, scroll speed, random weights |
| `overlay/index.html` | CSS variables at top — font sizes, list height |

---

## How matching works

| Result | Action |
|---|---|
| ≥ 80% confidence | Auto-added to queue |
| < 80% confidence | Sent to Pending with suggested match |
| No match | Sent to Pending, blank for manual entry |

Tune in `server/config.js`: `AUTO_ACCEPT_THRESHOLD`, `MATCH_THRESHOLD` (0.2 stricter / 0.6 looser).

---

## Random song modes

Set `RANDOM_PICK_MODE` in `.env`:
- `weighted` — favors songs not played recently (recommended)
- `pure` — truly random

Fine-tune weights in `server/config.js` (`RANDOM_NEVER_REQUESTED_WEIGHT`, `RANDOM_MAX_DAYS_WEIGHT`).

---

## File structure

```
vtuber-song-queue/
├── setup.ps1                 ← automated setup wizard
├── start.ps1                 ← automated stream startup
├── .env                      ← secrets (never commit!)
├── .env.example              ← template with descriptions
├── google-credentials.json   ← service account key (never commit!)
├── song-cache.json           ← auto-generated, safe to delete
├── server/
│   ├── index.js              ← main server
│   ├── config.js             ← tuneable behaviour settings
│   ├── sheets.js             ← song list reader
│   ├── matcher.js            ← fuzzy matching
│   ├── queue.js              ← queue state + WebSocket
│   ├── twitch.js             ← EventSub + webhook auth
│   ├── history.js            ← request history writer
│   └── random.js             ← random song picker
├── overlay/
│   └── index.html            ← OBS browser source
└── dashboard/
    └── index.html            ← streamer control panel
```

---

## Tips

- Song list **auto-refreshes every 5 minutes** — no restart needed after adding songs
- History sheet **updates within ~2 seconds** of each request
- If ngrok URL changes: update `PUBLIC_URL` in `.env` and restart — the server auto-deletes the old EventSub subscription
- For **permanent hosting** (no ngrok ever): deploy to Railway or Render
