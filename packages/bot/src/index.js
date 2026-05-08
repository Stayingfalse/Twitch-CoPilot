const { loadConfig, validateConfig } = require('./config');
const { TwitchCopilotBot } = require('./bot');

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

  const bot = new TwitchCopilotBot(config);

  for (const signal of ['SIGINT', 'SIGTERM']) {
    process.on(signal, async () => {
      await bot.stop();
      process.exit(0);
    });
  }

  await bot.start();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
