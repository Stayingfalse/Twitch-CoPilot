const { loadConfig, validateConfig } = require('./config');
const { TwitchCopilotBot } = require('./bot');
const { ChannelStore } = require('./channel-store');
const { createWebServer } = require('./web/server');

async function main() {
  const config = loadConfig();
  const issues = validateConfig(config);

  if (issues.length) {
    console.error('Configuration issues:');
    for (const issue of issues) {
      console.error(`- ${issue}`);
    }

    process.exitCode = 1;
    return;
  }

  const channelStore = new ChannelStore({ filePath: config.channels.storePath });
  let bot = null;
  let webServer = null;

  const stopAll = async () => {
    await Promise.allSettled([bot?.stop?.(), webServer?.close?.()]);
  };

  for (const signal of ['SIGINT', 'SIGTERM']) {
    process.on(signal, async () => {
      await stopAll();
      process.exit(0);
    });
  }

  webServer = createWebServer({
    config,
    channelStore,
    onChannelConfigChanged: () => {
      // Multi-channel joining is wired up in the next step; keep the hook for now.
    }
  });

  if (config.channel) {
    bot = new TwitchCopilotBot(config);
    await bot.start();
  } else {
    console.log('[bot] no TWITCH_CHANNEL set yet; waiting for OAuth enrollment via the web UI');
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
