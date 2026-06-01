// server/twitch.js
// Registers an EventSub subscription for Channel Points redemptions
// and verifies incoming webhook payloads from Twitch.

const crypto = require('crypto');
const axios = require('axios');

const TWITCH_API = 'https://api.twitch.tv/helix';
const EVENTSUB_URL = `${TWITCH_API}/eventsub/subscriptions`;
const REWARDS_URL = `${TWITCH_API}/channel_points/custom_rewards`;

// ─── Token Management ─────────────────────────────────────────────────────────

let appToken = null;
let tokenExpiry = 0;

async function getAppToken() {
  if (appToken && Date.now() < tokenExpiry) return appToken;

  const res = await axios.post('https://id.twitch.tv/oauth2/token', null, {
    params: {
      client_id: process.env.TWITCH_CLIENT_ID,
      client_secret: process.env.TWITCH_CLIENT_SECRET,
      grant_type: 'client_credentials',
    },
  });

  appToken = res.data.access_token;
  tokenExpiry = Date.now() + (res.data.expires_in - 60) * 1000;
  return appToken;
}

// ─── Webhook Verification ─────────────────────────────────────────────────────

function verifySignature(req) {
  const messageId = req.headers['twitch-eventsub-message-id'];
  const timestamp = req.headers['twitch-eventsub-message-timestamp'];
  const signature = req.headers['twitch-eventsub-message-signature'];

  if (!messageId || !timestamp || !signature) return false;

  const hmacMessage = messageId + timestamp + req.rawBody;
  const expectedSig = 'sha256=' + crypto
    .createHmac('sha256', process.env.TWITCH_WEBHOOK_SECRET)
    .update(hmacMessage)
    .digest('hex');

  try {
    return crypto.timingSafeEqual(
      Buffer.from(signature),
      Buffer.from(expectedSig)
    );
  } catch (_) {
    return false;
  }
}

// ─── Subscription Registration ────────────────────────────────────────────────

async function registerEventSub() {
  const token = await getAppToken();
  const publicUrl = process.env.PUBLIC_URL;
  const broadcasterId = process.env.TWITCH_BROADCASTER_ID;
  const rewardId = process.env.TWITCH_REWARD_ID;

  if (!publicUrl || publicUrl.includes('your-ngrok')) {
    console.warn('[twitch] PUBLIC_URL not set — skipping EventSub registration.');
    console.warn('[twitch] Set PUBLIC_URL in .env to your ngrok URL and restart.');
    return;
  }

  const callbackUrl = `${publicUrl}/twitch/webhook`;

  // Check if already subscribed — delete any that have a reward_id filter
  // so we can re-register to catch ALL redemptions
  const existing = await axios.get(EVENTSUB_URL, {
    headers: {
      'Client-Id': process.env.TWITCH_CLIENT_ID,
      Authorization: `Bearer ${token}`,
    },
  });

  const existingSubs = existing.data.data?.filter(
    sub => sub.type === 'channel.channel_points_custom_reward_redemption.add'
      && sub.status === 'enabled'
  ) || [];

  // Always delete existing subscriptions and re-register to ensure
  // the webhook secret stays in sync with .env
  for (const sub of existingSubs) {
    try {
      await axios.delete(`${EVENTSUB_URL}?id=${sub.id}`, {
        headers: {
          'Client-Id': process.env.TWITCH_CLIENT_ID,
          Authorization: `Bearer ${token}`,
        },
      });
      console.log(`[twitch] Deleted existing subscription ${sub.id}`);
    } catch (err) {
      console.warn('[twitch] Could not delete subscription:', err.message);
    }
  }

  const condition = { broadcaster_user_id: broadcasterId };
  // No reward_id filter — listen to all Channel Points redemptions
  // and route by reward ID in the webhook handler

  try {
    await axios.post(EVENTSUB_URL, {
      type: 'channel.channel_points_custom_reward_redemption.add',
      version: '1',
      condition,
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
    console.log('[twitch] EventSub subscription registered!');
  } catch (err) {
    console.error('[twitch] Failed to register EventSub:', err.response?.data || err.message);
  }
}

// ─── Refund Helper ────────────────────────────────────────────────────────────

async function refundRedemption(broadcasterId, rewardId, redemptionId) {
  try {
    const token = await getAppToken();
    await axios.patch(
      `${TWITCH_API}/channel_points/custom_rewards/redemptions`,
      { status: 'CANCELED' },
      {
        params: { broadcaster_id: broadcasterId, reward_id: rewardId, id: redemptionId },
        headers: {
          'Client-Id': process.env.TWITCH_CLIENT_ID,
          Authorization: `Bearer ${token}`,
        },
      }
    );
    console.log(`[twitch] Refunded redemption ${redemptionId}`);
  } catch (err) {
    console.error('[twitch] Failed to refund redemption:', err.response?.data || err.message);
  }
}

module.exports = { verifySignature, registerEventSub, refundRedemption };
