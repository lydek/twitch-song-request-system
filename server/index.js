// Main server: Express for HTTP APIs and Twitch EventSub, ws for overlay clients.

require('dotenv').config({ encoding: 'utf8' });
const crypto = require('crypto');
const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');
const fs = require('fs');
const axios = require('axios');

const { startAutoRefresh } = require('./sheets');
const { matchSong } = require('./matcher');
const { registerClient, addSong, addPending, acceptPending, skipSong, clearQueue, getState, deleteSong, moveSong } = require('./queue');
const { getAppMode, getEventSubTransport, verifySignature, registerEventSub, stopEventSub } = require('./twitch');
const { init: initHistory, recordRequest, getHistory } = require('./history');
const { pickRandom } = require('./random');

const APP_MODE_LOCAL = 'local';
const APP_MODE_SERVER = 'server';
const TWITCH_SCOPES = 'channel:read:redemptions channel:manage:redemptions';
const TWITCH_TOKEN_URL = 'https://id.twitch.tv/oauth2/token';
const TWITCH_DEVICE_URL = 'https://id.twitch.tv/oauth2/device';
const TWITCH_USERS_URL = 'https://api.twitch.tv/helix/users';
const TWITCH_REWARDS_URL = 'https://api.twitch.tv/helix/channel_points/custom_rewards';

function normalizeAppMode(value) {
  return value === APP_MODE_SERVER ? APP_MODE_SERVER : APP_MODE_LOCAL;
}

function getBaseDir() {
  const isPkg = typeof process.pkg !== 'undefined';
  return isPkg ? path.dirname(process.execPath) : path.join(__dirname, '..');
}

