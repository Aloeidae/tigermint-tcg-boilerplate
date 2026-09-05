import type { CardInstance, CreatureOnBoard, GameState, PlayerId } from '../types.js';
import type { Command } from '../commands.js';
import { other } from '../helpers.js';
import { statusBlocksAttack, statusBlocksSwap } from '../statuses.js';
import type { PokemonMove, ReactionType } from './types.js';
import { coversCost, isBasicSticker, reactionGame, stickerGame, trainerGame } from './types.js';
import { benchStickers } from './board.js';
import { effectiveBenchSize, effectiveSwapCost, hasOp, allPassives } from './passives.js';

/**
 * A straightforward league opponent: builds a bench, banks energy toward its
 * Active's biggest move, plays obviously-good trainers, and attacks with the
 * hardest-hitting affordable move (weakness-aware). One command per call,
 * like the standard AI — swap this file out for something smarter.
 */
export function choosePokemonCommand(state: GameState, me: PlayerId): Command {
  const p = state.players[me];

  if (state.phase === 'setup') {
    const basics = p.hand.filter((c) => isBasicSticker(c.def)).sort((a, b) => hpOf(b) - hpOf(a));
    const pinned = basics[0];
    const bench = basics.slice(1, state.rules.maxRow).map((c) => c.instanceId);
    // No basic in hand shouldn't happen (openings guarantee one) — bail out.
    if (!pinned) return { type: 'concede', player: me };
    return { type: 'setup', player: me, pinnedId: pinned.instanceId, benchIds: bench };
  }

  if (state.pendingPromote === me) {
    const pick = benchStickers(state, me).sort(
      (a, b) => score(b) - score(a)
    )[0];
    if (pick) return { type: 'promote', player: me, targetInstanceId: pick.instanceId };
    return { type: 'concede', player: me };
  }

  const flags = p.turnFlags;
  const activeSticker = p.row[0];

  // 1. Fill the bench with basics (biggest first).
  if (benchStickers(state, me).length < effectiveBenchSize(state, me)) {
    const basic = p.hand.filter((c) => isBasicSticker(c.def)).sort((a, b) => hpOf(b) - hpOf(a))[0];
    if (basic) return { type: 'playSticker', player: me, instanceId: basic.instanceId };
  }

  // 2. Evolve whatever can evolve.
  if (state.turn > 2) {
    for (const card of p.hand) {
      const g = stickerGame(card.def);
      if (!g || g.stageIndex === 0) continue;
      const target = p.row.find(
        (c) => c && (g.upgradesFrom === c.def.id || g.upgradesFrom === c.def.name) && (c.enteredTurn ?? 0) < state.turn
      );
      if (target) return { type: 'upgrade', player: me, instanceId: card.instanceId, targetInstanceId: target.instanceId };
    }
  }

  // 3. A Tool for the Active.
  if (activeSticker && !activeSticker.gift) {
    const gift = p.hand.find((c) => trainerGame(c.def)?.kind === 'gift');
    if (gift) return { type: 'attachGift', player: me, instanceId: gift.instanceId, targetInstanceId: activeSticker.instanceId };
  }

  // 4. Obviously-good trainers (draw when the deck allows, heal when hurt).
  for (const card of p.hand) {
    const trainer = trainerGame(card.def);
    if (!trainer || trainer.kind === 'gift' || trainer.kind === 'channel') continue;
    if (flags?.locked.includes(trainer.kind)) continue;
    if (trainer.kind === 'admin' && (flags?.supporter || (state.rules.firstTurnNoSupporter && state.turn === 1))) continue;
    if (trainer.effects.some((op) => op.op === 'condition' && typeof op.prizesTaken === 'number' && (p.prizesTaken ?? 0) !== op.prizesTaken)) continue;
    const good = trainer.effects.some((op) => {
      if ((op.op === 'draw' || op.op === 'search' || op.op === 'lookTop' || op.op === 'millDrawPer') && p.deck.length > 2) return true;
      if (op.op === 'drawTo' && p.hand.length < (op.count as number ?? 0) && p.deck.length > 2) return true;
      if (op.op === 'searchEnergy' && p.deck.length > 2) return true;
      if (op.op === 'heal' && p.row.some((c) => c && c.maxHealth - c.health >= (op.amount as number ?? 30))) return true;
      if (op.op === 'searchToBench' && benchStickers(state, me).length < effectiveBenchSize(state, me) && p.deck.length > 2) return true;
      return false;
    });
    if (good) return { type: 'playTrainer', player: me, instanceId: card.instanceId };
  }

  // 5. The once-per-turn energy attachment: feed whoever is closest to a
  // bigger move — the Active first.
  if (flags && !flags.energy) {
    const energy = p.hand.filter((c) => reactionGame(c.def));
    if (energy.length > 0) {
      const targets = [activeSticker, ...benchStickers(state, me)].filter((c): c is CreatureOnBoard => !!c);
      for (const target of targets) {
        const g = stickerGame(target.def);
        if (!g) continue;
        const uncovered = g.moves.some((m) => !covered(target, m));
        if (!uncovered) continue;
        const pick = bestEnergyFor(target, energy);
        if (pick) return { type: 'attachReaction', player: me, instanceId: pick.instanceId, targetInstanceId: target.instanceId };
      }
      // Everything covered — bank one on the Active anyway.
      if (activeSticker) {
        return { type: 'attachReaction', player: me, instanceId: energy[0].instanceId, targetInstanceId: activeSticker.instanceId };
      }
    }
  }

  // 6. Retreat a nearly-dead Active for a healthy attacker.
  if (activeSticker && flags && !flags.swap && !statusBlocksSwap(activeSticker)) {
    const hurt = activeSticker.health <= activeSticker.maxHealth * 0.25;
    const cost = effectiveSwapCost(state, me, activeSticker);
    const replacement = benchStickers(state, me).find(
      (c) => c.health > c.maxHealth * 0.6 && stickerGame(c.def)?.moves.some((m) => covered(c, m))
    );
    if (hurt && replacement && (activeSticker.reactions?.length ?? 0) >= cost) {
      return { type: 'swap', player: me, targetInstanceId: replacement.instanceId };
    }
  }

  // 7. Attack with the best affordable move (this ends the turn).
  if (
    activeSticker &&
    !(state.rules.firstTurnNoAttack && state.turn === 1) &&
    !statusBlocksAttack(activeSticker)
  ) {
    const g = stickerGame(activeSticker.def);
    const defender = state.players[other(me)].row[0];
    let best = -1;
    let bestValue = 0;
    (g?.moves ?? []).forEach((m, i) => {
      if (!covered(activeSticker, m)) return;
      let value = m.expectedDamage ?? m.damage;
      if (defender && g) {
        const dg = stickerGame(defender.def);
        if (dg?.weakness === g.type && !hasOp(allPassives(state, other(me), defender), 'noWeakness')) {
          value *= state.rules.weaknessMultiplier;
        }
        if (value >= defender.health) value += 100; // knockouts pay prizes
      }
      if (value > bestValue || (value === bestValue && value > 0 && i > best)) {
        best = i;
        bestValue = value;
      }
    });
    if (best >= 0 && bestValue > 0) return { type: 'useMove', player: me, moveIndex: best };
  }

  return { type: 'endTurn', player: me };
}

