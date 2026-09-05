import type { CreatureOnBoard, GameState, PlayerId } from '../types.js';
import type { Command } from '../commands.js';
import type { GameEvent } from '../events.js';
import type { CommandResult } from '../engine.js';
import { drawCard, endGame, other } from '../helpers.js';
import { applyDamage } from '../damage.js';
import { statusBlocksAttack, statusBlocksSwap, tickStatuses } from '../statuses.js';
import { coversCost, freshTurnFlags, isBasicSticker, reactionGame, stickerGame, trainerGame } from './types.js';
import type { EffectOp, ReactionType } from './types.js';
import { flipCoin } from './rng.js';
import { allPassives, channelOps, effectiveBenchSize, effectiveSwapCost, hasOp, matchFilter, passiveOps, sumOp } from './passives.js';
import {
  archiveSticker, benchStickers, discardEnergyFrom, makeBoardSticker, placeDamage,
} from './board.js';
import { attachEnergyCard, evolveInto, exchangeActive, runOps, runTraitTrigger, type OpContext } from './ops.js';
import './conditions.js';

/**
 * The Pokémon-TCG-style rules engine (rules.gameMode 'pokemon').
 *
 * Board mapping: row[0] is the ACTIVE sticker, row[1..] the BENCH. `life`
 * mirrors prizes remaining so the standard HUD heart stays meaningful.
 * A turn is: draw -> main (bench, evolve, attach one energy, trainers,
 * traits, one retreat) -> attack, which ends the turn. Special Conditions
 * tick BETWEEN turns; knockouts award prizes and demand a promotion.
 */

/** Called by createGame instead of the standard opening. */
export function initPokemonGame(state: GameState, events: GameEvent[], rng: () => number): void {
  state.phase = 'setup';
  state.setupDone = [false, false];
  state.pendingPromote = null;
  state.channel = null;
  state.rngCursor = 0;
  for (const p of state.players) {
    // One slot of Bench headroom so a benchSize +1 Stadium fits.
    p.row = new Array(state.rules.maxRow + 1).fill(null);
    p.life = state.rules.prizes;
    p.prizes = [];
    p.prizesTaken = 0;
    p.turnFlags = freshTurnFlags();
    // Opening hand must contain a basic sticker — redraw until it does.
    for (let attempt = 0; attempt < 24; attempt++) {
      for (let i = 0; i < state.rules.openingHand && p.deck.length > 0; i++) p.hand.push(p.deck.shift()!);
      if (p.hand.some((c) => isBasicSticker(c.def))) break;
      p.deck.push(...p.hand.splice(0));
      for (let i = p.deck.length - 1; i > 0; i--) {
        const j = Math.floor(rng() * (i + 1));
        [p.deck[i], p.deck[j]] = [p.deck[j], p.deck[i]];
      }
    }
    events.push(...p.hand.map(() => ({ type: 'cardDrawn', player: p.id } as GameEvent)));
    // Prizes come off the top, face down.
    p.prizes = p.deck.splice(0, Math.min(state.rules.prizes, Math.max(0, p.deck.length - 1)));
  }
}

function active(state: GameState, player: PlayerId): CreatureOnBoard | null {
  return state.players[player].row[0];
}

