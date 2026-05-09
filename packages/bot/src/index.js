const { loadConfig, validateConfig } = require('./config');
const { ChannelStore } = require('./channel-store');
const { createWebServer } = require('./web/server');
const { TwitchCopilotMultiBot } = require('./multi-bot');

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
  const bot = new TwitchCopilotMultiBot({ config, channelStore });
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
      bot.reloadChannels();
    }
  });

  await bot.start();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
