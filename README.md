# Twitch-CoPilot

**Monorepo Docker-based Twitch chat bot** with integrated MCP vector memory that:

- Extracts **live closed captions** directly from Twitch video streams using streamlink + ccextractor
- Joins Twitch chat and greets first-time chatters
- Fetches live stream context from the Twitch API (game + title)
- Stores chat and caption context in an integrated MCP vector memory server
- Generates AI-powered responses using Gemini, local OpenAI-compatible models, or fallback heuristics

## Architecture

This is a **monorepo monocontainer** project where everything runs in a single Docker container:

```
twitch-copilot/
├── packages/
│   ├── bot/                    # Main Twitch bot application
│   │   └── src/
│   │       ├── index.js        # Entry point
│   │       ├── bot.js          # Bot orchestration
│   │       ├── twitch-captions.js  # Live caption extraction
│   │       ├── transcript-source.js
│   │       ├── twitch-api.js
│   │       ├── llm.js
│   │       ├── prompt.js
│   │       ├── vector-memory.js
│   │       └── config.js
│   └── mcp-server/             # Integrated MCP vector memory server
│       └── src/
│           └── index.js        # MCP server with in-memory vector store
├── Dockerfile                  # Multi-service container
├── docker-compose.yml          # Deployment configuration
└── README.md
```

## Quick Start with Docker

### 1. Create a `.env` file

```env
# Required: Twitch Configuration
TWITCH_CHANNEL=your_channel_name
TWITCH_BOT_USERNAME=your_bot_username
TWITCH_BOT_OAUTH=oauth:your_twitch_oauth_token
TWITCH_CLIENT_ID=your_twitch_client_id
TWITCH_CLIENT_SECRET=your_twitch_client_secret

# Required: AI Provider (choose one)
AI_PROVIDER=gemini
GEMINI_API_KEY=your_gemini_api_key
GEMINI_MODEL=gemini-2.5-flash

# Optional: Bot Configuration
BOT_DISPLAY_NAME=TwitchCopilot
BOT_COMMAND_TRIGGER=!copilot
BOT_RESPONSE_COOLDOWN_MS=30000
BOT_COMMENTARY_INTERVAL_MS=90000

# Optional: Transcript Configuration
TRANSCRIPT_SOURCE=live
TRANSCRIPT_QUALITY=best
TRANSCRIPT_POLL_INTERVAL_MS=15000
TRANSCRIPT_MAX_SEGMENTS=8
```

### 2. Build and run with Docker Compose

```bash
docker-compose up --build
```

Or build and run directly with Docker:

```bash
docker build -t twitch-copilot .
docker run --env-file .env twitch-copilot
```

### 3. Stop the container

```bash
docker-compose down
```

## How It Works

### Live Caption Extraction

The bot uses **streamlink** to access the Twitch stream and pipes it to **ccextractor** to extract CEA-608/708 closed captions in real-time:

```
Twitch Stream → streamlink → ccextractor → Bot (captions as text)
```

This happens automatically when `TRANSCRIPT_SOURCE=live` (the default).

### Integrated MCP Vector Memory

The included MCP server provides vector-based memory storage:

- Uses simple character-frequency embeddings and cosine similarity
- Automatically started in the Docker container
- Stores and retrieves chat messages and caption context
- No external database required

### AI Response Generation

The bot generates responses using:

1. **Gemini API** (`AI_PROVIDER=gemini`) - Recommended
2. **Local OpenAI-compatible API** (`AI_PROVIDER=local`) - e.g., Ollama
3. **Fallback heuristics** (`AI_PROVIDER=fallback`) - Simple keyword-based responses

## Configuration Reference

### Transcript Sources

- `live` (default) - Extract live closed captions from the video stream
- `file` - Read from a local transcript file (legacy)
- `http` - Fetch from an HTTP endpoint (legacy)
- `none` - Disable transcript input

### AI Providers

**Gemini (Recommended)**
```env
AI_PROVIDER=gemini
GEMINI_API_KEY=your_api_key
GEMINI_MODEL=gemini-2.5-flash
```

**Local OpenAI-compatible (e.g., Ollama)**
```env
AI_PROVIDER=local
LOCAL_LLM_URL=http://host.docker.internal:11434/v1/chat/completions
LOCAL_LLM_MODEL=llama3.1:8b
```

**Fallback (No API required)**
```env
AI_PROVIDER=fallback
```

## Development

### Local Development without Docker

Install dependencies:
```bash
npm install
```

Install system dependencies (Ubuntu/Debian):
```bash
sudo apt-get install streamlink ccextractor
```

Run the bot:
```bash
npm start
```

Run tests:
```bash
npm test
```

### Workspace Commands

Start the bot:
```bash
npm run start --workspace=@twitch-copilot/bot
```

Start the MCP server separately:
```bash
npm run start --workspace=@twitch-copilot/mcp-server
```

## Requirements

### For Docker Deployment
- Docker
- Docker Compose (optional)

### For Local Development
- Node.js 20+
- streamlink (Python package)
- ccextractor (system binary)
- ffmpeg (system binary)

## Troubleshooting

### Captions not appearing

1. Check that the channel has closed captions enabled
2. Verify streamlink can access the stream: `streamlink https://twitch.tv/CHANNEL best --stdout`
3. Check container logs: `docker-compose logs -f`

### Memory issues

The in-memory vector store has a default limit of 250 items. Increase it:

```env
MEMORY_MAX_ITEMS=500
```

### Connection issues from within Docker

If the bot needs to access services on your host machine (e.g., local Ollama):

```env
LOCAL_LLM_URL=http://host.docker.internal:11434/v1/chat/completions
```

## License

ISC