function startTurn(state: GameState, player: PlayerId, events: GameEvent[]): void {
  state.active = player;
  state.turn += 1;
  state.phase = 'main1';
  const p = state.players[player];
  p.turnFlags = freshTurnFlags();
  for (const c of p.row) {
    if (c) c.traitUsed = false;
  }
  events.push({ type: 'turnStarted', player, turn: state.turn });
  // Utility statuses (Boosted, Protected, swap locks) tick down here;
  // Special Conditions have no duration and tick between turns instead.
  for (const c of p.row) {
    if (c) tickStatuses(state, player, c, events);
  }
  if (state.turn > 1 || state.rules.firstPlayerDraws) drawCard(state, player, events);
  if (state.gameOver) return;
  for (const c of p.row) {
    if (c) runTraitTrigger(state, player, c, 'onTurnStart', events);
  }
  // Stadium free draws (Public Group): auto-taken when the condition holds.
  for (const op of channelOps(state, player)) {
    if (op.op !== 'conditionalDraw' || p.turnFlags.stadiumDraw) continue;
    const cond = (op.condition ?? {}) as Record<string, unknown>;
    const act = active(state, player);
    if (cond.activeStage !== undefined && stickerGame(act?.def ?? {})?.stageIndex !== cond.activeStage) continue;
    p.turnFlags.stadiumDraw = true;
    drawCard(state, player, events);
  }
  events.push({ type: 'phaseChanged', player, phase: 'main1' });
}

/** Between-turns Special Condition checks, then hand the turn over. */
function endTurn(state: GameState, events: GameEvent[]): void {
  const ending = state.active;
  // Premium-Boost-style reactions discard themselves at turn end.
  for (const c of state.players[ending].row) {
    if (!c?.reactions) continue;
    for (let i = c.reactions.length - 1; i >= 0; i--) {
      const fx = reactionGame(c.reactions[i].def)?.effects ?? [];
      if (fx.some((op) => op.op === 'discardSelf')) {
        state.players[ending].graveyard.push(...c.reactions.splice(i, 1));
        events.push({ type: 'energyDiscarded', player: ending, instanceId: c.instanceId, count: 1 });
      }
    }
  }
  for (const player of [ending, other(ending)] as PlayerId[]) {
    const c = active(state, player);
    if (!c) continue;
    const enemyBoard = state.players[other(player)].row.filter((x): x is CreatureOnBoard => x !== null);
    for (const ref of [...c.statuses]) {
      if (ref.key === 'spammed') {
        let tick = ref.value ?? 10;
        for (const e of enemyBoard) tick += sumOp(passiveOps(e).filter((o) => matchesStatus(o, 'spammed')), 'statusAmplify');
        placeDamage(state, player, c, tick, events);
      } else if (ref.key === 'flamed') {
        placeDamage(state, player, c, ref.value ?? 20, events);
        if (c.health > 0 && flipCoin(state, player, events, 'recover')) removeStatus(c, player, 'flamed', events);
      } else if (ref.key === 'muted') {
        // Night Owl locks recovery; Night Mode demands extra heads.
        const enemyActive = active(state, other(player));
        const locked = enemyActive && passiveOps(enemyActive).some((o) => o.op === 'statusLock' && matchesStatus(o, 'muted'));
        if (locked) continue;
        let flips = 1;
        for (const op of channelOps(state, player)) {
          if (op.op === 'statusHarder' && matchesStatus(op, 'muted') && typeof op.flips === 'number') flips = op.flips;
        }
        let allHeads = true;
        for (let i = 0; i < flips; i++) {
          if (!flipCoin(state, player, events, 'wake')) allHeads = false;
        }
        if (allHeads) removeStatus(c, player, 'muted', events);
      } else if (ref.key === 'lagging' && player === ending) {
        // Paralysis clears at the end of its owner's own turn.
        removeStatus(c, player, 'lagging', events);
      }
    }
  }
  sweep(state, events);
  if (state.gameOver) return;
  if (state.pendingPromote != null) {
    state.endTurnAfterPromote = true;
    return;
  }
  startTurn(state, other(ending), events);
}

function matchesStatus(op: EffectOp, key: string): boolean {
  return typeof op.status === 'string' && op.status.toLowerCase() === key;
}

function removeStatus(c: CreatureOnBoard, owner: PlayerId, key: string, events: GameEvent[]): void {
  const i = c.statuses.findIndex((s) => s.key === key);
  if (i === -1) return;
  c.statuses.splice(i, 1);
  events.push({ type: 'statusExpired', player: owner, instanceId: c.instanceId, status: key, icon: '' });
}

