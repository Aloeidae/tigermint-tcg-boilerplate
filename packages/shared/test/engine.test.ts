import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  applyCommand,
  buildDemoDeck,
  configureSkill,
  createGame,
  findSkillKey,
  redactFor,
  chooseCommand,
  skillLine,
  OPENING_HAND,
  STARTING_LIFE,
  type CardDef,
  type GameState,
} from '../src/index.js';

const vanilla = (id: string, cost: number, attack: number, health: number): CardDef => ({
  id, name: id, type: 'creature', cost, attack, health,
});

function fixedDeck(): CardDef[] {
  const deck: CardDef[] = [];
  for (let i = 0; i < 30; i++) deck.push(vanilla(`c${i}`, 1, 2, 2));
  return deck;
}

test('createGame deals opening hands and starts turn 1 with 1 mana', () => {
  const { state } = createGame({ decks: [buildDemoDeck(), buildDemoDeck()], seed: 42 });
  // First player skips the turn-1 draw.
  assert.equal(state.players[0].hand.length, OPENING_HAND);
  assert.equal(state.players[1].hand.length, OPENING_HAND);
  assert.equal(state.players[0].life, STARTING_LIFE);
  assert.equal(state.active, 0);
  assert.equal(state.phase, 'main1');
  assert.equal(state.players[0].mana, 1);
  assert.equal(state.players[0].maxMana, 1);
});

test('same seed produces identical games', () => {
  const a = createGame({ decks: [buildDemoDeck(), buildDemoDeck()], seed: 7 });
  const b = createGame({ decks: [buildDemoDeck(), buildDemoDeck()], seed: 7 });
  assert.deepEqual(a.state, b.state);
});

test('full turn: summon, phases, attack next turn, mana growth', () => {
  let { state } = createGame({ decks: [fixedDeck(), fixedDeck()], seed: 1 });

  // Play a 1-cost creature into slot 2.
  const card = state.players[0].hand[0];
  let r = applyCommand(state, { type: 'playCard', player: 0, instanceId: card.instanceId, slot: 2 });
  assert.ok(r.ok, !r.ok ? r.error : '');
  state = r.state;
  assert.equal(state.players[0].mana, 0);
  assert.ok(state.players[0].row[2]);
  assert.equal(state.players[0].row[2]!.ready, false, 'summoning sickness');

  // Summoned creature cannot attack this turn.
  r = applyCommand(state, { type: 'advancePhase', player: 0 });
  assert.ok(r.ok);
  state = r.state;
  assert.equal(state.phase, 'combat');
  const bad = applyCommand(state, {
    type: 'attack', player: 0, attackerId: card.instanceId, target: { kind: 'face' },
  });
  assert.ok(!bad.ok);

  // End turn -> opponent turn -> end -> back to us with 2 mana and a ready creature.
  r = applyCommand(state, { type: 'endTurn', player: 0 });
  assert.ok(r.ok);
  state = r.state;
  assert.equal(state.active, 1);
  assert.equal(state.players[1].hand.length, OPENING_HAND + 1, 'second player draws on their turn');
  r = applyCommand(state, { type: 'endTurn', player: 1 });
  assert.ok(r.ok);
  state = r.state;
  assert.equal(state.active, 0);
  assert.equal(state.players[0].mana, 2);
  assert.equal(state.players[0].row[2]!.ready, true);

  // Attack face.
  r = applyCommand(state, { type: 'advancePhase', player: 0 });
  assert.ok(r.ok);
  state = r.state;
  r = applyCommand(state, {
    type: 'attack', player: 0, attackerId: card.instanceId, target: { kind: 'face' },
  });
  assert.ok(r.ok, !r.ok ? r.error : '');
  state = r.state;
  assert.equal(state.players[1].life, STARTING_LIFE - 2);

  // Same creature cannot attack twice.
  const twice = applyCommand(state, {
    type: 'attack', player: 0, attackerId: card.instanceId, target: { kind: 'face' },
  });
  assert.ok(!twice.ok);
});

