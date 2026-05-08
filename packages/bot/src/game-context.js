/**
 * Manages game-specific context, memorable moments, and quotes
 */
class GameContext {
  constructor() {
    this.games = new Map();
    this.currentGame = null;
  }

  /**
   * Get or create context for a game
   */
  getGameContext(gameName) {
    if (!gameName) {
      return null;
    }

    const key = gameName.toLowerCase();
    if (!this.games.has(key)) {
      this.games.set(key, {
        name: gameName,
        firstPlayed: Date.now(),
        lastPlayed: Date.now(),
        totalPlaytime: 0,
        sessionCount: 0,
        currentSessionStart: null,
        moments: [], // memorable moments from this game
        funnyQuotes: [], // funny things said during this game
        achievements: [], // notable achievements or events
        chatReactions: new Map(), // common chat reactions -> count
        streamTitles: [] // titles used when playing this game
      });
    }
    return this.games.get(key);
  }

  /**
   * Start a new game session
   */
  startGameSession(gameName, streamTitle = '') {
    if (!gameName) {
      return;
    }

    // End previous game session if there was one
    if (this.currentGame) {
      this.endGameSession();
    }

    const game = this.getGameContext(gameName);
    game.lastPlayed = Date.now();
    game.sessionCount++;
    game.currentSessionStart = Date.now();
    this.currentGame = gameName;

    // Track stream title
    if (streamTitle && !game.streamTitles.includes(streamTitle)) {
      game.streamTitles.push(streamTitle);
      if (game.streamTitles.length > 10) {
        game.streamTitles.shift();
      }
    }

    return game;
  }

  /**
   * End the current game session
   */
  endGameSession() {
    if (!this.currentGame) {
      return;
    }

    const game = this.getGameContext(this.currentGame);
    if (game && game.currentSessionStart) {
      game.totalPlaytime += Date.now() - game.currentSessionStart;
      game.currentSessionStart = null;
    }

    this.currentGame = null;
  }

  /**
   * Add a memorable moment for the current game
   */
  addMoment(description, context = {}) {
    if (!this.currentGame) {
      return;
    }

    const game = this.getGameContext(this.currentGame);
    game.moments.push({
      description,
      timestamp: Date.now(),
      context
    });

    // Keep last 20 moments
    if (game.moments.length > 20) {
      game.moments.shift();
    }
  }

  /**
   * Add a funny quote for the current game
   */
  addQuote(quote, speaker = 'streamer', context = {}) {
    if (!this.currentGame) {
      return;
    }

    const game = this.getGameContext(this.currentGame);
    game.funnyQuotes.push({
      text: quote,
      speaker,
      timestamp: Date.now(),
      context
    });

    // Keep last 30 quotes per game
    if (game.funnyQuotes.length > 30) {
      game.funnyQuotes.shift();
    }
  }

  /**
   * Add an achievement or notable event
   */
  addAchievement(achievement, description = '') {
    if (!this.currentGame) {
      return;
    }

    const game = this.getGameContext(this.currentGame);
    game.achievements.push({
      name: achievement,
      description,
      timestamp: Date.now()
    });

    // Keep last 15 achievements
    if (game.achievements.length > 15) {
      game.achievements.shift();
    }
  }

  /**
   * Record a chat reaction pattern
   */
  recordChatReaction(reaction) {
    if (!this.currentGame) {
      return;
    }

    const game = this.getGameContext(this.currentGame);
    const normalized = reaction.toLowerCase();
    game.chatReactions.set(normalized, (game.chatReactions.get(normalized) || 0) + 1);
  }

  /**
   * Get context summary for a game
   */
  getGameContextSummary(gameName) {
    const game = this.getGameContext(gameName);
    if (!game) {
      return null;
    }

    const hoursPlayed = Math.round(game.totalPlaytime / (1000 * 60 * 60) * 10) / 10;
    const topReactions = Array.from(game.chatReactions.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([reaction]) => reaction);

    return {
      name: game.name,
      sessionCount: game.sessionCount,
      hoursPlayed,
      recentMoments: game.moments.slice(-5),
      recentQuotes: game.funnyQuotes.slice(-10),
      recentAchievements: game.achievements.slice(-5),
      topReactions,
      isCurrentGame: this.currentGame?.toLowerCase() === gameName.toLowerCase()
    };
  }

  /**
   * Get memory entries for a game to store in vector memory
   */
  getMemoryEntries(gameName) {
    const summary = this.getGameContextSummary(gameName);
    if (!summary) {
      return [];
    }

    const entries = [];

    // Add game overview
    if (summary.sessionCount > 0) {
      entries.push({
        id: `game-context-${gameName.toLowerCase()}-${Date.now()}`,
        text: `${summary.name}: played ${summary.sessionCount} times for ${summary.hoursPlayed} hours. ${summary.recentAchievements.length > 0 ? 'Recent achievements: ' + summary.recentAchievements.map(a => a.name).join(', ') : ''}`,
        metadata: {
          source: 'game-context',
          game: gameName,
          type: 'overview'
        }
      });
    }

    // Add recent memorable moments
    summary.recentMoments.forEach((moment, idx) => {
      entries.push({
        id: `game-moment-${gameName.toLowerCase()}-${idx}-${moment.timestamp}`,
        text: `${summary.name} moment: ${moment.description}`,
        metadata: {
          source: 'game-moment',
          game: gameName,
          type: 'moment',
          timestamp: moment.timestamp
        }
      });
    });

    // Add funny quotes
    summary.recentQuotes.forEach((quote, idx) => {
      entries.push({
        id: `game-quote-${gameName.toLowerCase()}-${idx}-${quote.timestamp}`,
        text: `${summary.name} quote from ${quote.speaker}: "${quote.text}"`,
        metadata: {
          source: 'game-quote',
          game: gameName,
          type: 'quote',
          speaker: quote.speaker,
          timestamp: quote.timestamp
        }
      });
    });

    return entries;
  }

  /**
   * Detect if a message might be a funny quote
   * Returns true if the message seems memorable/funny
   */
  isFunnyQuote(message) {
    const lower = message.toLowerCase();

    // Indicators of funny/memorable content
    const funnyIndicators = [
      'lol', 'lmao', 'haha', 'omg', 'wow', 'wtf',
      '😂', '🤣', '💀', 'kekw', 'pepega', 'poggers', 'pog'
    ];

    const memorableIndicators = [
      'remember when', 'that time', 'never forget',
      'classic', 'legendary', 'iconic'
    ];

    // Check for exclamations or questions (often memorable)
    const hasExclamation = message.includes('!');
    const hasQuestion = message.includes('?');

    // Check for indicators
    const hasFunnyIndicator = funnyIndicators.some(indicator => lower.includes(indicator));
    const hasMemorableIndicator = memorableIndicators.some(indicator => lower.includes(indicator));

    // Message should be substantial (not just "lol")
    const isSubstantial = message.split(/\s+/).length > 3;

    return isSubstantial && (hasFunnyIndicator || hasMemorableIndicator || (hasExclamation && message.length > 20));
  }

  /**
   * Clean up old games with minimal playtime
   */
  pruneOldGames(minPlaytime = 5 * 60 * 1000) { // 5 minutes
    for (const [key, game] of this.games.entries()) {
      if (game.totalPlaytime < minPlaytime && game.sessionCount < 2) {
        this.games.delete(key);
      }
    }
  }
}

module.exports = {
  GameContext
};