/**
 * Knockout sweep: archive the fallen, award prizes, queue promotions, and
 * settle wins. `attacker` is the move context for onKOOpponent triggers.
 */
function sweep(
  state: GameState,
  events: GameEvent[],
  attacker?: { creature: CreatureOnBoard; owner: PlayerId }
): void {
  for (const p of state.players) {
    for (let slot = 0; slot < p.row.length; slot++) {
      const c = p.row[slot];
      if (!c || c.health > 0) continue;
      runTraitTrigger(state, p.id, c, 'onKO', events);
      p.row[slot] = null;
      archiveSticker(state, p.id, c);
      events.push({ type: 'creatureDied', player: p.id, instanceId: c.instanceId, cardName: c.def.name });
      const game = stickerGame(c.def);
      const taker = other(p.id);
      const t = state.players[taker];
      const count = Math.min(game?.starsOnKO ?? (game?.star ? state.rules.starPrizes : 1), t.prizes?.length ?? 0);
      if (count > 0 && t.prizes) {
        t.hand.push(...t.prizes.splice(0, count));
        t.prizesTaken = (t.prizesTaken ?? 0) + count;
        t.life = t.prizes.length;
        events.push({ type: 'prizeTaken', player: taker, count, remaining: t.prizes.length });
      }
      if (attacker && attacker.owner !== p.id && attacker.creature.health > 0) {
        runTraitTrigger(state, attacker.owner, attacker.creature, 'onKOOpponent', events);
      }
    }
  }
  if (state.gameOver) return;
  // Wins: last prize taken, or nothing left to promote.
  for (const p of state.players) {
    if ((p.prizes?.length ?? 0) === 0 && (p.prizesTaken ?? 0) > 0) {
      endGame(state, p.id, `${p.name} took their last prize`, events);
      return;
    }
  }
  for (const p of state.players) {
    if (p.row[0] === null) {
      if (benchStickers(state, p.id).length === 0) {
        endGame(state, other(p.id), `${p.name} has nothing left to promote`, events);
        return;
      }
      if (state.pendingPromote == null) state.pendingPromote = p.id;
    }
  }
}

/** Whether an extra energy attachment is available for this target. */
function extraAttachAllowed(state: GameState, player: PlayerId, target: CreatureOnBoard, targetSlot: number, card: { special?: boolean; type?: ReactionType }): boolean {
  const flags = state.players[player].turnFlags;
  if (!flags || flags.extraAttach) return false;
  const grants: EffectOp[] = [...channelOps(state, player)];
  for (const c of state.players[player].row) {
    if (c) grants.push(...passiveOps(c));
  }
  for (const op of grants) {
    if (op.op !== 'extraAttach') continue;
    if (op.scope === 'active' && targetSlot !== 0) continue;
    if (op.scope === 'bench' && targetSlot === 0) continue;
    if (op.matchType === true) {
      if (card.special) continue;
      const activeType = stickerGame(active(state, player)?.def ?? {})?.type;
      if (!activeType || card.type !== activeType) continue;
    }
    return true;
  }
  return false;
}