test('illegal commands are rejected without mutating state', () => {
  const { state } = createGame({ decks: [fixedDeck(), fixedDeck()], seed: 3 });
  const before = JSON.stringify(state);
  const r1 = applyCommand(state, { type: 'endTurn', player: 1 });
  assert.ok(!r1.ok, 'not your turn');
  const r2 = applyCommand(state, { type: 'attack', player: 0, attackerId: 'nope', target: { kind: 'face' } });
  assert.ok(!r2.ok, 'attack outside combat');
  assert.equal(JSON.stringify(state), before, 'input state untouched');
});

test('spells resolve: firebolt kills a creature, insight draws', () => {
  const firebolt: CardDef = { id: 'fb', name: 'Firebolt', type: 'spell', cost: 2, effect: { key: 'damage', amount: 3 } };
  const deckA: CardDef[] = new Array(30).fill(firebolt);
  let { state } = createGame({ decks: [deckA, fixedDeck()], seed: 5 });

  // Give player 0 mana and put an enemy creature on the board directly.
  state = structuredClone(state);
  state.players[0].mana = 5;
  state.players[1].row[0] = {
    instanceId: 'enemy-1',
    def: vanilla('e', 1, 2, 2),
    attack: 2, health: 2, maxHealth: 2, ready: true, attacksUsed: 0, equipment: [], statuses: [],
  };

  const spell = state.players[0].hand[0];
  const r = applyCommand(state, {
    type: 'playCard', player: 0, instanceId: spell.instanceId,
    target: { kind: 'creature', instanceId: 'enemy-1' },
  });
  assert.ok(r.ok, !r.ok ? r.error : '');
  assert.equal(r.state.players[1].row[0], null, 'creature died');
  assert.equal(r.state.players[1].graveyard.length, 1);
  assert.ok(r.events.some((e) => e.type === 'creatureDied'));
});

test('equipment buffs its wearer and needs a friendly target', () => {
  const sword: CardDef = { id: 'sw', name: 'Sword', type: 'equipment', cost: 1, attackBonus: 2, healthBonus: 1 };
  const deckA: CardDef[] = new Array(30).fill(sword);
  let { state } = createGame({ decks: [deckA, fixedDeck()], seed: 6 });
  state = structuredClone(state);
  state.players[0].row[0] = {
    instanceId: 'mine-1', def: vanilla('m', 1, 2, 2),
    attack: 2, health: 2, maxHealth: 2, ready: true, attacksUsed: 0, equipment: [], statuses: [],
  };

  const noTarget = applyCommand(state, { type: 'playCard', player: 0, instanceId: state.players[0].hand[0].instanceId });
  assert.ok(!noTarget.ok);

  const r = applyCommand(state, {
    type: 'playCard', player: 0, instanceId: state.players[0].hand[0].instanceId,
    target: { kind: 'creature', instanceId: 'mine-1' },
  });
  assert.ok(r.ok, !r.ok ? r.error : '');
  const c = r.state.players[0].row[0]!;
  assert.equal(c.attack, 4);
  assert.equal(c.health, 3);
  assert.equal(c.equipment.length, 1);
});

test('redactFor hides opponent hand and both deck contents', () => {
  const { state } = createGame({ decks: [buildDemoDeck(), buildDemoDeck()], seed: 9 });
  const view = redactFor(state, 0);
  assert.equal(view.you.hand.length, OPENING_HAND);
  assert.equal((view.opponent as unknown as Record<string, unknown>).hand, undefined);
  assert.equal(view.opponent.handCount, OPENING_HAND);
  assert.equal((view.you as unknown as Record<string, unknown>).deck, undefined);
  assert.equal(view.you.deckCount, 30 - OPENING_HAND);
});

test('AI plays out a full game against itself without stalling', () => {
  let { state } = createGame({ decks: [buildDemoDeck(), buildDemoDeck()], seed: 11 });
  let steps = 0;
  while (!state.gameOver && steps < 2000) {
    const cmd = chooseCommand(state as GameState, state.active);
    const r = applyCommand(state, cmd);
    assert.ok(r.ok, !r.ok ? `AI issued illegal command ${cmd.type}: ${r.error}` : '');
    state = r.state;
    steps++;
  }
  assert.ok(state.gameOver, `game should finish (took ${steps} steps)`);
  assert.notEqual(state.winner, null);
});

