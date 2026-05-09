const crypto = require('node:crypto');
const express = require('express');
const { TwitchApi } = require('../twitch-api');
const { normalizeChannelLogin, defaultFeatures } = require('../channel-store');

function randomToken(bytes = 24) {
  return crypto.randomBytes(bytes).toString('hex');
}

function parseCookies(req) {
  const header = req.headers.cookie || '';
  const cookies = {};
  for (const part of header.split(';')) {
    const [rawKey, ...rawValue] = part.trim().split('=');
    if (!rawKey) continue;
    cookies[rawKey] = decodeURIComponent(rawValue.join('=') || '');
  }
  return cookies;
}

function sign(value, secret) {
  return crypto.createHmac('sha256', secret).update(value).digest('hex');
}

function readSignedCookie(req, name, secret) {
  const cookies = parseCookies(req);
  const raw = cookies[name];
  if (!raw) return null;
  const [value, sig] = raw.split('.');
  if (!value || !sig) return null;
  const expected = sign(value, secret);
  if (sig.length !== expected.length) {
    return null;
  }
  if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) {
    return null;
  }
  return value;
}

function setSignedCookie(res, name, value, secret) {
  const sig = sign(value, secret);
  const cookieValue = `${value}.${sig}`;
  res.setHeader('Set-Cookie', `${name}=${encodeURIComponent(cookieValue)}; Path=/; HttpOnly; SameSite=Lax`);
}

function clearCookie(res, name) {
  res.setHeader('Set-Cookie', `${name}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax`);
}

function toBool(value) {
  if (value == null) return false;
  return ['1', 'true', 'yes', 'on'].includes(String(value).toLowerCase());
}

