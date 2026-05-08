const path = require('node:path');
const dotenv = require('dotenv');

dotenv.config();

function readInt(name, fallback) {
  const value = process.env[name];
  if (!value) {
    return fallback;
  }

  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function readBool(name, fallback = false) {
  const value = process.env[name];
  if (value == null) {
    return fallback;
  }

  return ['1', 'true', 'yes', 'on'].includes(String(value).toLowerCase());
}

function readJsonArray(name) {
  const value = process.env[name];
  if (!value) {
    return [];
  }

  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return value.split(' ').filter(Boolean);
  }
}

function resolveTranscriptPath(filePath) {
  if (!filePath) {
    return '';
  }

  return path.isAbsolute(filePath) ? filePath : path.resolve(process.cwd(), filePath);
}

function loadConfig() {
  const channel = process.env.TWITCH_CHANNEL || '';
  const botName = process.env.BOT_DISPLAY_NAME || process.env.TWITCH_BOT_USERNAME || 'Twitch CoPilot';
  const aiProvider = process.env.AI_PROVIDER || (process.env.GEMINI_API_KEY ? 'gemini' : process.env.LOCAL_LLM_URL ? 'local' : 'fallback');
  const transcriptSource = process.env.TRANSCRIPT_SOURCE || (process.env.TRANSCRIPT_HTTP_URL ? 'http' : process.env.TRANSCRIPT_FILE ? 'file' : 'none');

  return {
    channel,
    botName,
    dryRun: readBool('DRY_RUN', false),
    twitch: {
      botUsername: process.env.TWITCH_BOT_USERNAME || '',
      botOauth: process.env.TWITCH_BOT_OAUTH || '',
      clientId: process.env.TWITCH_CLIENT_ID || '',
      clientSecret: process.env.TWITCH_CLIENT_SECRET || ''
    },
    ai: {
      provider: aiProvider,
      geminiApiKey: process.env.GEMINI_API_KEY || '',
      geminiModel: process.env.GEMINI_MODEL || 'gemini-2.5-flash',
      localUrl: process.env.LOCAL_LLM_URL || 'http://127.0.0.1:11434/v1/chat/completions',
      localModel: process.env.LOCAL_LLM_MODEL || 'llama3.1:8b',
      temperature: Number.parseFloat(process.env.AI_TEMPERATURE || '0.7')
    },
    transcript: {
      source: transcriptSource,
      filePath: resolveTranscriptPath(process.env.TRANSCRIPT_FILE || ''),
      httpUrl: process.env.TRANSCRIPT_HTTP_URL || '',
      pollIntervalMs: readInt('TRANSCRIPT_POLL_INTERVAL_MS', 15000),
      maxSegments: readInt('TRANSCRIPT_MAX_SEGMENTS', 8)
    },
    memory: {
      namespace: process.env.MCP_VECTOR_NAMESPACE || channel || 'default',
      maxItems: readInt('MEMORY_MAX_ITEMS', 250),
      mcp: {
        command: process.env.MCP_VECTOR_SERVER_COMMAND || '',
        args: readJsonArray('MCP_VECTOR_SERVER_ARGS'),
        cwd: process.env.MCP_VECTOR_SERVER_CWD || process.cwd(),
        upsertTool: process.env.MCP_VECTOR_UPSERT_TOOL || 'upsert_memory',
        searchTool: process.env.MCP_VECTOR_SEARCH_TOOL || 'search_memory'
      }
    },
    bot: {
      responseCooldownMs: readInt('BOT_RESPONSE_COOLDOWN_MS', 30000),
      commentaryIntervalMs: readInt('BOT_COMMENTARY_INTERVAL_MS', 90000),
      streamPollIntervalMs: readInt('TWITCH_STREAM_POLL_INTERVAL_MS', 60000),
      maxReplyChars: readInt('BOT_MAX_REPLY_CHARS', 240)
    }
  };
}

function validateConfig(config) {
  const issues = [];

  if (!config.channel) {
    issues.push('TWITCH_CHANNEL is required.');
  }

  if (!config.dryRun && (!config.twitch.botUsername || !config.twitch.botOauth)) {
    issues.push('TWITCH_BOT_USERNAME and TWITCH_BOT_OAUTH are required unless DRY_RUN=true.');
  }

  if (!config.twitch.clientId || !config.twitch.clientSecret) {
    issues.push('TWITCH_CLIENT_ID and TWITCH_CLIENT_SECRET are required for stream title/game context.');
  }

  if (config.transcript.source === 'file' && !config.transcript.filePath) {
    issues.push('TRANSCRIPT_FILE is required when TRANSCRIPT_SOURCE=file.');
  }

  if (config.transcript.source === 'http' && !config.transcript.httpUrl) {
    issues.push('TRANSCRIPT_HTTP_URL is required when TRANSCRIPT_SOURCE=http.');
  }

  if (config.ai.provider === 'gemini' && !config.ai.geminiApiKey) {
    issues.push('GEMINI_API_KEY is required when AI_PROVIDER=gemini.');
  }

  if (config.ai.provider === 'local' && !config.ai.localUrl) {
    issues.push('LOCAL_LLM_URL is required when AI_PROVIDER=local.');
  }

  return issues;
}

module.exports = {
  loadConfig,
  validateConfig
};
