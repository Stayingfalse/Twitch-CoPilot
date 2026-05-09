const { buildCopilotPrompt, sanitizeChatReply } = require('./prompt');
const { TranscriptSource } = require('./transcript-source');
const { TwitchApi } = require('./twitch-api');
const { createAiProvider } = require('./llm');
const { createMemoryStore } = require('./vector-memory');
const { ChatterProfiles } = require('./chatter-profiles');
const { GameContext } = require('./game-context');
const { resolveChannelRuntimeConfig } = require('./channel-runtime');

class TwitchCopilotChannelSession {
  constructor({ baseConfig, channelRecord, sharedMcpClient, tmiClient }) {
    this.baseConfig = baseConfig;
    this.channelRecord = channelRecord;
    this.sharedMcpClient = sharedMcpClient || null;
    this.client = tmiClient;

    this.config = resolveChannelRuntimeConfig(baseConfig, channelRecord);
    this.channel = this.config.channel;
    this.features = this.config.channelFeatures;

    this.streamContext = {
      live: false,
      title: '',
      gameName: '',
      userName: this.channel
    };
    this.transcriptQueue = [];
    this.seenChatters = new Set();
    this.lastResponseAt = 0;

    this.twitchApi = new TwitchApi(this.config.twitch);
    this.transcriptSource = new TranscriptSource(this.config.transcript);
    this.ai = createAiProvider(this.config.ai);
    this.memory = null;
    this.timers = [];
    this.chatterProfiles = new ChatterProfiles();
    this.gameContext = new GameContext();
  }

  getUpdatedAt() {
    return this.channelRecord?.updatedAt || '';
  }

  async start() {
    if (this.features.memory) {
      this.memory = await createMemoryStore(this.config.memory, { sharedMcpClient: this.sharedMcpClient });
    } else {
      this.memory = {
        upsert: async () => {},
        search: async () => [],
        close: async () => {}
      };
    }

    this.transcriptSource.start();
    await this.refreshStreamContext();
    await this.ingestTranscript();
    this.startTimers();
  }

  startTimers() {
    const pollers = [];

    pollers.push(
      setInterval(() => this.refreshStreamContext().catch((error) => console.error(`[${this.channel}] stream refresh failed:`, error)), this.config.bot.streamPollIntervalMs)
    );

    if (this.features.transcript) {
      pollers.push(
        setInterval(() => this.ingestTranscript().catch((error) => console.error(`[${this.channel}] transcript poll failed:`, error)), this.config.transcript.pollIntervalMs)
      );
    }

    if (this.features.commentary) {
      pollers.push(
        setInterval(() => this.maybeCommentate().catch((error) => console.error(`[${this.channel}] commentary failed:`, error)), this.config.bot.commentaryIntervalMs)
      );
    }

    pollers.forEach((timer) => timer.unref?.());
    this.timers.push(...pollers);
  }

  async stop() {
    this.timers.forEach((timer) => clearInterval(timer));
    this.timers = [];

    if (this.memory) {
      await this.memory.close();
    }

    if (this.transcriptSource) {
      this.transcriptSource.stop();
    }
  }

  async refreshStreamContext() {
    const previousGame = this.streamContext.gameName;
    this.streamContext = await this.twitchApi.getStreamContext(this.channel);

    if (!this.features.memory) {
      return this.streamContext;
    }

    // Detect game change and update game context
    if (this.streamContext.gameName && this.streamContext.gameName !== previousGame) {
      this.gameContext.startGameSession(this.streamContext.gameName, this.streamContext.title);
      const gameEntries = this.gameContext.getMemoryEntries(this.streamContext.gameName);
      if (gameEntries.length > 0) {
        await this.memory.upsert(gameEntries);
      }
    }

    return this.streamContext;
  }

  async ingestTranscript() {
    if (!this.features.transcript) {
      return [];
    }

    const freshSegments = await this.transcriptSource.pullNewSegments();
    if (!freshSegments.length) {
      return [];
    }

    this.transcriptQueue.push(...freshSegments);
    this.transcriptQueue = this.transcriptQueue.slice(-this.config.transcript.maxSegments);

    // Detect and store funny quotes from transcript
    for (const segment of freshSegments) {
      if (this.gameContext.isFunnyQuote(segment.text)) {
        this.gameContext.addQuote(segment.text, segment.speaker || 'streamer');
      }
    }

    if (this.features.memory) {
      await this.memory.upsert(
        freshSegments.map((segment) => ({
          id: segment.id,
          text: segment.text,
          metadata: {
            source: 'transcript',
            speaker: segment.speaker || 'streamer',
            game: this.streamContext.gameName || 'unknown',
            channel: this.channel
          }
        }))
      );
    }

    return freshSegments;
  }

  async handleChatMessage(tags, message, self) {
    if (!this.features.enabled) {
      return;
    }

    if (self) {
      return;
    }

    const chatter = tags['display-name'] || tags.username || 'viewer';

    this.chatterProfiles.recordMessage(chatter, message, {
      game: this.streamContext.gameName,
      timestamp: Date.now()
    });

    if (this.gameContext.isFunnyQuote(message)) {
      this.gameContext.addQuote(message, chatter);
      this.chatterProfiles.addQuote(chatter, message, {
        game: this.streamContext.gameName
      });
    }

    if (this.features.memory) {
      await this.memory.upsert([
        {
          id: `chat-${Date.now()}-${chatter}`,
          text: message,
          metadata: {
            source: 'chat',
            chatter,
            game: this.streamContext.gameName || 'unknown',
            channel: this.channel
          }
        }
      ]);
    }

    const profile = this.chatterProfiles.getProfile(chatter);
    if (this.features.memory && profile.messageCount % 10 === 0) {
      const chatterEntries = this.chatterProfiles.getMemoryEntries(chatter);
      if (chatterEntries.length > 0) {
        await this.memory.upsert(chatterEntries);
      }
    }

    if (this.features.welcomeNewChatters && this.shouldWelcome(chatter, tags)) {
      await this.respond({ intent: 'welcome', chatter, chatMessage: message });
      return;
    }

    if (this.features.respondToChat && this.shouldReplyToChat(message)) {
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
    return (
      lower.includes(this.config.botName.toLowerCase()) ||
      lower.startsWith(this.config.bot.commandTrigger.toLowerCase()) ||
      lower.endsWith('?')
    );
  }

  async maybeCommentate() {
    if (!this.features.enabled || !this.features.commentary) {
      return;
    }

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
    const chatterContext = chatter ? this.chatterProfiles.getChatterContext(chatter) : null;
    const gameContextSummary = this.streamContext.gameName ? this.gameContext.getGameContextSummary(this.streamContext.gameName) : null;

    const query =
      chatMessage ||
      transcriptSegments.map((segment) => segment.text).join(' ') ||
      `${this.streamContext.gameName} ${this.streamContext.title}`;
    const memoryMatches = this.features.memory ? await this.memory.search(query, 5) : [];

    const prompt = buildCopilotPrompt({
      intent,
      botName: this.config.botName,
      channel: this.channel,
      streamContext: this.streamContext,
      chatter,
      chatterContext,
      gameContext: gameContextSummary,
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

    if (chatter) {
      this.chatterProfiles.recordInteraction(chatter, {
        intent,
        prompt: chatMessage,
        response: reply,
        game: this.streamContext.gameName
      });
    }

    this.lastResponseAt = Date.now();

    if (this.config.dryRun) {
      console.log(`[dry-run][#${this.channel}][${intent}] ${reply}`);
      return reply;
    }

    await this.client.say(this.channel, reply);
    return reply;
  }
}

module.exports = {
  TwitchCopilotChannelSession
};
