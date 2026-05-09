#!/bin/bash
# Local development startup script
# Starts MCP server in background and bot in foreground

set -e

echo "Starting MCP Vector Memory Server..."
node packages/mcp-server/src/index.js > /tmp/mcp-server.log 2>&1 &
MCP_PID=$!

echo "MCP Server PID: $MCP_PID"
echo "MCP Server logs: /tmp/mcp-server.log"

# Give MCP server a moment to start
sleep 2

# Function to cleanup on exit
cleanup() {
    echo ""
    echo "Shutting down..."
    kill $MCP_PID 2>/dev/null || true
    exit 0
}

trap cleanup SIGTERM SIGINT

# Start bot in foreground
echo "Starting Twitch Copilot Bot..."
cd packages/bot
node src/index.js
