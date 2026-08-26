import type { CardDef, CardInstance, CreatureOnBoard, GameState, PlayerId, PlayerState } from './types.js';
import type { Command } from './commands.js';
import type { GameEvent } from './events.js';
import { checkWin, drawCard, endGame, findCreature, other, sweepDeaths } from './helpers.js';
import { effectTargetSpec, getEffect, isValidTarget } from './effects.js';
import { resolveAttack, resolveBlocks, toggleAttacker } from './combat.js';
import { mergeRules, type RulesConfig } from './rules.js';
import { creatureHasFlag, getSkill, runHook, runRowHook } from './skills.js';
import { tickStatuses } from './statuses.js';

export type CommandResult =
  | { ok: true; state: GameState; events: GameEvent[] }
  | { ok: false; error: string };

export interface GameSetup {
  decks: [CardDef[], CardDef[]];
  names?: [string, string];
  seed?: number;
  /** Partial rules override; merged onto DEFAULT_RULES. */
  rules?: Partial<RulesConfig>;
}

// Small deterministic PRNG (mulberry32) so games are reproducible from a seed.
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function buildDeck(defs: CardDef[], player: PlayerId, rng: () => number, deckSize: number): CardInstance[] {
  const cards = defs.slice(0, deckSize).map((def, i) => ({
    instanceId: `p${player}-${i}`,
    def,
  }));
  // Fisher-Yates shuffle.
  for (let i = cards.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [cards[i], cards[j]] = [cards[j], cards[i]];
  }
  return cards;
}

function makePlayer(id: PlayerId, name: string, deck: CardInstance[], rules: RulesConfig): PlayerState {
  return {
    id,
    name,
    life: rules.startingLife,
    mana: 0,
    maxMana: 0,
    deck,
    hand: [],
    row: new Array(rules.maxRow).fill(null),
    graveyard: [],
    fatigue: 0,
    mulliganUsed: false,
  };
}

/** Create a fresh game. Player 0 always takes the first turn. */
export function createGame(setup: GameSetup): { state: GameState; events: GameEvent[] } {
  const seed = setup.seed ?? Math.floor(Math.random() * 0xffffffff);
  const rng = mulberry32(seed);
  const names = setup.names ?? ['Player 1', 'Player 2'];
  const rules = mergeRules(setup.rules);

  const state: GameState = {
    players: [
      makePlayer(0, names[0], buildDeck(setup.decks[0], 0, rng, rules.deckSize), rules),
      makePlayer(1, names[1], buildDeck(setup.decks[1], 1, rng, rules.deckSize), rules),
    ],
    active: 0,
    phase: 'main1',
    turn: 0,
    gameOver: false,
    winner: null,
    seed,
    rules,
    nextTokenId: 0,
    attackers: [],
    blocks: [],
  };

  const events: GameEvent[] = [{ type: 'gameStarted' }];
  for (const p of state.players) {
    for (let i = 0; i < rules.openingHand; i++) drawCard(state, p.id, events);
  }
  startTurn(state, 0, events);
  return { state, events };
}

function startTurn(state: GameState, player: PlayerId, events: GameEvent[]): void {
  // The outgoing player's end-of-turn skills fire before the turn flips
  // (skipped on game setup, when no turn has happened yet).
  if (state.turn > 0) {
    runRowHook('onEndTurn', state, state.active, events);
    sweepDeaths(state, events);
    checkWin(state, events);
    if (state.gameOver) return;
  }
  state.active = player;
  state.turn += 1;
  state.phase = 'main1';
  state.attackers = [];
  state.blocks = [];

  const p = state.players[player];
  p.maxMana = Math.min(p.maxMana + 1, state.rules.manaCap);
  p.mana = p.maxMana;
  for (const c of p.row) {
    if (c) {
      c.ready = true;
      c.attacksUsed = 0;
    }
  }

  events.push({ type: 'turnStarted', player, turn: state.turn });
  // By default the very first turn skips the draw (small first-player nerf).
  if (state.turn > 1 || state.rules.firstPlayerDraws) drawCard(state, player, events);
  // Turn-start skills (e.g. Regenerate), then status ticks (Poison, thawing
  // Frozen) on the active player's creatures.
  for (const c of p.row) {
    if (c) runHook('onTurnStart', state, player, c, events);
  }
  for (const c of p.row) {
    if (c) tickStatuses(state, player, c, events);
  }
  sweepDeaths(state, events);
  checkWin(state, events); // fatigue damage from the draw can end the game
  events.push({ type: 'phaseChanged', player, phase: 'main1' });
}