/** Everything below runs on a fresh clone; concede is handled by the caller. */
export function applyPokemonCommand(state: GameState, cmd: Command): CommandResult {
  // ---- Setup phase: both players place an opening board ----
  if (cmd.type === 'setup') {
    if (state.phase !== 'setup') return { ok: false, error: 'The game is already set up' };
    if (state.setupDone?.[cmd.player]) return { ok: false, error: 'You already set up' };
    const next = structuredClone(state);
    const events: GameEvent[] = [];
    const me = next.players[cmd.player];
    const pinned = me.hand.find((c) => c.instanceId === cmd.pinnedId);
    if (!pinned || !isBasicSticker(pinned.def)) return { ok: false, error: 'Pick a basic sticker for your Active spot' };
    me.hand.splice(me.hand.indexOf(pinned), 1);
    me.row[0] = makeBoardSticker(pinned, 0);
    const benchIds = [...new Set(cmd.benchIds ?? [])];
    let slot = 1;
    for (const id of benchIds) {
      if (slot > next.rules.maxRow - 1) break;
      const card = me.hand.find((c) => c.instanceId === id);
      if (!card || !isBasicSticker(card.def)) continue;
      me.hand.splice(me.hand.indexOf(card), 1);
      me.row[slot] = makeBoardSticker(card, 0);
      slot += 1;
    }
    next.setupDone![cmd.player] = true;
    events.push({ type: 'playerReady', player: cmd.player });
    if (next.setupDone![0] && next.setupDone![1]) {
      events.push({ type: 'gameStarted' });
      startTurn(next, 0, events);
    }
    return { ok: true, state: next, events };
  }
  if (state.phase === 'setup') return { ok: false, error: 'Waiting for both players to set up' };

  // ---- Promotion after a knockout (sent by whoever lost their Active) ----
  if (cmd.type === 'promote') {
    if (state.pendingPromote !== cmd.player) return { ok: false, error: 'You have nothing to promote' };
    const next = structuredClone(state);
    const events: GameEvent[] = [];
    const bench = benchStickers(next, cmd.player);
    const picked = bench.find((c) => c.instanceId === cmd.targetInstanceId);
    if (!picked) return { ok: false, error: 'Promote one of your Bench stickers' };
    const row = next.players[cmd.player].row;
    const slot = row.indexOf(picked);
    row[0] = picked;
    row[slot] = null;
    events.push({ type: 'promoted', player: cmd.player, instanceId: picked.instanceId, cardName: picked.def.name });
    next.pendingPromote = null;
    // The other Active may have fallen in the same exchange.
    for (const p of next.players) {
      if (p.row[0] === null && benchStickers(next, p.id).length > 0) next.pendingPromote = p.id;
    }
    if (next.pendingPromote == null && next.endTurnAfterPromote) {
      next.endTurnAfterPromote = false;
      startTurn(next, other(next.active), events);
    }
    return { ok: true, state: next, events };
  }
  if (state.pendingPromote != null) return { ok: false, error: 'Waiting for a promotion' };
  if (cmd.player !== state.active) return { ok: false, error: 'It is not your turn' };

  const next = structuredClone(state);
  const events: GameEvent[] = [];
  const me = next.players[cmd.player];
  const flags = me.turnFlags!;

  switch (cmd.type) {
    case 'playSticker': {
      const i = me.hand.findIndex((c) => c.instanceId === cmd.instanceId);
      if (i === -1) return { ok: false, error: 'Card not in hand' };
      const card = me.hand[i];
      if (!isBasicSticker(card.def)) return { ok: false, error: 'Only basic stickers can be played directly' };
      let slot = cmd.slot;
      if (slot === undefined || slot < 0 || slot >= me.row.length || me.row[slot] !== null) {
        slot = me.row[0] === null ? 0 : me.row.findIndex((s, idx) => idx > 0 && s === null);
      }
      if (slot === -1) return { ok: false, error: 'Your Bench is full' };
      if (slot > 0 && benchStickers(next, cmd.player).length >= effectiveBenchSize(next, cmd.player)) {
        return { ok: false, error: 'Your Bench is full' };
      }
      me.hand.splice(i, 1);
      const creature = makeBoardSticker(card, next.turn);
      me.row[slot] = creature;
      events.push({ type: 'cardPlayed', player: cmd.player, cardName: card.def.name, cardType: 'creature', def: card.def });
      events.push({ type: 'creatureSummoned', player: cmd.player, instanceId: card.instanceId, slot, cardName: card.def.name });
      runTraitTrigger(next, cmd.player, creature, 'onPlay', events);
      sweep(next, events);
      return { ok: true, state: next, events };
    }

    case 'upgrade': {
      const i = me.hand.findIndex((c) => c.instanceId === cmd.instanceId);
      if (i === -1) return { ok: false, error: 'Card not in hand' };
      const card = me.hand[i];
      const game = stickerGame(card.def);
      if (!game || game.stageIndex === 0) return { ok: false, error: 'That card is not an evolution' };
      const target = me.row.find((c) => c?.instanceId === cmd.targetInstanceId);
      if (!target) return { ok: false, error: 'Evolve one of your own stickers' };
      if (game.upgradesFrom !== target.def.id && game.upgradesFrom !== target.def.name) {
        return { ok: false, error: `${card.def.name} does not evolve from ${target.def.name}` };
      }
      if (next.turn <= 2) return { ok: false, error: 'No evolving on your first turn' };
      if ((target.enteredTurn ?? 0) >= next.turn) return { ok: false, error: 'It just came into play — evolve next turn' };
      me.hand.splice(i, 1);
      events.push({ type: 'cardPlayed', player: cmd.player, cardName: card.def.name, cardType: 'creature', def: card.def });
      evolveInto(next, cmd.player, target, card, events);
      runTraitTrigger(next, cmd.player, target, 'onPlay', events);
      return { ok: true, state: next, events };
    }

    case 'attachReaction': {
      const i = me.hand.findIndex((c) => c.instanceId === cmd.instanceId);
      if (i === -1) return { ok: false, error: 'Card not in hand' };
      const card = me.hand[i];
      const game = reactionGame(card.def);
      if (!game) return { ok: false, error: 'That is not an energy card' };
      const slot = me.row.findIndex((c) => c?.instanceId === cmd.targetInstanceId);
      if (slot === -1) return { ok: false, error: 'Attach energy to one of your own stickers' };
      const target = me.row[slot]!;
      if (flags.energy) {
        if (!extraAttachAllowed(next, cmd.player, target, slot, game)) {
          return { ok: false, error: 'You already attached energy this turn' };
        }
        flags.extraAttach = true;
      } else {
        flags.energy = true;
      }
      me.hand.splice(i, 1);
      attachEnergyCard(next, cmd.player, target, card, events);
      sweep(next, events); // Mixed Signals can knock out its own bearer
      return { ok: true, state: next, events };
    }

    case 'attachGift': {
      const i = me.hand.findIndex((c) => c.instanceId === cmd.instanceId);
      if (i === -1) return { ok: false, error: 'Card not in hand' };
      const card = me.hand[i];
      const trainer = trainerGame(card.def);
      if (trainer?.kind !== 'gift') return { ok: false, error: 'That is not a Tool' };
      const target = me.row.find((c) => c?.instanceId === cmd.targetInstanceId);
      if (!target) return { ok: false, error: 'Attach the Tool to one of your own stickers' };
      if (target.gift) return { ok: false, error: 'It already holds a Tool' };
      me.hand.splice(i, 1);
      target.gift = card;
      for (const op of trainer.effects) {
        if (op.op === 'hpBonus' && typeof op.amount === 'number') {
          target.maxHealth += op.amount;
          target.health += op.amount;
        }
      }
      events.push({ type: 'equipmentAttached', player: cmd.player, targetInstanceId: target.instanceId, cardName: card.def.name });
      return { ok: true, state: next, events };
    }

    case 'playTrainer': {
      const i = me.hand.findIndex((c) => c.instanceId === cmd.instanceId);
      if (i === -1) return { ok: false, error: 'Card not in hand' };
      const card = me.hand[i];
      const trainer = trainerGame(card.def);
      if (!trainer || trainer.kind === 'gift') return { ok: false, error: 'Attach Tools with attachGift' };
      if (flags.locked.includes(trainer.kind)) return { ok: false, error: `You can't play another ${trainer.kind} this turn` };
      if (trainer.kind === 'admin') {
        if (flags.supporter) return { ok: false, error: 'One Supporter per turn' };
        if (next.rules.firstTurnNoSupporter && next.turn === 1) return { ok: false, error: 'No Supporters on the very first turn' };
      }
      for (const op of channelOps(next, cmd.player)) {
        if (op.op === 'limitKind' && op.kind === trainer.kind && typeof op.perTurn === 'number') {
          if ((flags.played[trainer.kind] ?? 0) >= op.perTurn) {
            return { ok: false, error: `Only ${op.perTurn} ${trainer.kind} per turn right now` };
          }
        }
      }
      for (const op of trainer.effects) {
        if (op.op === 'condition' && typeof op.prizesTaken === 'number' && (me.prizesTaken ?? 0) !== op.prizesTaken) {
          return { ok: false, error: 'Its play condition is not met' };
        }
      }
      if (trainer.kind === 'channel') {
        if (flags.stadium) return { ok: false, error: 'One Stadium per turn' };
        if (next.channel?.card.def.name === card.def.name) return { ok: false, error: 'That Stadium is already in play' };
        me.hand.splice(i, 1);
        if (next.channel) next.players[next.channel.owner].graveyard.push(next.channel.card);
        next.channel = { card, owner: cmd.player };
        flags.stadium = true;
        events.push({ type: 'cardPlayed', player: cmd.player, cardName: card.def.name, cardType: 'spell', def: card.def });
        events.push({ type: 'channelPlayed', player: cmd.player, cardName: card.def.name });
      } else {
        me.hand.splice(i, 1);
        events.push({ type: 'cardPlayed', player: cmd.player, cardName: card.def.name, cardType: 'spell', def: card.def });
        events.push({ type: 'spellCast', player: cmd.player, cardName: card.def.name });
        const ctx: OpContext = { state: next, events, player: cmd.player, source: active(next, cmd.player), target: cmd.target };
        runOps(trainer.effects, ctx);
        me.graveyard.push(card);
        if (trainer.kind === 'admin') flags.supporter = true;
      }
      flags.played[trainer.kind] = (flags.played[trainer.kind] ?? 0) + 1;
      sweep(next, events);
      return { ok: true, state: next, events };
    }

    case 'useTrait': {
      const creature = me.row.find((c) => c?.instanceId === cmd.instanceId);
      if (!creature) return { ok: false, error: 'Use a trait on one of your own stickers' };
      const trait = stickerGame(creature.def)?.trait;
      if (!trait || trait.trigger !== 'oncePerTurn') return { ok: false, error: 'No usable trait there' };
      if (creature.traitUsed) return { ok: false, error: 'Already used this turn' };
      creature.traitUsed = true;
      events.push({
        type: 'skillTriggered', player: cmd.player, instanceId: creature.instanceId,
        cardName: creature.def.name, skill: trait.name, icon: '✨',
      });
      runOps(trait.effects, { state: next, events, player: cmd.player, source: creature, target: cmd.target });
      sweep(next, events);
      return { ok: true, state: next, events };
    }

    case 'swap': {
      if (flags.swap) return { ok: false, error: 'You already retreated this turn' };
      const act = active(next, cmd.player);
      if (!act) return { ok: false, error: 'No Active sticker' };
      if (statusBlocksSwap(act)) return { ok: false, error: `${act.def.name} cannot retreat right now` };
      const cost = effectiveSwapCost(next, cmd.player, act);
      if ((act.reactions?.length ?? 0) < cost) return { ok: false, error: `Retreating costs ${cost} energy` };
      discardEnergyFrom(next, cmd.player, act, cost, events);
      const error = exchangeActive(next, cmd.player, cmd.targetInstanceId, events);
      if (error) return { ok: false, error };
      flags.swap = true;
      return { ok: true, state: next, events };
    }

    case 'useMove': {
      if (next.rules.firstTurnNoAttack && next.turn === 1) return { ok: false, error: 'No attacking on the very first turn' };
      const att = active(next, cmd.player);
      if (!att) return { ok: false, error: 'No Active sticker' };
      const game = stickerGame(att.def);
      const move = game?.moves[cmd.moveIndex];
      if (!game || !move) return { ok: false, error: 'No such move' };
      if (statusBlocksAttack(att)) return { ok: false, error: `${att.def.name} cannot attack right now` };
      const attached = (att.reactions ?? []).map((r) => reactionGame(r.def) ?? { type: 'Neutral' as ReactionType });
      if (!coversCost(attached, move.cost, game.type)) return { ok: false, error: 'Not enough energy for that move' };

      // Confusion: flip first — tails, the move fails and it hurts itself.
      if (att.statuses.some((s) => s.key === 'glitched') && !flipCoin(next, cmd.player, events, 'glitched')) {
        events.push({ type: 'moveFailed', player: cmd.player, instanceId: att.instanceId, cardName: att.def.name, reason: 'glitched' });
        placeDamage(next, cmd.player, att, 30, events);
        sweep(next, events);
        if (!next.gameOver) endTurn(next, events);
        return { ok: true, state: next, events };
      }

      events.push({ type: 'moveUsed', player: cmd.player, instanceId: att.instanceId, cardName: att.def.name, move: move.name });
      const defender = active(next, other(cmd.player));
      const ctx: OpContext = {
        state: next, events, player: cmd.player, source: att,
        target: cmd.target, defender: defender ?? undefined, dmg: { bonus: 0 },
      };
      runOps(move.effects, ctx, 'pre');

      let amount = move.damage + (ctx.dmg?.bonus ?? 0);
      if (amount > 0 && defender) {
        // Attacker-side bonuses first…
        const mine = allPassives(next, cmd.player, att);
        for (const s of att.statuses) {
          if (s.key === 'boosted') amount += s.value ?? 0;
        }
        amount += sumOp(mine, 'buffDamage');
        amount += sumOp(mine, 'bonusPerBench') * benchStickers(next, cmd.player).length;
        for (const op of mine) {
          if (op.op === 'bonusPerPrizeTaken' && typeof op.amount === 'number') {
            const side = op.side === 'opponent' ? other(cmd.player) : cmd.player;
            amount += op.amount * (next.players[side].prizesTaken ?? 0);
          }
          if (op.op === 'bonusVs' && typeof op.amount === 'number' && matchFilter(defender.def, op.filter)) {
            amount += op.amount;
          }
        }
        // …then weakness ×N and resistance −N on the defender…
        const theirs = allPassives(next, other(cmd.player), defender);
        const dGame = stickerGame(defender.def);
        if (dGame?.weakness === game.type && !hasOp(theirs, 'noWeakness')) amount *= next.rules.weaknessMultiplier;
        if (dGame?.resistance === game.type) amount = Math.max(0, amount - next.rules.resistanceAmount);
        // …then flat protection (Thick Skin).
        amount = Math.max(0, amount - sumOp(theirs, 'armor'));
        const dealt = applyDamage(next, att, defender, amount, events, true);
        if (dealt > 0) {
          runTraitTrigger(next, other(cmd.player), defender, 'onDamaged', events, { attacker: att });
          const giftFx = defender.gift ? trainerGame(defender.gift.def)?.effects ?? [] : [];
          runOps(giftFx.filter((op) => op.op === 'drawOnDamaged'), { state: next, events, player: other(cmd.player), source: defender });
        }
      }
      runOps(move.effects, ctx, 'post');
      sweep(next, events, { creature: att, owner: cmd.player });
      if (!next.gameOver) endTurn(next, events);
      return { ok: true, state: next, events };
    }

    case 'endTurn': {
      endTurn(next, events);
      return { ok: true, state: next, events };
    }

    default:
      return { ok: false, error: 'Not available under these rules' };
  }
}
