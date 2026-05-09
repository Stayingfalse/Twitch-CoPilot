# Twitch-CoPilot

**Monorepo Docker-based Twitch chat bot** with integrated MCP vector memory that:

- Extracts **live closed captions** directly from Twitch video streams using streamlink + ccextractor
- Joins Twitch chat and greets first-time chatters
- **Tracks individual chatter context** - remembers each chatter's interests, conversation history, and memorable quotes
- **Tracks game-specific context** - stores memorable moments, achievements, and funny quotes for each game
- Fetches live stream context from the Twitch API (game + title)
- Stores chat and caption context in an integrated MCP vector memory server
- Generates **personalized AI-powered responses** using chatter history and game context
- Supports Gemini, local OpenAI-compatible models, or fallback heuristics

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
│   │       ├── chatter-profiles.js # Per-chatter context tracking
│   │       ├── game-context.js     # Per-game history and quotes
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

### 1. Obtain Required API Keys

Before you can run the bot, you'll need to obtain API keys from third-party services:

#### Twitch API Keys

1. **Go to the Twitch Developer Console**: https://dev.twitch.tv/console
2. **Register an application**:
   - Click "Register Your Application"
   - Name: Choose any name (e.g., "MyTwitchCopilot")
   - OAuth Redirect URLs: Use `http://localhost` for development
   - Category: Select "Chat Bot"
   - Click "Create"
3. **Get your credentials**:
   - Copy the **Client ID** (this is your `TWITCH_CLIENT_ID`)
   - Click "New Secret" to generate a **Client Secret** (this is your `TWITCH_CLIENT_SECRET`)
4. **Generate an OAuth token** for the bot account:
   - Go to: https://twitchtokengenerator.com/
   - Select "Bot Chat Token"
   - Authorize with the Twitch account you want to use as the bot
   - Copy the OAuth token (this is your `TWITCH_BOT_OAUTH`, including the `oauth:` prefix)

#### Gemini API Key (Recommended AI Provider)

1. **Go to Google AI Studio**: https://makersuite.google.com/app/apikey
2. **Sign in** with your Google account
3. **Create an API key**:
   - Click "Get API key" or "Create API key"
   - Select or create a Google Cloud project
   - Copy the generated API key (this is your `GEMINI_API_KEY`)
4. **Note**: Gemini API has a free tier with generous limits. Check https://ai.google.dev/pricing for current rates.

#### Alternative: Local AI (Optional)

If you prefer not to use cloud AI services, you can run a local LLM using Ollama:

1. **Install Ollama**: https://ollama.ai/
2. **Pull a model**: `ollama pull llama3.1:8b`
3. **Start the server**: `ollama serve`
4. Use `AI_PROVIDER=local` in your configuration

### 2. Create a `.env` file

Create a `.env` file in the project root with your API keys and configuration:

```env
# ============================================
# REQUIRED: Twitch Configuration
# ============================================
# The Twitch channel name to monitor (without the @ symbol)
TWITCH_CHANNEL=your_channel_name

# The username of the bot account (must match the OAuth token account)
TWITCH_BOT_USERNAME=your_bot_username

# OAuth token for the bot account (from twitchtokengenerator.com)
# Must include the "oauth:" prefix
TWITCH_BOT_OAUTH=oauth:your_twitch_oauth_token

# Twitch application Client ID (from dev.twitch.tv/console)
TWITCH_CLIENT_ID=your_twitch_client_id

# Twitch application Client Secret (from dev.twitch.tv/console)
TWITCH_CLIENT_SECRET=your_twitch_client_secret

# ============================================
# REQUIRED: AI Provider Configuration
# ============================================
# Choose one: "gemini", "local", or "fallback"
AI_PROVIDER=gemini

# For Gemini (Google AI):
# Get your API key from https://makersuite.google.com/app/apikey
GEMINI_API_KEY=your_gemini_api_key
GEMINI_MODEL=gemini-2.5-flash

# For Local AI (Ollama):
# Uncomment these if using AI_PROVIDER=local
# LOCAL_LLM_URL=http://host.docker.internal:11434/v1/chat/completions
# LOCAL_LLM_MODEL=llama3.1:8b

# ============================================
# OPTIONAL: Bot Behavior Configuration
# ============================================
# Display name shown to users (defaults to TWITCH_BOT_USERNAME)
BOT_DISPLAY_NAME=TwitchCopilot

# Command trigger for direct bot interaction (e.g., "!copilot help")
BOT_COMMAND_TRIGGER=!copilot

# Minimum milliseconds between bot responses to prevent spam
BOT_RESPONSE_COOLDOWN_MS=30000

# Milliseconds between automatic commentary when streamer is talking
BOT_COMMENTARY_INTERVAL_MS=90000

# Maximum characters per message (Twitch limit is 500, recommended 240)
BOT_MAX_REPLY_CHARS=240

# ============================================
# OPTIONAL: Transcript/Caption Configuration
# ============================================
# Source for transcript: "live", "file", "http", or "none"
TRANSCRIPT_SOURCE=live

# Stream quality for caption extraction: "best", "720p", "480p", etc.
TRANSCRIPT_QUALITY=best

# How often to check for new captions (milliseconds)
TRANSCRIPT_POLL_INTERVAL_MS=15000

# Maximum number of recent transcript segments to keep in memory
TRANSCRIPT_MAX_SEGMENTS=8

# ============================================
# OPTIONAL: Advanced Configuration
# ============================================
# Maximum items stored in vector memory (affects memory usage)
MEMORY_MAX_ITEMS=250

# AI model temperature (0.0-1.0, higher = more creative)
AI_TEMPERATURE=0.7

# Stream info polling interval (milliseconds)
TWITCH_STREAM_POLL_INTERVAL_MS=60000
```

