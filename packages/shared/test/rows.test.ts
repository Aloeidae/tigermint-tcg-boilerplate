import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  applyCommand,
  buildRowsDemoDeck,
  chooseCommand,
  createGame,
  redactFor,
  rowPower,
  totalPower,
  validateRowsDeck,
  ROWS_STANDARD,
  ROWS_DEMO_CARDS,
  type CardDef,
  type GameState,
} from '../src/index.js';

const unit = (id: string, power: number, row: 'melee' | 'ranged' | 'siege' | 'agile' = 'melee', extra?: Partial<NonNullable<CardDef['rows']>>): CardDef => ({
  id, name: id, type: 'creature', cost: 0, rows: { kind: 'unit', row, power, ...extra },
});
const special = (id: string, kind: NonNullable<NonNullable<CardDef['rows']>['special']>): CardDef => ({
  id, name: id, type: 'spell', cost: 0, rows: { kind: 'special', special: kind },
});

function plainDeck(): CardDef[] {
  const deck: CardDef[] = [];
  for (let i = 0; i < 25; i++) deck.push(unit(`u${i}`, 5));
  return deck;
}

function newGame(decks?: [CardDef[], CardDef[]], seed = 11): GameState {
  return createGame({ decks: decks ?? [plainDeck(), plainDeck()], seed, rules: { ...ROWS_STANDARD } }).state;
}

/** Put a specific card in hand (deterministic regardless of the shuffle). */
function stack(state: GameState, player: 0 | 1, def: CardDef, instanceId: string): GameState {
  const s = structuredClone(state);
  s.players[player].hand.push({ instanceId, def });
  return s;
}

test('rows: opening deals full hands, no mana, round 1 live', () => {
  const state = newGame();
  assert.equal(state.players[0].hand.length, ROWS_STANDARD.openingHand);
  assert.equal(state.players[1].hand.length, ROWS_STANDARD.openingHand);
  assert.equal(state.players[0].life, 2, 'life is round lives');
  assert.equal(state.rowsRound?.round, 1);
  assert.equal(state.active, 0);
  const view = redactFor(state, 0);
  assert.ok(view.rowsRound, 'round state is public');
  assert.ok(view.you.rowsBoard && view.opponent.rowsBoard, 'boards are public');
});

test('rows: playing a unit adds power and hands the turn over', () => {
  const state = stack(newGame(), 0, unit('grunt', 6), 'g-1');
  const r = applyCommand(state, { type: 'playRowsCard', player: 0, instanceId: 'g-1' });
  assert.ok(r.ok, !r.ok ? r.error : '');
  assert.equal(r.state.players[0].rowsBoard!.melee.length, 1);
  assert.equal(totalPower(r.state, 0), 6);
  assert.equal(r.state.active, 1, 'turn passes to the opponent');
  assert.ok(!applyCommand(r.state, { type: 'playRowsCard', player: 0, instanceId: 'x' }).ok, 'not your turn');
});

test('rows: agile units need a row and land where told', () => {
  const state = stack(newGame(), 0, unit('cat', 5, 'agile'), 'cat-1');
  assert.ok(!applyCommand(state, { type: 'playRowsCard', player: 0, instanceId: 'cat-1' }).ok, 'row required');
  const r = applyCommand(state, { type: 'playRowsCard', player: 0, instanceId: 'cat-1', row: 'ranged' });
  assert.ok(r.ok, !r.ok ? r.error : '');
  assert.equal(r.state.players[0].rowsBoard!.ranged.length, 1);
});

test('rows: a spy joins the enemy row and draws 2', () => {
  const state = stack(newGame(), 0, unit('mole', 7, 'ranged', { ability: 'spy' }), 'spy-1');
  const before = state.players[0].hand.length;
  const r = applyCommand(state, { type: 'playRowsCard', player: 0, instanceId: 'spy-1' });
  assert.ok(r.ok, !r.ok ? r.error : '');
  assert.equal(r.state.players[1].rowsBoard!.ranged.length, 1, 'stands on their side');
  assert.equal(totalPower(r.state, 1), 7, 'scores for them');
  assert.equal(r.state.players[0].hand.length, before - 1 + 2, 'drew 2');
});

