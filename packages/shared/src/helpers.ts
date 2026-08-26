import type { CreatureOnBoard, GameState, PlayerId, PlayerState } from './types.js';
import type { GameEvent } from './events.js';
import { runHook, runRowHook } from './skills.js';

export function other(p: PlayerId): PlayerId {
  return p === 0 ? 1 : 0;
}

export function findCreature(
  state: GameState,
  instanceId: string
): { creature: CreatureOnBoard; owner: PlayerId; slot: number } | null {
  for (const player of state.players) {
    for (let slot = 0; slot < player.row.length; slot++) {
      const c = player.row[slot];
      if (c && c.instanceId === instanceId) {
        return { creature: c, owner: player.id, slot };
      }
    }
  }
  return null;
}

export function damageCreature(
  state: GameState,
  creature: CreatureOnBoard,
  amount: number,
  events: GameEvent[]
): void {
  if (amount <= 0) return;
  creature.health -= amount;
  const owner = findCreature(state, creature.instanceId)!.owner;
  events.push({ type: 'creatureDamaged', player: owner, instanceId: creature.instanceId, amount });
}

export function damageFace(state: GameState, player: PlayerId, amount: number, events: GameEvent[]): void {
  if (amount <= 0) return;
  const p = state.players[player];
  p.life -= amount;
  events.push({ type: 'lifeChanged', player, life: p.life, delta: -amount });
}

export function healFace(state: GameState, player: PlayerId, amount: number, events: GameEvent[]): void {
  if (amount <= 0) return;
  const p = state.players[player];
  p.life += amount;
  events.push({ type: 'lifeChanged', player, life: p.life, delta: amount });
}

/**
 * Move dead creatures (and their equipment) to the graveyard, running each
 * one's onDeath skill hooks first (a hook may heal it back above 0).
 */
export function sweepDeaths(state: GameState, events: GameEvent[]): void {
  for (const player of state.players) {
    for (let slot = 0; slot < player.row.length; slot++) {
      const c = player.row[slot];
      if (c && c.health <= 0) {
        runHook('onDeath', state, player.id, c, events);
        if (c.health > 0) continue; // an onDeath hook saved it
        player.row[slot] = null;
        player.graveyard.push({ instanceId: c.instanceId, def: c.def });
        player.graveyard.push(...c.equipment);
        events.push({ type: 'creatureDied', player: player.id, instanceId: c.instanceId, cardName: c.def.name });
        // Surviving allies react (Scavenger and friends).
        for (const ally of player.row) {
          if (ally && ally.health > 0) runHook('onAllyDeath', state, player.id, ally, events);
        }
      }
    }
  }
}

/**
 * End the game if anyone is at 0 life. If both players dropped to 0 at once,
 * the player who caused it (the active player) wins.
 */
export function checkWin(state: GameState, events: GameEvent[]): void {
  if (state.gameOver) return;
  const [a, b] = state.players;
  let loser: PlayerId | null = null;
  if (a.life <= 0 && b.life <= 0) loser = other(state.active);
  else if (a.life <= 0) loser = 0;
  else if (b.life <= 0) loser = 1;
  if (loser !== null) {
    endGame(state, other(loser), 'life reached 0', events);
  }
}

export function endGame(state: GameState, winner: PlayerId, reason: string, events: GameEvent[]): void {
  state.gameOver = true;
  state.winner = winner;
  events.push({ type: 'gameOver', winner, reason });
}

/**
 * Draw one card. Drawing from an empty deck triggers fatigue: depending on
 * the rules, that either loses the game outright or deals growing damage.
 */
export function drawCard(state: GameState, player: PlayerId, events: GameEvent[]): void {
  const p: PlayerState = state.players[player];
  const card = p.deck.shift();
  if (!card) {
    events.push({ type: 'fatigue', player });
    if (state.rules.fatigue === 'damage') {
      p.fatigue += 1;
      damageFace(state, player, p.fatigue, events);
    } else {
      endGame(state, other(player), 'tried to draw from an empty deck', events);
    }
    return;
  }
  if (p.hand.length >= state.rules.maxHand) {
    // Hand is full: the card is burned to the graveyard.
    p.graveyard.push(card);
    events.push({ type: 'cardDrawn', player });
    return;
  }
  p.hand.push(card);
  events.push({ type: 'cardDrawn', player, cardName: card.def.name });
  // Board creatures with onDraw skills react to their owner drawing.
  // (Keep onDraw hooks from drawing cards themselves, or cap it — loops.)
  runRowHook('onDraw', state, player, events);
}
