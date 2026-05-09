#!/usr/bin/env node

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema
} from '@modelcontextprotocol/sdk/types.js';

// In-memory vector store with simple cosine similarity
class VectorMemoryStore {
  constructor() {
    this.memories = new Map();
  }

  // Simple text embedding via character frequency vector
  embed(text) {
    const normalized = text.toLowerCase();
    const vector = new Array(26).fill(0);

    for (const char of normalized) {
      const code = char.charCodeAt(0);
      if (code >= 97 && code <= 122) {
        vector[code - 97]++;
      }
    }

    const magnitude = Math.sqrt(vector.reduce((sum, v) => sum + v * v, 0));
    return magnitude > 0 ? vector.map(v => v / magnitude) : vector;
  }

  cosineSimilarity(vec1, vec2) {
    let dotProduct = 0;
    for (let i = 0; i < vec1.length; i++) {
      dotProduct += vec1[i] * vec2[i];
    }
    return dotProduct;
  }

  upsert(items) {
    for (const item of items) {
      const embedding = this.embed(item.text);
      this.memories.set(item.id, {
        id: item.id,
        text: item.text,
        metadata: item.metadata || {},
        embedding
      });
    }
    return { success: true, count: items.length };
  }

  search(query, limit = 5) {
    const queryEmbedding = this.embed(query);
    const results = [];

    for (const memory of this.memories.values()) {
      const similarity = this.cosineSimilarity(queryEmbedding, memory.embedding);
      results.push({
        id: memory.id,
        text: memory.text,
        metadata: memory.metadata,
        score: similarity
      });
    }

    results.sort((a, b) => b.score - a.score);
    return results.slice(0, limit);
  }

  clear() {
    this.memories.clear();
    return { success: true };
  }
}

const store = new VectorMemoryStore();

const server = new Server(
  {
    name: 'twitch-copilot-vector-memory',
    version: '1.0.0'
  },
  {
    capabilities: {
      tools: {}
    }
  }
);

server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: 'upsert_memory',
        description: 'Store or update memory items with text and metadata',
        inputSchema: {
          type: 'object',
          properties: {
            items: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  id: { type: 'string' },
                  text: { type: 'string' },
                  metadata: { type: 'object' }
                },
                required: ['id', 'text']
              }
            }
          },
          required: ['items']
        }
      },
      {
        name: 'search_memory',
        description: 'Search memory items by text similarity',
        inputSchema: {
          type: 'object',
          properties: {
            query: { type: 'string' },
            limit: { type: 'number', default: 5 }
          },
          required: ['query']
        }
      },
      {
        name: 'clear_memory',
        description: 'Clear all stored memories',
        inputSchema: {
          type: 'object',
          properties: {}
        }
      }
    ]
  };
});

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  switch (name) {
    case 'upsert_memory': {
      const result = store.upsert(args.items || []);
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(result)
          }
        ]
      };
    }

    case 'search_memory': {
      const results = store.search(args.query, args.limit || 5);
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(results)
          }
        ]
      };
    }

    case 'clear_memory': {
      const result = store.clear();
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(result)
          }
        ]
      };
    }

    default:
      throw new Error(`Unknown tool: ${name}`);
  }
});

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('Twitch Copilot MCP Vector Memory Server running');
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
