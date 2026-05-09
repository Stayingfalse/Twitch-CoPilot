const { defaultFeatures, normalizeChannelLogin } = require('./channel-store');

function resolveChannelRuntimeConfig(baseConfig, channelRecord) {
  const channel = normalizeChannelLogin(channelRecord?.login || baseConfig.channel);
  const features = { ...defaultFeatures(), ...(channelRecord?.features || {}) };

  const twitchOverride = channelRecord?.twitch || {};
  const apiKeys = channelRecord?.apiKeys || {};
  const aiOverride = channelRecord?.ai || {};

  return {
    ...baseConfig,
    channel,
    channelRecord: channelRecord || null,
    channelFeatures: features,
    twitch: {
      ...baseConfig.twitch,
      ...twitchOverride
    },
    ai: {
      ...baseConfig.ai,
      ...aiOverride,
      geminiApiKey: apiKeys.geminiApiKey || baseConfig.ai.geminiApiKey,
      localUrl: apiKeys.localUrl || baseConfig.ai.localUrl
    },
    transcript: {
      ...baseConfig.transcript,
      channel,
      source: features.transcript ? baseConfig.transcript.source : 'none'
    },
    memory: {
      ...baseConfig.memory,
      namespace: channel || baseConfig.memory.namespace
    }
  };
}

module.exports = {
  resolveChannelRuntimeConfig
};

