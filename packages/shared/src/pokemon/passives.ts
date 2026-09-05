import type { CardDef, CreatureOnBoard, GameState, PlayerId } from '../types.js';
import type { EffectOp } from './types.js';
import { reactionGame, stickerGame, trainerGame } from './types.js';

/**
 * Passive-effect plumbing for the pokemon game mode. "Passive" ops never run
 * as one-shot actions — the engine QUERIES them at the moments they matter:
 * armor when damage lands, noWeakness when weakness would apply, swap-cost
 * modifiers when retreating, and so on. They live on static traits, attached
 * Tools (gifts), attached special reactions, and the Stadium (channel).
 */

/** Every op passively in force on one sticker (trait + gift + reactions). */
export function passiveOps(creature: CreatureOnBoard): EffectOp[] {
  const ops: EffectOp[] = [];
  const game = stickerGame(creature.def);
  if (game?.trait && game.trait.trigger === 'static') ops.push(...game.trait.effects);
  if (creature.gift) {
    const gift = trainerGame(creature.gift.def);
    if (gift) ops.push(...gift.effects);
  }
  for (const r of creature.reactions ?? []) {
    const rg = reactionGame(r.def);
    // e.g. Premium Boost: +damage while attached.
    for (const op of rg?.effects ?? []) {
      if (op.op !== 'discardSelf' && op.when !== 'onAttach') ops.push(op);
    }
  }
  return ops;
}

/** Ops in force from the Stadium, for either side ('both' or the asker). */
export function channelOps(state: GameState, forPlayer: PlayerId): EffectOp[] {
  if (!state.channel) return [];
  const trainer = trainerGame(state.channel.card.def);
  if (!trainer) return [];
  return trainer.effects.filter((op) => {
    const side = op.side ?? 'both';
    if (side === 'both') return true;
    return side === 'self' ? state.channel!.owner === forPlayer : state.channel!.owner !== forPlayer;
  });
}

/** All passives affecting one sticker: its own + the Stadium's. */
export function allPassives(state: GameState, owner: PlayerId, creature: CreatureOnBoard): EffectOp[] {
  return [...passiveOps(creature), ...channelOps(state, owner)];
}

export function sumOp(ops: EffectOp[], op: string, field = 'amount'): number {
  let total = 0;
  for (const o of ops) {
    if (o.op === op && typeof o[field] === 'number') total += o[field] as number;
  }
  return total;
}

export function hasOp(ops: EffectOp[], op: string): boolean {
  return ops.some((o) => o.op === op);
}

/**
 * Card filter used by search/recover/bonusVs ops:
 * { kind, special, stage, stageMin, orStar } — all optional, all must match
 * (except orStar, which widens a stage requirement to star stickers).
 */
export function matchFilter(def: CardDef, filter: unknown): boolean {
  if (!filter || typeof filter !== 'object') return true;
  const f = filter as Record<string, unknown>;
  const game = def.game;
  if (f.kind !== undefined) {
    const kinds = Array.isArray(f.kind) ? f.kind : [f.kind];
    if (!game || !kinds.includes(game.kind)) return false;
  }
  const sticker = stickerGame(def);
  const reaction = reactionGame(def);
  if (f.special !== undefined && (!reaction || (reaction.special ?? false) !== f.special)) return false;
  if (f.stage !== undefined && (!sticker || sticker.stageIndex !== f.stage)) return false;
  if (f.stageMin !== undefined) {
    const stageOk = sticker && sticker.stageIndex >= (f.stageMin as number);
    const starOk = f.orStar === true && sticker?.star === true;
    if (!stageOk && !starOk) return false;
  }
  return true;
}

/** The Active's effective retreat cost after every modifier in play. */
export function effectiveSwapCost(state: GameState, owner: PlayerId, creature: CreatureOnBoard): number {
  const game = stickerGame(creature.def);
  if (!game) return 0;
  const mine = allPassives(state, owner, creature);
  // A flat override (Free Swap) wins; deltas apply on top of the base.
  const override = mine.find((o) => o.op === 'swapCost' && typeof o.value === 'number');
  let cost = override ? (override.value as number) : game.swapCost;
  for (const o of mine) {
    if (o.op === 'swapCostDelta' && typeof o.delta === 'number' && matchFilter(creature.def, o.filter)) {
      cost += o.delta;
    }
  }
  // The enemy Active can tax retreats (Frost Wall).
  const enemyActive = state.players[owner === 0 ? 1 : 0].row[0];
  if (enemyActive) {
    cost += sumOp(passiveOps(enemyActive), 'opponentSwapCost', 'delta');
  }
  return Math.max(0, cost);
}

/** Bench capacity: rules baseline plus Stadium modifiers (Megagroup). */
export function effectiveBenchSize(state: GameState, owner: PlayerId): number {
  const base = state.rules.maxRow - 1;
  const bonus = sumOp(channelOps(state, owner), 'benchSize', 'delta');
  // The row array carries headroom, but never exceed it.
  const capacity = state.players[owner].row.length - 1;
  return Math.max(1, Math.min(base + bonus, capacity));
}

/** Whether a sticker is shielded from Special Conditions. */
export function isStatusImmune(state: GameState, owner: PlayerId, creature: CreatureOnBoard): boolean {
  return hasOp(allPassives(state, owner, creature), 'statusImmune');
}
