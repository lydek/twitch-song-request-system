// Registers an EventSub subscription for Channel Points redemptions
// and verifies incoming webhook payloads from Twitch.

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const WebSocket = require('ws');
const axios = require('axios');

const APP_MODE_LOCAL = 'local';
const APP_MODE_SERVER = 'server';
const TWITCH_API = 'https://api.twitch.tv/helix';
const TWITCH_TOKEN_URL = 'https://id.twitch.tv/oauth2/token';
const EVENTSUB_URL = `${TWITCH_API}/eventsub/subscriptions`;
const EVENTSUB_WS_URL = 'wss://eventsub.wss.twitch.tv/ws';

const isPkg = typeof process.pkg !== 'undefined';
const baseDir = isPkg ? path.dirname(process.execPath) : path.join(__dirname, '..');
const envPath = path.join(baseDir, '.env');

let appToken = null;
let appTokenExpiry = 0;
let userToken = null;
let userTokenExpiry = 0;

const runtime = {
  ws: null,
  reconnectTimer: null,
  stopped: true,
  reconnectUrl: null,
  onNotification: null,
  seenMessageIds: new Map(),
};

function normalizeAppMode(value) {
  return value === APP_MODE_SERVER ? APP_MODE_SERVER : APP_MODE_LOCAL;
}

function getAppMode() {
  return normalizeAppMode(process.env.APP_MODE || APP_MODE_LOCAL);
}

function getEventSubTransport() {
  return getAppMode() === APP_MODE_SERVER ? 'webhook' : 'websocket';
}

function getEnvValue(name) {
  const value = process.env[name];
  return typeof value === 'string' ? value.trim() : '';
}

function updateEnvFile(updates) {
  if (!fs.existsSync(envPath)) return;

  let content = fs.readFileSync(envPath, 'utf8');
  for (const [key, value] of Object.entries(updates)) {
    const nextValue = String(value ?? '');
    const line = `${key}=${nextValue}`;
    const pattern = new RegExp(`^${key}=.*$`, 'm');

    if (pattern.test(content)) {
      content = content.replace(pattern, line);
    } else {
      if (!content.endsWith('\n')) content += '\n';
      content += `${line}\n`;
    }

    process.env[key] = nextValue;
  }

  fs.writeFileSync(envPath, content, 'utf8');
}

async function getAppToken() {
  if (appToken && Date.now() < appTokenExpiry) return appToken;

  const clientSecret = getEnvValue('TWITCH_CLIENT_SECRET');
  if (!clientSecret) {
    throw new Error('TWITCH_CLIENT_SECRET is required in server mode');
  }

  const res = await axios.post(TWITCH_TOKEN_URL, new URLSearchParams({
    client_id: process.env.TWITCH_CLIENT_ID,
    client_secret: clientSecret,
    grant_type: 'client_credentials',
  }).toString(), {
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  });

  appToken = res.data.access_token;
  appTokenExpiry = Date.now() + ((res.data.expires_in || 0) - 60) * 1000;
  return appToken;
}

async function refreshUserToken() {
  const refreshToken = getEnvValue('TWITCH_USER_REFRESH_TOKEN');
  if (!refreshToken) {
    throw new Error('TWITCH_USER_REFRESH_TOKEN is required in local mode');
  }

  const form = new URLSearchParams({
    client_id: process.env.TWITCH_CLIENT_ID,
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
  });

  const clientSecret = getEnvValue('TWITCH_CLIENT_SECRET');
  if (clientSecret) {
    form.set('client_secret', clientSecret);
  }

  const res = await axios.post(TWITCH_TOKEN_URL, form.toString(), {
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  });

  userToken = res.data.access_token;
  userTokenExpiry = Date.now() + ((res.data.expires_in || 0) - 60) * 1000;

  const nextRefreshToken = res.data.refresh_token || refreshToken;
  updateEnvFile({
    TWITCH_USER_ACCESS_TOKEN: userToken,
    TWITCH_USER_REFRESH_TOKEN: nextRefreshToken,
    TWITCH_USER_TOKEN_EXPIRES_AT: new Date(userTokenExpiry).toISOString(),
  });

  return userToken;
}

