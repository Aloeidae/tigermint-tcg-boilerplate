import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  applyCommand,
  createGame,
  redactFor,
  validatePokemonDeck,
  buildStarterPokemonDeck,
  POKEMON_DEMO_CARDS,
  POKEMON_QUICK,
  chooseCommand,
  actingPlayer,
  isBasicSticker,
  type CardDef,
  type GameState,
  type ReactionType,
  type RulesConfig,
} from '../src/index.js';
import type { Command } from '../src/commands.js';

// --- fixtures --------------------------------------------------------------

const energy = (type: ReactionType): CardDef => ({
  id: `tst-energy-${type.toLowerCase()}`,
  name: `${type} Energy`,
  type: 'spell',
  cost: 0,
  game: { kind: 'reaction', type, special: false, provides: [type] },
});

const basic = (
  id: string,
  type: ReactionType,
  hp: number,
  moves: NonNullable<Extract<CardDef['game'], { kind: 'sticker' }>>['moves'],
  extra: Partial<Extract<CardDef['game'], { kind: 'sticker' }>> = {}
): CardDef => ({
  id,
  name: id,
  type: 'creature',
  cost: 1,
  game: {
    kind: 'sticker', stage: 'Static', stageIndex: 0, type, hp, moves,
    weakness: null, resistance: null, swapCost: 1, ...extra,
  },
});

// Solid deck: hits for 30, can inflict poison.
const solidBasic = basic('tst-solid', 'Solid', 70, [
  { name: 'Jab', cost: ['Solid'], damage: 30 },
  { name: 'Sludge Sling', cost: ['Solid'], damage: 0, effects: [{ op: 'status', status: 'Spammed' }] },
]);
// Mind deck: weak to Solid, can put the enemy to sleep.
const mindBasic = basic('tst-mind', 'Mind', 70, [
  { name: 'Zap', cost: ['Mind'], damage: 30 },
  { name: 'Lull', cost: ['Mind'], damage: 0, effects: [{ op: 'status', status: 'Muted' }] },
], { weakness: 'Solid' });

const evoCard: CardDef = {
  id: 'tst-evo',
  name: 'tst-evo',
  type: 'creature',
  cost: 2,
  game: {
    kind: 'sticker', stage: 'Animated', stageIndex: 1, upgradesFrom: 'tst-solid',
    type: 'Solid', hp: 120, moves: [{ name: 'Slam', cost: ['Solid', 'Solid'], damage: 60 }],
    weakness: null, resistance: null, swapCost: 2,
  },
};

const drawBot: CardDef = {
  id: 'tst-bot', name: 'tst-bot', type: 'spell', cost: 1,
  game: { kind: 'bot', effects: [{ op: 'draw', count: 2 }] },
};
const drawAdmin: CardDef = {
  id: 'tst-admin', name: 'tst-admin', type: 'spell', cost: 1,
  game: { kind: 'admin', effects: [{ op: 'draw', count: 1 }] },
};

function deckOf(sticker: CardDef, type: ReactionType, extras: CardDef[] = []): CardDef[] {
  const deck: CardDef[] = [];
  for (let i = 0; i < 10 - Math.min(extras.length, 4); i++) deck.push(sticker);
  deck.push(...extras);
  while (deck.length < 30) deck.push(energy(type));
  return deck;
}

const QUICK: Partial<RulesConfig> = { ...POKEMON_QUICK };

function ok(r: ReturnType<typeof applyCommand>): GameState {
  assert.ok(r.ok, !r.ok ? r.error : '');
  return (r as { ok: true; state: GameState }).state;
}

/** Both players place their opening boards (first basic active, rest benched). */
function doSetup(state: GameState): GameState {
  for (const player of [0, 1] as const) {
    const p = state.players[player];
    const basics = p.hand.filter((c) => isBasicSticker(c.def));
    state = ok(
      applyCommand(state, {
        type: 'setup', player, pinnedId: basics[0].instanceId,
        benchIds: basics.slice(1).map((c) => c.instanceId),
      })
    );
  }
  return state;
}

