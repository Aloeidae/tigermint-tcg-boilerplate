import type { CreatureOnBoard, GameState, PlayerId } from './types.js';
import type { AttackTarget } from './commands.js';
import type { GameEvent } from './events.js';
import { checkWin, findCreature, other, sweepDeaths } from './helpers.js';
import { applyDamage, applyFaceDamage } from './damage.js';
import { creatureHasFlag, getSkill } from './skills.js';
import { statusBlocksAttack } from './statuses.js';

/**
 * Resolve one attack during the combat phase.
 *
 * Rules: a ready creature may attack once per turn (see rules.attacksPerTurn),
 * targeting an enemy creature or the enemy player's face. Guard creatures must
 * be attacked before anything else; First Strike changes the damage order.
 * All damage goes through damage.ts so every skill hook applies. Swap this
 * file out for blockers, lanes, multi-row combat, etc.
 */
export function resolveAttack(
  state: GameState,
  attackerOwner: PlayerId,
  attackerId: string,
  target: AttackTarget,
  events: GameEvent[]
): string | null {
  const found = findCreature(state, attackerId);
  if (!found || found.owner !== attackerOwner) return 'Attacker not found on your row';
  const attacker = found.creature;
  if (!attacker.ready) return 'That creature is not ready (summoning sickness)';
  if (statusBlocksAttack(attacker)) return 'That creature cannot attack right now';
  if (attacker.attacksUsed >= state.rules.attacksPerTurn) return 'That creature has no attacks left this turn';
  if (attacker.attack <= 0) return 'That creature has no attack';

  const defenderPlayer: PlayerId = other(attackerOwner);
  const defenderRow = state.players[defenderPlayer].row;
  const guards = defenderRow.filter((c): c is CreatureOnBoard => !!c && creatureHasFlag(c, 'guards'));

  if (target.kind === 'face') {
    if (guards.length > 0) return 'A guarding creature is in the way — attack it first';
    if (state.rules.mustAttackCreaturesFirst && defenderRow.some((c) => c !== null)) {
      return 'Enemy creatures are in the way — attack them first';
    }
    events.push({
      type: 'attacked',
      player: attackerOwner,
      attackerId,
      attackerName: attacker.def.name,
      targetKind: 'face',
    });
    applyFaceDamage(state, attacker, defenderPlayer, attacker.attack, events);
  } else {
    const def = findCreature(state, target.instanceId);
    if (!def || def.owner === attackerOwner) return 'Invalid attack target';
    if (guards.length > 0 && !guards.some((g) => g.instanceId === def.creature.instanceId)) {
      return 'You must attack a guarding creature first';
    }
    events.push({
      type: 'attacked',
      player: attackerOwner,
      attackerId,
      attackerName: attacker.def.name,
      targetKind: 'creature',
      targetId: def.creature.instanceId,
      targetName: def.creature.def.name,
    });
    exchange(state, attacker, attackerOwner, def.creature, defenderPlayer, events);
  }

  attacker.attacksUsed += 1;
  sweepDeaths(state, events);
  checkWin(state, events);
  return null;
}

// ---------------------------------------------------------------------------
// Blockers-style combat (rules.combatStyle === 'blockers'): attackers are
// declared against the PLAYER, the defender assigns blockers, then combat
// resolves — blocked pairs exchange damage, unblocked attackers hit the face.
// ---------------------------------------------------------------------------

/** Toggle a creature as a declared attacker during the combat phase. */
export function toggleAttacker(
  state: GameState,
  attackerOwner: PlayerId,
  attackerId: string,
  events: GameEvent[]
): string | null {
  const found = findCreature(state, attackerId);
  if (!found || found.owner !== attackerOwner) return 'Attacker not found on your row';
  const c = found.creature;

  const declared = state.attackers.indexOf(attackerId);
  if (declared !== -1) {
    state.attackers.splice(declared, 1);
    events.push({ type: 'attackerDeclared', player: attackerOwner, instanceId: attackerId, cardName: c.def.name, declared: false });
    return null;
  }
  if (!c.ready) return 'That creature is not ready (summoning sickness)';
  if (statusBlocksAttack(c)) return 'That creature cannot attack right now';
  if (c.attacksUsed >= state.rules.attacksPerTurn) return 'That creature has no attacks left this turn';
  if (c.attack <= 0) return 'That creature has no attack';
  state.attackers.push(attackerId);
  events.push({ type: 'attackerDeclared', player: attackerOwner, instanceId: attackerId, cardName: c.def.name, declared: true });
  return null;
}