/**
 * Validate and apply one command to a game state. Pure: the input state is
 * never mutated; on success a new state plus the resulting events is returned.
 */
export function applyCommand(state: GameState, cmd: Command): CommandResult {
  if (state.gameOver) return { ok: false, error: 'The game is over' };

  if (cmd.type === 'concede') {
    const next = structuredClone(state);
    const events: GameEvent[] = [];
    endGame(next, other(cmd.player), `${next.players[cmd.player].name} conceded`, events);
    return { ok: true, state: next, events };
  }

  // Mulligans are decided during the first round by BOTH players, so this
  // command (like concede) is exempt from the active-player check.
  if (cmd.type === 'mulligan') {
    if (!state.rules.mulligan) return { ok: false, error: 'Mulligans are not allowed by these rules' };
    if (state.turn > 2) return { ok: false, error: 'Mulligans are only available in the first round' };
    if (state.players[cmd.player].mulliganUsed) return { ok: false, error: 'You already mulliganed' };
    const next = structuredClone(state);
    const events: GameEvent[] = [];
    const me = next.players[cmd.player];
    me.mulliganUsed = true;
    const count = me.hand.length;
    me.deck.push(...me.hand.splice(0));
    // Deterministic reshuffle derived from the game seed and the player.
    const rng = mulberry32((next.seed ^ (0x9e3779b9 * (cmd.player + 1))) >>> 0);
    for (let i = me.deck.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [me.deck[i], me.deck[j]] = [me.deck[j], me.deck[i]];
    }
    events.push({ type: 'mulligan', player: cmd.player, count });
    for (let i = 0; i < count; i++) drawCard(next, cmd.player, events);
    return { ok: true, state: next, events };
  }

  // Blockers-style combat: during the block phase the DEFENDER acts (the
  // only exception to "commands come from the active player").
  if (cmd.type === 'declareBlockers') {
    if (state.rules.combatStyle !== 'blockers') return { ok: false, error: 'These rules have no block step' };
    if (state.phase !== 'block') return { ok: false, error: 'There is nothing to block right now' };
    if (cmd.player !== other(state.active)) return { ok: false, error: 'Only the defender declares blockers' };
    const next = structuredClone(state);
    const events: GameEvent[] = [];
    const error = resolveBlocks(next, cmd.player, cmd.blocks, events);
    if (error) return { ok: false, error };
    return { ok: true, state: next, events };
  }

  if (cmd.player !== state.active) return { ok: false, error: 'It is not your turn' };
  if (state.phase === 'block') return { ok: false, error: 'Waiting for the defender to declare blockers' };

  const next = structuredClone(state);
  const events: GameEvent[] = [];
  const me = next.players[cmd.player];

  switch (cmd.type) {
    case 'playCard': {
      if (next.phase !== 'main1' && next.phase !== 'main2') {
        return { ok: false, error: 'Cards can only be played in a main phase' };
      }
      const handIndex = me.hand.findIndex((c) => c.instanceId === cmd.instanceId);
      if (handIndex === -1) return { ok: false, error: 'Card not in hand' };
      const card = me.hand[handIndex];
      const def = card.def;
      if (def.cost > me.mana) return { ok: false, error: 'Not enough mana' };

      if (def.type === 'creature') {
        let slot = cmd.slot ?? me.row.findIndex((s) => s === null);
        if (slot < 0 || slot >= me.row.length) return { ok: false, error: 'No free slot' };
        if (me.row[slot] !== null) {
          const free = me.row.findIndex((s) => s === null);
          if (free === -1) return { ok: false, error: 'Your row is full' };
          slot = free;
        }
        const creature: CreatureOnBoard = {
          instanceId: card.instanceId,
          def,
          attack: def.attack ?? 0,
          health: def.health ?? 1,
          maxHealth: def.health ?? 1,
          ready: !next.rules.summoningSickness,
          attacksUsed: 0,
          equipment: [],
          statuses: [],
        };
        me.hand.splice(handIndex, 1);
        me.mana -= def.cost;
        me.row[slot] = creature;
        events.push({ type: 'cardPlayed', player: cmd.player, cardName: def.name, cardType: 'creature', def });
        events.push({ type: 'creatureSummoned', player: cmd.player, instanceId: card.instanceId, slot, cardName: def.name });
        // Haste-like skills let it act immediately despite summoning sickness.
        if (!creature.ready && creatureHasFlag(creature, 'grantsSummonReady')) {
          creature.ready = true;
          const haste = getSkill('haste');
          events.push({
            type: 'skillTriggered', player: cmd.player, instanceId: creature.instanceId,
            cardName: def.name, skill: haste?.name ?? 'Haste', icon: haste?.icon ?? '⚡',
          });
        }
        runHook('onSummon', next, cmd.player, creature, events);
      } else if (def.type === 'equipment') {
        const target = cmd.target;
        if (!target || target.kind !== 'creature') return { ok: false, error: 'Equipment needs a friendly creature target' };
        const found = findCreature(next, target.instanceId);
        if (!found || found.owner !== cmd.player) return { ok: false, error: 'Equipment must attach to a friendly creature' };
        me.hand.splice(handIndex, 1);
        me.mana -= def.cost;
        found.creature.equipment.push(card);
        found.creature.attack += def.attackBonus ?? 0;
        found.creature.health += def.healthBonus ?? 0;
        found.creature.maxHealth += def.healthBonus ?? 0;
        events.push({ type: 'cardPlayed', player: cmd.player, cardName: def.name, cardType: 'equipment', def });
        events.push({ type: 'equipmentAttached', player: cmd.player, targetInstanceId: target.instanceId, cardName: def.name });
        // Equipment can grant readiness skills (e.g. Haste) to a sick creature.
        if (!found.creature.ready && creatureHasFlag(found.creature, 'grantsSummonReady')) {
          found.creature.ready = true;
        }
        // Equipment may also carry an on-attach effect aimed at its wearer.
        if (def.effect) {
          const entry = getEffect(def.effect.key);
          entry?.handler({ state: next, caster: cmd.player, target, amount: def.effect.amount ?? 0, events });
        }
      } else {
        // Spell
        if (!def.effect) return { ok: false, error: 'This spell has no effect defined' };
        const entry = getEffect(def.effect.key);
        if (!entry) return { ok: false, error: `Unknown effect '${def.effect.key}'` };
        const target = cmd.target ?? { kind: 'none' as const };
        if (!isValidTarget(next, cmd.player, effectTargetSpec(def.effect), target)) {
          return { ok: false, error: 'Invalid target for that spell' };
        }
        me.hand.splice(handIndex, 1);
        me.mana -= def.cost;
        me.graveyard.push(card);
        events.push({ type: 'cardPlayed', player: cmd.player, cardName: def.name, cardType: 'spell', def });
        events.push({ type: 'spellCast', player: cmd.player, cardName: def.name });
        entry.handler({ state: next, caster: cmd.player, target, amount: def.effect.amount ?? 0, events });
      }

      sweepDeaths(next, events);
      checkWin(next, events);
      return { ok: true, state: next, events };
    }

    case 'attack': {
      if (next.phase !== 'combat') return { ok: false, error: 'Attacks only happen in the combat phase' };
      // Blockers mode: 'attack' toggles the creature as a declared attacker;
      // damage waits for the block step. Targeted mode: resolve immediately.
      const error =
        next.rules.combatStyle === 'blockers'
          ? toggleAttacker(next, cmd.player, cmd.attackerId, events)
          : resolveAttack(next, cmd.player, cmd.attackerId, cmd.target, events);
      if (error) return { ok: false, error };
      return { ok: true, state: next, events };
    }

    case 'advancePhase': {
      if (next.phase === 'main1') {
        next.phase = 'combat';
        events.push({ type: 'phaseChanged', player: cmd.player, phase: 'combat' });
      } else if (next.phase === 'combat') {
        if (next.rules.combatStyle === 'blockers' && next.attackers.length > 0) {
          const defender = other(cmd.player);
          if (next.players[defender].row.some((c) => c !== null)) {
            // Hand the decision to the defender.
            next.phase = 'block';
            events.push({ type: 'phaseChanged', player: cmd.player, phase: 'block' });
          } else {
            // Nothing can block — resolve straight to the face.
            resolveBlocks(next, defender, [], events);
          }
        } else {
          next.attackers = [];
          next.phase = 'main2';
          events.push({ type: 'phaseChanged', player: cmd.player, phase: 'main2' });
        }
      } else {
        startTurn(next, other(cmd.player), events);
      }
      return { ok: true, state: next, events };
    }

    case 'endTurn': {
      startTurn(next, other(cmd.player), events);
      return { ok: true, state: next, events };
    }
  }
}