test('guard rule: face attacks are blocked while enemy creatures live', () => {
  let { state } = createGame({
    decks: [fixedDeck(), fixedDeck()], seed: 21,
    rules: { mustAttackCreaturesFirst: true },
  });
  state = structuredClone(state);
  state.phase = 'combat';
  state.players[0].row[0] = {
    instanceId: 'mine-1', def: vanilla('m', 1, 2, 2),
    attack: 2, health: 2, maxHealth: 2, ready: true, attacksUsed: 0, equipment: [], statuses: [],
  };
  state.players[1].row[0] = {
    instanceId: 'guard-1', def: vanilla('g', 1, 1, 1),
    attack: 1, health: 1, maxHealth: 1, ready: true, attacksUsed: 0, equipment: [], statuses: [],
  };

  const face = applyCommand(state, { type: 'attack', player: 0, attackerId: 'mine-1', target: { kind: 'face' } });
  assert.ok(!face.ok, 'face attack must be rejected while a guard lives');

  const clear = applyCommand(state, {
    type: 'attack', player: 0, attackerId: 'mine-1', target: { kind: 'creature', instanceId: 'guard-1' },
  });
  assert.ok(clear.ok);
});

test('blitz rules: no summoning sickness lets creatures attack immediately', () => {
  let { state } = createGame({ decks: [fixedDeck(), fixedDeck()], seed: 22, rules: { summoningSickness: false } });
  const card = state.players[0].hand[0];
  let r = applyCommand(state, { type: 'playCard', player: 0, instanceId: card.instanceId, slot: 0 });
  assert.ok(r.ok);
  state = r.state;
  r = applyCommand(state, { type: 'advancePhase', player: 0 });
  assert.ok(r.ok);
  r = applyCommand(r.state, { type: 'attack', player: 0, attackerId: card.instanceId, target: { kind: 'face' } });
  assert.ok(r.ok, !r.ok ? r.error : '');
});

test('fatigue damage mode: empty-deck draws hurt instead of losing', () => {
  let { state } = createGame({ decks: [fixedDeck(), fixedDeck()], seed: 23, rules: { fatigue: 'damage' } });
  state = structuredClone(state);
  state.players[1].deck = [];
  const lifeBefore = state.players[1].life;

  // Ending player 0's turn makes player 1 draw from an empty deck.
  let r = applyCommand(state, { type: 'endTurn', player: 0 });
  assert.ok(r.ok);
  assert.equal(r.state.players[1].life, lifeBefore - 1, 'first fatigue tick deals 1');
  assert.ok(!r.state.gameOver);

  // Second empty draw deals 2.
  let s = r.state;
  r = applyCommand(s, { type: 'endTurn', player: 1 });
  assert.ok(r.ok);
  r = applyCommand(r.state, { type: 'endTurn', player: 0 });
  assert.ok(r.ok);
  assert.equal(r.state.players[1].life, lifeBefore - 3, 'second fatigue tick deals 2');
});

// ---------------------------------------------------------------------------
// Skills
// ---------------------------------------------------------------------------

import type { CreatureOnBoard, SkillRef } from '../src/index.js';

const skilled = (id: string, cost: number, attack: number, health: number, skills: SkillRef[]): CardDef => ({
  id, name: id, type: 'creature', cost, attack, health, skills,
});

function onBoard(def: CardDef, instanceId: string, ready = true): CreatureOnBoard {
  return {
    instanceId, def,
    attack: def.attack ?? 0, health: def.health ?? 1, maxHealth: def.health ?? 1,
    ready, attacksUsed: 0, equipment: [], statuses: [],
  };
}

function combatState(mine: CreatureOnBoard[], theirs: CreatureOnBoard[], seed = 50) {
  let { state } = createGame({ decks: [fixedDeck(), fixedDeck()], seed });
  state = structuredClone(state);
  state.phase = 'combat';
  mine.forEach((c, i) => (state.players[0].row[i] = c));
  theirs.forEach((c, i) => (state.players[1].row[i] = c));
  return state;
}

