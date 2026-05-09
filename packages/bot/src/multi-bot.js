const tmi = require('tmi.js');
const { TwitchCopilotChannelSession } = require('./channel-session');
const { createSharedMcpClient } = require('./vector-memory');
const { defaultFeatures, normalizeChannelLogin } = require('./channel-store');

function toChannelRecordFromEnv(login) {
  const normalized = normalizeChannelLogin(login);
  if (!normalized) return null;
  const now = new Date().toISOString();
  return {
    login: normalized,
    displayName: normalized,
    createdAt: now,
    updatedAt: now,
    features: defaultFeatures(),
    twitch: {},
    ai: {},
    apiKeys: {}
  };
}

class TwitchCopilotMultiBot {
  constructor({ config, channelStore }) {
    this.config = config;
    this.channelStore = channelStore;
    this.client = null;
    this.sharedMcpClient = null;
    this.sessions = new Map(); // login -> TwitchCopilotChannelSession
    this.reloadLock = Promise.resolve();
  }

  async computeDesiredChannels() {
    const stored = await this.channelStore.list();
    const enabledStored = stored.filter((channel) => (channel.features?.enabled ?? true) === true);
    const desired = new Map(enabledStored.map((channel) => [normalizeChannelLogin(channel.login), channel]));

    const envRecord = toChannelRecordFromEnv(this.config.channel);
    if (envRecord && !desired.has(envRecord.login)) {
      desired.set(envRecord.login, envRecord);
    }

    return Array.from(desired.values()).filter((record) => record && record.login);
  }

  async start() {
    const desired = await this.computeDesiredChannels();

    const needsMcp = desired.some((channel) => (channel.features?.memory ?? true) === true);
    if (needsMcp) {
      this.sharedMcpClient = await createSharedMcpClient(this.config.memory?.mcp);
    }

    if (this.config.dryRun) {
      this.client = {
        say: async (channel, message) => console.log(`[dry-run][irc][#${channel}] ${message}`),
        join: async () => {},
        part: async () => {},
        connect: async () => {},
        disconnect: async () => {}
      };
    } else {
      this.client = new tmi.Client({
        identity: {
          username: this.config.twitch.botUsername,
          password: this.config.twitch.botOauth
        },
        channels: []
      });

      this.client.on('message', async (rawChannel, tags, message, self) => {
        const channel = normalizeChannelLogin(rawChannel);
        const session = this.sessions.get(channel);
        if (!session) return;

        try {
          await session.handleChatMessage(tags, message, self);
        } catch (error) {
          console.error(`[${channel}] message handling failed:`, error);
        }
      });

      await this.client.connect();
      console.log('[bot] connected to Twitch IRC');
    }

    for (const record of desired) {
      await this.addOrUpdateSession(record);
      await this.joinChannel(record.login);
    }

    if (!desired.length) {
      console.log('[bot] no channels enrolled yet; use the web UI to enroll via OAuth');
    }
  }

  async joinChannel(login) {
    if (this.config.dryRun) return;
    try {
      await this.client.join(login);
      console.log(`[bot] joined #${login}`);
    } catch (error) {
      if (String(error?.message || '').includes('already joined')) {
        return;
      }
      console.warn(`[bot] join failed for #${login}:`, error?.message || error);
    }
  }

  async partChannel(login) {
    if (this.config.dryRun) return;
    try {
      await this.client.part(login);
      console.log(`[bot] parted #${login}`);
    } catch (error) {
      console.warn(`[bot] part failed for #${login}:`, error?.message || error);
    }
  }

  async addOrUpdateSession(record) {
    const login = normalizeChannelLogin(record.login);
    const existing = this.sessions.get(login);
    if (existing && existing.getUpdatedAt() === (record.updatedAt || '')) {
      return;
    }

    if (existing) {
      await existing.stop();
      this.sessions.delete(login);
    }

    const session = new TwitchCopilotChannelSession({
      baseConfig: this.config,
      channelRecord: record,
      sharedMcpClient: this.sharedMcpClient,
      tmiClient: this.client
    });
    await session.start();
    this.sessions.set(login, session);
  }

  reloadChannels() {
    this.reloadLock = this.reloadLock.then(() => this.reloadChannelsInternal()).catch((error) => {
      console.error('[bot] reload failed:', error);
    });
    return this.reloadLock;
  }

  async reloadChannelsInternal() {
    const desired = await this.computeDesiredChannels();
    const desiredMap = new Map(desired.map((record) => [normalizeChannelLogin(record.login), record]));

    const needsMcp = desired.some((channel) => (channel.features?.memory ?? true) === true);
    let mcpBecameAvailable = false;
    if (needsMcp && !this.sharedMcpClient) {
      this.sharedMcpClient = await createSharedMcpClient(this.config.memory?.mcp);
      mcpBecameAvailable = Boolean(this.sharedMcpClient);
    }

    if (mcpBecameAvailable) {
      // Restart existing sessions so they can use the shared MCP transport.
      for (const [login, session] of Array.from(this.sessions.entries())) {
        await session.stop();
        this.sessions.delete(login);
      }
    }

    // Remove channels that are no longer desired.
    for (const [login, session] of this.sessions.entries()) {
      if (desiredMap.has(login)) continue;
      await session.stop();
      this.sessions.delete(login);
      await this.partChannel(login);
    }

    // Add or update desired channels.
    for (const record of desired) {
      await this.addOrUpdateSession(record);
      await this.joinChannel(normalizeChannelLogin(record.login));
    }
  }

  async stop() {
    await Promise.allSettled(Array.from(this.sessions.values()).map((session) => session.stop()));
    this.sessions.clear();

    if (this.client) {
      await this.client.disconnect();
    }

    if (this.sharedMcpClient) {
      await this.sharedMcpClient.close();
    }
  }
}

module.exports = {
  TwitchCopilotMultiBot
};