### 3. Build and run with Docker Compose

```bash
docker-compose up --build
```

Or build and run directly with Docker:

```bash
docker build -t twitch-copilot .
docker run --env-file .env twitch-copilot
```

### 4. Stop the container

```bash
docker-compose down
```

## Docker Configuration

### Environment Variables

The bot is configured entirely through environment variables. All variables are documented in the `.env` file example above. Key points:

- **Required variables**: `TWITCH_CHANNEL`, `TWITCH_BOT_USERNAME`, `TWITCH_BOT_OAUTH`, `TWITCH_CLIENT_ID`, `TWITCH_CLIENT_SECRET`, and either `GEMINI_API_KEY` (for Gemini) or `AI_PROVIDER=fallback` (for no AI)
- **Optional variables**: All bot behavior, transcript, and memory settings have sensible defaults
- **File location**: Place the `.env` file in the same directory as `docker-compose.yml`

### Docker Volumes

The `docker-compose.yml` configures two optional volumes:

#### 1. Environment File Volume (Read-Only)
```yaml
- ./.env:/app/.env:ro
```
- **Purpose**: Makes your `.env` file available inside the container
- **Mode**: Read-only (`:ro`) for security
- **Location**: Maps `./env` from your host to `/app/.env` in the container
- **Required**: Yes, if using `env_file` in docker-compose.yml
- **Note**: The container reads environment variables at startup, so you'll need to restart after changes

#### 2. Logs Volume (Optional)
```yaml
- ./logs:/app/logs
```
- **Purpose**: Persists bot logs on your host machine for debugging
- **Mode**: Read-write (logs are written by the bot)
- **Location**: Maps `./logs` directory on host to `/app/logs` in container
- **Required**: No, but useful for troubleshooting
- **Usage**: Create the logs directory first: `mkdir logs`
- **Contents**: Application logs, error logs, and fallback notices

#### Adding Custom Volumes

If you need to persist additional data or mount configuration files, add volumes to your `docker-compose.yml`:

```yaml
volumes:
  # Persist chatter and game context across restarts (if implemented with file storage)
  - ./data:/app/data

  # Mount custom transcript files
  - ./transcripts:/app/transcripts:ro

  # Mount custom configuration
  - ./config.json:/app/config.json:ro
```

### Docker Networks

The bot uses a dedicated Docker network (`copilot-network`) defined in `docker-compose.yml`:

```yaml
networks:
  copilot-network:
    driver: bridge
```

This isolates the bot's network traffic. If you need to connect the bot to other services (like a local Ollama instance), you can:

1. **Use host networking** (not recommended for production):
   ```yaml
   network_mode: "host"
   ```

2. **Connect to an external network**:
   ```yaml
   networks:
     - copilot-network
     - your-external-network
   ```

3. **Use Docker's special hostname** `host.docker.internal` to reach services on your host:
   ```env
   LOCAL_LLM_URL=http://host.docker.internal:11434/v1/chat/completions
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

**Smart Fallback:** When using Gemini or local AI providers, the bot automatically falls back to heuristic responses only if the AI model encounters an error or returns an empty response. This ensures non-repetitive, contextual responses whenever possible, while gracefully degrading when the AI is unavailable.

### Context Tracking & Personalization

The bot maintains rich context about every interaction:

**Per-Chatter Context:**
- Tracks each chatter's message history and interests
- Identifies regular chatters vs first-time visitors
- Stores memorable quotes from each chatter
- Records conversation history with the bot
- Detects topics each chatter frequently discusses
- References past conversations naturally in responses

**Per-Game Context:**
- Tracks when each game is played and for how long
- Stores memorable moments and achievements
- Collects funny quotes from both streamer and chat
- Automatically detects potentially funny/memorable messages
- References game-specific history in commentary

**Contextual Responses:**
The bot uses this context to:
- Welcome regulars by referencing their interests
- Mention past funny quotes in relevant moments
- Reference game-specific achievements and moments
- Personalize responses based on chatter history
- Make commentary more engaging and contextually aware

All context is stored in the integrated vector memory for semantic retrieval, meaning the bot can recall relevant information even when not directly queried.

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