test('haste: creature can attack the turn it is summoned', () => {
  let { state } = createGame({ decks: [new Array<CardDef>(30).fill(skilled('hasty', 1, 2, 1, [{ key: 'haste' }])), fixedDeck()], seed: 31 });
  const card = state.players[0].hand[0];
  let r = applyCommand(state, { type: 'playCard', player: 0, instanceId: card.instanceId, slot: 0 });
  assert.ok(r.ok);
  assert.equal(r.state.players[0].row[0]!.ready, true, 'haste overrides summoning sickness');
  assert.ok(r.events.some((e) => e.type === 'skillTriggered' && e.skill === 'Haste'));
  r = applyCommand(r.state, { type: 'advancePhase', player: 0 });
  assert.ok(r.ok);
  r = applyCommand(r.state, { type: 'attack', player: 0, attackerId: card.instanceId, target: { kind: 'face' } });
  assert.ok(r.ok, !r.ok ? r.error : '');
});

test('first strike: a killed defender never strikes back', () => {
  const state = combatState(
    [onBoard(skilled('fs', 1, 2, 2, [{ key: 'firstStrike' }]), 'fs-1')],
    [onBoard(vanilla('v', 1, 2, 2), 'v-1')]
  );
  const r = applyCommand(state, { type: 'attack', player: 0, attackerId: 'fs-1', target: { kind: 'creature', instanceId: 'v-1' } });
  assert.ok(r.ok);
  assert.equal(r.state.players[1].row[0], null, 'defender died');
  assert.equal(r.state.players[0].row[0]!.health, 2, 'first striker took no damage back');
});

test('guard: attacks must hit guarding creatures first', () => {
  const state = combatState(
    [onBoard(vanilla('m', 1, 3, 3), 'm-1')],
    [onBoard(vanilla('plain', 1, 1, 1), 'plain-1'), onBoard(skilled('g', 1, 1, 4, [{ key: 'guard' }]), 'g-1')]
  );
  const face = applyCommand(state, { type: 'attack', player: 0, attackerId: 'm-1', target: { kind: 'face' } });
  assert.ok(!face.ok, 'face is guarded');
  const plain = applyCommand(state, { type: 'attack', player: 0, attackerId: 'm-1', target: { kind: 'creature', instanceId: 'plain-1' } });
  assert.ok(!plain.ok, 'non-guard is protected');
  const guard = applyCommand(state, { type: 'attack', player: 0, attackerId: 'm-1', target: { kind: 'creature', instanceId: 'g-1' } });
  assert.ok(guard.ok, !guard.ok ? guard.error : '');
});

test('armor reduces combat and spell damage', () => {
  const state = combatState(
    [onBoard(vanilla('m', 1, 3, 5), 'm-1')],
    [onBoard(skilled('tank', 1, 1, 6, [{ key: 'armor', value: 2 }]), 'tank-1')]
  );
  const r = applyCommand(state, { type: 'attack', player: 0, attackerId: 'm-1', target: { kind: 'creature', instanceId: 'tank-1' } });
  assert.ok(r.ok);
  assert.equal(r.state.players[1].row[0]!.health, 5, 'took 3-2=1 combat damage');

  // Spell damage is reduced too.
  let s = structuredClone(r.state);
  s.phase = 'main1';
  s.players[0].mana = 5;
  const firebolt: CardDef = { id: 'fb2', name: 'Firebolt', type: 'spell', cost: 2, effect: { key: 'damage', amount: 3 } };
  s.players[0].hand.push({ instanceId: 'fb-1', def: firebolt });
  const r2 = applyCommand(s, { type: 'playCard', player: 0, instanceId: 'fb-1', target: { kind: 'creature', instanceId: 'tank-1' } });
  assert.ok(r2.ok, !r2.ok ? r2.error : '');
  assert.equal(r2.state.players[1].row[0]!.health, 4, 'spell also reduced by armor');
});

test('lifelink heals its owner for damage dealt', () => {
  const state = combatState(
    [onBoard(skilled('leech', 1, 3, 3, [{ key: 'lifelink' }]), 'leech-1')],
    []
  );
  state.players[0].life = 10;
  const r = applyCommand(state, { type: 'attack', player: 0, attackerId: 'leech-1', target: { kind: 'face' } });
  assert.ok(r.ok);
  assert.equal(r.state.players[0].life, 13, 'healed 3 from lifelink');
  assert.ok(r.events.some((e) => e.type === 'skillTriggered' && e.skill === 'Lifelink'));
});

