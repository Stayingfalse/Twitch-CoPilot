const { spawn } = require('node:child_process');
const { EventEmitter } = require('node:events');

/**
 * Extracts closed captions from Twitch stream using streamlink + ccextractor
 * This runs as a subprocess that continuously monitors the stream
 */
class TwitchCaptionExtractor extends EventEmitter {
  constructor(config) {
    super();
    this.channel = config.channel;
    this.quality = config.quality || 'best';
    this.process = null;
    this.buffer = '';
  }

  /**
   * Start extracting captions from the stream
   */
  start() {
    if (this.process) {
      return;
    }

    // Use streamlink to get the stream, pipe to ccextractor
    // streamlink outputs the stream to stdout, ccextractor reads from stdin
    const streamlink = spawn('streamlink', [
      `https://twitch.tv/${this.channel}`,
      this.quality,
      '--stdout',
      '--twitch-disable-ads'
    ]);

    const ccextractor = spawn('ccextractor', [
      '-',
      '-o',
      '-',
      '--no_progress_bar',
      '--stream',
      '--trim'
    ]);

    // Pipe streamlink output to ccextractor input
    streamlink.stdout.pipe(ccextractor.stdin);

    // Handle ccextractor output (the actual captions)
    ccextractor.stdout.on('data', (data) => {
      this.buffer += data.toString();
      this.processBuffer();
    });

    // Handle errors
    streamlink.stderr.on('data', (data) => {
      const message = data.toString();
      if (!message.includes('[download]')) {
        console.error('streamlink error:', message);
      }
    });

    ccextractor.stderr.on('data', (data) => {
      const message = data.toString();
      if (!message.includes('Extracting')) {
        console.error('ccextractor error:', message);
      }
    });

    streamlink.on('close', (code) => {
      console.log('streamlink closed with code:', code);
      this.stop();
    });

    ccextractor.on('close', (code) => {
      console.log('ccextractor closed with code:', code);
      this.stop();
    });

    this.process = { streamlink, ccextractor };
    console.log(`Started caption extraction for channel: ${this.channel}`);
  }

  /**
   * Process accumulated buffer and emit caption lines
   */
  processBuffer() {
    const lines = this.buffer.split('\n');

    // Keep the last incomplete line in the buffer
    this.buffer = lines.pop() || '';

    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed && !trimmed.startsWith('[') && trimmed.length > 2) {
        this.emit('caption', {
          text: trimmed,
          timestamp: Date.now()
        });
      }
    }
  }

  /**
   * Stop the caption extraction
   */
  stop() {
    if (!this.process) {
      return;
    }

    try {
      this.process.streamlink.kill();
      this.process.ccextractor.kill();
    } catch (error) {
      console.error('Error stopping caption extraction:', error);
    }

    this.process = null;
    this.buffer = '';
  }

  /**
   * Check if extraction is running
   */
  isRunning() {
    return this.process !== null;
  }
}

module.exports = {
  TwitchCaptionExtractor
};