test('rows: muster pulls its tag from the deck onto the board', () => {
  let state = newGame();
  state = structuredClone(state);
  state.players[0].deck.push(
    { instanceId: 'm-2', def: unit('packmate', 4, 'melee', { ability: 'muster', musterTag: 'pack' }) },
    { instanceId: 'm-3', def: unit('packmate', 4, 'melee', { ability: 'muster', musterTag: 'pack' }) },
  );
  state = stack(state, 0, unit('packmate', 4, 'melee', { ability: 'muster', musterTag: 'pack' }), 'm-1');
  const r = applyCommand(state, { type: 'playRowsCard', player: 0, instanceId: 'm-1' });
  assert.ok(r.ok, !r.ok ? r.error : '');
  assert.equal(r.state.players[0].rowsBoard!.melee.length, 3, 'all three mustered');
  assert.equal(totalPower(r.state, 0), 12);
});

test('rows: bond multiplies, horn doubles, heroes ignore it all', () => {
  let state = newGame();
  state = structuredClone(state);
  const b = state.players[0].rowsBoard!;
  b.melee.push(
    { instanceId: 'b-1', def: unit('twin', 4, 'melee', { ability: 'bond' }) },
    { instanceId: 'b-2', def: unit('twin', 4, 'melee', { ability: 'bond' }) },
  );
  assert.equal(rowPower(state, 0, 'melee'), 16, 'bond: 4×2 each');
  b.horns.melee = true;
  assert.equal(rowPower(state, 0, 'melee'), 32, 'horn doubles on top');
  b.ranged.push({ instanceId: 'h-1', def: unit('champ', 10, 'ranged', { hero: true }) });
  b.horns.ranged = true;
  state.rowsRound!.weather.ranged = true;
  assert.equal(rowPower(state, 0, 'ranged'), 10, 'hero ignores weather and horn');
});

test('rows: a horn-ability unit doubles the others but not itself', () => {
  let state = newGame();
  state = structuredClone(state);
  const b = state.players[0].rowsBoard!;
  b.ranged.push(
    { instanceId: 'n-1', def: unit('archer', 6, 'ranged') },
    { instanceId: 'n-2', def: unit('herald', 2, 'ranged', { ability: 'horn' }) },
  );
  assert.equal(rowPower(state, 0, 'ranged'), 14, 'archer 12 + herald 2');
});

test('rows: weather flattens a row to 1s and clear lifts it', () => {
  let state = newGame();
  state = structuredClone(state);
  state.players[1].rowsBoard!.melee.push(
    { instanceId: 'w-1', def: unit('bear', 8, 'melee') },
    { instanceId: 'w-2', def: unit('boar', 5, 'melee') },
  );
  state = stack(state, 0, special('frost', 'frost'), 'fr-1');
  let r = applyCommand(state, { type: 'playRowsCard', player: 0, instanceId: 'fr-1' });
  assert.ok(r.ok, !r.ok ? r.error : '');
  assert.equal(totalPower(r.state, 1), 2, 'both units fight at 1');
  assert.ok(r.events.some((e) => e.type === 'weatherChanged' && e.melee));

  let s2 = stack(r.state, 1, special('clear', 'clear'), 'cl-1');
  s2.active = 1;
  r = applyCommand(s2, { type: 'playRowsCard', player: 1, instanceId: 'cl-1' });
  assert.ok(r.ok, !r.ok ? r.error : '');
  assert.equal(totalPower(r.state, 1), 13, 'weather lifted');
});

test('rows: scorch burns the strongest non-hero units on both sides', () => {
  let state = newGame();
  state = structuredClone(state);
  state.players[0].rowsBoard!.melee.push({ instanceId: 's-1', def: unit('mine', 9, 'melee') });
  state.players[1].rowsBoard!.siege.push(
    { instanceId: 's-2', def: unit('theirs', 9, 'siege') },
    { instanceId: 's-3', def: unit('champ', 12, 'siege', { hero: true }) },
    { instanceId: 's-4', def: unit('small', 3, 'siege') },
  );
  state = stack(state, 0, special('fire', 'scorch'), 'sc-1');
  const r = applyCommand(state, { type: 'playRowsCard', player: 0, instanceId: 'sc-1' });
  assert.ok(r.ok, !r.ok ? r.error : '');
  assert.equal(r.state.players[0].rowsBoard!.melee.length, 0, 'own 9 burned too');
  assert.deepEqual(r.state.players[1].rowsBoard!.siege.map((u) => u.instanceId), ['s-3', 's-4'], 'hero and the small one survive');
  assert.ok(r.events.some((e) => e.type === 'scorched' && e.cardNames.length === 2));
});