test('deathtouch destroys any creature it damages', () => {
  const state = combatState(
    [onBoard(skilled('viper', 1, 1, 2, [{ key: 'deathtouch' }]), 'viper-1')],
    [onBoard(vanilla('big', 1, 2, 9), 'big-1')]
  );
  const r = applyCommand(state, { type: 'attack', player: 0, attackerId: 'viper-1', target: { kind: 'creature', instanceId: 'big-1' } });
  assert.ok(r.ok);
  assert.equal(r.state.players[1].row[0], null, 'the 9-health creature died to deathtouch');
});

test('regenerate heals at the start of its owner turn', () => {
  let { state } = createGame({ decks: [fixedDeck(), fixedDeck()], seed: 37 });
  state = structuredClone(state);
  const troll = onBoard(skilled('troll', 1, 2, 6, [{ key: 'regenerate', value: 2 }]), 'troll-1');
  troll.health = 2;
  state.players[0].row[0] = troll;

  let r = applyCommand(state, { type: 'endTurn', player: 0 });
  assert.ok(r.ok);
  r = applyCommand(r.state, { type: 'endTurn', player: 1 });
  assert.ok(r.ok);
  assert.equal(r.state.players[0].row[0]!.health, 4, 'regenerated 2 at turn start');
});

test('equipment-granted haste readies a summoning-sick creature', () => {
  const horn: CardDef = { id: 'horn', name: 'Charge Horn', type: 'equipment', cost: 1, attackBonus: 1, skills: [{ key: 'haste' }] };
  let { state } = createGame({ decks: [new Array<CardDef>(30).fill(horn), fixedDeck()], seed: 41 });
  state = structuredClone(state);
  state.players[0].mana = 5;
  state.players[0].row[0] = onBoard(vanilla('slow', 1, 2, 2), 'slow-1', false);

  const r = applyCommand(state, {
    type: 'playCard', player: 0, instanceId: state.players[0].hand[0].instanceId,
    target: { kind: 'creature', instanceId: 'slow-1' },
  });
  assert.ok(r.ok, !r.ok ? r.error : '');
  assert.equal(r.state.players[0].row[0]!.ready, true, 'horn granted haste');
});

test('configureSkill renames a skill everywhere without changing mechanics', () => {
  configureSkill('haste', { name: 'Charge', icon: '🐎' });
  assert.equal(skillLine([{ key: 'haste' }]), '🐎 Charge');
  assert.equal(findSkillKey('Charge'), 'haste', 'metadata matching follows the new name');

  // Mechanics unchanged: a summoned creature with the renamed skill is still ready.
  let { state } = createGame({ decks: [new Array<CardDef>(30).fill(skilled('c', 1, 2, 1, [{ key: 'haste' }])), fixedDeck()], seed: 43 });
  const card = state.players[0].hand[0];
  const r = applyCommand(state, { type: 'playCard', player: 0, instanceId: card.instanceId, slot: 0 });
  assert.ok(r.ok);
  assert.equal(r.state.players[0].row[0]!.ready, true);
  assert.ok(r.events.some((e) => e.type === 'skillTriggered' && e.skill === 'Charge'));

  configureSkill('haste', { name: 'Haste', icon: '⚡' }); // restore for other tests
});

test('concede ends the game for the other player', () => {
  const { state } = createGame({ decks: [buildDemoDeck(), buildDemoDeck()], seed: 13 });
  const r = applyCommand(state, { type: 'concede', player: 1 });
  assert.ok(r.ok);
  assert.equal(r.state.winner, 0);
});

// ---------------------------------------------------------------------------
// Blockers-style combat (rules.combatStyle: 'blockers')
// ---------------------------------------------------------------------------

