class GeminiProvider {
  constructor(config) {
    this.config = config;
  }

  async generate(context) {
    const prompt = context.prompt;
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(this.config.geminiModel)}:generateContent?key=${encodeURIComponent(this.config.geminiApiKey)}`;
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        contents: [
          {
            parts: [
              {
                text: prompt
              }
            ]
          }
        ],
        generationConfig: {
          temperature: this.config.temperature,
          maxOutputTokens: 120
        }
      })
    });

    if (!response.ok) {
      throw new Error(`Gemini request failed with ${response.status}`);
    }

    const payload = await response.json();
    return payload.candidates?.[0]?.content?.parts?.map((part) => part.text).join(' ').trim() || '';
  }
}

class LocalOpenAiProvider {
  constructor(config) {
    this.config = config;
  }

  async generate(context) {
    const prompt = context.prompt;
    const response = await fetch(this.config.localUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: this.config.localModel,
        temperature: this.config.temperature,
        messages: [
          {
            role: 'user',
            content: prompt
          }
        ],
        max_tokens: 120
      })
    });

    if (!response.ok) {
      throw new Error(`Local model request failed with ${response.status}`);
    }

    const payload = await response.json();
    return payload.choices?.[0]?.message?.content?.trim() || '';
  }
}

class HeuristicProvider {
  async generate(context) {
    if (context.intent === 'welcome' && context.chatter) {
      const topic = context.streamContext.gameName || context.streamContext.title || 'the stream';
      return `Welcome in, ${context.chatter}! We're hanging out with ${topic} right now.`;
    }

    if (context.intent === 'commentary' && context.transcriptSegments.length) {
      return `That ${context.transcriptSegments[context.transcriptSegments.length - 1].text.slice(0, 140)} really sets the tone for chat.`;
    }

    if (context.chatMessage) {
      return `${context.chatter || 'Friend'}, good call — ${context.chatMessage.slice(0, 120)}`;
    }

    return `Chat's live and I'm keeping an eye on ${context.streamContext.gameName || 'the stream'}.`;
  }
}

function createAiProvider(config) {
  if (config.provider === 'gemini') {
    return new GeminiProvider(config);
  }

  if (config.provider === 'local') {
    return new LocalOpenAiProvider(config);
  }

  return new HeuristicProvider();
}

module.exports = {
  createAiProvider
};
