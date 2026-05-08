const test = require('node:test');
const assert = require('node:assert/strict');
const { LocalVectorMemory } = require('../src/vector-memory');
const { buildCopilotPrompt, sanitizeChatReply } = require('../src/prompt');

test('LocalVectorMemory returns the most relevant stored context first', async () => {
  const memory = new LocalVectorMemory(10);
  await memory.upsert([
    {
      id: '1',
      text: 'The streamer is fighting a difficult Elden Ring boss.',
      metadata: { source: 'transcript' }
    },
    {
      id: '2',
      text: 'Chat is asking about the build and the weapon choice.',
      metadata: { source: 'chat' }
    }
  ]);

  const matches = await memory.search('What boss is the streamer fighting?', 2);

  assert.equal(matches[0].id, '1');
  assert.equal(matches[0].metadata.source, 'transcript');
});

test('buildCopilotPrompt includes stream, transcript, and memory context', () => {
  const prompt = buildCopilotPrompt({
    intent: 'chat',
    botName: 'CoPilot',
    channel: 'stayingfalse',
    streamContext: {
      live: true,
      gameName: 'Elden Ring',
      title: 'Boss attempts',
      userName: 'Stayingfalse'
    },
    chatter: 'viewer1',
    chatMessage: 'What build is this?',
    transcriptSegments: [{ text: 'I need one more clean dodge here.' }],
    memoryMatches: [{ text: 'Chat mentioned the dex build earlier.', metadata: { source: 'chat' } }]
  });

  assert.match(prompt, /Elden Ring/);
  assert.match(prompt, /What build is this\?/);
  assert.match(prompt, /one more clean dodge/);
  assert.match(prompt, /dex build/);
});

test('sanitizeChatReply compacts whitespace and enforces length', () => {
  const reply = sanitizeChatReply('  hello\n\nthere   friend  ', 12);
  assert.equal(reply, 'hello there');
});

test('sanitizeChatReply removes markdown-style formatting characters', () => {
  const reply = sanitizeChatReply('`hello` *_chat_* > friend #1', 50);
  assert.equal(reply, 'hello chat friend 1');
});