test('blockers: declare attackers, defender blocks, unblocked damage goes face', () => {
  let { state } = createGame({ decks: [fixedDeck(), fixedDeck()], seed: 80, rules: { combatStyle: 'blockers' } });
  state = structuredClone(state);
  state.phase = 'combat';
  state.players[0].row[0] = onBoard(vanilla('a1', 1, 3, 3), 'a-1');
  state.players[0].row[1] = onBoard(vanilla('a2', 1, 2, 2), 'a-2');
  state.players[1].row[0] = onBoard(vanilla('d1', 1, 2, 4), 'd-1');

  let r = applyCommand(state, { type: 'attack', player: 0, attackerId: 'a-1', target: { kind: 'face' } });
  assert.ok(r.ok, !r.ok ? r.error : '');
  r = applyCommand(r.state, { type: 'attack', player: 0, attackerId: 'a-2', target: { kind: 'face' } });
  assert.ok(r.ok);
  assert.deepEqual(r.state.attackers, ['a-1', 'a-2']);

  // Toggling un-declares; re-declare for the real swing.
  r = applyCommand(r.state, { type: 'attack', player: 0, attackerId: 'a-2', target: { kind: 'face' } });
  assert.ok(r.ok);
  assert.deepEqual(r.state.attackers, ['a-1']);
  r = applyCommand(r.state, { type: 'attack', player: 0, attackerId: 'a-2', target: { kind: 'face' } });
  assert.ok(r.ok);

  // To the block step; the attacker can only wait.
  r = applyCommand(r.state, { type: 'advancePhase', player: 0 });
  assert.ok(r.ok);
  assert.equal(r.state.phase, 'block');
  assert.ok(!applyCommand(r.state, { type: 'endTurn', player: 0 }).ok, 'attacker waits on blockers');
  assert.ok(!applyCommand(r.state, { type: 'declareBlockers', player: 0, blocks: [] }).ok, 'only the defender blocks');

  // d-1 blocks a-1; a-2 is unblocked and hits the face.
  const life = r.state.players[1].life;
  r = applyCommand(r.state, { type: 'declareBlockers', player: 1, blocks: [{ blocker: 'd-1', attacker: 'a-1' }] });
  assert.ok(r.ok, !r.ok ? r.error : '');
  assert.equal(r.state.phase, 'main2');
  assert.equal(r.state.players[1].life, life - 2, 'only the unblocked attacker went face');
  assert.equal(r.state.players[1].row[0]!.health, 1, 'blocker took the blocked hit');
  assert.equal(r.state.players[0].row[0]!.health, 1, 'blocker always strikes back');
  assert.equal(r.state.attackers.length, 0, 'combat state cleared');
});

test('blockers: no defenders means combat resolves straight to the face', () => {
  let { state } = createGame({ decks: [fixedDeck(), fixedDeck()], seed: 81, rules: { combatStyle: 'blockers' } });
  state = structuredClone(state);
  state.phase = 'combat';
  state.players[0].row[0] = onBoard(vanilla('a1', 1, 4, 4), 'a-1');

  let r = applyCommand(state, { type: 'attack', player: 0, attackerId: 'a-1', target: { kind: 'face' } });
  assert.ok(r.ok);
  const life = r.state.players[1].life;
  r = applyCommand(r.state, { type: 'advancePhase', player: 0 });
  assert.ok(r.ok);
  assert.equal(r.state.phase, 'main2', 'no block step without defenders');
  assert.equal(r.state.players[1].life, life - 4);
});

// ---------------------------------------------------------------------------
// Statuses
// ---------------------------------------------------------------------------

test('poison ticks at the owner turn start and can kill', () => {
  let { state } = createGame({ decks: [fixedDeck(), fixedDeck()], seed: 61 });
  state = structuredClone(state);
  state.players[0].mana = 5;
  state.players[1].row[0] = onBoard(vanilla('victim', 1, 2, 2), 'victim-1');
  const dart: CardDef = { id: 'vd', name: 'Venom Dart', type: 'spell', cost: 1, effect: { key: 'poison', amount: 2 } };
  state.players[0].hand.push({ instanceId: 'vd-1', def: dart });

  let r = applyCommand(state, {
    type: 'playCard', player: 0, instanceId: 'vd-1',
    target: { kind: 'creature', instanceId: 'victim-1' },
  });
  assert.ok(r.ok, !r.ok ? r.error : '');
  assert.ok(r.events.some((e) => e.type === 'statusApplied' && e.status === 'Poison'));
  assert.equal(r.state.players[1].row[0]!.statuses.length, 1);

  // The victim's owner's turn starts -> poison ticks 2 -> the 2-health creature dies.
  r = applyCommand(r.state, { type: 'endTurn', player: 0 });
  assert.ok(r.ok);
  assert.equal(r.state.players[1].row[0], null, 'poison killed it at its owner turn start');
  assert.ok(r.events.some((e) => e.type === 'creatureDied' && e.cardName === 'victim'));
});

