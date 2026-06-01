// server/history.js
// Records song request history to a separate Google Sheet.
// Each row = one unique song. Updated on every confirmed request.
//
// Sheet columns:
//   title | artist | total_requests | last_requested_at | last_requester
//   | top1_requester | top1_count | top2_requester | top2_count
//   | top3_requester | top3_count

const { google } = require('googleapis');
const path = require('path');
const fs = require('fs');

const CREDENTIALS_PATH = path.join(__dirname, '..', 'google-credentials.json');
const HEADERS = [
  'title', 'artist', 'total_requests',
  'last_requested_at', 'last_requester',
  'top1_requester', 'top1_count',
  'top2_requester', 'top2_count',
  'top3_requester', 'top3_count',
];

// In-memory store: title_lower → { rowIndex, data }
let rowMap = {};
let rowData = {};
let startupSnapshot = {};  // frozen at startup — never updated during session
let sheetsClient = null;
let historySheetId = null;
let initialized = false;

async function getClient() {
  if (sheetsClient) return sheetsClient;
  const auth = new google.auth.GoogleAuth({
    keyFile: CREDENTIALS_PATH,
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });
  const authClient = await auth.getClient();
  sheetsClient = google.sheets({ version: 'v4', auth: authClient });
  return sheetsClient;
}

async function init() {
  historySheetId = process.env.HISTORY_SHEET_ID;
  if (!historySheetId) {
    console.warn('[history] HISTORY_SHEET_ID not set — request history disabled');
    return;
  }
  if (!fs.existsSync(CREDENTIALS_PATH)) {
    console.warn('[history] google-credentials.json not found — history disabled');
    return;
  }

  try {
    const sheets = await getClient();

    // Read existing data
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId: historySheetId,
      range: 'A:K',
    });

    const rows = res.data.values || [];

    // If sheet is empty, write headers
    if (rows.length === 0) {
      await sheets.spreadsheets.values.update({
        spreadsheetId: historySheetId,
        range: 'A1',
        valueInputOption: 'RAW',
        requestBody: { values: [HEADERS] },
      });
      console.log('[history] Created header row in history sheet');
    } else {
      // Load existing rows into memory
      const dataRows = rows.slice(1);
      dataRows.forEach((row, i) => {
        const title = (row[0] || '').toLowerCase().trim();
        if (!title) return;
        rowMap[title] = i + 2;
        rowData[title] = parseRow(row);
      });
      // Freeze a snapshot of what was in the sheet at startup
      startupSnapshot = JSON.parse(JSON.stringify(rowData));
      console.log(`[history] Loaded ${dataRows.length} songs from history sheet`);
    }

    initialized = true;
  } catch (err) {
    console.error('[history] Init error:', err.message);
  }
}

function parseRow(row) {
  return {
    title:              row[0]  || '',
    artist:             row[1]  || '',
    total_requests:     parseInt(row[2]) || 0,
    last_requested_at:  row[3]  || '',
    last_requester:     row[4]  || '',
    top1_requester:     row[5]  || '',
    top1_count:         parseInt(row[6]) || 0,
    top2_requester:     row[7]  || '',
    top2_count:         parseInt(row[8]) || 0,
    top3_requester:     row[9]  || '',
    top3_count:         parseInt(row[10]) || 0,
  };
}

function recordToRow(r) {
  return [
    r.title, r.artist, r.total_requests,
    r.last_requested_at, r.last_requester,
    r.top1_requester, r.top1_count,
    r.top2_requester, r.top2_count,
    r.top3_requester, r.top3_count,
  ];
}

function updateTopRequesters(record, requester) {
  // Rebuild counts map from current top3
  const counts = {};
  if (record.top1_requester) counts[record.top1_requester] = record.top1_count;
  if (record.top2_requester) counts[record.top2_requester] = record.top2_count;
  if (record.top3_requester) counts[record.top3_requester] = record.top3_count;

  // Increment this requester
  counts[requester] = (counts[requester] || 0) + 1;

  // Sort descending and take top 3
  const sorted = Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3);

  record.top1_requester = sorted[0]?.[0] || '';
  record.top1_count     = sorted[0]?.[1] || 0;
  record.top2_requester = sorted[1]?.[0] || '';
  record.top2_count     = sorted[1]?.[1] || 0;
  record.top3_requester = sorted[2]?.[0] || '';
  record.top3_count     = sorted[2]?.[1] || 0;
}

// Queue of pending writes to avoid hammering the API
let writeQueue = [];
let writeTimer = null;

async function flushWrites() {
  if (writeQueue.length === 0) return;
  const toWrite = [...writeQueue];
  writeQueue = [];

  try {
    const sheets = await getClient();

    // Batch all updates into one batchUpdate call
    const data = toWrite.map(({ rowIndex, record }) => ({
      range: `A${rowIndex}:K${rowIndex}`,
      values: [recordToRow(record)],
    }));

    await sheets.spreadsheets.values.batchUpdate({
      spreadsheetId: historySheetId,
      requestBody: { valueInputOption: 'RAW', data },
    });

    console.log(`[history] Wrote ${toWrite.length} record(s) to history sheet`);
  } catch (err) {
    console.error('[history] Write error:', err.message);
  }
}

function scheduleWrite(rowIndex, record) {
  // Replace any existing queued write for this row
  writeQueue = writeQueue.filter(w => w.rowIndex !== rowIndex);
  writeQueue.push({ rowIndex, record });

  clearTimeout(writeTimer);
  writeTimer = setTimeout(flushWrites, 1500); // debounce 1.5s
}

async function recordRequest({ title, artist, requester }) {
  if (!initialized || !historySheetId) return;

  const key = title.toLowerCase().trim();
  const now = new Date().toISOString().replace('T', ' ').slice(0, 19);

  if (rowMap[key]) {
    // Update existing row
    const record = rowData[key];
    record.total_requests += 1;
    record.last_requested_at = now;
    record.last_requester = requester;
    updateTopRequesters(record, requester);
    scheduleWrite(rowMap[key], record);

  } else {
    // New song — append a row
    const record = {
      title, artist,
      total_requests: 1,
      last_requested_at: now,
      last_requester: requester,
      top1_requester: requester, top1_count: 1,
      top2_requester: '', top2_count: 0,
      top3_requester: '', top3_count: 0,
    };

    try {
      const sheets = await getClient();
      const res = await sheets.spreadsheets.values.append({
        spreadsheetId: historySheetId,
        range: 'A:K',
        valueInputOption: 'RAW',
        insertDataOption: 'INSERT_ROWS',
        requestBody: { values: [recordToRow(record)] },
      });

      // Get the row index from the response
      const updatedRange = res.data.updates?.updatedRange || '';
      const match = updatedRange.match(/A(\d+)/);
      const newRow = match ? parseInt(match[1]) : null;

      if (newRow) {
        rowMap[key] = newRow;
        rowData[key] = record;
        // Don't add to startupSnapshot — first ever request has no prior history
        console.log(`[history] New song "${title}" added at row ${newRow}`);
      }
    } catch (err) {
      console.error('[history] Append error:', err.message);
    }
  }
}

module.exports = { init, recordRequest, getHistory: () => startupSnapshot };
