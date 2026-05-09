/**
 * Manages per-chatter context and conversation history
 */
class ChatterProfiles {
  constructor() {
    this.profiles = new Map();
  }

  /**
   * Get or create a profile for a chatter
   */
  getProfile(chatterName) {
    const key = chatterName.toLowerCase();
    if (!this.profiles.has(key)) {
      this.profiles.set(key, {
        name: chatterName,
        firstSeen: Date.now(),
        lastSeen: Date.now(),
        messageCount: 0,
        topics: new Map(), // topic -> count
        recentMessages: [], // circular buffer of recent messages
        preferences: {}, // learned preferences
        funnyQuotes: [], // memorable things they said
        interactions: [] // interactions with the bot
      });
    }
    return this.profiles.get(key);
  }

  /**
   * Update chatter profile with a new message
   */
  recordMessage(chatterName, message, metadata = {}) {
    const profile = this.getProfile(chatterName);
    profile.lastSeen = Date.now();
    profile.messageCount++;

    // Add to recent messages (keep last 10)
    profile.recentMessages.push({
      text: message,
      timestamp: Date.now(),
      ...metadata
    });
    if (profile.recentMessages.length > 10) {
      profile.recentMessages.shift();
    }

    // Extract and count topics (simple word frequency)
    this.extractTopics(message).forEach((topic) => {
      profile.topics.set(topic, (profile.topics.get(topic) || 0) + 1);
    });

    return profile;
  }

  /**
   * Record an interaction between the bot and a chatter
   */
  recordInteraction(chatterName, interaction) {
    const profile = this.getProfile(chatterName);
    profile.interactions.push({
      ...interaction,
      timestamp: Date.now()
    });
    // Keep last 20 interactions
    if (profile.interactions.length > 20) {
      profile.interactions.shift();
    }
  }

  /**
   * Add a funny/memorable quote from a chatter
   */
  addQuote(chatterName, quote, context = {}) {
    const profile = this.getProfile(chatterName);
    profile.funnyQuotes.push({
      text: quote,
      timestamp: Date.now(),
      context
    });
    // Keep last 5 quotes per chatter
    if (profile.funnyQuotes.length > 5) {
      profile.funnyQuotes.shift();
    }
  }

  /**
   * Get the top topics a chatter discusses
   */
  getTopTopics(chatterName, limit = 5) {
    const profile = this.getProfile(chatterName);
    return Array.from(profile.topics.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, limit)
      .map(([topic, count]) => ({ topic, count }));
  }

  /**
   * Get context summary for a chatter
   */
  getChatterContext(chatterName) {
    const profile = this.getProfile(chatterName);
    const daysSinceFirst = Math.floor((Date.now() - profile.firstSeen) / (1000 * 60 * 60 * 24));
    const topTopics = this.getTopTopics(chatterName, 3);

    return {
      name: profile.name,
      isNew: daysSinceFirst === 0 && profile.messageCount < 5,
      isRegular: profile.messageCount > 20,
      messageCount: profile.messageCount,
      daysSinceFirst,
      topTopics: topTopics.map(t => t.topic),
      recentMessages: profile.recentMessages.slice(-3),
      lastInteraction: profile.interactions[profile.interactions.length - 1],
      funnyQuotes: profile.funnyQuotes
    };
  }

  /**
   * Extract topics from a message (simple tokenization)
   */
  extractTopics(message) {
    const words = message
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter(word => word.length > 3); // Only words longer than 3 chars

    // Filter out common words
    const stopWords = new Set(['this', 'that', 'with', 'have', 'from', 'they', 'been', 'were', 'your', 'what', 'when', 'where', 'about', 'which', 'their']);
    return words.filter(word => !stopWords.has(word));
  }

  /**
   * Get memory entries for a chatter to store in vector memory
   */
  getMemoryEntries(chatterName) {
    const context = this.getChatterContext(chatterName);
    const entries = [];

    // Add chatter summary
    if (context.topTopics.length > 0) {
      entries.push({
        id: `chatter-profile-${chatterName.toLowerCase()}-${Date.now()}`,
        text: `${context.name} often talks about: ${context.topTopics.join(', ')}. They've sent ${context.messageCount} messages.`,
        metadata: {
          source: 'chatter-profile',
          chatter: chatterName,
          type: 'interests'
        }
      });
    }

    // Add recent memorable interactions
    if (context.lastInteraction) {
      entries.push({
        id: `chatter-interaction-${chatterName.toLowerCase()}-${Date.now()}`,
        text: `Previous interaction with ${context.name}: ${context.lastInteraction.prompt} → ${context.lastInteraction.response}`,
        metadata: {
          source: 'chatter-interaction',
          chatter: chatterName,
          type: 'conversation'
        }
      });
    }

    // Add funny quotes
    context.funnyQuotes.forEach((quote, idx) => {
      entries.push({
        id: `chatter-quote-${chatterName.toLowerCase()}-${idx}-${quote.timestamp}`,
        text: `Memorable quote from ${context.name}: "${quote.text}"`,
        metadata: {
          source: 'chatter-quote',
          chatter: chatterName,
          type: 'quote'
        }
      });
    });

    return entries;
  }

  /**
   * Clean up old profiles (optional, for memory management)
   */
  pruneOldProfiles(maxAge = 30 * 24 * 60 * 60 * 1000) { // 30 days
    const now = Date.now();
    for (const [key, profile] of this.profiles.entries()) {
      if (now - profile.lastSeen > maxAge && profile.messageCount < 10) {
        this.profiles.delete(key);
      }
    }
  }
}

module.exports = {
  ChatterProfiles
};
