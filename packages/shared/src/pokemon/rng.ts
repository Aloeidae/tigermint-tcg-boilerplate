import type { GameState, PlayerId } from '../types.js';
import type { GameEvent } from '../events.js';

/**
 * Deterministic randomness for the pokemon mode. Every flip and shuffle
 * advances `state.rngCursor`, so a replay of the same seed + commands
 * reproduces the exact same coins — pure-reducer friendly.
 */
export function nextRand(state: GameState): number {
  const cursor = (state.rngCursor = (state.rngCursor ?? 0) + 1);
  let a = (state.seed ^ Math.imul(cursor, 0x9e3779b9)) >>> 0;
  a = (a + 0x6d2b79f5) | 0;
  let t = Math.imul(a ^ (a >>> 15), 1 | a);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

/** Flip a coin, tell the table about it. */
export function flipCoin(state: GameState, player: PlayerId, events: GameEvent[], label?: string): boolean {
  const heads = nextRand(state) < 0.5;
  events.push({ type: 'coinFlip', player, heads, label });
  return heads;
}

/** Deterministic in-place Fisher–Yates over a player's deck. */
export function shuffleDeck(state: GameState, player: PlayerId): void {
  const deck = state.players[player].deck;
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(nextRand(state) * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
}
