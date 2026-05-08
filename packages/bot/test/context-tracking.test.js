const { test } = require('node:test');
const assert = require('node:assert');
const { ChatterProfiles } = require('../src/chatter-profiles');
const { GameContext } = require('../src/game-context');

test('ChatterProfiles tracks chatter message history', () => {
  const profiles = new ChatterProfiles();

  profiles.recordMessage('TestUser', 'I love playing games');
  profiles.recordMessage('TestUser', 'Minecraft is my favorite');
  profiles.recordMessage('TestUser', 'I also enjoy building things');

  const profile = profiles.getProfile('TestUser');
  assert.strictEqual(profile.messageCount, 3);
  assert.strictEqual(profile.recentMessages.length, 3);
  assert.ok(profile.lastSeen > 0);
});

test('ChatterProfiles detects chatter interests from messages', () => {
  const profiles = new ChatterProfiles();

  profiles.recordMessage('Gamer123', 'I love Minecraft and building houses');
  profiles.recordMessage('Gamer123', 'Minecraft is the best game ever');
  profiles.recordMessage('Gamer123', 'Just finished building a castle in Minecraft');

  const topTopics = profiles.getTopTopics('Gamer123', 3);
  const topics = topTopics.map(t => t.topic);

  assert.ok(topics.includes('minecraft'));
  assert.ok(topics.includes('building'));
});

test('ChatterProfiles tracks regular vs new chatters', () => {
  const profiles = new ChatterProfiles();

  // New chatter
  profiles.recordMessage('NewUser', 'Hello!');
  const newContext = profiles.getChatterContext('NewUser');
  assert.strictEqual(newContext.isNew, true);
  assert.strictEqual(newContext.isRegular, false);

  // Regular chatter
  for (let i = 0; i < 25; i++) {
    profiles.recordMessage('RegularUser', `Message ${i}`);
  }
  const regularContext = profiles.getChatterContext('RegularUser');
  assert.strictEqual(regularContext.isNew, false);
  assert.strictEqual(regularContext.isRegular, true);
});

test('ChatterProfiles stores funny quotes', () => {
  const profiles = new ChatterProfiles();

  profiles.addQuote('FunnyUser', 'That was hilarious!', { game: 'Minecraft' });
  profiles.addQuote('FunnyUser', 'Best stream ever!', { game: 'Minecraft' });

  const context = profiles.getChatterContext('FunnyUser');
  assert.strictEqual(context.funnyQuotes.length, 2);
  assert.strictEqual(context.funnyQuotes[0].text, 'That was hilarious!');
});

test('ChatterProfiles records interactions', () => {
  const profiles = new ChatterProfiles();

  profiles.recordInteraction('InteractiveUser', {
    intent: 'chat',
    prompt: 'What game are we playing?',
    response: 'We are playing Minecraft!',
    game: 'Minecraft'
  });

  const context = profiles.getChatterContext('InteractiveUser');
  assert.strictEqual(context.lastInteraction.intent, 'chat');
  assert.strictEqual(context.lastInteraction.prompt, 'What game are we playing?');
});

test('GameContext tracks game sessions', () => {
  const gameContext = new GameContext();

  gameContext.startGameSession('Minecraft', 'Building a castle');
  const game = gameContext.getGameContext('minecraft');

  assert.strictEqual(game.name, 'Minecraft');
  assert.strictEqual(game.sessionCount, 1);
  assert.ok(game.currentSessionStart !== null);
  assert.strictEqual(gameContext.currentGame, 'Minecraft');
});

test('GameContext stores memorable moments', () => {
  const gameContext = new GameContext();

  gameContext.startGameSession('Dark Souls', 'First playthrough');
  gameContext.addMoment('Defeated the first boss!', { difficulty: 'hard' });
  gameContext.addMoment('Found a secret area', { surprise: true });

  const summary = gameContext.getGameContextSummary('Dark Souls');
  assert.strictEqual(summary.recentMoments.length, 2);
  assert.strictEqual(summary.recentMoments[0].description, 'Defeated the first boss!');
});

test('GameContext stores funny quotes', () => {
  const gameContext = new GameContext();

  gameContext.startGameSession('Minecraft');
  gameContext.addQuote('How did I fall off that cliff?!', 'streamer');
  gameContext.addQuote('That was epic!', 'viewer123');

  const summary = gameContext.getGameContextSummary('Minecraft');
  assert.strictEqual(summary.recentQuotes.length, 2);
  assert.strictEqual(summary.recentQuotes[0].speaker, 'streamer');
  assert.strictEqual(summary.recentQuotes[1].speaker, 'viewer123');
});

test('GameContext detects funny quotes', () => {
  const gameContext = new GameContext();

  // Should detect funny quotes
  assert.strictEqual(gameContext.isFunnyQuote('That was hilarious lol!'), true);
  assert.strictEqual(gameContext.isFunnyQuote('OMG that was amazing wow!'), true);
  assert.strictEqual(gameContext.isFunnyQuote('Never forget this moment!'), true);

  // Should not detect normal messages
  assert.strictEqual(gameContext.isFunnyQuote('ok'), false);
  assert.strictEqual(gameContext.isFunnyQuote('lol'), false);
  assert.strictEqual(gameContext.isFunnyQuote('What is this?'), false);
});

test('GameContext tracks achievements', () => {
  const gameContext = new GameContext();

  gameContext.startGameSession('The Legend of Zelda');
  gameContext.addAchievement('Master Sword Obtained', 'Found the legendary sword');
  gameContext.addAchievement('All Shrines Completed', 'Completed 120 shrines');

  const summary = gameContext.getGameContextSummary('The Legend of Zelda');
  assert.strictEqual(summary.recentAchievements.length, 2);
  assert.strictEqual(summary.recentAchievements[0].name, 'Master Sword Obtained');
});

test('ChatterProfiles generates memory entries', () => {
  const profiles = new ChatterProfiles();

  profiles.recordMessage('MemoryUser', 'I love strategy games');
  profiles.recordMessage('MemoryUser', 'Strategy games are the best');
  profiles.addQuote('MemoryUser', 'This is the best play ever!');

  const entries = profiles.getMemoryEntries('MemoryUser');

  // Should have profile entry and quote entry
  assert.ok(entries.length >= 2);
  assert.ok(entries.some(e => e.metadata.type === 'interests'));
  assert.ok(entries.some(e => e.metadata.type === 'quote'));
});

test('GameContext generates memory entries', () => {
  const gameContext = new GameContext();

  gameContext.startGameSession('Elden Ring');
  gameContext.addMoment('Defeated Margit');
  gameContext.addQuote('That was intense!', 'streamer');

  const entries = gameContext.getMemoryEntries('Elden Ring');

  // Should have game overview, moment, and quote entries
  assert.ok(entries.length >= 3);
  assert.ok(entries.some(e => e.metadata.type === 'overview'));
  assert.ok(entries.some(e => e.metadata.type === 'moment'));
  assert.ok(entries.some(e => e.metadata.type === 'quote'));
});