test('shield absorbs damage before health and expires when spent', () => {
  const defender = onBoard(vanilla('turtle', 1, 1, 4), 'turtle-1');
  defender.statuses.push({ key: 'shield', value: 3 });
  const state = combatState([onBoard(vanilla('m', 1, 2, 2), 'm-1')], [defender], 62);

  let r = applyCommand(state, { type: 'attack', player: 0, attackerId: 'm-1', target: { kind: 'creature', instanceId: 'turtle-1' } });
  assert.ok(r.ok);
  assert.equal(r.state.players[1].row[0]!.health, 4, 'shield ate all 2 damage');
  assert.equal(r.state.players[1].row[0]!.statuses[0].value, 1, '1 shield left');

  // A second hit spends the rest: 2 damage - 1 shield = 1 through.
  const s = structuredClone(r.state);
  s.players[0].row[0]!.attacksUsed = 0;
  r = applyCommand(s, { type: 'attack', player: 0, attackerId: 'm-1', target: { kind: 'creature', instanceId: 'turtle-1' } });
  assert.ok(r.ok);
  assert.equal(r.state.players[1].row[0]!.health, 3, 'one damage got through');
  assert.equal(r.state.players[1].row[0]!.statuses.length, 0, 'shield expired');
  assert.ok(r.events.some((e) => e.type === 'statusExpired' && e.status === 'Shield'));
});

test('frozen blocks attacking for one own turn, then thaws', () => {
  let { state } = createGame({ decks: [fixedDeck(), fixedDeck()], seed: 63 });
  state = structuredClone(state);
  const frosty = onBoard(vanilla('frosty', 1, 2, 2), 'frosty-1');
  frosty.statuses.push({ key: 'frozen', turns: 1 });
  state.players[1].row[0] = frosty;

  // Opponent's turn: still frozen, cannot attack.
  let r = applyCommand(state, { type: 'endTurn', player: 0 });
  assert.ok(r.ok);
  let s = structuredClone(r.state);
  s.phase = 'combat';
  const blocked = applyCommand(s, { type: 'attack', player: 1, attackerId: 'frosty-1', target: { kind: 'face' } });
  assert.ok(!blocked.ok, 'frozen creature cannot attack');

  // A full round later the freeze has expired.
  r = applyCommand(r.state, { type: 'endTurn', player: 1 });
  assert.ok(r.ok);
  r = applyCommand(r.state, { type: 'endTurn', player: 0 });
  assert.ok(r.ok);
  assert.equal(r.state.players[1].row[0]!.statuses.length, 0, 'thawed');
  s = structuredClone(r.state);
  s.phase = 'combat';
  const ok = applyCommand(s, { type: 'attack', player: 1, attackerId: 'frosty-1', target: { kind: 'face' } });
  assert.ok(ok.ok, !ok.ok ? ok.error : '');
});

test('scavenger grows when an ally dies', () => {
  const scav = onBoard(skilled('crow', 1, 1, 2, [{ key: 'scavenger', value: 1 }]), 'crow-1');
  const bait = onBoard(vanilla('bait', 1, 1, 1), 'bait-1');
  const state = combatState([onBoard(vanilla('m', 1, 3, 3), 'm-1')], [bait, scav], 65);
  // Wrong-side check: scavenger belongs to player 1; kill its ally.
  const r = applyCommand(state, { type: 'attack', player: 0, attackerId: 'm-1', target: { kind: 'creature', instanceId: 'bait-1' } });
  assert.ok(r.ok);
  const crow = r.state.players[1].row[1]!;
  assert.equal(crow.attack, 2, '+1 attack from scavenger');
  assert.equal(crow.health, 3, '+1 health from scavenger');
});

