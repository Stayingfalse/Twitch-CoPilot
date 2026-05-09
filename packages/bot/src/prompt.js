function formatMemory(matches) {
  if (!matches.length) {
    return 'None';
  }

  return matches
    .map((match) => `- [${match.metadata?.source || 'memory'}] ${match.text}`)
    .join('\n');
}

function formatTranscript(segments) {
  if (!segments.length) {
    return 'None';
  }

  return segments.map((segment) => `- ${segment.text}`).join('\n');
}

function buildCopilotPrompt({
  intent,
  botName,
  channel,
  streamContext,
  chatter,
  chatterContext,
  gameContext,
  chatMessage,
  transcriptSegments,
  memoryMatches
}) {
  const parts = [
    `You are ${botName}, an interactive Twitch co-pilot for the channel ${channel}.`,
    'Keep replies short, natural, and safe for Twitch chat.',
    'Only return the chat message to send. No quotes or explanations.',
    `Intent: ${intent}`,
    'Stream context:',
    `- Live: ${streamContext.live ? 'yes' : 'no'}`,
    `- Game: ${streamContext.gameName || 'Unknown'}`,
    `- Title: ${streamContext.title || 'Unknown'}`,
    `- Broadcaster: ${streamContext.userName || channel}`
  ];

  // Add chatter-specific context
  if (chatter) {
    parts.push(`Active chatter: ${chatter}`);

    if (chatterContext) {
      if (chatterContext.isNew) {
        parts.push(`- ${chatter} is new to the channel!`);
      } else if (chatterContext.isRegular) {
        parts.push(`- ${chatter} is a regular (${chatterContext.messageCount} messages over ${chatterContext.daysSinceFirst} days)`);
      }

      if (chatterContext.topTopics && chatterContext.topTopics.length > 0) {
        parts.push(`- ${chatter} often discusses: ${chatterContext.topTopics.join(', ')}`);
      }

      if (chatterContext.lastInteraction && intent === 'chat') {
        const timeSince = Math.floor((Date.now() - chatterContext.lastInteraction.timestamp) / (1000 * 60));
        if (timeSince < 60) {
          parts.push(`- Last talked with ${chatter} ${timeSince} minutes ago about: ${chatterContext.lastInteraction.prompt}`);
        }
      }

      if (chatterContext.funnyQuotes && chatterContext.funnyQuotes.length > 0) {
        const recentQuote = chatterContext.funnyQuotes[chatterContext.funnyQuotes.length - 1];
        parts.push(`- Memorable quote from ${chatter}: "${recentQuote.text}"`);
      }
    }
  } else {
    parts.push('Active chatter: None');
  }

  parts.push(chatMessage ? `Latest chat message: ${chatMessage}` : 'Latest chat message: None');

  // Add game-specific context
  if (gameContext) {
    parts.push('Game context:');
    if (gameContext.sessionCount > 1) {
      parts.push(`- ${gameContext.name} has been played ${gameContext.sessionCount} times (${gameContext.hoursPlayed} hours)`);
    }

    if (gameContext.recentAchievements && gameContext.recentAchievements.length > 0) {
      const achievement = gameContext.recentAchievements[gameContext.recentAchievements.length - 1];
      parts.push(`- Recent achievement: ${achievement.name}`);
    }

    if (gameContext.recentQuotes && gameContext.recentQuotes.length > 0) {
      const quotes = gameContext.recentQuotes.slice(-2);
      quotes.forEach((quote) => {
        parts.push(`- ${gameContext.name} quote from ${quote.speaker}: "${quote.text}"`);
      });
    }

    if (gameContext.recentMoments && gameContext.recentMoments.length > 0) {
      const moment = gameContext.recentMoments[gameContext.recentMoments.length - 1];
      parts.push(`- Recent moment: ${moment.description}`);
    }
  }

  parts.push('Recent transcript:', formatTranscript(transcriptSegments));
  parts.push('Relevant memory:', formatMemory(memoryMatches));
  parts.push(
    'Response rules:',
    '- If welcoming someone, greet them and mention the current game or stream topic when possible.',
    '- If replying to a regular chatter, reference their interests or past conversations naturally.',
    '- If replying to chat, answer the chatter directly and stay connected to the current stream moment.',
    '- If making commentary, reference what the streamer just said, memorable game moments, or what chat is reacting to.',
    '- Use game-specific context and funny quotes to make responses more engaging and personal.',
    '- Stay under 240 characters.'
  );

  return parts.join('\n');
}

function sanitizeChatReply(message, maxChars) {
  const compact = String(message || '')
    .replace(/[`*_>#]/g, '')
    .replace(/\s+/g, ' ')
    .trim();

  if (!compact) {
    return '';
  }

  return compact.slice(0, maxChars).trim();
}

module.exports = {
  buildCopilotPrompt,
  sanitizeChatReply
};
