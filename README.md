# Twitch-CoPilot

Node.js Twitch chat bot that:

- joins Twitch chat and greets first-time chatters
- fetches live stream context from the Twitch API (game + title)
- ingests streamer speech from either a transcript file or transcript HTTP endpoint
- stores chat/transcript context in vector memory, with optional MCP-backed vector tools
- replies with either Gemini, a local OpenAI-compatible model, or a fallback heuristic mode

## Setup

```bash
npm install
```

Create a `.env` file:

```env
TWITCH_CHANNEL=your_channel
TWITCH_BOT_USERNAME=your_bot_username
TWITCH_BOT_OAUTH=oauth:your_twitch_oauth_token
TWITCH_CLIENT_ID=your_twitch_client_id
TWITCH_CLIENT_SECRET=your_twitch_client_secret

# AI provider: gemini | local | fallback
AI_PROVIDER=gemini
GEMINI_API_KEY=your_gemini_api_key
GEMINI_MODEL=gemini-2.5-flash
BOT_COMMAND_TRIGGER=!twitchcopilot

# Transcript input: file | http | none
TRANSCRIPT_SOURCE=file
TRANSCRIPT_FILE=/absolute/path/to/transcript.json
# or
# TRANSCRIPT_SOURCE=http
# TRANSCRIPT_HTTP_URL=http://127.0.0.1:8000/transcript

# Optional MCP vector database bridge
# MCP_VECTOR_SERVER_COMMAND=npx
# MCP_VECTOR_SERVER_ARGS=[\"your-mcp-vector-server\"]
# MCP_VECTOR_UPSERT_TOOL=upsert_memory
# MCP_VECTOR_SEARCH_TOOL=search_memory
```

## Transcript format

`TRANSCRIPT_FILE` or `TRANSCRIPT_HTTP_URL` can return either:

- plain text lines, one transcript line per line
- a JSON array of strings
- a JSON array of objects like `{ "id": "123", "text": "Huge clutch there" }`
- a JSON object with `segments` or `items`

This makes it easy to plug in Whisper, a custom speech-to-text sidecar, or another transcript tool that watches the stream.

## Run

```bash
npm start
```

For a local startup check without connecting to Twitch chat:

```bash
DRY_RUN=true TWITCH_CHANNEL=demo npm start
```

## Tests

```bash
npm test
```