/**
 * Validate the defender's blocks and resolve combat: blocked pairs fight
 * (First Strike honored, blockers always strike back), unblocked attackers
 * hit the defender's face. Ends in main2.
 */
export function resolveBlocks(
  state: GameState,
  defender: PlayerId,
  blocks: { blocker: string; attacker: string }[],
  events: GameEvent[]
): string | null {
  const usedBlockers = new Set<string>();
  const blockedAttackers = new Set<string>();
  for (const b of blocks) {
    const blocker = findCreature(state, b.blocker);
    if (!blocker || blocker.owner !== defender) return 'Blocker not found on your row';
    if (usedBlockers.has(b.blocker)) return 'A creature can only block one attacker';
    if (!state.attackers.includes(b.attacker)) return 'That creature is not attacking';
    if (blockedAttackers.has(b.attacker)) return 'That attacker is already blocked';
    usedBlockers.add(b.blocker);
    blockedAttackers.add(b.attacker);
  }
  state.blocks = blocks.map((b) => ({ ...b }));
  events.push({ type: 'blocksDeclared', player: defender, count: blocks.length });

  const attackerOwner = other(defender);
  for (const attackerId of state.attackers) {
    const found = findCreature(state, attackerId);
    if (!found || found.creature.health <= 0) continue; // died mid-combat
    const attacker = found.creature;
    const pair = state.blocks.find((b) => b.attacker === attackerId);
    const blocker = pair ? findCreature(state, pair.blocker) : null;
    if (blocker && blocker.creature.health > 0) {
      events.push({
        type: 'attacked', player: attackerOwner, attackerId, attackerName: attacker.def.name,
        targetKind: 'creature', targetId: blocker.creature.instanceId, targetName: blocker.creature.def.name,
      });
      exchange(state, attacker, attackerOwner, blocker.creature, defender, events, true);
    } else {
      events.push({
        type: 'attacked', player: attackerOwner, attackerId, attackerName: attacker.def.name, targetKind: 'face',
      });
      applyFaceDamage(state, attacker, defender, attacker.attack, events);
    }
    attacker.attacksUsed += 1;
    sweepDeaths(state, events);
  }
  state.attackers = [];
  state.blocks = [];
  checkWin(state, events);
  if (!state.gameOver) {
    state.phase = 'main2';
    events.push({ type: 'phaseChanged', player: attackerOwner, phase: 'main2' });
  }
  return null;
}

/** One creature-vs-creature damage exchange, honoring First Strike order. */
function exchange(
  state: GameState,
  attacker: CreatureOnBoard,
  attackerOwner: PlayerId,
  defender: CreatureOnBoard,
  defenderPlayer: PlayerId,
  events: GameEvent[],
  forceRetaliate = false
): void {
  const attackerFirst = creatureHasFlag(attacker, 'strikesFirst') && !creatureHasFlag(defender, 'strikesFirst');
  const defenderFirst = creatureHasFlag(defender, 'strikesFirst') && !creatureHasFlag(attacker, 'strikesFirst');
  // A blocker chose the fight — it always strikes back regardless of the
  // targeted-mode retaliation knob.
  const canRetaliate = (forceRetaliate || state.rules.retaliation) && defender.attack > 0;

  const firstStrikeEvent = (bearer: CreatureOnBoard, owner: PlayerId): void => {
    const def = getSkill('firstStrike');
    events.push({
      type: 'skillTriggered', player: owner, instanceId: bearer.instanceId,
      cardName: bearer.def.name, skill: def?.name ?? 'First Strike', icon: def?.icon ?? '⚔',
    });
  };

  if (attackerFirst) {
    applyDamage(state, attacker, defender, attacker.attack, events, true);
    if (defender.health > 0) {
      if (canRetaliate) applyDamage(state, defender, attacker, defender.attack, events, false);
    } else {
      firstStrikeEvent(attacker, attackerOwner);
    }
    return;
  }

  if (defenderFirst && canRetaliate) {
    applyDamage(state, defender, attacker, defender.attack, events, false);
    if (attacker.health > 0) {
      applyDamage(state, attacker, defender, attacker.attack, events, true);
    } else {
      firstStrikeEvent(defender, defenderPlayer);
    }
    return;
  }

  // Simultaneous damage (or a first-strike defender that can't retaliate).
  applyDamage(state, attacker, defender, attacker.attack, events, true);
  if (canRetaliate) applyDamage(state, defender, attacker, defender.attack, events, false);
}
