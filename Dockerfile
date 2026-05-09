FROM node:20-slim

# Install system dependencies for caption extraction
RUN apt-get update && apt-get install -y \
    python3 \
    python3-pip \
    ffmpeg \
    ccextractor \
    && rm -rf /var/lib/apt/lists/*

# Install streamlink for Twitch stream access
RUN pip3 install --no-cache-dir streamlink

# Set working directory
WORKDIR /app

# Copy package files for both bot and mcp-server
COPY package.json ./
COPY packages/bot/package*.json ./packages/bot/
COPY packages/mcp-server/package.json ./packages/mcp-server/

# Install dependencies
RUN npm install --workspaces

# Copy source code
COPY packages/bot/ ./packages/bot/
COPY packages/mcp-server/ ./packages/mcp-server/

# Create start script that runs both services
RUN echo '#!/bin/bash\n\
set -e\n\
\n\
# Start MCP server in background\n\
echo "Starting MCP Vector Memory Server..."\n\
node /app/packages/mcp-server/src/index.js > /tmp/mcp-server.log 2>&1 &\n\
MCP_PID=$!\n\
\n\
# Give MCP server a moment to start\n\
sleep 2\n\
\n\
# Function to cleanup on exit\n\
cleanup() {\n\
    echo "Shutting down..."\n\
    kill $MCP_PID 2>/dev/null || true\n\
    exit 0\n\
}\n\
\n\
trap cleanup SIGTERM SIGINT\n\
\n\
# Start bot in foreground\n\
echo "Starting Twitch Copilot Bot..."\n\
cd /app/packages/bot\n\
node src/index.js\n\
' > /app/start.sh && chmod +x /app/start.sh

# Expose any ports if needed (not required for this app)
# EXPOSE 8080

# Set environment variable defaults
ENV NODE_ENV=production
ENV TRANSCRIPT_SOURCE=live

# Run the start script
CMD ["/app/start.sh"]