function hpOf(card: CardInstance): number {
  return stickerGame(card.def)?.hp ?? 0;
}

function score(c: CreatureOnBoard): number {
  return c.health + (c.reactions?.length ?? 0) * 40;
}

function covered(creature: CreatureOnBoard, move: PokemonMove): boolean {
  const g = stickerGame(creature.def);
  const attached = (creature.reactions ?? []).map((r) => reactionGame(r.def) ?? { type: 'Neutral' as ReactionType });
  return !!g && coversCost(attached, move.cost, g.type);
}

/** The energy card that helps this sticker toward an uncovered move. */
function bestEnergyFor(creature: CreatureOnBoard, energy: CardInstance[]): CardInstance | null {
  const g = stickerGame(creature.def);
  if (!g) return null;
  for (const card of energy) {
    const rg = reactionGame(card.def);
    if (!rg) continue;
    const withIt = [...(creature.reactions ?? []), card].map((r) => reactionGame(r.def) ?? { type: 'Neutral' as ReactionType });
    for (const move of g.moves) {
      if (!covered(creature, move) && coversCost(withIt, move.cost, g.type)) return card;
    }
  }
  // No single card completes a move — prefer the sticker's own type.
  return energy.find((c) => reactionGame(c.def)?.type === g.type) ?? energy[0] ?? null;
}
