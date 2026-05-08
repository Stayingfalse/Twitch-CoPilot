const fs = require('node:fs/promises');

function normalizeSegments(payload) {
  const rawSegments = Array.isArray(payload)
    ? payload
    : Array.isArray(payload?.segments)
      ? payload.segments
      : Array.isArray(payload?.items)
        ? payload.items
        : typeof payload?.text === 'string'
          ? payload.text.split('\n')
          : [];

  return rawSegments
    .map((segment, index) => {
      if (typeof segment === 'string') {
        return {
          id: `segment-${index}-${segment}`,
          text: segment.trim()
        };
      }

      return {
        id: String(segment.id || segment.start || segment.timestamp || `segment-${index}`),
        text: String(segment.text || segment.transcript || '').trim(),
        speaker: segment.speaker || ''
      };
    })
    .filter((segment) => segment.text);
}

class TranscriptSource {
  constructor(config) {
    this.config = config;
    this.seen = new Set();
  }

  async readPayload() {
    if (this.config.source === 'file' && this.config.filePath) {
      const content = await fs.readFile(this.config.filePath, 'utf8');
      try {
        return JSON.parse(content);
      } catch {
        return content.split('\n').filter(Boolean);
      }
    }

    if (this.config.source === 'http' && this.config.httpUrl) {
      const response = await fetch(this.config.httpUrl);
      const text = await response.text();
      try {
        return JSON.parse(text);
      } catch {
        return text.split('\n').filter(Boolean);
      }
    }

    return [];
  }

  async pullNewSegments() {
    if (this.config.source === 'none') {
      return [];
    }

    const payload = await this.readPayload();
    const segments = normalizeSegments(payload).slice(-this.config.maxSegments);
    const fresh = [];

    for (const segment of segments) {
      if (this.seen.has(segment.id)) {
        continue;
      }

      this.seen.add(segment.id);
      fresh.push(segment);
    }

    if (this.seen.size > 500) {
      this.seen = new Set(Array.from(this.seen).slice(-250));
    }

    return fresh;
  }
}

module.exports = {
  TranscriptSource
};
