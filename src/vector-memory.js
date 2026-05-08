function tokenize(text) {
  return String(text || '')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

function toVector(text) {
  const vector = new Map();
  for (const token of tokenize(text)) {
    vector.set(token, (vector.get(token) || 0) + 1);
  }
  return vector;
}

function cosineSimilarity(a, b) {
  let dot = 0;
  let aMagnitude = 0;
  let bMagnitude = 0;

  for (const value of a.values()) {
    aMagnitude += value * value;
  }

  for (const value of b.values()) {
    bMagnitude += value * value;
  }

  for (const [token, value] of a.entries()) {
    dot += value * (b.get(token) || 0);
  }

  if (!aMagnitude || !bMagnitude) {
    return 0;
  }

  return dot / (Math.sqrt(aMagnitude) * Math.sqrt(bMagnitude));
}

class LocalVectorMemory {
  constructor(maxItems) {
    this.maxItems = maxItems;
    this.items = [];
    this.signatures = new Set();
  }

  async upsert(entries) {
    for (const entry of entries) {
      const signature = `${entry.id || 'memory'}:${entry.metadata?.source || 'memory'}:${entry.text}`;
      if (this.signatures.has(signature)) {
        continue;
      }

      this.signatures.add(signature);
      this.items.push({
        ...entry,
        vector: toVector(entry.text)
      });
    }

    while (this.items.length > this.maxItems) {
      const removed = this.items.shift();
      if (removed) {
        this.signatures.delete(`${removed.id || 'memory'}:${removed.metadata?.source || 'memory'}:${removed.text}`);
      }
    }
  }

  async search(query, limit = 5) {
    const queryVector = toVector(query);

    return this.items
      .map((item) => ({
        id: item.id,
        text: item.text,
        metadata: item.metadata,
        score: cosineSimilarity(queryVector, item.vector)
      }))
      .filter((item) => item.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);
  }
}

function parseMcpPayload(result) {
  if (result?.structuredContent) {
    return result.structuredContent;
  }

  const textPart = Array.isArray(result?.content)
    ? result.content.find((item) => item.type === 'text' && item.text)
    : null;

  if (!textPart) {
    return null;
  }

  try {
    return JSON.parse(textPart.text);
  } catch {
    return null;
  }
}

class HybridVectorMemory {
  constructor(config, localMemory) {
    this.config = config;
    this.localMemory = localMemory;
    this.client = null;
    this.callToolSchema = null;
  }

  async connect() {
    if (!this.config.mcp.command) {
      return;
    }

    const [{ Client }, { StdioClientTransport }, { CallToolResultSchema }] = await Promise.all([
      import('@modelcontextprotocol/sdk/client/index.js'),
      import('@modelcontextprotocol/sdk/client/stdio.js'),
      import('@modelcontextprotocol/sdk/types.js')
    ]);

    this.client = new Client({
      name: 'twitch-copilot',
      version: '1.0.0'
    });
    this.callToolSchema = CallToolResultSchema;
    this.transport = new StdioClientTransport({
      command: this.config.mcp.command,
      args: this.config.mcp.args,
      cwd: this.config.mcp.cwd,
      stderr: 'pipe'
    });

    this.transport.stderr?.on('data', (chunk) => {
      const message = chunk.toString().trim();
      if (message) {
        console.warn('[mcp]', message);
      }
    });

    await this.client.connect(this.transport);
  }

  async upsert(entries) {
    await this.localMemory.upsert(entries);

    if (!this.client) {
      return;
    }

    try {
      await this.client.request(
        {
          method: 'tools/call',
          params: {
            name: this.config.mcp.upsertTool,
            arguments: {
              namespace: this.config.namespace,
              documents: entries
            }
          }
        },
        this.callToolSchema
      );
    } catch (error) {
      console.warn('[mcp] upsert failed, using local memory only:', error.message);
    }
  }

  async search(query, limit = 5) {
    if (this.client) {
      try {
        const result = await this.client.request(
          {
            method: 'tools/call',
            params: {
              name: this.config.mcp.searchTool,
              arguments: {
                namespace: this.config.namespace,
                query,
                limit
              }
            }
          },
          this.callToolSchema
        );
        const payload = parseMcpPayload(result);
        const matches = payload?.matches || payload?.documents || [];
        if (Array.isArray(matches) && matches.length) {
          return matches.map((match) => ({
            id: match.id,
            text: match.text,
            metadata: match.metadata || {},
            score: match.score || 0
          }));
        }
      } catch (error) {
        console.warn('[mcp] search failed, falling back to local memory:', error.message);
      }
    }

    return this.localMemory.search(query, limit);
  }

  async close() {
    if (this.transport) {
      await this.transport.close();
    }
  }
}

async function createMemoryStore(config) {
  const localMemory = new LocalVectorMemory(config.maxItems);
  const memory = new HybridVectorMemory(config, localMemory);
  await memory.connect();
  return memory;
}

module.exports = {
  LocalVectorMemory,
  createMemoryStore
};