function createWebhookSecret() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  return Array.from({ length: 32 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
}

function checkConfigured() {
  const baseDir = getBaseDir();
  const mode = getAppMode();
  const credPath = path.join(baseDir, 'google-credentials.json');

  const hasCreds = fs.existsSync(credPath);
  const hasClientId = !!process.env.TWITCH_CLIENT_ID && process.env.TWITCH_CLIENT_ID !== 'your_client_id_here';
  const hasSheetId = !!process.env.GOOGLE_SHEET_ID && process.env.GOOGLE_SHEET_ID !== 'your_sheet_id_here';
  const hasBroadcasterId = !!process.env.TWITCH_BROADCASTER_ID && process.env.TWITCH_BROADCASTER_ID !== 'your_numeric_user_id_here';

  if (!(hasCreds && hasClientId && hasSheetId && hasBroadcasterId)) {
    return false;
  }

  if (mode === APP_MODE_SERVER) {
    return Boolean(process.env.TWITCH_CLIENT_SECRET && process.env.PUBLIC_URL && process.env.TWITCH_WEBHOOK_SECRET);
  }

  return Boolean(process.env.TWITCH_USER_REFRESH_TOKEN);
}

let isSetupMode = !checkConfigured();
const setupAuthStates = new Map();

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

function pruneSetupAuthStates() {
  const cutoff = Date.now() - (10 * 60 * 1000);
  for (const [state, data] of setupAuthStates.entries()) {
    if (data.createdAt < cutoff) {
      setupAuthStates.delete(state);
    }
  }
}

async function completeTwitchAuthorization({ clientId, userToken, refreshToken = '', expiresIn = 0 }) {
  const userRes = await axios.get(TWITCH_USERS_URL, {
    headers: {
      'Client-Id': clientId,
      Authorization: `Bearer ${userToken}`,
    },
  });

  if (!userRes.data.data || userRes.data.data.length === 0) {
    throw new Error('Unable to find the authenticated Twitch user');
  }

  const broadcasterId = userRes.data.data[0].id;
  const rewardHeaders = {
    'Client-Id': clientId,
    Authorization: `Bearer ${userToken}`,
    'Content-Type': 'application/json',
  };

  let existingRewards = [];
  try {
    const rewardsRes = await axios.get(`${TWITCH_REWARDS_URL}?broadcaster_id=${broadcasterId}`, {
      headers: rewardHeaders,
    });
    existingRewards = rewardsRes.data.data || [];
  } catch (err) {
    console.warn('[setup] Could not read existing rewards:', err.response?.data || err.message);
  }

  let rewardId = '';
  const foundReward = existingRewards.find(reward => reward.title.includes('Song Request') || reward.title.includes('點歌'));
  if (foundReward) {
    rewardId = foundReward.id;
    console.log(`[setup] Reusing song request reward "${foundReward.title}" (${rewardId})`);
  } else {
    try {
      const createRes = await axios.post(`${TWITCH_REWARDS_URL}?broadcaster_id=${broadcasterId}`, {
        title: '點歌券',
        cost: 500,
        is_user_input_required: true,
        prompt: '輸入想點的歌名',
      }, { headers: rewardHeaders });
      rewardId = createRes.data.data[0].id;
      console.log(`[setup] Created song request reward 點歌券 (${rewardId})`);
    } catch (err) {
      console.error('[setup] Failed to create song request reward:', err.response?.data || err.message);
    }
  }

  let randomRewardId = '';
  const foundRandom = existingRewards.find(reward => reward.title.includes('Random') || reward.title.includes('隨機點歌'));
  if (foundRandom) {
    randomRewardId = foundRandom.id;
    console.log(`[setup] Reusing random reward "${foundRandom.title}" (${randomRewardId})`);
  } else {
    try {
      const createRes = await axios.post(`${TWITCH_REWARDS_URL}?broadcaster_id=${broadcasterId}`, {
        title: '隨機點歌券',
        cost: 300,
        is_user_input_required: false,
      }, { headers: rewardHeaders });
      randomRewardId = createRes.data.data[0].id;
      console.log(`[setup] Created random reward 隨機點歌券 (${randomRewardId})`);
    } catch (err) {
      console.error('[setup] Failed to create random reward:', err.response?.data || err.message);
    }
  }

  return {
    broadcasterId,
    rewardId,
    randomRewardId,
    accessToken: userToken,
    refreshToken,
    expiresIn,
  };
}

async function handleRedemptionEvent(event, source = 'webhook') {
  const requestText = event?.user_input?.trim();
  const rewardId = event?.reward?.id;
  const requester = event?.user_name;

  console.log(`[${source}] Redemption from @${requester}: "${requestText}" (reward: ${rewardId})`);

  const randomRewardId = process.env.TWITCH_RANDOM_REWARD_ID;
  if (randomRewardId && rewardId === randomRewardId) {
    const { queue, nowPlaying } = getState();
    const excludeTitles = [
      ...(nowPlaying ? [nowPlaying.title] : []),
      ...queue.map(song => song.title),
    ];
    const picked = pickRandom(excludeTitles);

    if (picked) {
      addSong({ title: picked.title, artist: picked.artist, key: picked.key || '', requester });
      recordRequest({ title: picked.title, artist: picked.artist, requester });
      console.log(`[random] Added "${picked.title}" for @${requester}`);
    } else {
      console.log('[random] No eligible songs to pick from');
    }
    return;
  }

  if (!requestText) {
    console.log(`[${source}] Empty request text - no match attempted`);
    return;
  }

  const result = matchSong(requestText);
  if (result.matched && result.confident) {
    addSong({
      title: result.song.title,
      artist: result.song.artist,
      key: result.song.key || '',
      requester,
    });
    recordRequest({ title: result.song.title, artist: result.song.artist, requester });
    console.log(`[queue] Added "${result.song.title}" for @${requester} (${result.confidence}% match)`);
    return;
  }

  if (result.matched && !result.confident) {
    addPending({
      title: result.song.title,
      artist: result.song.artist,
      requester,
      originalRequest: requestText,
      confidence: result.confidence,
    });
    console.log(`[queue] Weak match "${result.song.title}" (${result.confidence}%) for @${requester} - sent to pending`);
    return;
  }

  addPending({
    title: '',
    artist: '',
    requester,
    originalRequest: requestText,
    confidence: null,
  });
  console.log(`[queue] No match for "${requestText}" by @${requester} - sent to pending`);
}

async function startCoreServices() {
  stopEventSub();
  await startAutoRefresh();
  await initHistory();
  await registerEventSub(handleRedemptionEvent);
}

app.use('/setup', express.static(path.join(__dirname, '..', 'setup')));

app.use((req, res, next) => {
  if (isSetupMode) {
    const isSetupRoute = req.path.startsWith('/setup') || req.path.startsWith('/api/setup');
    const isRoot = req.path === '/';
    const isDashboardOrOverlay = req.path.startsWith('/dashboard') || req.path.startsWith('/overlay');

    if (!isSetupRoute && (isRoot || isDashboardOrOverlay)) {
      return res.redirect('/setup/index.html');
    }
  }
  next();
});

app.use((req, res, next) => {
  const chunks = [];
  req.on('data', chunk => chunks.push(chunk));
  req.on('end', () => {
    const buf = Buffer.concat(chunks);
    req.rawBody = buf.toString('utf8');
    try {
      req.body = JSON.parse(req.rawBody);
    } catch (_) {
      req.body = {};
    }
    next();
  });
});

app.use('/overlay', express.static(path.join(__dirname, '..', 'overlay')));
app.use('/dashboard', express.static(path.join(__dirname, '..', 'dashboard')));

app.post('/twitch/webhook', async (req, res) => {
  if (getEventSubTransport() !== 'webhook') {
    return res.sendStatus(204);
  }

  if (!verifySignature(req)) {
    console.warn('[webhook] Invalid signature - request rejected');
    return res.sendStatus(403);
  }

  const messageType = req.headers['twitch-eventsub-message-type'];

  if (messageType === 'webhook_callback_verification') {
    console.log('[webhook] Verification challenge received - subscription confirmed.');
    return res.status(200).send(req.body.challenge);
  }

  if (messageType === 'revocation') {
    console.warn('[webhook] Subscription revoked:', req.body.subscription?.status);
    return res.sendStatus(204);
  }

  if (messageType === 'notification') {
    await handleRedemptionEvent(req.body.event, 'webhook');
    return res.sendStatus(204);
  }

  res.sendStatus(204);
});

app.get('/api/queue', (req, res) => res.json(getState()));
app.post('/api/skip', (req, res) => res.json({ nowPlaying: skipSong() }));
app.post('/api/clear', (req, res) => { clearQueue(); res.json({ ok: true }); });

app.post('/api/add', (req, res) => {
  const { title, artist, key, requester } = req.body;
  if (!title) return res.status(400).json({ error: 'title required' });
  const entry = addSong({ title: title.trim(), artist: artist || '', key: key || '', requester: requester || 'manual' });
  recordRequest({ title: title.trim(), artist: artist || '', requester: requester || 'manual' });
  res.json({ ok: true, entry });
});

app.post('/api/delete', (req, res) => {
  const { zone, index } = req.body;
  const result = deleteSong(zone, index);
  if (!result) return res.status(400).json({ error: 'invalid zone or index' });
  res.json({ ok: true });
});

app.post('/api/move', (req, res) => {
  const { fromZone, fromIndex, toZone, toIndex } = req.body;
  const result = moveSong(fromZone, fromIndex, toZone, toIndex);
  if (!result) return res.status(400).json({ error: 'invalid move' });
  res.json({ ok: true });
});

app.post('/api/refresh-songs', async (req, res) => {
  const { fetchSongs } = require('./sheets');
  const songs = await fetchSongs();
  res.json({ ok: true, count: songs.length });
});

app.post('/api/accept-pending', (req, res) => {
  const { index, title, artist } = req.body;
  const result = acceptPending(index, title, artist);
  if (!result) return res.status(400).json({ error: 'invalid index' });
  res.json({ ok: true });
});

app.get('/api/songs', (req, res) => {
  const { getSongs } = require('./sheets');
  res.json(getSongs());
});

app.get('/api/history', (req, res) => {
  res.json(getHistory());
});

wss.on('connection', (ws, req) => {
  console.log(`[ws] Overlay connected from ${req.socket.remoteAddress}`);
  registerClient(ws);
});

app.post('/api/setup/device-code/start', async (req, res) => {
  if (!isSetupMode) {
    return res.status(403).json({ error: 'Setup mode is not active' });
  }

  const clientId = String(req.body?.client_id || '').trim();
  if (!clientId) {
    return res.status(400).json({ error: 'Twitch Client ID is required' });
  }

  try {
    const deviceRes = await axios.post(TWITCH_DEVICE_URL, new URLSearchParams({
      client_id: clientId,
      scopes: TWITCH_SCOPES,
    }).toString(), {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    });

    res.json({
      ok: true,
      deviceCode: deviceRes.data.device_code,
      userCode: deviceRes.data.user_code,
      verificationUri: deviceRes.data.verification_uri,
      expiresIn: deviceRes.data.expires_in,
      interval: deviceRes.data.interval,
    });
  } catch (err) {
    res.status(500).json({ error: err.response?.data?.message || err.message });
  }
});

app.post('/api/setup/device-code/poll', async (req, res) => {
  if (!isSetupMode) {
    return res.status(403).json({ error: 'Setup mode is not active' });
  }

  const clientId = String(req.body?.client_id || '').trim();
  const deviceCode = String(req.body?.device_code || '').trim();
  if (!clientId || !deviceCode) {
    return res.status(400).json({ error: 'client_id and device_code are required' });
  }

  try {
    const tokenRes = await axios.post(TWITCH_TOKEN_URL, new URLSearchParams({
      client_id: clientId,
      scopes: TWITCH_SCOPES,
      device_code: deviceCode,
      grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
    }).toString(), {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    });

    const data = await completeTwitchAuthorization({
      clientId,
      userToken: tokenRes.data.access_token,
      refreshToken: tokenRes.data.refresh_token || '',
      expiresIn: tokenRes.data.expires_in || 0,
    });

    res.json({ ok: true, data });
  } catch (err) {
    const message = err.response?.data?.message || err.message;
    if (message === 'authorization_pending' || message === 'slow_down') {
      return res.json({ ok: false, pending: true, status: message });
    }
    if (message === 'expired_token' || message === 'invalid device code') {
      return res.status(400).json({ error: message });
    }
    res.status(500).json({ error: message });
  }
});

app.post('/api/setup/twitch-auth-url', (req, res) => {
  if (!isSetupMode) {
    return res.status(403).json({ error: 'Setup mode is not active' });
  }

  const clientId = String(req.body?.client_id || '').trim();
  const clientSecret = String(req.body?.client_secret || '').trim();
  if (!clientId || !clientSecret) {
    return res.status(400).json({ error: 'Twitch Client ID and Client Secret are required' });
  }

  pruneSetupAuthStates();

  const state = crypto.randomBytes(24).toString('hex');
  setupAuthStates.set(state, {
    clientId,
    clientSecret,
    createdAt: Date.now(),
  });

  const redirectUri = `http://${req.headers.host}/setup/callback`;
  const authUrl = `https://id.twitch.tv/oauth2/authorize?client_id=${clientId}&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=code&scope=${encodeURIComponent(TWITCH_SCOPES)}&state=${state}`;

  res.json({ ok: true, authUrl });
});

app.get('/setup/callback', async (req, res) => {
  const { code, state } = req.query;
  if (!code) {
    return res.send('<html><body><script>window.opener.postMessage({ type: "TWITCH_AUTH_ERROR", error: "Missing authorization code" }, "*"); window.close();</script></body></html>');
  }

  try {
    const savedState = setupAuthStates.get(state);
    if (!savedState) {
      throw new Error('OAuth state expired or is invalid');
    }
    setupAuthStates.delete(state);

    const redirectUri = `http://${req.headers.host}/setup/callback`;
    const tokenRes = await axios.post(TWITCH_TOKEN_URL, new URLSearchParams({
      client_id: savedState.clientId,
      client_secret: savedState.clientSecret,
      code,
      grant_type: 'authorization_code',
      redirect_uri: redirectUri,
    }).toString(), {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    });

    const data = await completeTwitchAuthorization({
      clientId: savedState.clientId,
      userToken: tokenRes.data.access_token,
      refreshToken: tokenRes.data.refresh_token || '',
      expiresIn: tokenRes.data.expires_in || 0,
    });

    const successPayload = JSON.stringify({ type: 'TWITCH_AUTH_SUCCESS', data });
    res.send(`
      <html>
      <head><meta charset="utf-8"></head>
      <body style="background-color:#0d0b18;color:#f3f4f6;font-family:sans-serif;text-align:center;padding-top:100px;">
        <h2 style="color:#a855f7;margin-bottom:20px;">授權成功</h2>
        <p style="color:#9ca3af;">正在將 Twitch 資訊傳回設定頁面...</p>
        <script>
          window.opener.postMessage(${successPayload}, '*');
          setTimeout(() => window.close(), 1000);
        </script>
      </body>
      </html>
    `);
  } catch (err) {
    const errorPayload = JSON.stringify({
      type: 'TWITCH_AUTH_ERROR',
      error: err.response?.data?.message || err.message,
    });
    res.send(`
      <html>
      <head><meta charset="utf-8"></head>
      <body style="background-color:#0d0b18;color:#f3f4f6;font-family:sans-serif;text-align:center;padding-top:100px;">
        <h2 style="color:#ef4444;margin-bottom:20px;">授權失敗</h2>
        <button onclick="window.close()" style="margin-top:20px;padding:10px 20px;background:rgba(255,255,255,0.08);border:1px solid rgba(255,255,255,0.1);color:#fff;border-radius:8px;cursor:pointer;">關閉視窗</button>
        <script>window.opener.postMessage(${errorPayload}, '*');</script>
      </body>
      </html>
    `);
  }
});

app.post('/api/setup/save', async (req, res) => {
  try {
    const baseDir = getBaseDir();
    const credPath = path.join(baseDir, 'google-credentials.json');
    const envPath = path.join(baseDir, '.env');
    const appMode = normalizeAppMode(String(req.body?.app_mode || ''));
    const eventSubTransport = appMode === APP_MODE_SERVER ? 'webhook' : 'websocket';

    const twitchClientId = String(req.body?.twitch_client_id || '').trim();
    const twitchClientSecret = String(req.body?.twitch_client_secret || '').trim();
    const twitchBroadcasterId = String(req.body?.twitch_broadcaster_id || '').trim();
    const twitchRewardId = String(req.body?.twitch_reward_id || '').trim();
    const twitchRandomRewardId = String(req.body?.twitch_random_reward_id || '').trim();
    const twitchUserAccessToken = String(req.body?.twitch_user_access_token || '').trim();
    const twitchUserRefreshToken = String(req.body?.twitch_user_refresh_token || '').trim();
    const twitchUserTokenExpiresAt = String(req.body?.twitch_user_token_expires_at || '').trim();
    const googleSheetId = String(req.body?.google_sheet_id || '').trim();
    const sheetSongColumn = String(req.body?.sheet_song_column || 'title').trim() || 'title';
    const sheetArtistColumn = String(req.body?.sheet_artist_column || 'artist').trim() || 'artist';
    const historySheetId = String(req.body?.history_sheet_id || '').trim();
    const publicUrl = String(req.body?.public_url || '').trim();
    const googleCredentials = req.body?.google_credentials || null;

    if (!twitchClientId || !twitchBroadcasterId || !googleSheetId || !googleCredentials) {
      return res.status(400).json({ error: 'Missing required setup fields' });
    }

    if (appMode === APP_MODE_LOCAL && !twitchUserRefreshToken) {
      return res.status(400).json({ error: 'Local mode requires Twitch device authorization' });
    }

    if (appMode === APP_MODE_SERVER && (!twitchClientSecret || !publicUrl)) {
      return res.status(400).json({ error: 'Server mode requires Twitch Client Secret and PUBLIC_URL' });
    }

    fs.writeFileSync(credPath, JSON.stringify(googleCredentials, null, 2), 'utf8');

    const webhookSecret = appMode === APP_MODE_SERVER
      ? (String(req.body?.twitch_webhook_secret || '').trim() || createWebhookSecret())
      : '';

    const envContent = [
      '# ========================================================',
      '#  VTuber Song Queue -- Generated Configuration',
      '# ========================================================',
      '',
      '# --- Application Mode ---',
      `APP_MODE=${appMode}`,
      `TWITCH_EVENTSUB_TRANSPORT=${eventSubTransport}`,
      '',
      '# --- Twitch App ---',
      `TWITCH_CLIENT_ID=${twitchClientId}`,
      `TWITCH_CLIENT_SECRET=${appMode === APP_MODE_SERVER ? twitchClientSecret : ''}`,
      '',
      '# --- Twitch Channel ---',
      `TWITCH_BROADCASTER_ID=${twitchBroadcasterId}`,
      `TWITCH_WEBHOOK_SECRET=${webhookSecret}`,
      '',
      '# --- Twitch User OAuth (local websocket mode) ---',
      `TWITCH_USER_ACCESS_TOKEN=${appMode === APP_MODE_LOCAL ? twitchUserAccessToken : ''}`,
      `TWITCH_USER_REFRESH_TOKEN=${appMode === APP_MODE_LOCAL ? twitchUserRefreshToken : ''}`,
      `TWITCH_USER_TOKEN_EXPIRES_AT=${appMode === APP_MODE_LOCAL ? twitchUserTokenExpiresAt : ''}`,
      '',
      '# --- Twitch Channel Points Rewards ---',
      `TWITCH_REWARD_ID=${twitchRewardId}`,
      `TWITCH_RANDOM_REWARD_ID=${twitchRandomRewardId}`,
      '',
      '# --- Google Sheets ---',
      `GOOGLE_SHEET_ID=${googleSheetId}`,
      `SHEET_SONG_COLUMN=${sheetSongColumn}`,
      `SHEET_ARTIST_COLUMN=${sheetArtistColumn}`,
      `HISTORY_SHEET_ID=${historySheetId}`,
      '',
      '# --- Server ---',
      'PORT=3000',
      `PUBLIC_URL=${appMode === APP_MODE_SERVER ? publicUrl : ''}`,
      '',
      '# --- Random Song Behaviour ---',
      'RANDOM_PICK_MODE=weighted',
      '',
    ].join('\n');

    fs.writeFileSync(envPath, envContent, 'utf8');
    require('dotenv').config({ path: envPath, override: true });

    isSetupMode = false;

    setTimeout(async () => {
      try {
        await startCoreServices();
        console.log('[setup] Core services reloaded successfully.');
      } catch (err) {
        console.error('[setup] Core service reload failed:', err.message);
      }
    }, 500);

    res.json({ ok: true });
  } catch (err) {
    console.error('[setup] Failed to save configuration:', err.message);
    res.status(500).json({ error: err.message });
  }
});

const PORT = process.env.PORT || 3000;

function listenAsync(targetPort) {
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      server.off('error', onError);
      server.off('listening', onListening);
    };

    const onError = err => {
      cleanup();
      reject(err);
    };

    const onListening = () => {
      cleanup();
      resolve();
    };

    server.once('error', onError);
    server.once('listening', onListening);
    server.listen(targetPort);
  });
}

