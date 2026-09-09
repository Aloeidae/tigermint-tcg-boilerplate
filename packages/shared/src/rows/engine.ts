import type { GameState, PlayerId } from '../types.js';
import type { Command } from '../commands.js';
import type { GameEvent } from '../events.js';
import type { CommandResult } from '../engine.js';
import { endGame, other } from '../helpers.js';
import { emptyRowsBoard, ROW_KINDS, WEATHER_ROW, type RowKind } from './types.js';
import { totalPower, unitsInPlay } from './power.js';

/**
 * The Three-Rows-style rules engine (rules.gameMode 'rows').
 *
 * No mana, no combat phases: players alternate playing ONE card (or passing)
 * onto three battlefield rows. When both pass, the higher power total takes
 * the round; `life` is round lives (2 = best of three). Cards never come
 * back — the whole game is fought from the opening hand plus what spies and
 * musters pull in. Running out of cards passes for you.
 */

/** Called by createGame instead of the standard opening. */
export function initRowsGame(state: GameState, events: GameEvent[]): void {
  state.rowsRound = {
    round: 1,
    wins: [0, 0],
    passed: [false, false],
    weather: { melee: false, ranged: false, siege: false },
    starter: 0,
  };
  for (const p of state.players) {
    p.rowsBoard = emptyRowsBoard();
    for (let i = 0; i < state.rules.openingHand; i++) rowsDraw(state, p.id, events);
  }
  state.active = 0;
  state.turn = 1;
  state.phase = 'main1';
  events.push({ type: 'roundStarted', round: 1, starter: 0 });
  events.push({ type: 'turnStarted', player: 0, turn: 1 });
}

/** Rows draws never fatigue: an empty deck simply gives nothing. */
function rowsDraw(state: GameState, player: PlayerId, events: GameEvent[]): void {
  const p = state.players[player];
  const card = p.deck.shift();
  if (!card) return;
  if (p.hand.length >= state.rules.maxHand) {
    p.graveyard.push(card);
    events.push({ type: 'cardDrawn', player });
    return;
  }
  p.hand.push(card);
  events.push({ type: 'cardDrawn', player, cardName: card.def.name });
}

function maybeAutoPass(state: GameState, player: PlayerId, events: GameEvent[]): void {
  const r = state.rowsRound!;
  if (!r.passed[player] && state.players[player].hand.length === 0) {
    r.passed[player] = true;
    events.push({ type: 'passed', player });
  }
}

/** Hand the turn over after an action (or resolve the round if both passed). */
function settleTurn(state: GameState, events: GameEvent[]): void {
  const r = state.rowsRound!;
  maybeAutoPass(state, 0, events);
  maybeAutoPass(state, 1, events);
  if (r.passed[0] && r.passed[1]) {
    endRound(state, events);
    return;
  }
  const opp = other(state.active);
  if (!r.passed[opp]) state.active = opp;
  state.turn += 1;
  events.push({ type: 'turnStarted', player: state.active, turn: state.turn });
}

function endRound(state: GameState, events: GameEvent[]): void {
  const r = state.rowsRound!;
  const totals: [number, number] = [totalPower(state, 0), totalPower(state, 1)];
  const winner: PlayerId | null = totals[0] > totals[1] ? 0 : totals[1] > totals[0] ? 1 : null;
  for (const pl of [0, 1] as PlayerId[]) {
    // The winner keeps their lives; a tie costs both a life.
    if (winner === pl) continue;
    state.players[pl].life = Math.max(0, state.players[pl].life - 1);
    events.push({ type: 'lifeChanged', player: pl, life: state.players[pl].life, delta: -1 });
  }
  if (winner !== null) r.wins[winner] += 1;
  events.push({ type: 'roundEnded', round: r.round, totals, winner, wins: [...r.wins] });

  const dead: [boolean, boolean] = [state.players[0].life <= 0, state.players[1].life <= 0];
  if (dead[0] || dead[1]) {
    let champ: PlayerId;
    if (dead[0] && dead[1]) {
      // simultaneous elimination: cards left in hand, then deck, then the second player
      const h = state.players[0].hand.length - state.players[1].hand.length;
      const d = state.players[0].deck.length - state.players[1].deck.length;
      champ = h !== 0 ? (h > 0 ? 0 : 1) : d !== 0 ? (d > 0 ? 0 : 1) : 1;
    } else {
      champ = dead[0] ? 1 : 0;
    }
    endGame(state, champ, `won ${r.wins[champ]} round${r.wins[champ] === 1 ? '' : 's'}`, events);
    return;
  }

  // Clear the battlefield and weather; the round winner leads the next round.
  for (const pl of [0, 1] as PlayerId[]) {
    const b = state.players[pl].rowsBoard!;
    for (const row of ROW_KINDS) state.players[pl].graveyard.push(...b[row].splice(0));
    b.horns = { melee: false, ranged: false, siege: false };
  }
  r.weather = { melee: false, ranged: false, siege: false };
  r.passed = [false, false];
  r.round += 1;
  r.starter = winner ?? r.starter;
  state.active = r.starter;
  state.turn += 1;
  events.push({ type: 'roundStarted', round: r.round, starter: r.starter });
  events.push({ type: 'turnStarted', player: state.active, turn: state.turn });

  // Both already out of cards: the leftover rounds resolve themselves.
  maybeAutoPass(state, 0, events);
  maybeAutoPass(state, 1, events);
  if (r.passed[0] && r.passed[1]) {
    endRound(state, events);
    return;
  }
  if (r.passed[state.active]) state.active = other(state.active);
}