async function getUserToken() {
  if (userToken && Date.now() < userTokenExpiry) return userToken;

  const persistedAccessToken = getEnvValue('TWITCH_USER_ACCESS_TOKEN');
  const persistedExpiresAt = Date.parse(getEnvValue('TWITCH_USER_TOKEN_EXPIRES_AT'));
  if (persistedAccessToken && Number.isFinite(persistedExpiresAt) && Date.now() < persistedExpiresAt) {
    userToken = persistedAccessToken;
    userTokenExpiry = persistedExpiresAt;
    return userToken;
  }

  return refreshUserToken();
}

function verifySignature(req) {
  const messageId = req.headers['twitch-eventsub-message-id'];
  const timestamp = req.headers['twitch-eventsub-message-timestamp'];
  const signature = req.headers['twitch-eventsub-message-signature'];
  const secret = process.env.TWITCH_WEBHOOK_SECRET;

  if (!messageId || !timestamp || !signature || !secret) return false;

  const hmacMessage = messageId + timestamp + req.rawBody;
  const expectedSig = 'sha256=' + crypto.createHmac('sha256', secret).update(hmacMessage).digest('hex');

  try {
    return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expectedSig));
  } catch (_) {
    return false;
  }
}

function cleanupSeenMessages() {
  const cutoff = Date.now() - (10 * 60 * 1000);
  for (const [messageId, seenAt] of runtime.seenMessageIds.entries()) {
    if (seenAt < cutoff) runtime.seenMessageIds.delete(messageId);
  }
}

function markSeen(messageId) {
  cleanupSeenMessages();
  if (runtime.seenMessageIds.has(messageId)) return true;
  runtime.seenMessageIds.set(messageId, Date.now());
  return false;
}

async function listSubscriptions(token) {
  const res = await axios.get(EVENTSUB_URL, {
    headers: {
      'Client-Id': process.env.TWITCH_CLIENT_ID,
      Authorization: `Bearer ${token}`,
    },
  });

  return res.data.data || [];
}

async function deleteSubscription(token, id) {
  await axios.delete(`${EVENTSUB_URL}?id=${id}`, {
    headers: {
      'Client-Id': process.env.TWITCH_CLIENT_ID,
      Authorization: `Bearer ${token}`,
    },
  });
}

async function deleteExistingRedemptionSubscriptions(token) {
  const existingSubs = (await listSubscriptions(token)).filter(
    sub => sub.type === 'channel.channel_points_custom_reward_redemption.add'
  );

  for (const sub of existingSubs) {
    try {
      await deleteSubscription(token, sub.id);
      console.log(`[twitch] Deleted existing subscription ${sub.id}`);
    } catch (err) {
      console.warn('[twitch] Could not delete subscription:', err.response?.data || err.message);
    }
  }
}

