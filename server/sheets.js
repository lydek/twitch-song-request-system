// server/sheets.js
// Reads your song list from ALL tabs in Google Sheets (except excluded ones)
// and caches it locally.

const { google } = require('googleapis');
const config = require('./config');
const path = require('path');
const fs = require('fs');

const isPkg = typeof process.pkg !== 'undefined';
const baseDir = isPkg ? path.dirname(process.execPath) : path.join(__dirname, '..');

const CREDENTIALS_PATH = path.join(baseDir, 'google-credentials.json');
const CACHE_PATH = path.join(baseDir, 'song-cache.json');

// Tabs to skip — add more names here if needed

let songCache = [];
let refreshTimer = null;

async function getAuthClient() {
  if (!fs.existsSync(CREDENTIALS_PATH)) {
    throw new Error(
      'google-credentials.json not found.\n' +
      'See SETUP.md → Step 2 to create a Google Service Account and download credentials.'
    );
  }
  const auth = new google.auth.GoogleAuth({
    keyFile: CREDENTIALS_PATH,
    scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
  });
  return auth.getClient();
}

async function fetchSongs() {
  console.log('[sheets] fetchSongs v2 running (with key support)');
  const sheetId = process.env.GOOGLE_SHEET_ID;
  const songCol = process.env.SHEET_SONG_COLUMN || 'title';
  const artistCol = process.env.SHEET_ARTIST_COLUMN || 'artist';
  console.log(`[sheets] Looking for columns: song="${songCol}", artist="${artistCol}"`);

  if (!sheetId) {
    console.warn('[sheets] GOOGLE_SHEET_ID not set — using empty song list');
    return [];
  }

  try {
    const auth = await getAuthClient();
    const sheets = google.sheets({ version: 'v4', auth });

    // Step 1: get all sheet/tab names
    const meta = await sheets.spreadsheets.get({ spreadsheetId: sheetId });
    const tabs = meta.data.sheets
      .map(s => s.properties.title)
      .filter(name => !config.EXCLUDED_TABS.includes(name));

    console.log(`[sheets] Found tabs: ${meta.data.sheets.map(s => s.properties.title).join(', ')}`);
    console.log(`[sheets] Reading tabs: ${tabs.join(', ')}`);

    // Step 2: fetch all tabs in one batchGet call
    const batchRes = await sheets.spreadsheets.values.batchGet({
      spreadsheetId: sheetId,
      ranges: tabs.map(tab => `${tab}!A:Z`),
    });

    const allSongs = [];

    for (const valueRange of batchRes.data.valueRanges) {
      const rows = valueRange.values;
      if (!rows || rows.length < 2) continue;

      const headers = rows[0].map(h => h.toLowerCase().trim());
      const titleIdx = headers.indexOf(songCol.toLowerCase());
      const artistIdx = headers.indexOf(artistCol.toLowerCase());
      const keyIdx = headers.indexOf('key');

      console.log(`[sheets] Tab headers: ${headers.join(', ')}`);
      console.log(`[sheets] keyIdx: ${keyIdx}`);

      if (titleIdx === -1) {
        console.warn(
          `[sheets] Tab "${valueRange.range}" has no "${songCol}" column — skipping. ` +
          `Found headers: ${headers.join(', ')}`
        );
        continue;
      }

      const songs = rows.slice(1)
        .filter(row => row[titleIdx]?.trim())
        .map(row => {
          const rawKey = keyIdx !== -1 ? String(row[keyIdx] ?? '').trim() : '';
          const key = /^-?\d+(\.\d+)?$/.test(rawKey) ? rawKey : '';
          if (rawKey && !key) console.log(`[sheets] Rejected key value: "${rawKey}"`);
          return {
            title: row[titleIdx].trim(),
            artist: artistIdx !== -1 ? (row[artistIdx] || '').trim() : '',
            key,
          };
        });

      allSongs.push(...songs);
    }

    // Deduplicate by title (case-insensitive)
    const seen = new Set();
    const deduped = allSongs.filter(s => {
      const key = s.title.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    console.log(`[sheets] Loaded ${deduped.length} songs total across ${tabs.length} tabs`);
    const withKey = deduped.filter(s => s.key).length;
    console.log(`[sheets] Songs with key: ${withKey}`);
    console.log(`[sheets] Sample song: ${JSON.stringify(deduped.find(s => s.key) || deduped[0])}`);

    // Force write fresh cache (delete old one first to avoid stale reads)
    if (fs.existsSync(CACHE_PATH)) fs.unlinkSync(CACHE_PATH);
    fs.writeFileSync(CACHE_PATH, JSON.stringify(deduped, null, 2));
    songCache = deduped;
    return deduped;

  } catch (err) {
    console.error('[sheets] Error fetching songs:', err.message);
    if (fs.existsSync(CACHE_PATH)) {
      console.log('[sheets] Using cached song list from disk');
      songCache = JSON.parse(fs.readFileSync(CACHE_PATH, 'utf8'));
    }
    return songCache;
  }
}

function getSongs() {
  return songCache;
}

async function startAutoRefresh() {
  await fetchSongs();
  if (refreshTimer) clearInterval(refreshTimer);
  refreshTimer = setInterval(fetchSongs, config.SHEET_REFRESH_INTERVAL_MS);
}

module.exports = { fetchSongs, getSongs, startAutoRefresh };

