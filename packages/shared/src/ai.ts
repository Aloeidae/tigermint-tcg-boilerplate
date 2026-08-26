import type { CreatureOnBoard, EffectTarget, GameState, PlayerId } from './types.js';
import type { Command } from './commands.js';
import { effectTargetSpec } from './effects.js';
import { other } from './helpers.js';
import { creatureHasFlag } from './skills.js';

/**
 * Whose decision the game is waiting on. Almost always the active player —
 * except the block step of blockers-style combat, where the DEFENDER acts.
 */
export function actingPlayer(state: GameState): PlayerId {
  return state.phase === 'block' ? other(state.active) : state.active;
}

/**
 * A deliberately simple opponent: plays what it can afford, attacks greedily.
 * Returns ONE command at a time; the caller applies it and asks again until
 * the AI ends its turn. Replace this file to build a smarter opponent.
 */
export function chooseCommand(state: GameState, me: PlayerId): Command {
  const p = state.players[me];
  const enemy = state.players[other(me)];

  // Blockers combat, defending: assign blockers, then combat resolves.
  if (state.phase === 'block') {
    return { type: 'declareBlockers', player: me, blocks: chooseBlocks(state, me) };
  }

  if (state.phase === 'main1' || state.phase === 'main2') {
    // 1. Summon the most expensive affordable creature if there's room.
    const freeSlot = p.row.findIndex((s) => s === null);
    if (freeSlot !== -1) {
      const creatures = p.hand
        .filter((c) => c.def.type === 'creature' && c.def.cost <= p.mana)
        .sort((a, b) => b.def.cost - a.def.cost);
      if (creatures.length > 0) {
        return { type: 'playCard', player: me, instanceId: creatures[0].instanceId, slot: freeSlot };
      }
    }

    // 2. Attach affordable equipment to the strongest creature.
    const myCreatures = p.row.filter((c): c is CreatureOnBoard => c !== null);
    const equipment = p.hand.find((c) => c.def.type === 'equipment' && c.def.cost <= p.mana);
    if (equipment && myCreatures.length > 0) {
      const strongest = [...myCreatures].sort((a, b) => b.attack - a.attack)[0];
      return {
        type: 'playCard',
        player: me,
        instanceId: equipment.instanceId,
        target: { kind: 'creature', instanceId: strongest.instanceId },
      };
    }

    // 3. Cast an affordable spell with a sensible target.
    for (const card of p.hand) {
      if (card.def.type !== 'spell' || card.def.cost > p.mana || !card.def.effect) continue;
      const target = pickSpellTarget(state, me, card.def.effect.key, card.def.effect.amount ?? 0);
      if (target) {
        return { type: 'playCard', player: me, instanceId: card.instanceId, target };
      }
    }

    return state.phase === 'main1' ? { type: 'advancePhase', player: me } : { type: 'endTurn', player: me };
  }

  // Blockers combat, attacking: declare everything that can swing, then
  // pass the decision to the defender.
  if (state.rules.combatStyle === 'blockers') {
    const undeclared = p.row.find(
      (c) =>
        c && c.ready && c.attacksUsed < state.rules.attacksPerTurn && c.attack > 0 &&
        !state.attackers.includes(c.instanceId)
    );
    if (undeclared) {
      return { type: 'attack', player: me, attackerId: undeclared.instanceId, target: { kind: 'face' } };
    }
    return { type: 'advancePhase', player: me };
  }

  // Targeted combat: attack with each ready creature, one command at a time.
  const attacker = p.row.find(
    (c) => c && c.ready && c.attacksUsed < state.rules.attacksPerTurn && c.attack > 0
  );
  if (attacker) {
    const allEnemyCreatures = enemy.row.filter((c): c is CreatureOnBoard => c !== null);
    const guards = allEnemyCreatures.filter((c) => creatureHasFlag(c, 'guards'));
    // Guards restrict legal targets; the face is legal only when unguarded.
    const enemyCreatures = guards.length > 0 ? guards : allEnemyCreatures;
    const faceAllowed =
      guards.length === 0 &&
      (!state.rules.mustAttackCreaturesFirst || allEnemyCreatures.length === 0);
    // Go face if it wins the game.
    if (faceAllowed && enemy.life <= attacker.attack) {
      return { type: 'attack', player: me, attackerId: attacker.instanceId, target: { kind: 'face' } };
    }
    // Prefer a favorable trade: kill the biggest enemy creature we can, ideally surviving.
    const killable = enemyCreatures
      .filter((c) => c.health <= attacker.attack)
      .sort((a, b) => b.attack + b.health - (a.attack + a.health));
    const surviving = killable.find((c) => c.attack < attacker.health);
    const trade = surviving ?? killable[0];
    if (trade && (!faceAllowed || trade.attack + trade.health >= attacker.attack)) {
      return { type: 'attack', player: me, attackerId: attacker.instanceId, target: { kind: 'creature', instanceId: trade.instanceId } };
    }
    if (!faceAllowed) {
      // Guard rule: must hit some creature even if the trade is poor.
      const biggestThreat = [...enemyCreatures].sort((a, b) => b.attack - a.attack)[0];
      if (biggestThreat) {
        return { type: 'attack', player: me, attackerId: attacker.instanceId, target: { kind: 'creature', instanceId: biggestThreat.instanceId } };
      }
    }
    return { type: 'attack', player: me, attackerId: attacker.instanceId, target: { kind: 'face' } };
  }
  return { type: 'advancePhase', player: me };
}

