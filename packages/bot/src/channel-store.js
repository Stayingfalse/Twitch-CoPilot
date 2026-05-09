const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');

function nowIso() {
  return new Date().toISOString();
}

function normalizeChannelLogin(login) {
  return String(login || '')
    .trim()
    .replace(/^#/, '')
    .toLowerCase();
}

function defaultFeatures() {
  return {
    enabled: true,
    welcomeNewChatters: true,
    respondToChat: true,
    commentary: true,
    transcript: true,
    memory: true
  };
}

function defaultChannelRecord({ login, displayName }) {
  const createdAt = nowIso();
  return {
    login,
    displayName: displayName || login,
    createdAt,
    updatedAt: createdAt,
    features: defaultFeatures(),
    twitch: {},
    ai: {},
    apiKeys: {}
  };
}

async function readJsonFile(filePath) {
  try {
    const raw = await fs.readFile(filePath, 'utf8');
    return JSON.parse(raw);
  } catch (error) {
    if (error && (error.code === 'ENOENT' || error.code === 'ENOTDIR')) {
      return null;
    }
    throw error;
  }
}

async function atomicWriteJson(filePath, payload) {
  const dir = path.dirname(filePath);
  await fs.mkdir(dir, { recursive: true });
  const tempName = `${path.basename(filePath)}.${crypto.randomBytes(6).toString('hex')}.tmp`;
  const tempPath = path.join(dir, tempName);
  await fs.writeFile(tempPath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
  await fs.rename(tempPath, filePath);
}

class ChannelStore {
  constructor({ filePath }) {
    this.filePath = filePath;
  }

  async load() {
    const data = await readJsonFile(this.filePath);
    if (data && typeof data === 'object' && data.version === 1 && data.channels && typeof data.channels === 'object') {
      return data;
    }

    return { version: 1, channels: {} };
  }

  async list() {
    const data = await this.load();
    return Object.values(data.channels || {}).sort((a, b) => String(a.login).localeCompare(String(b.login)));
  }

  async get(login) {
    const normalized = normalizeChannelLogin(login);
    if (!normalized) {
      return null;
    }
    const data = await this.load();
    return data.channels?.[normalized] || null;
  }

  async upsert(login, patch) {
    const normalized = normalizeChannelLogin(login);
    if (!normalized) {
      throw new Error('channel login is required');
    }

    const data = await this.load();
    const existing = data.channels?.[normalized] || defaultChannelRecord({ login: normalized, displayName: normalized });
    const updated = {
      ...existing,
      ...patch,
      login: normalized,
      updatedAt: nowIso(),
      features: { ...defaultFeatures(), ...(existing.features || {}), ...(patch.features || {}) },
      twitch: { ...(existing.twitch || {}), ...(patch.twitch || {}) },
      ai: { ...(existing.ai || {}), ...(patch.ai || {}) },
      apiKeys: { ...(existing.apiKeys || {}), ...(patch.apiKeys || {}) }
    };

    data.channels = data.channels || {};
    data.channels[normalized] = updated;
    await atomicWriteJson(this.filePath, data);
    return updated;
  }

  async enrollFromTwitchUser({ login, displayName }) {
    const normalized = normalizeChannelLogin(login);
    if (!normalized) {
      throw new Error('twitch user login missing');
    }

    const existing = await this.get(normalized);
    if (existing) {
      return this.upsert(normalized, {
        displayName: displayName || existing.displayName || normalized
      });
    }

    return this.upsert(normalized, defaultChannelRecord({ login: normalized, displayName: displayName || normalized }));
  }
}

module.exports = {
  ChannelStore,
  normalizeChannelLogin,
  defaultFeatures
};