async function start() {
  console.log('\nVTuber Song Queue starting...\n');

  if (isSetupMode) {
    console.log('[setup] Configuration is incomplete. Starting in setup mode.');
  } else {
    console.log(`[startup] Starting in ${getAppMode()} mode with EventSub transport "${getEventSubTransport()}".`);
    try {
      await startCoreServices();
    } catch (err) {
      console.error('[startup] Failed to start core services. Falling back to setup mode:', err.message);
      isSetupMode = true;
    }
  }

  try {
    await listenAsync(PORT);
  } catch (err) {
    if (err && err.code === 'EADDRINUSE') {
      console.error(`\n[startup] Port ${PORT} is already in use.`);
      console.error('[startup] Close the other VTuber Song Queue instance or change PORT in .env, then start again.');
      process.exit(1);
      return;
    }

    throw err;
  }

  console.log(`\nServer running at http://localhost:${PORT}`);
  if (isSetupMode) {
    console.log(`Setup URL:   http://localhost:${PORT}/setup/index.html\n`);
  } else {
    console.log(`Overlay URL: http://localhost:${PORT}/overlay/index.html`);
    console.log(`Dashboard:   http://localhost:${PORT}/dashboard/index.html`);
    console.log(`API:         http://localhost:${PORT}/api/queue\n`);
  }
}

start().catch(err => {
  console.error('Fatal startup error:', err);
  process.exit(1);
});