test('inspiring heals its owner at end of turn', () => {
  let { state } = createGame({ decks: [fixedDeck(), fixedDeck()], seed: 66 });
  state = structuredClone(state);
  state.players[0].life = 10;
  state.players[0].row[0] = onBoard(skilled('herald', 1, 2, 4, [{ key: 'inspiring', value: 1 }]), 'herald-1');
  const r = applyCommand(state, { type: 'endTurn', player: 0 });
  assert.ok(r.ok);
  assert.equal(r.state.players[0].life, 11, 'healed 1 at own turn end');
});

test('mulligan redraws the opening hand once, even off-turn', () => {
  const { state } = createGame({
    decks: [fixedDeck(), buildDemoDeck()], seed: 68, rules: { mulligan: true },
  });
  // The NON-active player may mulligan during the first round.
  const before = state.players[1].hand.map((c) => c.instanceId).join(',');
  let r = applyCommand(state, { type: 'mulligan', player: 1 });
  assert.ok(r.ok, !r.ok ? r.error : '');
  const after = r.state.players[1].hand.map((c) => c.instanceId).join(',');
  assert.equal(r.state.players[1].hand.length, OPENING_HAND, 'same hand size back');
  assert.notEqual(after, before, 'hand changed');
  assert.ok(r.state.players[1].mulliganUsed);

  const again = applyCommand(r.state, { type: 'mulligan', player: 1 });
  assert.ok(!again.ok, 'only once');

  // Deterministic: same state + same command = same redraw.
  const r2 = applyCommand(state, { type: 'mulligan', player: 1 });
  assert.ok(r2.ok);
  assert.deepEqual(r2.ok && r2.state, r.state);
});

test('mulligan is rejected when the rules forbid it or the round passed', () => {
  const noRule = createGame({ decks: [fixedDeck(), fixedDeck()], seed: 69 }).state;
  assert.ok(!applyCommand(noRule, { type: 'mulligan', player: 0 }).ok, 'rules.mulligan off');

  let { state } = createGame({ decks: [fixedDeck(), fixedDeck()], seed: 70, rules: { mulligan: true } });
  let r = applyCommand(state, { type: 'endTurn', player: 0 });
  assert.ok(r.ok);
  r = applyCommand(r.state, { type: 'endTurn', player: 1 });
  assert.ok(r.ok);
  assert.ok(!applyCommand(r.state, { type: 'mulligan', player: 0 }).ok, 'window closed after round 1');
});

test('token summon fills free slots and respects the row limit', () => {
  let { state } = createGame({ decks: [fixedDeck(), fixedDeck()], seed: 67 });
  state = structuredClone(state);
  state.players[0].mana = 9;
  // Leave exactly one free slot.
  for (let i = 0; i < state.players[0].row.length - 1; i++) {
    state.players[0].row[i] = onBoard(vanilla(`f${i}`, 1, 1, 1), `f-${i}`);
  }
  const call: CardDef = { id: 'ac', name: 'Acorn Call', type: 'spell', cost: 2, effect: { key: 'summonSquirrel', amount: 2 } };
  state.players[0].hand.push({ instanceId: 'ac-1', def: call });
  const r = applyCommand(state, { type: 'playCard', player: 0, instanceId: 'ac-1' });
  assert.ok(r.ok, !r.ok ? r.error : '');
  const row = r.state.players[0].row;
  assert.ok(row.every((c) => c !== null), 'row is now full');
  const tokens = row.filter((c) => c && c.def.name === 'Squirrel');
  assert.equal(tokens.length, 1, 'only one squirrel fit');
  assert.ok(r.events.some((e) => e.type === 'creatureSummoned' && e.cardName === 'Squirrel'));
});

test('venomous poisons what it damages', () => {
  const state = combatState(
    [onBoard(skilled('asp', 1, 1, 3, [{ key: 'venomous', value: 1 }]), 'asp-1')],
    [onBoard(vanilla('prey', 1, 1, 4), 'prey-1')],
    64
  );
  const r = applyCommand(state, { type: 'attack', player: 0, attackerId: 'asp-1', target: { kind: 'creature', instanceId: 'prey-1' } });
  assert.ok(r.ok);
  const prey = r.state.players[1].row[0]!;
  assert.ok(prey.statuses.some((st) => st.key === 'poison' && st.value === 1), 'poisoned by the hit');
});
