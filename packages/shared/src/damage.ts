import type { CreatureOnBoard, GameState, PlayerId } from './types.js';
import type { GameEvent } from './events.js';
import { damageFace, findCreature } from './helpers.js';
import { modifyDamage, runAfterDealDamage } from './skills.js';
import { modifyStatusDamage } from './statuses.js';

/**
 * The one damage pipeline. Combat AND spell effects route through here, so
 * skills that modify damage (Armor) or trigger on dealing it (Lifelink,
 * Deathtouch) work everywhere without special cases.
 */

/**
 * Deal damage to a creature. `source` is the dealing creature, or null for
 * spells/effects. Returns the final amount dealt after skill modifiers.
 */
export function applyDamage(
  state: GameState,
  source: CreatureOnBoard | null,
  target: CreatureOnBoard,
  base: number,
  events: GameEvent[],
  attacking = false
): number {
  const targetInfo = findCreature(state, target.instanceId);
  if (!targetInfo) return 0;
  const sourceInfo = source ? findCreature(state, source.instanceId) : null;

  let amount = base;
  if (source && sourceInfo) {
    amount = modifyDamage('modifyDamageDealt', amount, state, sourceInfo.owner, source, events, {
      other: target,
      attacking,
    });
    amount = modifyStatusDamage('modifyDamageDealt', amount, state, sourceInfo.owner, source, events);
  }
  amount = modifyDamage('modifyDamageTaken', amount, state, targetInfo.owner, target, events, {
    other: source ?? undefined,
    attacking: false,
  });
  // Statuses intercept last, so a Shield absorbs what actually got through.
  amount = modifyStatusDamage('modifyDamageTaken', amount, state, targetInfo.owner, target, events);

  if (amount > 0) {
    target.health -= amount;
    events.push({ type: 'creatureDamaged', player: targetInfo.owner, instanceId: target.instanceId, amount });
  }
  if (source && sourceInfo && amount > 0) {
    runAfterDealDamage(amount, state, sourceInfo.owner, source, events, { other: target, attacking });
  }
  return amount;
}

/** Deal damage from a creature to a player's face. */
export function applyFaceDamage(
  state: GameState,
  source: CreatureOnBoard,
  targetPlayer: PlayerId,
  base: number,
  events: GameEvent[]
): number {
  const sourceInfo = findCreature(state, source.instanceId);
  let amount = base;
  if (sourceInfo) {
    amount = modifyDamage('modifyDamageDealt', amount, state, sourceInfo.owner, source, events, {
      otherPlayer: targetPlayer,
      attacking: true,
    });
  }
  if (amount > 0) {
    damageFace(state, targetPlayer, amount, events);
    if (sourceInfo) {
      runAfterDealDamage(amount, state, sourceInfo.owner, source, events, { otherPlayer: targetPlayer, attacking: true });
    }
  }
  return amount;
}
