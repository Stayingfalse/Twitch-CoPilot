const tmi = require('tmi.js');
const { buildCopilotPrompt, sanitizeChatReply } = require('./prompt');
const { TranscriptSource } = require('./transcript-source');
const { TwitchApi } = require('./twitch-api');
const { createAiProvider } = require('./llm');
const { createMemoryStore } = require('./vector-memory');

class TwitchCopilotBot {
  constructor(config) {
    this.config = config;
    this.streamContext = {
      live: false,
      title: '',
      gameName: '',
      userName: config.channel
    };
    this.transcriptQueue = [];
    this.seenChatters = new Set();
    this.lastResponseAt = 0;
    this.twitchApi = new TwitchApi(config.twitch);
    this.transcriptSource = new TranscriptSource(config.transcript);
    this.ai = createAiProvider(config.ai);
    this.memory = null;
    this.client = null;
    this.timers = [];
  }

  async start() {
    this.memory = await createMemoryStore(this.config.memory);
    await this.refreshStreamContext();
    await this.ingestTranscript();
    this.startTimers();

    if (this.config.dryRun) {
      console.log('[dry-run] bot initialized');
      console.log('[dry-run] stream context:', this.streamContext);
      return;
    }

    this.client = new tmi.Client({
      identity: {
        username: this.config.twitch.botUsername,
        password: this.config.twitch.botOauth
      },
      channels: [this.config.channel]
    });

    this.client.on('message', async (_channel, tags, message, self) => {
      try {
        await this.handleChatMessage(tags, message, self);
      } catch (error) {
        console.error('message handling failed:', error);
      }
    });

    await this.client.connect();
    console.log(`Connected to #${this.config.channel}`);
  }

  startTimers() {
    const pollers = [
      setInterval(() => this.refreshStreamContext().catch((error) => console.error('stream refresh failed:', error)), this.config.bot.streamPollIntervalMs),
      setInterval(() => this.ingestTranscript().catch((error) => console.error('transcript poll failed:', error)), this.config.transcript.pollIntervalMs),
      setInterval(() => this.maybeCommentate().catch((error) => console.error('commentary failed:', error)), this.config.bot.commentaryIntervalMs)
    ];

    pollers.forEach((timer) => timer.unref?.());
    this.timers.push(...pollers);
  }

  async stop() {
    this.timers.forEach((timer) => clearInterval(timer));
    this.timers = [];

    if (this.client) {
      await this.client.disconnect();
    }

    if (this.memory) {
      await this.memory.close();
    }
  }

  async refreshStreamContext() {
    this.streamContext = await this.twitchApi.getStreamContext(this.config.channel);
    return this.streamContext;
  }

  async ingestTranscript() {
    const freshSegments = await this.transcriptSource.pullNewSegments();
    if (!freshSegments.length) {
      return [];
    }

    this.transcriptQueue.push(...freshSegments);
    this.transcriptQueue = this.transcriptQueue.slice(-this.config.transcript.maxSegments);
    await this.memory.upsert(
      freshSegments.map((segment) => ({
        id: segment.id,
        text: segment.text,
        metadata: {
          source: 'transcript',
          speaker: segment.speaker || 'streamer'
        }
      }))
    );
    return freshSegments;
  }

  async handleChatMessage(tags, message, self) {
    if (self) {
      return;
    }

    const chatter = tags['display-name'] || tags.username || 'viewer';
    await this.memory.upsert([
      {
        id: `chat-${Date.now()}-${chatter}`,
        text: message,
        metadata: {
          source: 'chat',
          chatter
        }
      }
    ]);

    if (this.shouldWelcome(chatter, tags)) {
      await this.respond({ intent: 'welcome', chatter, chatMessage: message });
      return;
    }

    if (this.shouldReplyToChat(message)) {
      await this.respond({ intent: 'chat', chatter, chatMessage: message });
    }
  }

  shouldWelcome(chatter, tags) {
    const username = String(chatter || '').toLowerCase();
    const isBroadcaster = Boolean(tags.badges?.broadcaster);
    if (!username || isBroadcaster || this.seenChatters.has(username)) {
      return false;
    }

    this.seenChatters.add(username);
    return true;
  }

  shouldReplyToChat(message) {
    if (Date.now() - this.lastResponseAt < this.config.bot.responseCooldownMs) {
      return false;
    }

    const lower = String(message || '').toLowerCase();
    return lower.includes(this.config.botName.toLowerCase()) || lower.startsWith(this.config.bot.commandTrigger.toLowerCase()) || lower.endsWith('?');
  }

  async maybeCommentate() {
    if (!this.transcriptQueue.length) {
      return;
    }

    if (Date.now() - this.lastResponseAt < this.config.bot.responseCooldownMs) {
      return;
    }

    const transcriptSegments = this.transcriptQueue.slice(-3);
    this.transcriptQueue = [];
    await this.respond({ intent: 'commentary', transcriptSegments });
  }

  async respond({ intent, chatter = '', chatMessage = '', transcriptSegments = [] }) {
    const query = chatMessage || transcriptSegments.map((segment) => segment.text).join(' ') || `${this.streamContext.gameName} ${this.streamContext.title}`;
    const memoryMatches = await this.memory.search(query, 5);
    const prompt = buildCopilotPrompt({
      intent,
      botName: this.config.botName,
      channel: this.config.channel,
      streamContext: this.streamContext,
      chatter,
      chatMessage,
      transcriptSegments: transcriptSegments.length ? transcriptSegments : this.transcriptQueue.slice(-3),
      memoryMatches
    });

    const rawReply = await this.ai.generate({
      intent,
      chatter,
      chatMessage,
      transcriptSegments,
      streamContext: this.streamContext,
      memoryMatches,
      prompt
    });
    const reply = sanitizeChatReply(typeof rawReply === 'string' ? rawReply : rawReply?.prompt || rawReply, this.config.bot.maxReplyChars);

    if (!reply) {
      return '';
    }

    this.lastResponseAt = Date.now();
    if (this.config.dryRun) {
      console.log(`[dry-run][${intent}] ${reply}`);
      return reply;
    }

    await this.client.say(this.config.channel, reply);
    return reply;
  }
}

module.exports = {
  TwitchCopilotBot
};