export function applyRowsCommand(state: GameState, cmd: Command): CommandResult {
  if (cmd.player !== state.active) return { ok: false, error: 'It is not your turn' };
  const r = state.rowsRound;
  if (!r) return { ok: false, error: 'The rows round state is missing' };
  if (r.passed[cmd.player]) return { ok: false, error: 'You already passed this round' };

  if (cmd.type === 'pass') {
    const next = structuredClone(state);
    const events: GameEvent[] = [];
    next.rowsRound!.passed[cmd.player] = true;
    events.push({ type: 'passed', player: cmd.player });
    settleTurn(next, events);
    return { ok: true, state: next, events };
  }

  if (cmd.type !== 'playRowsCard') return { ok: false, error: 'Not available under these rules' };

  const handIndex = state.players[cmd.player].hand.findIndex((c) => c.instanceId === cmd.instanceId);
  if (handIndex === -1) return { ok: false, error: 'Card not in hand' };
  const block = state.players[cmd.player].hand[handIndex].def.rows;
  if (!block) return { ok: false, error: 'This card has no rows definition' };

  const next = structuredClone(state);
  const events: GameEvent[] = [];
  const me = next.players[cmd.player];
  const card = me.hand[handIndex];

  if (block.kind === 'unit') {
    let rowKind: RowKind;
    if (block.row === 'agile') {
      if (cmd.row !== 'melee' && cmd.row !== 'ranged') {
        return { ok: false, error: 'Agile units need a row: melee or ranged' };
      }
      rowKind = cmd.row;
    } else if (block.row === 'melee' || block.row === 'ranged' || block.row === 'siege') {
      rowKind = block.row;
    } else {
      return { ok: false, error: 'This unit has no row' };
    }
    // Spies stand on the OPPONENT's side and score for them — you draw 2.
    const side = block.ability === 'spy' ? other(cmd.player) : cmd.player;
    me.hand.splice(handIndex, 1);
    next.players[side].rowsBoard![rowKind].push({ instanceId: card.instanceId, def: card.def });
    events.push({
      type: 'rowsCardPlayed', player: cmd.player, cardName: card.def.name,
      row: rowKind, spy: block.ability === 'spy' || undefined,
    });
    if (block.ability === 'spy') {
      rowsDraw(next, cmd.player, events);
      rowsDraw(next, cmd.player, events);
    }
    if (block.ability === 'muster' && block.musterTag) {
      for (let i = me.deck.length - 1; i >= 0; i--) {
        const mate = me.deck[i];
        const mb = mate.def.rows;
        if (mb?.kind !== 'unit' || mb.musterTag !== block.musterTag) continue;
        me.deck.splice(i, 1);
        const mateRow: RowKind = mb.row === 'agile' || mb.row === undefined ? 'melee' : mb.row;
        me.rowsBoard![mateRow].push({ instanceId: mate.instanceId, def: mate.def });
        events.push({
          type: 'rowsCardPlayed', player: cmd.player, cardName: mate.def.name,
          row: mateRow, mustered: true,
        });
      }
    }
  } else {
    // Specials
    const special = block.special;
    if (!special) return { ok: false, error: 'This special has no effect' };
    if (special === 'horn') {
      if (!cmd.row) return { ok: false, error: 'The horn needs a row' };
      if (me.rowsBoard!.horns[cmd.row]) return { ok: false, error: 'That row already has a horn' };
    }
    me.hand.splice(handIndex, 1);
    me.graveyard.push(card);
    events.push({ type: 'rowsCardPlayed', player: cmd.player, cardName: card.def.name, row: cmd.row });
    if (special === 'frost' || special === 'fog' || special === 'rain') {
      next.rowsRound!.weather[WEATHER_ROW[special]] = true;
    } else if (special === 'clear') {
      next.rowsRound!.weather = { melee: false, ranged: false, siege: false };
    } else if (special === 'horn') {
      me.rowsBoard!.horns[cmd.row as RowKind] = true;
    } else {
      // scorch: the strongest non-hero unit(s) anywhere burn — yours included
      const candidates = unitsInPlay(next).filter((u) => !u.unit.def.rows?.hero);
      const max = candidates.reduce((m, u) => Math.max(m, u.power), 0);
      const burned: string[] = [];
      for (const { owner, row, unit, power } of candidates) {
        if (max <= 0 || power !== max) continue;
        const arr = next.players[owner].rowsBoard![row];
        arr.splice(arr.indexOf(unit), 1);
        next.players[owner].graveyard.push({ instanceId: unit.instanceId, def: unit.def });
        burned.push(unit.def.name);
      }
      events.push({ type: 'scorched', cardNames: burned });
    }
    if (special !== 'horn' && special !== 'scorch') {
      const w = next.rowsRound!.weather;
      events.push({ type: 'weatherChanged', melee: w.melee, ranged: w.ranged, siege: w.siege });
    }
  }

  settleTurn(next, events);
  return { ok: true, state: next, events };
}