/**
 * Blocking heuristic: favorable trades first (kill the attacker and/or
 * survive), then chump-block whatever would otherwise be lethal.
 */
function chooseBlocks(state: GameState, me: PlayerId): { blocker: string; attacker: string }[] {
  const p = state.players[me];
  const available = p.row.filter((c): c is CreatureOnBoard => c !== null);
  const attackers = state.attackers
    .map((id) => {
      for (const c of state.players[other(me)].row) if (c?.instanceId === id) return c;
      return null;
    })
    .filter((c): c is CreatureOnBoard => c !== null)
    .sort((a, b) => b.attack - a.attack);

  const blocks: { blocker: string; attacker: string }[] = [];
  const used = new Set<string>();
  let incoming = 0;

  for (const atk of attackers) {
    // Best trade: kills the attacker, prefer surviving the exchange.
    const killers = available.filter((b) => !used.has(b.instanceId) && b.attack >= atk.health);
    const pick =
      killers.find((b) => b.health > atk.attack) ??
      killers[0] ??
      // Absorb big hits with a tanky body that survives.
      available.find((b) => !used.has(b.instanceId) && b.health > atk.attack && atk.attack >= 3);
    if (pick) {
      used.add(pick.instanceId);
      blocks.push({ blocker: pick.instanceId, attacker: atk.instanceId });
    } else {
      incoming += atk.attack;
    }
  }

  // Facing lethal? Chump-block the biggest unblocked attackers with anything left.
  if (incoming >= p.life) {
    for (const atk of attackers) {
      if (blocks.some((b) => b.attacker === atk.instanceId)) continue;
      const chump = available.find((b) => !used.has(b.instanceId));
      if (!chump) break;
      used.add(chump.instanceId);
      blocks.push({ blocker: chump.instanceId, attacker: atk.instanceId });
    }
  }
  return blocks;
}

function pickSpellTarget(state: GameState, me: PlayerId, effectKey: string, amount: number): EffectTarget | null {
  const p = state.players[me];
  const enemy = state.players[other(me)];
  const spec = effectTargetSpec({ key: effectKey, amount });
  const enemyCreatures = enemy.row.filter((c): c is CreatureOnBoard => c !== null);
  const myCreatures = p.row.filter((c): c is CreatureOnBoard => c !== null);

  switch (spec) {
    case 'none':
      // Only bother with AoE when there's something to hit.
      if (effectKey === 'aoeDamage') return enemyCreatures.length >= 2 ? { kind: 'none' } : null;
      return { kind: 'none' };
    case 'any': {
      if (effectKey === 'damage') {
        if (enemy.life <= amount) return { kind: 'face', player: enemy.id };
        const killable = enemyCreatures.filter((c) => c.health <= amount).sort((a, b) => b.attack - a.attack)[0];
        if (killable) return { kind: 'creature', instanceId: killable.instanceId };
        const biggest = enemyCreatures.sort((a, b) => b.attack - a.attack)[0];
        if (biggest) return { kind: 'creature', instanceId: biggest.instanceId };
        return { kind: 'face', player: enemy.id };
      }
      return null;
    }
    case 'friendly': {
      const hurt = myCreatures.filter((c) => c.health < c.maxHealth).sort((a, b) => a.health - b.health)[0];
      if (hurt) return { kind: 'creature', instanceId: hurt.instanceId };
      if (p.life <= 12) return { kind: 'face', player: me };
      return null;
    }
    case 'friendly-creature': {
      const best = myCreatures.filter((c) => c.ready).sort((a, b) => b.attack - a.attack)[0];
      return best ? { kind: 'creature', instanceId: best.instanceId } : null;
    }
    case 'enemy-creature': {
      const biggest = enemyCreatures.sort((a, b) => b.attack - a.attack)[0];
      return biggest ? { kind: 'creature', instanceId: biggest.instanceId } : null;
    }
    case 'any-creature': {
      const biggest = enemyCreatures.sort((a, b) => b.attack - a.attack)[0];
      return biggest ? { kind: 'creature', instanceId: biggest.instanceId } : null;
    }
  }
}