test('rows: both passing ends the round, clears the board, loser drops a life', () => {
  let state = newGame();
  state = structuredClone(state);
  state.players[0].rowsBoard!.melee.push({ instanceId: 'p-1', def: unit('big', 9, 'melee') });
  state.rowsRound!.weather.melee = true;
  let r = applyCommand(state, { type: 'pass', player: 0 });
  assert.ok(r.ok, !r.ok ? r.error : '');
  assert.equal(r.state.active, 1);
  r = applyCommand(r.state, { type: 'pass', player: 1 });
  assert.ok(r.ok, !r.ok ? r.error : '');
  const s = r.state;
  assert.equal(s.rowsRound!.round, 2);
  assert.equal(s.players[0].life, 2, 'round winner keeps lives');
  assert.equal(s.players[1].life, 1, 'loser drops one');
  assert.equal(s.players[0].rowsBoard!.melee.length, 0, 'board cleared');
  assert.equal(s.players[0].graveyard.length, 1, 'unit went to the graveyard');
  assert.equal(s.rowsRound!.weather.melee, false, 'weather cleared');
  assert.equal(s.active, 0, 'round winner leads off');
  assert.ok(r.events.some((e) => e.type === 'roundEnded' && e.winner === 0));
});

test('rows: losing two rounds loses the game; a tie hurts both', () => {
  let state = newGame();
  state = structuredClone(state);
  state.players[1].life = 1;
  state.players[0].rowsBoard!.melee.push({ instanceId: 'p-1', def: unit('big', 9, 'melee') });
  let r = applyCommand(state, { type: 'pass', player: 0 });
  assert.ok(r.ok);
  r = applyCommand(r.state, { type: 'pass', player: 1 });
  assert.ok(r.ok);
  assert.equal(r.state.gameOver, true);
  assert.equal(r.state.winner, 0);

  // Tie: both lose a life, nobody takes a round.
  let tie = newGame();
  let t = applyCommand(tie, { type: 'pass', player: 0 });
  assert.ok(t.ok);
  t = applyCommand(t.state, { type: 'pass', player: 1 });
  assert.ok(t.ok);
  assert.equal(t.state.players[0].life, 1);
  assert.equal(t.state.players[1].life, 1);
  assert.ok(t.events.some((e) => e.type === 'roundEnded' && e.winner === null));
});

test('rows: demo deck is legal and the AI plays a full game to completion', () => {
  const check = validateRowsDeck(buildRowsDemoDeck(), ROWS_STANDARD);
  assert.ok(check.ok, check.errors.join('; '));
  assert.ok(ROWS_DEMO_CARDS.length > 0);

  let { state } = createGame({
    decks: [buildRowsDemoDeck(), buildRowsDemoDeck()], seed: 77, rules: { ...ROWS_STANDARD },
  });
  for (let i = 0; i < 400 && !state.gameOver; i++) {
    const cmd = chooseCommand(state, state.active);
    const r = applyCommand(state, cmd);
    assert.ok(r.ok, !r.ok ? `AI sent an illegal command: ${r.error} (${JSON.stringify(cmd)})` : '');
    state = r.state;
  }
  assert.ok(state.gameOver, 'the AI game finished');
  assert.ok(state.winner === 0 || state.winner === 1);
});

test('rows: deck validator flags bad decks', () => {
  const noRows = validateRowsDeck(new Array(25).fill({ id: 'x', name: 'x', type: 'creature', cost: 1 } as CardDef), ROWS_STANDARD);
  assert.ok(!noRows.ok);
  const short = validateRowsDeck(buildRowsDemoDeck().slice(0, 10), ROWS_STANDARD);
  assert.ok(!short.ok);
  const allSpecials = validateRowsDeck(new Array(25).fill(special('w', 'frost')), ROWS_STANDARD);
  assert.ok(!allSpecials.ok);
});

test('rows: concede still works mid-round', () => {
  const state = newGame();
  const r = applyCommand(state, { type: 'concede', player: 1 });
  assert.ok(r.ok);
  assert.equal(r.state.winner, 0);
});
