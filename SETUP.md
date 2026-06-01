# 🎵 VTuber Song Queue — Setup Guide

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

Install these before running the setup script:

- **Node.js LTS** → https://nodejs.org (check "Add to PATH")
- **ngrok** → https://ngrok.com/download (sign up free, unzip to `C:\ngrok\`)

---

## First-time setup

```powershell
.\setup.ps1        # English
.\setup_zh.ps1     # Traditional Chinese / 繁體中文
```

The script walks you through everything interactively:

1. Installs npm packages
2. Asks for your Twitch Client ID & Secret → gets tokens automatically
3. Looks up your Broadcaster ID from your username
4. Creates the 🎵 Song Request and 🎲 Random Song Channel Points rewards automatically
5. Asks for your Google Sheet IDs
6. Configures ngrok authtoken
7. Writes everything to `.env`

The only manual step it can't do for you is the **Google Service Account** — follow this once:

1. https://console.cloud.google.com → new project → enable **Google Sheets API**
2. **IAM & Admin → Service Accounts → Create** → **Keys → JSON**
3. Rename the downloaded file to **`google-credentials.json`** → place in project root
4. Share your **song list sheet** (Viewer) and **history sheet** (Editor) with the service account email

---

## Every stream

```powershell
.\start.ps1        # English
.\start_zh.ps1     # Traditional Chinese / 繁體中文
```

That's it. The script:
- Starts ngrok and reads the public URL automatically
- Updates `PUBLIC_URL` in `.env`
- Starts the server

Then open **http://localhost:3000/dashboard** in your browser.

---

## Google Sheets setup

### Song list sheet
Your existing sheet with songs. All tabs are included except those in `EXCLUDED_TABS` (`server/config.js`).

Header row must have at minimum:

| title | artist | key |
|---|---|---|
| シャルル | バルーン | 0 |
| ロキ | みきとP | -2 |

Column names must match `SHEET_SONG_COLUMN` / `SHEET_ARTIST_COLUMN` in `.env`.
`key` column is optional — must be numeric. Non-numeric values are ignored.

### History sheet
A separate blank sheet. The server creates headers automatically on first run.
Share with service account email → **Editor** access.

---

## Configuration

| File | What to change |
|---|---|
| `.env` | Credentials, IDs, URLs — see `.env.example` for descriptions |
| `server/config.js` | Matching thresholds, excluded tabs, scroll speed, random weights |
| `overlay/index.html` | CSS variables at top — font sizes, list height |

---

## Dashboard

Open `http://localhost:3000/dashboard` during streams.

| Feature | Description |
|---|---|
| 4 columns | Now Playing · Up Next · Played · Pending Review |
| Drag & drop | Move songs between columns or reorder within |
| ✓ Finished | Moves Now Playing → Played, pulls next song |
| Pending column | Weak/unmatched requests — edit and accept manually |
| Manual request bar | Add songs without Channel Points |
| History info | Each card shows last request date and requester |
| Key circle | Shows transposition value (+3, -2, etc.) |

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

Songs already in queue/Now Playing are always excluded.

---

## File structure

```
vtuber-song-queue/
├── setup.ps1                 ← run once for first-time setup
├── start.ps1                 ← run every stream
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
- If ngrok URL changes: just run `.\start.ps1` again — it updates `.env` automatically
- For **permanent hosting** (no ngrok ever): deploy to Railway or Render