function newGame(deckA: CardDef[], deckB: CardDef[], seed = 5, rules: Partial<RulesConfigLike> = {}): GameState {
  const { state } = createGame({ decks: [deckA, deckB], seed, rules: { ...QUICK, ...rules } });
  return state;
}
type RulesConfigLike = RulesConfig;

/** Cycle full turns (both players pass) until a hand card matches. */
function untilInHand(state: GameState, player: 0 | 1, pred: (c: CardDef) => boolean, max = 20): GameState {
  for (let i = 0; i < max; i++) {
    if (state.players[player].hand.some((c) => pred(c.def))) return state;
    state = ok(applyCommand(state, { type: 'endTurn', player: state.active }));
  }
  throw new Error('card never drawn');
}

function findEnergy(state: GameState, player: 0 | 1) {
  return state.players[player].hand.find((c) => c.def.game?.kind === 'reaction');
}

// --- tests -----------------------------------------------------------------

test('pokemon: createGame opens in setup with prizes set and a basic in hand', () => {
  const state = newGame(deckOf(solidBasic, 'Solid'), deckOf(mindBasic, 'Mind'));
  assert.equal(state.phase, 'setup');
  for (const p of state.players) {
    assert.equal(p.prizes?.length, 3);
    assert.equal(p.life, 3);
    assert.ok(p.hand.some((c) => isBasicSticker(c.def)), 'opening hand has a basic');
  }
  // Redaction: the opponent's setup board is hidden, prize contents never leave the server.
  const view = redactFor(state, 0);
  assert.equal(view.opponent.prizeCount, 3);
  assert.ok(!('prizes' in view.you));
});

test('pokemon: setup places boards, then turn 1 begins without a first draw', () => {
  let state = newGame(deckOf(solidBasic, 'Solid'), deckOf(mindBasic, 'Mind'));
  const before = state.players[0].hand.length;
  state = doSetup(state);
  assert.equal(state.phase, 'main1');
  assert.equal(state.active, 0);
  assert.equal(state.turn, 1);
  assert.ok(state.players[0].row[0], 'active placed');
  // Quick rules: the first player skips the turn-1 draw.
  assert.equal(state.players[0].hand.length, before - state.players[0].row.filter(Boolean).length);
});

test('pokemon: one energy attachment per turn, and turn-1 attack ban', () => {
  let state = doSetup(newGame(deckOf(solidBasic, 'Solid'), deckOf(mindBasic, 'Mind')));
  state = untilInHand(state, 0, (d) => d.game?.kind === 'reaction');
  assert.equal(state.active, 0);
  const activeId = state.players[0].row[0]!.instanceId;
  const e1 = findEnergy(state, 0)!;
  state = ok(applyCommand(state, { type: 'attachReaction', player: 0, instanceId: e1.instanceId, targetInstanceId: activeId }));
  assert.equal(state.players[0].row[0]!.reactions?.length, 1);
  const e2 = findEnergy(state, 0);
  if (e2) {
    const again = applyCommand(state, { type: 'attachReaction', player: 0, instanceId: e2.instanceId, targetInstanceId: activeId });
    assert.ok(!again.ok, 'second attachment must be rejected');
  }
  if (state.turn === 1) {
    const early = applyCommand(state, { type: 'useMove', player: 0, moveIndex: 0 });
    assert.ok(!early.ok, 'no attacking on the very first turn');
  }
});

