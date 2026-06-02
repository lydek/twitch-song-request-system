document.addEventListener('DOMContentLoaded', () => {
  const MODE_LOCAL = 'local';
  const MODE_SERVER = 'server';

  let googleCredentialsData = null;
  let twitchUserAccessToken = '';
  let twitchUserRefreshToken = '';
  let twitchUserTokenExpiresAt = '';
  let deviceCode = '';
  let devicePollTimer = null;
  let devicePollIntervalMs = 5000;

  const panels = [
    document.getElementById('step-panel-1'),
    document.getElementById('step-panel-2'),
    document.getElementById('step-panel-3'),
  ];

  const toStep2Btn = document.getElementById('to-step-2');
  const toStep3Btn = document.getElementById('to-step-3');
  const backToStep1Btn = document.getElementById('back-to-step-1');
  const backToStep2Btn = document.getElementById('back-to-step-2');
  const btnSaveStart = document.getElementById('btn-save-start');
  const btnTwitchAuth = document.getElementById('btn-twitch-auth');

  const appMode = document.getElementById('app_mode');
  const appModeHint = document.getElementById('app-mode-hint');
  const clientSecretGroup = document.getElementById('client-secret-group');
  const publicUrlGroup = document.getElementById('public-url-group');
  const deviceCodeBox = document.getElementById('device-code-box');
  const deviceCodeLink = document.getElementById('device-code-link');
  const deviceCodeUserCode = document.getElementById('device-code-user-code');

  const twitchStatus = document.getElementById('twitch-status');
  const twitchClientId = document.getElementById('twitch_client_id');
  const twitchClientSecret = document.getElementById('twitch_client_secret');
  const twitchAutoFields = document.getElementById('twitch-auto-fields');
  const twitchBroadcasterId = document.getElementById('twitch_broadcaster_id');
  const twitchRewardId = document.getElementById('twitch_reward_id');
  const twitchRandomRewardId = document.getElementById('twitch-random_reward_id');

  const googleSheetId = document.getElementById('google_sheet_id');
  const sheetSongColumn = document.getElementById('sheet_song_column');
  const sheetArtistColumn = document.getElementById('sheet_artist_column');
  const historySheetId = document.getElementById('history_sheet_id');
  const dropZone = document.getElementById('drop-zone');
  const credentialsFileInput = document.getElementById('credentials-file');
  const fileStatus = document.getElementById('file-status');
  const publicUrl = document.getElementById('public_url');

  const previewMode = document.getElementById('preview-mode');
  const previewTransport = document.getElementById('preview-transport');
  const previewBroadcaster = document.getElementById('preview-broadcaster');
  const previewSheetId = document.getElementById('preview-sheet-id');
  const saveStatus = document.getElementById('save-status');

  function isLocalMode() {
    return appMode.value === MODE_LOCAL;
  }

  function clearDevicePolling() {
    if (devicePollTimer) {
      clearTimeout(devicePollTimer);
      devicePollTimer = null;
    }
  }

  function goToStep(step) {
    if (step < 1 || step > 3) return;

    panels.forEach((panel, index) => {
      panel.classList.toggle('active', index === step - 1);
    });

    for (let i = 1; i <= 3; i += 1) {
      const dot = document.getElementById(`dot-${i}`);
      const line = document.getElementById(`line-${i - 1}`);
      if (i < step) {
        dot.classList.remove('active');
        dot.classList.add('completed');
        if (line) line.classList.add('active');
      } else if (i === step) {
        dot.classList.remove('completed');
        dot.classList.add('active');
        if (line) line.classList.add('active');
      } else {
        dot.classList.remove('active', 'completed');
        if (line) line.classList.remove('active');
      }
    }

    if (step === 3) {
      previewMode.textContent = isLocalMode() ? 'Local Mode' : 'Server Mode';
      previewTransport.textContent = isLocalMode() ? 'WebSocket' : 'Webhook';
      previewBroadcaster.textContent = twitchBroadcasterId.value || '尚未授權';
      previewSheetId.textContent = googleSheetId.value || '-';
    }
  }

  function updateModeUI() {
    const local = isLocalMode();
    appModeHint.textContent = local
      ? 'Local Mode 不需要 Client Secret，也不需要 PUBLIC_URL。授權會使用 Device Code Flow。'
      : 'Server Mode 需要 Client Secret 與 PUBLIC_URL。授權會使用 Authorization Code Flow。';
    clientSecretGroup.style.display = local ? 'none' : '';
    publicUrlGroup.style.display = local ? 'none' : '';
    btnTwitchAuth.textContent = local ? '開始 Device Code 授權' : '開始 OAuth 授權';

    if (local) {
      twitchClientSecret.value = '';
    }
  }

  function checkStep2Validity() {
    const isSheetIdFilled = googleSheetId.value.trim().length > 0;
    const isFileUploaded = googleCredentialsData !== null;
    toStep3Btn.disabled = !(isSheetIdFilled && isFileUploaded);
  }

  function setTwitchAuthorized(data) {
    clearDevicePolling();
    twitchBroadcasterId.value = data.broadcasterId || '';
    twitchRewardId.value = data.rewardId || '';
    twitchRandomRewardId.value = data.randomRewardId || '';
    twitchUserAccessToken = data.accessToken || '';
    twitchUserRefreshToken = data.refreshToken || '';
    twitchUserTokenExpiresAt = data.expiresIn
      ? new Date(Date.now() + (Number(data.expiresIn) * 1000)).toISOString()
      : '';

    twitchAutoFields.classList.remove('hidden');
    twitchStatus.className = 'status-msg status-success';
    twitchStatus.textContent = `Twitch 已授權完成，Broadcaster ID: ${data.broadcasterId}`;
    btnTwitchAuth.disabled = true;
    twitchClientId.disabled = true;
    twitchClientSecret.disabled = true;
    toStep2Btn.disabled = false;
  }

  async function pollDeviceCode() {
    try {
      const res = await fetch('/api/setup/device-code/poll', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          client_id: twitchClientId.value.trim(),
          device_code: deviceCode,
        }),
      });

      const data = await res.json();
      if (res.ok && data.ok) {
        setTwitchAuthorized(data.data || {});
        deviceCodeBox.classList.add('hidden');
        return;
      }

      if (data.pending) {
        if (data.status === 'slow_down') {
          devicePollIntervalMs += 5000;
        }
        devicePollTimer = setTimeout(pollDeviceCode, devicePollIntervalMs);
        return;
      }

      throw new Error(data.error || 'Device Code 授權失敗');
    } catch (err) {
      clearDevicePolling();
      twitchStatus.className = 'status-msg status-error';
      twitchStatus.textContent = err.message;
      btnTwitchAuth.disabled = false;
    }
  }

  async function beginLocalAuth() {
    const clientId = twitchClientId.value.trim();
    if (!clientId) {
      twitchStatus.className = 'status-msg status-error';
      twitchStatus.textContent = '請先填入 Twitch Client ID。';
      return;
    }

    twitchStatus.className = 'status-msg status-pending';
    twitchStatus.textContent = '正在向 Twitch 申請 Device Code...';
    btnTwitchAuth.disabled = true;

    try {
      const res = await fetch('/api/setup/device-code/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ client_id: clientId }),
      });

      const data = await res.json();
      if (!res.ok || !data.ok) {
        throw new Error(data.error || '無法建立 Device Code 授權');
      }

      deviceCode = data.deviceCode;
      devicePollIntervalMs = Math.max(Number(data.interval || 5) * 1000, 5000);
      deviceCodeLink.href = data.verificationUri;
      deviceCodeUserCode.textContent = data.userCode;
      deviceCodeBox.classList.remove('hidden');

      twitchStatus.textContent = '請在瀏覽器完成 Twitch 授權，系統會自動偵測。';
      clearDevicePolling();
      devicePollTimer = setTimeout(pollDeviceCode, devicePollIntervalMs);
    } catch (err) {
      btnTwitchAuth.disabled = false;
      twitchStatus.className = 'status-msg status-error';
      twitchStatus.textContent = err.message;
    }
  }

  async function beginServerAuth() {
    const clientId = twitchClientId.value.trim();
    const clientSecret = twitchClientSecret.value.trim();
    if (!clientId || !clientSecret) {
      twitchStatus.className = 'status-msg status-error';
      twitchStatus.textContent = 'Server Mode 需要 Twitch Client ID 與 Client Secret。';
      return;
    }

    twitchStatus.className = 'status-msg status-pending';
    twitchStatus.textContent = '正在建立 Twitch OAuth 授權流程...';
    btnTwitchAuth.disabled = true;

    try {
      const res = await fetch('/api/setup/twitch-auth-url', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          client_id: clientId,
          client_secret: clientSecret,
        }),
      });

      const data = await res.json();
      if (!res.ok || !data.ok || !data.authUrl) {
        throw new Error(data.error || '無法建立 Twitch OAuth 授權網址');
      }

      const width = 600;
      const height = 700;
      const left = (window.screen.width / 2) - (width / 2);
      const top = (window.screen.height / 2) - (height / 2);
      const authWindow = window.open(data.authUrl, 'Twitch Auth', `width=${width},height=${height},left=${left},top=${top}`);
      if (!authWindow) {
        throw new Error('瀏覽器阻擋了彈出視窗，請允許彈窗後再試一次。');
      }

      twitchStatus.textContent = '請在新視窗完成 Twitch 授權。';
    } catch (err) {
      btnTwitchAuth.disabled = false;
      twitchStatus.className = 'status-msg status-error';
      twitchStatus.textContent = err.message;
    }
  }

  function handleFile(file) {
    if (file.type !== 'application/json' && !file.name.endsWith('.json')) {
      fileStatus.className = 'file-status-msg status-error';
      fileStatus.textContent = '請上傳 JSON 憑證檔案。';
      googleCredentialsData = null;
      checkStep2Validity();
      return;
    }

    const reader = new FileReader();
    reader.onload = event => {
      try {
        const json = JSON.parse(event.target.result);
        if (json.type === 'service_account' && json.client_email && json.private_key) {
          googleCredentialsData = json;
          fileStatus.className = 'file-status-msg status-success';
          fileStatus.innerHTML = `憑證已載入：<br><code>${json.client_email}</code>`;
          dropZone.querySelector('.drop-zone__prompt').textContent = `已選擇 ${file.name}`;
        } else {
          throw new Error('這不是有效的 Google service account JSON。');
        }
      } catch (err) {
        googleCredentialsData = null;
        fileStatus.className = 'file-status-msg status-error';
        fileStatus.textContent = err.message;
      }
      checkStep2Validity();
    };
    reader.readAsText(file);
  }

  async function saveConfiguration() {
    btnSaveStart.disabled = true;
    saveStatus.className = 'status-msg status-pending';
    saveStatus.textContent = '正在儲存設定並啟動服務...';

    const payload = {
      app_mode: appMode.value,
      twitch_client_id: twitchClientId.value.trim(),
      twitch_client_secret: twitchClientSecret.value.trim(),
      twitch_broadcaster_id: twitchBroadcasterId.value.trim(),
      twitch_reward_id: twitchRewardId.value.trim(),
      twitch_random_reward_id: twitchRandomRewardId.value.trim(),
      twitch_user_access_token: twitchUserAccessToken,
      twitch_user_refresh_token: twitchUserRefreshToken,
      twitch_user_token_expires_at: twitchUserTokenExpiresAt,
      google_sheet_id: googleSheetId.value.trim(),
      sheet_song_column: sheetSongColumn.value.trim() || 'title',
      sheet_artist_column: sheetArtistColumn.value.trim() || 'artist',
      history_sheet_id: historySheetId.value.trim(),
      google_credentials: googleCredentialsData,
      public_url: publicUrl.value.trim(),
    };

    try {
      const res = await fetch('/api/setup/save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      const data = await res.json();
      if (!res.ok || !data.ok) {
        throw new Error(data.error || '儲存設定失敗');
      }

      saveStatus.className = 'status-msg status-success';
      saveStatus.innerHTML = '設定已儲存，系統正在初始化。<br>3 秒後將跳轉到控制台。';
      setTimeout(() => {
        window.location.href = '/dashboard/index.html';
      }, 3000);
    } catch (err) {
      btnSaveStart.disabled = false;
      saveStatus.className = 'status-msg status-error';
      saveStatus.textContent = err.message;
    }
  }

  toStep2Btn.addEventListener('click', () => goToStep(2));
  backToStep1Btn.addEventListener('click', () => goToStep(1));
  toStep3Btn.addEventListener('click', () => goToStep(3));
  backToStep2Btn.addEventListener('click', () => goToStep(2));

  appMode.addEventListener('change', updateModeUI);
  btnTwitchAuth.addEventListener('click', () => {
    if (isLocalMode()) {
      beginLocalAuth();
    } else {
      beginServerAuth();
    }
  });
  googleSheetId.addEventListener('input', checkStep2Validity);
  btnSaveStart.addEventListener('click', saveConfiguration);

  dropZone.addEventListener('click', () => credentialsFileInput.click());
  ['dragenter', 'dragover'].forEach(eventName => {
    dropZone.addEventListener(eventName, event => {
      event.preventDefault();
      dropZone.classList.add('drop-zone--over');
    });
  });
  ['dragleave', 'drop'].forEach(eventName => {
    dropZone.addEventListener(eventName, event => {
      event.preventDefault();
      dropZone.classList.remove('drop-zone--over');
    });
  });
  dropZone.addEventListener('drop', event => {
    const files = event.dataTransfer.files;
    if (files.length) handleFile(files[0]);
  });
  credentialsFileInput.addEventListener('change', () => {
    if (credentialsFileInput.files.length) handleFile(credentialsFileInput.files[0]);
  });

  window.addEventListener('message', event => {
    if (event.origin !== window.location.origin) return;
    const msg = event.data;
    if (msg?.type === 'TWITCH_AUTH_SUCCESS') {
      setTwitchAuthorized(msg.data || {});
    } else if (msg?.type === 'TWITCH_AUTH_ERROR') {
      btnTwitchAuth.disabled = false;
      twitchStatus.className = 'status-msg status-error';
      twitchStatus.textContent = msg.error || 'Twitch 授權失敗';
    }
  });

  updateModeUI();
  checkStep2Validity();
});
