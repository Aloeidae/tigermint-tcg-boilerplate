import type { CardInstance, CreatureOnBoard, GameState, PlayerId } from '../types.js';
import type { GameEvent } from '../events.js';
import { applyStatus, findStatusKey, getStatus } from '../statuses.js';
import { CONDITION_KEYS, EXCLUSIVE_CONDITIONS, type ConditionKey } from './conditions.js';
import { isStatusImmune } from './passives.js';
import { stickerGame, trainerGame } from './types.js';

/**
 * Board bookkeeping for the pokemon mode: putting stickers into play,
 * damage counters, energy, conditions, and knockouts. The engine and the
 * effect-DSL interpreter both build on these.
 */

/** The board entity for a sticker entering play. Legacy skills are stripped —
 *  in this mode a card's behavior comes only from its `game` block. */
export function makeBoardSticker(card: CardInstance, turn: number): CreatureOnBoard {
  const game = stickerGame(card.def);
  const hp = game?.hp ?? card.def.health ?? 1;
  return {
    instanceId: card.instanceId,
    def: { ...card.def, skills: [] },
    attack: 0,
    health: hp,
    maxHealth: hp,
    ready: true,
    attacksUsed: 0,
    equipment: [],
    statuses: [],
    reactions: [],
    gift: null,
    stack: [],
    enteredTurn: turn,
    traitUsed: false,
  };
}

/**
 * Put damage counters on a sticker directly — condition ticks, self-damage,
 * and "put damage" effects. Deliberately OUTSIDE the damage pipeline: placed
 * damage ignores weakness, resistance, armor, and protection, exactly like
 * damage counters in the source material. Move damage goes through
 * damage.ts instead.
 */
export function placeDamage(
  state: GameState,
  owner: PlayerId,
  creature: CreatureOnBoard,
  amount: number,
  events: GameEvent[]
): void {
  if (amount <= 0) return;
  creature.health -= amount;
  events.push({ type: 'creatureDamaged', player: owner, instanceId: creature.instanceId, amount });
}

export function healSticker(
  state: GameState,
  owner: PlayerId,
  creature: CreatureOnBoard,
  amount: number,
  events: GameEvent[]
): void {
  const healed = Math.min(amount, creature.maxHealth - creature.health);
  if (healed <= 0) return;
  creature.health += healed;
  events.push({ type: 'creatureHealed', player: owner, instanceId: creature.instanceId, amount: healed });
}

/**
 * Apply a Special Condition to a sticker (normally the Active). Re-applying
 * refreshes the value; asleep/paralyzed/confused replace one another.
 * Status-immune stickers (Spam Shield, Premium Glow) shrug it off.
 */
export function applyCondition(
  state: GameState,
  owner: PlayerId,
  creature: CreatureOnBoard,
  key: ConditionKey,
  events: GameEvent[],
  value?: number
): void {
  if (isStatusImmune(state, owner, creature)) return;
  if (EXCLUSIVE_CONDITIONS.includes(key)) {
    creature.statuses = creature.statuses.filter(
      (s) => !EXCLUSIVE_CONDITIONS.includes(s.key as ConditionKey)
    );
  } else {
    // Poison/burn refresh rather than stack their tick value.
    creature.statuses = creature.statuses.filter((s) => s.key !== key);
  }
  applyStatus(state, owner, creature, { key, value }, events);
}

/** Resolve a condition name from data ("Muted", "Spammed"…) to its key. */
export function conditionKey(name: unknown): ConditionKey | null {
  if (typeof name !== 'string') return null;
  const key = findStatusKey(name);
  return key && (CONDITION_KEYS as readonly string[]).includes(key) ? (key as ConditionKey) : null;
}

/** Retreating or evolving clears Special Conditions (and turn statuses). */
export function clearConditions(creature: CreatureOnBoard, owner: PlayerId, events: GameEvent[]): void {
  for (const ref of [...creature.statuses]) {
    const def = getStatus(ref.key);
    events.push({
      type: 'statusExpired',
      player: owner,
      instanceId: creature.instanceId,
      status: def?.name ?? ref.key,
      icon: def?.icon ?? '',
    });
  }
  creature.statuses = [];
}

/**
 * Discard up to `count` energy cards from a sticker into its owner's
 * graveyard (from the most recently attached down). Returns how many left.
 */
export function discardEnergyFrom(
  state: GameState,
  owner: PlayerId,
  creature: CreatureOnBoard,
  count: number,
  events: GameEvent[]
): number {
  const reactions = creature.reactions ?? [];
  const n = Math.min(count, reactions.length);
  if (n <= 0) return 0;
  const removed = reactions.splice(reactions.length - n, n);
  state.players[owner].graveyard.push(...removed);
  events.push({ type: 'energyDiscarded', player: owner, instanceId: creature.instanceId, count: n });
  return n;
}

/** Detach a sticker's Tool (gift) into its owner's graveyard. */
export function discardGift(
  state: GameState,
  owner: PlayerId,
  creature: CreatureOnBoard,
  events: GameEvent[]
): void {
  if (!creature.gift) return;
  const gift = creature.gift;
  creature.gift = null;
  // Undo a +HP Tool's bonus (never below 1 so the discard itself can't KO).
  const trainer = trainerGame(gift.def);
  for (const op of trainer?.effects ?? []) {
    if (op.op === 'hpBonus' && typeof op.amount === 'number') {
      creature.maxHealth -= op.amount;
      creature.health = Math.max(1, Math.min(creature.health, creature.maxHealth));
    }
  }
  state.players[owner].graveyard.push(gift);
}

/** Everything a knocked-out sticker takes with it into the graveyard. */
export function archiveSticker(state: GameState, owner: PlayerId, creature: CreatureOnBoard): void {
  const grave = state.players[owner].graveyard;
  grave.push({ instanceId: creature.instanceId, def: creature.def });
  grave.push(...(creature.stack ?? []));
  grave.push(...(creature.reactions ?? []));
  if (creature.gift) grave.push(creature.gift);
}

/** Stickers a player has in play (Active first). */
export function boardStickers(state: GameState, player: PlayerId): CreatureOnBoard[] {
  return state.players[player].row.filter((c): c is CreatureOnBoard => c !== null);
}

/** Bench = every slot but 0. */
export function benchStickers(state: GameState, player: PlayerId): CreatureOnBoard[] {
  return state.players[player].row.slice(1).filter((c): c is CreatureOnBoard => c !== null);
}