async function registerWebhookSubscription() {
  const token = await getAppToken();
  const publicUrl = getEnvValue('PUBLIC_URL');
  const broadcasterId = process.env.TWITCH_BROADCASTER_ID;

  if (!publicUrl) {
    throw new Error('PUBLIC_URL is required in server mode');
  }

  await deleteExistingRedemptionSubscriptions(token);

  const callbackUrl = `${publicUrl}/twitch/webhook`;
  await axios.post(EVENTSUB_URL, {
    type: 'channel.channel_points_custom_reward_redemption.add',
    version: '1',
    condition: { broadcaster_user_id: broadcasterId },
    transport: {
      method: 'webhook',
      callback: callbackUrl,
      secret: process.env.TWITCH_WEBHOOK_SECRET,
    },
  }, {
    headers: {
      'Client-Id': process.env.TWITCH_CLIENT_ID,
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
  });

  console.log('[twitch] EventSub webhook subscription registered.');
}

async function registerWebSocketSubscription(sessionId) {
  const token = await getUserToken();
  const broadcasterId = process.env.TWITCH_BROADCASTER_ID;

  await deleteExistingRedemptionSubscriptions(token);

  await axios.post(EVENTSUB_URL, {
    type: 'channel.channel_points_custom_reward_redemption.add',
    version: '1',
    condition: { broadcaster_user_id: broadcasterId },
    transport: {
      method: 'websocket',
      session_id: sessionId,
    },
  }, {
    headers: {
      'Client-Id': process.env.TWITCH_CLIENT_ID,
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
  });

  console.log('[twitch] EventSub websocket subscription registered.');
}

function scheduleReconnect(delayMs = 1000) {
  if (runtime.stopped || runtime.reconnectTimer) return;

  runtime.reconnectTimer = setTimeout(() => {
    runtime.reconnectTimer = null;
    connectEventSubWebSocket(runtime.reconnectUrl || EVENTSUB_WS_URL)
      .catch(err => console.error('[twitch] EventSub reconnect failed:', err.message));
  }, delayMs);
}

function stopEventSub() {
  runtime.stopped = true;

  if (runtime.reconnectTimer) {
    clearTimeout(runtime.reconnectTimer);
    runtime.reconnectTimer = null;
  }

  if (runtime.ws) {
    const ws = runtime.ws;
    runtime.ws = null;
    ws.removeAllListeners();
    try { ws.close(); } catch (_) {}
  }

  runtime.reconnectUrl = null;
  runtime.seenMessageIds.clear();
}

async function connectEventSubWebSocket(url = EVENTSUB_WS_URL) {
  if (runtime.stopped) return;

  if (runtime.ws) {
    runtime.ws.removeAllListeners();
    try { runtime.ws.terminate(); } catch (_) {}
    runtime.ws = null;
  }

  runtime.reconnectUrl = null;

  await new Promise((resolve, reject) => {
    let resolved = false;
    const ws = new WebSocket(url);
    runtime.ws = ws;

    ws.once('open', () => {
      console.log('[twitch] EventSub websocket connected.');
    });

    ws.on('message', async raw => {
      try {
        const payload = JSON.parse(raw.toString('utf8'));
        const metadata = payload.metadata || {};
        const messageId = metadata.message_id;

        if (messageId && markSeen(messageId)) return;

        if (metadata.message_type === 'session_welcome') {
          const sessionId = payload.payload?.session?.id;
          if (!sessionId) throw new Error('Missing EventSub websocket session ID');
          await registerWebSocketSubscription(sessionId);
          if (!resolved) {
            resolved = true;
            resolve();
          }
          return;
        }

        if (metadata.message_type === 'session_reconnect') {
          runtime.reconnectUrl = payload.payload?.session?.reconnect_url || EVENTSUB_WS_URL;
          console.log('[twitch] EventSub requested websocket reconnect.');
          try { ws.close(); } catch (_) {}
          return;
        }

        if (metadata.message_type === 'notification') {
          await runtime.onNotification(payload.payload?.event, 'websocket');
          return;
        }

        if (metadata.message_type === 'revocation') {
          console.warn('[twitch] EventSub subscription revoked:', payload.payload?.subscription?.status);
        }
      } catch (err) {
        if (!resolved) {
          resolved = true;
          reject(err);
        } else {
          console.error('[twitch] EventSub websocket message error:', err.message);
        }
      }
    });

    ws.once('error', err => {
      if (!resolved) {
        resolved = true;
        reject(err);
      } else {
        console.error('[twitch] EventSub websocket error:', err.message);
      }
    });

    ws.once('close', () => {
      runtime.ws = null;
      if (!runtime.stopped) {
        console.warn('[twitch] EventSub websocket closed. Reconnecting...');
        scheduleReconnect();
      }
    });
  });
}

async function registerEventSub(onNotification) {
  const transport = getEventSubTransport();

  if (transport === 'webhook') {
    stopEventSub();
    await registerWebhookSubscription();
    return;
  }

  if (typeof onNotification !== 'function') {
    throw new Error('registerEventSub requires an onNotification callback in local mode');
  }

  runtime.stopped = false;
  runtime.onNotification = onNotification;
  await connectEventSubWebSocket(EVENTSUB_WS_URL);
}

module.exports = {
  getAppMode,
  getEventSubTransport,
  verifySignature,
  registerEventSub,
  stopEventSub,
};