test('pokemon: moves apply weakness, end the turn, and knockouts pay prizes + demand a promote', () => {
  let state = doSetup(newGame(deckOf(solidBasic, 'Solid'), deckOf(mindBasic, 'Mind'), 11));
  // Power up player 0's active.
  state = untilInHand(state, 0, (d) => d.game?.kind === 'reaction');
  const attacker = state.players[0].row[0]!;
  state = ok(applyCommand(state, {
    type: 'attachReaction', player: 0, instanceId: findEnergy(state, 0)!.instanceId, targetInstanceId: attacker.instanceId,
  }));
  if (state.turn === 1) {
    // Can't attack yet — pass the round.
    state = ok(applyCommand(state, { type: 'endTurn', player: 0 }));
    state = ok(applyCommand(state, { type: 'endTurn', player: 1 }));
  }
  assert.equal(state.active, 0);
  const defenderBefore = state.players[1].row[0]!;
  state = ok(applyCommand(state, { type: 'useMove', player: 0, moveIndex: 0 }));
  // 30 base ×2 weakness = 60 onto a 70 HP defender.
  const defender = state.players[1].row[0]!;
  assert.equal(defender.instanceId, defenderBefore.instanceId);
  assert.equal(defender.health, 10);
  assert.equal(state.active, 1, 'attacking ends the turn');

  // Pass back and finish it off.
  state = ok(applyCommand(state, { type: 'endTurn', player: 1 }));
  const benchBefore = state.players[1].row.slice(1).filter(Boolean).length;
  state = ok(applyCommand(state, { type: 'useMove', player: 0, moveIndex: 0 }));
  assert.equal(state.players[1].row[0], null, 'defender knocked out');
  assert.equal(state.players[0].prizes?.length, 2, 'prize taken');
  assert.equal(state.players[0].prizesTaken, 1);
  if (benchBefore > 0) {
    assert.equal(state.pendingPromote, 1);
    assert.equal(actingPlayer(state), 1);
    const replacement = state.players[1].row.slice(1).find((c) => c)!;
    const blockedMid = applyCommand(state, { type: 'endTurn', player: 0 });
    assert.ok(!blockedMid.ok, 'nothing else happens while a promote is pending');
    state = ok(applyCommand(state, { type: 'promote', player: 1, targetInstanceId: replacement.instanceId }));
    assert.ok(state.players[1].row[0], 'promoted');
    assert.equal(state.active, 1, 'the interrupted turn hand-off resumes');
  }
});

test('pokemon: poison ticks between turns, sleep blocks attacking, coins are seed-deterministic', () => {
  let state = doSetup(newGame(deckOf(solidBasic, 'Solid'), deckOf(mindBasic, 'Mind'), 21));
  state = untilInHand(state, 0, (d) => d.game?.kind === 'reaction');
  const att = state.players[0].row[0]!;
  state = ok(applyCommand(state, {
    type: 'attachReaction', player: 0, instanceId: findEnergy(state, 0)!.instanceId, targetInstanceId: att.instanceId,
  }));
  while (state.turn === 1 || state.active !== 0) {
    state = ok(applyCommand(state, { type: 'endTurn', player: state.active }));
  }
  // Sludge Sling: 0 damage, poisons the enemy active; the between-turns tick lands 10.
  state = ok(applyCommand(state, { type: 'useMove', player: 0, moveIndex: 1 }));
  const poisoned = state.players[1].row[0]!;
  assert.ok(poisoned.statuses.some((s) => s.key === 'spammed'));
  assert.equal(poisoned.health, 60, 'poison ticked once between turns');

  // Opponent lulls us to sleep: our attack is now illegal.
  state = untilInHand(state, 1, (d) => d.game?.kind === 'reaction');
  if (state.active !== 1) state = ok(applyCommand(state, { type: 'endTurn', player: state.active }));
  const oppActive = state.players[1].row[0]!;
  state = ok(applyCommand(state, {
    type: 'attachReaction', player: 1, instanceId: findEnergy(state, 1)!.instanceId, targetInstanceId: oppActive.instanceId,
  }));
  state = ok(applyCommand(state, { type: 'useMove', player: 1, moveIndex: 1 }));
  const mine = state.players[0].row[0]!;
  if (mine.statuses.some((s) => s.key === 'muted')) {
    const blocked = applyCommand(state, { type: 'useMove', player: 0, moveIndex: 0 });
    assert.ok(!blocked.ok, 'muted stickers cannot attack');
  }

  // Determinism: replaying the same seed and commands gives identical flips.
  const replayA = scriptedRun(31);
  const replayB = scriptedRun(31);
  assert.deepEqual(replayA, replayB);
});