function escapeHtml(text) {
  return String(text || '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function maskSecret(secret) {
  if (!secret) return '';
  if (secret.length <= 6) return '••••••';
  return `${'•'.repeat(Math.min(secret.length - 4, 12))}${secret.slice(-4)}`;
}

function page(title, bodyHtml) {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(title)}</title>
  <style>
    :root { color-scheme: dark; }
    body { font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Arial; background:#0b0f19; color:#e5e7eb; margin:0; }
    a { color:#93c5fd; }
    header { padding:16px 20px; border-bottom:1px solid #1f2937; background:#0b1220; position:sticky; top:0; }
    main { padding:20px; max-width:980px; margin:0 auto; }
    .card { border:1px solid #1f2937; border-radius:12px; padding:16px; background:#0b1220; margin:14px 0; }
    .row { display:flex; gap:14px; flex-wrap:wrap; }
    .row > * { flex: 1 1 240px; }
    label { display:block; font-size:12px; opacity:0.9; margin-bottom:6px; }
    input[type="text"], input[type="password"], input[type="url"], select { width:100%; padding:10px 12px; border-radius:10px; border:1px solid #1f2937; background:#0b0f19; color:#e5e7eb; }
    input[type="checkbox"] { transform: translateY(1px); }
    .muted { opacity:0.75; font-size:12px; }
    .btn { display:inline-block; border:1px solid #1f2937; background:#111827; color:#e5e7eb; padding:10px 12px; border-radius:10px; cursor:pointer; }
    .btn.primary { background:#1d4ed8; border-color:#1d4ed8; }
    .btn.danger { background:#7f1d1d; border-color:#7f1d1d; }
    .badge { font-size:12px; padding:4px 8px; border-radius:999px; border:1px solid #1f2937; background:#0b0f19; display:inline-block; }
    .divider { height:1px; background:#1f2937; margin:14px 0; }
    .grid2 { display:grid; grid-template-columns: 1fr 1fr; gap:12px; }
    @media (max-width: 760px) { .grid2 { grid-template-columns: 1fr; } }
  </style>
</head>
<body>
  <header>
    <div style="display:flex; justify-content:space-between; align-items:center; gap:12px;">
      <div><strong>Twitch-CoPilot</strong> <span class="muted">Channel enrollment & settings</span></div>
      <div>${bodyHtml.includes('data-logged-in="true"') ? '<form method="post" action="/auth/logout" style="margin:0"><button class="btn danger" type="submit">Log out</button></form>' : ''}</div>
    </div>
  </header>
  <main>${bodyHtml}</main>
</body>
</html>`;
}

async function fetchTwitchUser({ clientId, clientSecret, code, redirectUri }) {
  const tokenUrl = new URL('https://id.twitch.tv/oauth2/token');
  tokenUrl.searchParams.set('client_id', clientId);
  tokenUrl.searchParams.set('client_secret', clientSecret);
  tokenUrl.searchParams.set('code', code);
  tokenUrl.searchParams.set('grant_type', 'authorization_code');
  tokenUrl.searchParams.set('redirect_uri', redirectUri);

  const tokenRes = await fetch(tokenUrl, { method: 'POST' });
  if (!tokenRes.ok) {
    throw new Error(`oauth token exchange failed with ${tokenRes.status}`);
  }
  const tokenPayload = await tokenRes.json();
  const accessToken = tokenPayload.access_token;
  if (!accessToken) {
    throw new Error('oauth token response missing access_token');
  }

  const userRes = await fetch('https://api.twitch.tv/helix/users', {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Client-Id': clientId
    }
  });
  if (!userRes.ok) {
    throw new Error(`helix users call failed with ${userRes.status}`);
  }
  const userPayload = await userRes.json();
  const user = Array.isArray(userPayload.data) ? userPayload.data[0] : null;
  if (!user?.login) {
    throw new Error('helix users response missing user login');
  }

  return {
    login: user.login,
    displayName: user.display_name || user.login
  };
}

function renderChannelSettings({ channel, streamContext, viewerLogin }) {
  const canEdit = normalizeChannelLogin(viewerLogin) === normalizeChannelLogin(channel.login);
  const features = { ...defaultFeatures(), ...(channel.features || {}) };
  const liveBadge = streamContext?.live ? '<span class="badge">LIVE</span>' : '<span class="badge">OFFLINE</span>';

  const readOnlyAttr = canEdit ? '' : 'disabled';
  const editNote = canEdit ? '' : `<div class="muted">Log in as <code>${escapeHtml(channel.login)}</code> to edit settings for this channel.</div>`;

  return `<div class="card">
  <div style="display:flex; justify-content:space-between; align-items:center; gap:12px;">
    <div>
      <div style="font-size:18px;"><strong>#${escapeHtml(channel.login)}</strong> <span class="muted">${escapeHtml(channel.displayName || channel.login)}</span></div>
      <div class="muted">Stream: ${liveBadge} ${escapeHtml(streamContext?.gameName || '')} ${escapeHtml(streamContext?.title || '')}</div>
    </div>
    <div class="muted">Updated: ${escapeHtml(channel.updatedAt || '')}</div>
  </div>
  <div class="divider"></div>
  ${editNote}
  <form method="post" action="/channels/${encodeURIComponent(channel.login)}/settings">
    <div class="row">
      <label><input type="checkbox" name="features.enabled" value="1" ${features.enabled ? 'checked' : ''} ${readOnlyAttr}/> Enabled</label>
      <label><input type="checkbox" name="features.respondToChat" value="1" ${features.respondToChat ? 'checked' : ''} ${readOnlyAttr}/> Respond in chat</label>
      <label><input type="checkbox" name="features.welcomeNewChatters" value="1" ${features.welcomeNewChatters ? 'checked' : ''} ${readOnlyAttr}/> Welcome new chatters</label>
      <label><input type="checkbox" name="features.commentary" value="1" ${features.commentary ? 'checked' : ''} ${readOnlyAttr}/> Commentary</label>
      <label><input type="checkbox" name="features.transcript" value="1" ${features.transcript ? 'checked' : ''} ${readOnlyAttr}/> Transcript ingestion</label>
      <label><input type="checkbox" name="features.memory" value="1" ${features.memory ? 'checked' : ''} ${readOnlyAttr}/> Vector memory</label>
    </div>

    <div class="divider"></div>
    <div class="grid2">
      <div>
        <label>AI provider</label>
        <select name="ai.provider" ${readOnlyAttr}>
          <option value="">(use global default)</option>
          <option value="fallback" ${channel.ai?.provider === 'fallback' ? 'selected' : ''}>fallback</option>
          <option value="gemini" ${channel.ai?.provider === 'gemini' ? 'selected' : ''}>gemini</option>
          <option value="local" ${channel.ai?.provider === 'local' ? 'selected' : ''}>local</option>
        </select>
        <div class="muted">Set only if you want per-channel model selection.</div>
      </div>
      <div>
        <label>Temperature</label>
        <input type="text" name="ai.temperature" value="${escapeHtml(channel.ai?.temperature ?? '')}" placeholder="(use global default)" ${readOnlyAttr}/>
      </div>
    </div>

    <div class="grid2">
      <div>
        <label>Gemini model</label>
        <input type="text" name="ai.geminiModel" value="${escapeHtml(channel.ai?.geminiModel || '')}" placeholder="(use global default)" ${readOnlyAttr}/>
      </div>
      <div>
        <label>Local model</label>
        <input type="text" name="ai.localModel" value="${escapeHtml(channel.ai?.localModel || '')}" placeholder="(use global default)" ${readOnlyAttr}/>
      </div>
    </div>

    <div class="grid2">
      <div>
        <label>Gemini API key <span class="muted">${channel.apiKeys?.geminiApiKey ? `(saved: ${escapeHtml(maskSecret(channel.apiKeys.geminiApiKey))})` : ''}</span></label>
        <input type="password" name="apiKeys.geminiApiKey" value="" placeholder="(leave blank to keep existing)" ${readOnlyAttr}/>
        <label class="muted"><input type="checkbox" name="apiKeys.clearGeminiApiKey" value="1" ${readOnlyAttr}/> Clear saved key</label>
      </div>
      <div>
        <label>Local LLM URL</label>
        <input type="url" name="apiKeys.localUrl" value="${escapeHtml(channel.apiKeys?.localUrl || '')}" placeholder="(use global default)" ${readOnlyAttr}/>
      </div>
    </div>

    <div class="grid2">
      <div>
        <label>Twitch Client ID <span class="muted">(optional override)</span></label>
        <input type="text" name="twitch.clientId" value="${escapeHtml(channel.twitch?.clientId || '')}" placeholder="(use global default)" ${readOnlyAttr}/>
      </div>
      <div>
        <label>Twitch Client Secret <span class="muted">${channel.twitch?.clientSecret ? `(saved: ${escapeHtml(maskSecret(channel.twitch.clientSecret))})` : ''}</span></label>
        <input type="password" name="twitch.clientSecret" value="" placeholder="(leave blank to keep existing)" ${readOnlyAttr}/>
        <label class="muted"><input type="checkbox" name="twitch.clearClientSecret" value="1" ${readOnlyAttr}/> Clear saved secret</label>
      </div>
    </div>

    <div style="display:flex; gap:12px; justify-content:flex-end; margin-top:12px;">
      <button class="btn primary" type="submit" ${canEdit ? '' : 'disabled'}>Save settings</button>
    </div>
  </form>
</div>`;
}

function createWebServer({ config, channelStore, onChannelConfigChanged }) {
  const app = express();
  app.disable('x-powered-by');
  app.use(express.urlencoded({ extended: false }));

  const sessionSecret = config.web.sessionSecret;
  const sessions = new Map(); // sessionId -> { login, displayName, createdAt }
  const states = new Map(); // oauthState -> createdAtMs
  const twitchApi = new TwitchApi(config.twitch);

  if (!sessionSecret) {
    console.warn('[web] WEB_SESSION_SECRET is not set; logins will not persist safely.');
  }

  function requireSession(req) {
    if (!sessionSecret) return null;
    const sessionId = readSignedCookie(req, 'tcpsess', sessionSecret);
    if (!sessionId) return null;
    return sessions.get(sessionId) || null;
  }

  app.get('/healthz', (_req, res) => {
    res.status(200).type('text/plain').send('ok');
  });

  app.get('/auth/login', (req, res) => {
    if (!config.twitch.clientId || !config.twitch.clientSecret) {
      res.status(500).type('text/html').send(page('Missing config', `<div class="card"><div>Set <code>TWITCH_CLIENT_ID</code> and <code>TWITCH_CLIENT_SECRET</code> to enable OAuth enrollment.</div></div>`));
      return;
    }

    const state = randomToken(16);
    states.set(state, Date.now());

    const redirectUri = new URL('/auth/callback', config.web.publicUrl).toString();
    const url = new URL('https://id.twitch.tv/oauth2/authorize');
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('client_id', config.twitch.clientId);
    url.searchParams.set('redirect_uri', redirectUri);
    url.searchParams.set('scope', 'user:read:email');
    url.searchParams.set('state', state);
    url.searchParams.set('force_verify', 'true');
    res.redirect(url.toString());
  });

  app.get('/auth/callback', async (req, res) => {
    try {
      const { code, state, error, error_description } = req.query || {};
      if (error) {
        res.status(400).type('text/html').send(page('OAuth error', `<div class="card"><div>${escapeHtml(String(error))}</div><div class="muted">${escapeHtml(String(error_description || ''))}</div></div>`));
        return;
      }

      if (!code || !state || typeof code !== 'string' || typeof state !== 'string') {
        res.status(400).type('text/html').send(page('OAuth error', `<div class="card"><div>Missing OAuth callback parameters.</div></div>`));
        return;
      }

      const createdAt = states.get(state);
      states.delete(state);
      if (!createdAt || Date.now() - createdAt > 10 * 60 * 1000) {
        res.status(400).type('text/html').send(page('OAuth error', `<div class="card"><div>Invalid or expired OAuth state.</div></div>`));
        return;
      }

      const redirectUri = new URL('/auth/callback', config.web.publicUrl).toString();
      const user = await fetchTwitchUser({
        clientId: config.twitch.clientId,
        clientSecret: config.twitch.clientSecret,
        code,
        redirectUri
      });

      await channelStore.enrollFromTwitchUser(user);

      const sessionId = randomToken(24);
      sessions.set(sessionId, { ...user, createdAt: new Date().toISOString() });
      if (sessionSecret) {
        setSignedCookie(res, 'tcpsess', sessionId, sessionSecret);
      }

      onChannelConfigChanged?.();
      res.redirect('/');
    } catch (error) {
      res.status(500).type('text/html').send(page('Server error', `<div class="card"><div>OAuth enrollment failed.</div><div class="muted">${escapeHtml(error?.message || String(error))}</div></div>`));
    }
  });

  app.post('/auth/logout', (req, res) => {
    if (sessionSecret) {
      const sessionId = readSignedCookie(req, 'tcpsess', sessionSecret);
      if (sessionId) sessions.delete(sessionId);
      clearCookie(res, 'tcpsess');
    }
    res.redirect('/');
  });

  app.get('/', async (req, res) => {
    const session = requireSession(req);
    const channels = await channelStore.list();

    if (!session) {
      const content = `<div class="card">
  <div style="font-size:18px;"><strong>Enroll your channel</strong></div>
  <div class="muted">Log in with Twitch to enroll the channel associated with your account.</div>
  <div style="margin-top:12px;">
    <a class="btn primary" href="/auth/login">Log in with Twitch</a>
  </div>
  <div class="divider"></div>
  <div class="muted">After enrolling, this page shows per-channel feature toggles and optional per-channel API keys / model settings.</div>
</div>`;

      res.status(200).type('text/html').send(page('Twitch-CoPilot', content));
      return;
    }

    const contexts = await Promise.all(
      channels.map(async (channel) => {
        const effectiveTwitchConfig = {
          clientId: channel.twitch?.clientId || config.twitch.clientId,
          clientSecret: channel.twitch?.clientSecret || config.twitch.clientSecret
        };
        const api = effectiveTwitchConfig.clientId && effectiveTwitchConfig.clientSecret ? new TwitchApi(effectiveTwitchConfig) : twitchApi;
        let streamContext = null;
        try {
          streamContext = await api.getStreamContext(channel.login);
        } catch (error) {
          streamContext = { live: false, title: `context error: ${error.message}`, gameName: '', userName: channel.login };
        }

        return renderChannelSettings({ channel, streamContext, viewerLogin: session.login });
      })
    );

    const content = `<div class="card" data-logged-in="true">
  <div style="display:flex; justify-content:space-between; gap:12px; flex-wrap:wrap; align-items:baseline;">
    <div>
      <div style="font-size:18px;"><strong>Logged in as</strong> ${escapeHtml(session.displayName)} <span class="muted">(${escapeHtml(session.login)})</span></div>
      <div class="muted">Enrolled channels: ${channels.length}</div>
    </div>
    <div><a class="btn" href="/auth/login">Enroll another channel</a></div>
  </div>
</div>
${contexts.join('\n')}`;

    res.status(200).type('text/html').send(page('Twitch-CoPilot', content));
  });

  app.post('/channels/:login/settings', async (req, res) => {
    const session = requireSession(req);
    if (!session) {
      res.status(401).type('text/html').send(page('Unauthorized', `<div class="card"><div>Please log in.</div></div>`));
      return;
    }

    const login = normalizeChannelLogin(req.params.login);
    if (!login) {
      res.status(400).type('text/html').send(page('Bad request', `<div class="card"><div>Missing channel login.</div></div>`));
      return;
    }

    if (normalizeChannelLogin(session.login) !== login) {
      res.status(403).type('text/html').send(page('Forbidden', `<div class="card"><div>You can only edit settings for your own channel.</div></div>`));
      return;
    }

    const body = req.body || {};
    const patch = {
      features: {
        enabled: toBool(body['features.enabled']),
        respondToChat: toBool(body['features.respondToChat']),
        welcomeNewChatters: toBool(body['features.welcomeNewChatters']),
        commentary: toBool(body['features.commentary']),
        transcript: toBool(body['features.transcript']),
        memory: toBool(body['features.memory'])
      },
      ai: {},
      apiKeys: {},
      twitch: {}
    };

    const provider = String(body['ai.provider'] || '').trim();
    if (provider) patch.ai.provider = provider;

    const tempRaw = String(body['ai.temperature'] || '').trim();
    if (tempRaw) {
      const parsed = Number.parseFloat(tempRaw);
      if (Number.isFinite(parsed)) patch.ai.temperature = parsed;
    }

    const geminiModel = String(body['ai.geminiModel'] || '').trim();
    if (geminiModel) patch.ai.geminiModel = geminiModel;

    const localModel = String(body['ai.localModel'] || '').trim();
    if (localModel) patch.ai.localModel = localModel;

    const localUrl = String(body['apiKeys.localUrl'] || '').trim();
    if (localUrl) patch.apiKeys.localUrl = localUrl;

    if (toBool(body['apiKeys.clearGeminiApiKey'])) {
      patch.apiKeys.geminiApiKey = '';
    } else {
      const geminiKey = String(body['apiKeys.geminiApiKey'] || '').trim();
      if (geminiKey) patch.apiKeys.geminiApiKey = geminiKey;
    }

    const twitchClientId = String(body['twitch.clientId'] || '').trim();
    if (twitchClientId) patch.twitch.clientId = twitchClientId;

    if (toBool(body['twitch.clearClientSecret'])) {
      patch.twitch.clientSecret = '';
    } else {
      const twitchClientSecret = String(body['twitch.clientSecret'] || '').trim();
      if (twitchClientSecret) patch.twitch.clientSecret = twitchClientSecret;
    }

    await channelStore.upsert(login, patch);
    onChannelConfigChanged?.();
    res.redirect('/');
  });

  const server = app.listen(config.web.port, () => {
    console.log(`[web] settings available on ${config.web.publicUrl}`);
  });

  return {
    close: async () => new Promise((resolve) => server.close(() => resolve()))
  };
}

module.exports = {
  createWebServer
};
