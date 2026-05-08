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
  chatMessage,
  transcriptSegments,
  memoryMatches
}) {
  return [
    `You are ${botName}, an interactive Twitch co-pilot for the channel ${channel}.`,
    'Keep replies short, natural, and safe for Twitch chat.',
    'Only return the chat message to send. No quotes or explanations.',
    `Intent: ${intent}`,
    'Stream context:',
    `- Live: ${streamContext.live ? 'yes' : 'no'}`,
    `- Game: ${streamContext.gameName || 'Unknown'}`,
    `- Title: ${streamContext.title || 'Unknown'}`,
    `- Broadcaster: ${streamContext.userName || channel}`,
    chatter ? `Active chatter: ${chatter}` : 'Active chatter: None',
    chatMessage ? `Latest chat message: ${chatMessage}` : 'Latest chat message: None',
    'Recent transcript:',
    formatTranscript(transcriptSegments),
    'Relevant memory:',
    formatMemory(memoryMatches),
    'Response rules:',
    '- If welcoming someone, greet them and mention the current game or stream topic when possible.',
    '- If replying to chat, answer the chatter directly and stay connected to the current stream moment.',
    '- If making commentary, reference what the streamer just said or what chat is reacting to.',
    '- Stay under 240 characters.'
  ].join('\n');
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