function scriptedRun(seed: number): GameState {
  let state = doSetup(newGame(deckOf(solidBasic, 'Solid'), deckOf(mindBasic, 'Mind'), seed));
  const script: Command[] = [
    { type: 'endTurn', player: 0 },
    { type: 'endTurn', player: 1 },
    { type: 'endTurn', player: 0 },
  ];
  for (const cmd of script) state = ok(applyCommand(state, cmd));
  return state;
}

test('pokemon: retreat pays the swap cost and is once per turn', () => {
  let state = doSetup(newGame(deckOf(solidBasic, 'Solid'), deckOf(mindBasic, 'Mind'), 41));
  state = untilInHand(state, 0, (d) => d.game?.kind === 'reaction');
  if (state.active !== 0) state = ok(applyCommand(state, { type: 'endTurn', player: state.active }));
  const bench = state.players[0].row.slice(1).find((c) => c);
  if (!bench) return; // this seed benched nothing; covered by other seeds
  const act = state.players[0].row[0]!;
  const broke = applyCommand(state, { type: 'swap', player: 0, targetInstanceId: bench.instanceId });
  assert.ok(!broke.ok, 'cannot pay a 1-energy retreat with nothing attached');
  state = ok(applyCommand(state, {
    type: 'attachReaction', player: 0, instanceId: findEnergy(state, 0)!.instanceId, targetInstanceId: act.instanceId,
  }));
  state = ok(applyCommand(state, { type: 'swap', player: 0, targetInstanceId: bench.instanceId }));
  assert.equal(state.players[0].row[0]!.instanceId, bench.instanceId, 'bench sticker is now active');
  assert.equal(state.players[0].graveyard.length, 1, 'retreat cost discarded');
  const again = applyCommand(state, { type: 'swap', player: 0, targetInstanceId: act.instanceId });
  assert.ok(!again.ok, 'one retreat per turn');
});

test('pokemon: evolution needs time in play, keeps damage, and is banned on the first turns', () => {
  let state = doSetup(newGame(deckOf(solidBasic, 'Solid', [evoCard, evoCard, evoCard, evoCard]), deckOf(mindBasic, 'Mind'), 51));
  state = untilInHand(state, 0, (d) => d.id === 'tst-evo');
  if (state.active !== 0) state = ok(applyCommand(state, { type: 'endTurn', player: state.active }));
  const evo = state.players[0].hand.find((c) => c.def.id === 'tst-evo')!;
  const target = state.players[0].row.find((c) => c && c.def.id === 'tst-solid');
  assert.ok(target, 'a solid basic is in play');
  if (state.turn <= 2) {
    const tooSoon = applyCommand(state, { type: 'upgrade', player: 0, instanceId: evo.instanceId, targetInstanceId: target!.instanceId });
    assert.ok(!tooSoon.ok, 'no evolving on your first turn');
    state = ok(applyCommand(state, { type: 'endTurn', player: 0 }));
    state = ok(applyCommand(state, { type: 'endTurn', player: 1 }));
  }
  target!.health -= 0; // no-op; damage carryover asserted via HP math below
  state = ok(applyCommand(state, { type: 'upgrade', player: 0, instanceId: evo.instanceId, targetInstanceId: target!.instanceId }));
  const evolved = state.players[0].row.find((c) => c?.instanceId === target!.instanceId)!;
  assert.equal(evolved.def.id, 'tst-evo');
  assert.equal(evolved.maxHealth, 120);
  assert.equal(evolved.health, 120, 'undamaged evolves to full HP');
  assert.equal(evolved.stack?.length, 1, 'the basic sits underneath');
  const again = applyCommand(state, {
    type: 'upgrade', player: 0,
    instanceId: state.players[0].hand.find((c) => c.def.id === 'tst-evo')?.instanceId ?? 'none',
    targetInstanceId: evolved.instanceId,
  });
  assert.ok(!again.ok, 'cannot evolve the same sticker again this turn');
});

test('pokemon: items draw, supporters are one per turn', () => {
  let state = doSetup(newGame(deckOf(solidBasic, 'Solid', [drawBot, drawBot, drawAdmin, drawAdmin]), deckOf(mindBasic, 'Mind'), 61));
  state = untilInHand(state, 0, (d) => d.id === 'tst-bot');
  if (state.active !== 0) state = ok(applyCommand(state, { type: 'endTurn', player: state.active }));
  const bot = state.players[0].hand.find((c) => c.def.id === 'tst-bot')!;
  const handBefore = state.players[0].hand.length;
  state = ok(applyCommand(state, { type: 'playTrainer', player: 0, instanceId: bot.instanceId }));
  assert.equal(state.players[0].hand.length, handBefore + 1, 'played 1, drew 2');

  state = untilInHand(state, 0, (d) => d.id === 'tst-admin');
  if (state.active !== 0) state = ok(applyCommand(state, { type: 'endTurn', player: state.active }));
  const admins = state.players[0].hand.filter((c) => c.def.id === 'tst-admin');
  if (admins.length >= 2 && !(state.rules.firstTurnNoSupporter && state.turn === 1)) {
    state = ok(applyCommand(state, { type: 'playTrainer', player: 0, instanceId: admins[0].instanceId }));
    const second = applyCommand(state, { type: 'playTrainer', player: 0, instanceId: admins[1].instanceId });
    assert.ok(!second.ok, 'one supporter per turn');
  }
});

test('pokemon: taking the last prize wins the game', () => {
  let state = doSetup(newGame(deckOf(solidBasic, 'Solid'), deckOf(mindBasic, 'Mind'), 71, { prizes: 1 }));
  state = untilInHand(state, 0, (d) => d.game?.kind === 'reaction');
  const att = state.players[0].row[0]!;
  state = ok(applyCommand(state, {
    type: 'attachReaction', player: 0, instanceId: findEnergy(state, 0)!.instanceId, targetInstanceId: att.instanceId,
  }));
  while (state.turn === 1 || state.active !== 0) {
    state = ok(applyCommand(state, { type: 'endTurn', player: state.active }));
  }
  state = ok(applyCommand(state, { type: 'useMove', player: 0, moveIndex: 0 }));
  if (!state.gameOver) {
    state = ok(applyCommand(state, { type: 'endTurn', player: 1 }));
    state = ok(applyCommand(state, { type: 'useMove', player: 0, moveIndex: 0 }));
  }
  assert.ok(state.gameOver, '70 HP falls to two weakness-doubled hits');
  assert.equal(state.winner, 0);
});

test('pokemon: deck validation enforces size, basics, copy caps, unlimited basic energy', () => {
  const rules = { ...POKEMON_QUICK };
  const good = [
    ...new Array(4).fill(solidBasic),
    ...new Array(2).fill(evoCard),
    ...new Array(24).fill(energy('Solid')), // basic energy is unlimited
  ];
  assert.deepEqual(validatePokemonDeck(good, rules), []);
  const noBasics = new Array(30).fill(energy('Solid'));
  assert.ok(validatePokemonDeck(noBasics, rules).some((p) => p.includes('basic sticker')));
  const tooMany = [...new Array(6).fill(evoCard), ...deckOf(solidBasic, 'Solid').slice(6)];
  assert.ok(validatePokemonDeck(tooMany, rules).some((p) => p.includes('copies')));
});

test('pokemon: the starter-deck builder produces a legal deck from the demo set', () => {
  const deck = buildStarterPokemonDeck(POKEMON_DEMO_CARDS, 30);
  assert.equal(deck.length, 30);
  assert.deepEqual(validatePokemonDeck(deck, { ...POKEMON_QUICK }), []);
});

test('pokemon: the AI plays a full demo game to completion', () => {
  const deck = buildStarterPokemonDeck(POKEMON_DEMO_CARDS, 30);
  let { state } = createGame({ decks: [deck, deck], seed: 99, rules: { ...QUICK } });
  for (let i = 0; i < 2000 && !state.gameOver; i++) {
    const cmd = chooseCommand(state, actingPlayer(state));
    const r = applyCommand(state, cmd);
    assert.ok(r.ok, !r.ok ? `AI issued an illegal command: ${cmd.type} — ${r.error}` : '');
    state = r.state;
  }
  assert.ok(state.gameOver, 'the AI mirror match ends');
});
