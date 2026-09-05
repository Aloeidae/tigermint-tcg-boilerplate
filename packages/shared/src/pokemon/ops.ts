import type { CardInstance, CreatureOnBoard, EffectTarget, GameState, PlayerId } from '../types.js';
import type { GameEvent } from '../events.js';
import { drawCard, findCreature, other } from '../helpers.js';
import { applyStatus } from '../statuses.js';
import type { EffectOp } from './types.js';
import { isBasicSticker, reactionGame, stickerGame } from './types.js';
import { flipCoin, shuffleDeck } from './rng.js';
import { allPassives, hasOp, matchFilter } from './passives.js';
import {
  applyCondition, benchStickers, clearConditions, conditionKey,
  discardEnergyFrom, discardGift, healSticker, makeBoardSticker, placeDamage,
} from './board.js';

/**
 * The effect-DSL interpreter for the pokemon game mode — the registry that
 * makes move text, Items, Supporters, Stadiums, Tools, and Traits data
 * instead of code. Each `op` in a card's `effects` array looks up a handler
 * here; register your own with registerOp() and reference it from card data.
 *
 * PASSIVE ops (armor, noWeakness, swap-cost modifiers…) have no handler —
 * the engine queries them where they matter (see passives.ts) — so the
 * interpreter skips them silently.
 *
 * Search/choice ops auto-pick a sensible option instead of pausing the game
 * for a selection UI; the picks are deterministic, so replays stay exact.
 */

export interface OpContext {
  state: GameState;
  events: GameEvent[];
  /** The side running the effect. */
  player: PlayerId;
  /** The bearer: the attacker for move text, the trait/Tool holder for triggers. */
  source: CreatureOnBoard | null;
  /** A choice supplied with the command (heal target, gust pick…). */
  target?: EffectTarget;
  /** Move context: the enemy Active the move hit. */
  defender?: CreatureOnBoard;
  /** Damaged-trigger context: who dealt the triggering damage. */
  attacker?: CreatureOnBoard;
  /** Move damage accumulator — present only during the pre-damage pass. */
  dmg?: { bonus: number };
  /** The last creature an op touched (lets a later op chain onto it). */
  affected?: CreatureOnBoard | null;
}

export type OpHandler = (op: EffectOp, ctx: OpContext) => void;

const ops = new Map<string, OpHandler>();

export function registerOp(name: string, handler: OpHandler): void {
  ops.set(name, handler);
}

/** Ops the engine queries as standing modifiers instead of running.
 *  (thorns/drawOnDamaged/moveAllEnergyOnKO run too, but only inside their
 *  trigger contexts — their handlers no-op without one.) */
const PASSIVE_OPS = new Set([
  'armor', 'taunt', 'benchImmune', 'noWeakness', 'statusImmune', 'statusLock',
  'statusAmplify', 'statusHarder', 'swapCost', 'swapCostDelta', 'opponentSwapCost',
  'extraAttach', 'bonusPerBench', 'bonusPerPrizeTaken', 'bonusVs', 'hpBonus',
  'benchSize', 'limitKind', 'conditionalDraw', 'condition', 'priority', 'discardSelf',
]);

/** Ops that shape a move's damage — run before damage, skipped after. */
const PRE_DAMAGE_OPS = new Set(['flipBonus', 'flipDamage']);

export function runOps(list: EffectOp[] | undefined, ctx: OpContext, pass: 'pre' | 'post' | 'all' = 'all'): void {
  for (const op of list ?? []) {
    if (ctx.state.gameOver) return;
    const isPre = PRE_DAMAGE_OPS.has(op.op);
    if (pass === 'pre' && !isPre) continue;
    if (pass === 'post' && isPre) continue;
    if (pass !== 'pre' && PASSIVE_OPS.has(op.op)) continue;
    const handler = ops.get(op.op);
    if (handler) handler(op, ctx);
    // Unknown ops no-op by design: data from a newer generator degrades
    // gracefully instead of crashing an older engine.
  }
}

// --- shared little helpers -------------------------------------------------

const num = (v: unknown, fallback = 0): number => (typeof v === 'number' && Number.isFinite(v) ? v : fallback);

function opponentActive(ctx: OpContext): CreatureOnBoard | null {
  return ctx.state.players[other(ctx.player)].row[0];
}

function targetCreature(ctx: OpContext): { creature: CreatureOnBoard; owner: PlayerId } | null {
  if (ctx.target?.kind !== 'creature') return null;
  const found = findCreature(ctx.state, ctx.target.instanceId);
  return found ? { creature: found.creature, owner: found.owner } : null;
}

function ownerOf(ctx: OpContext, creature: CreatureOnBoard): PlayerId {
  return findCreature(ctx.state, creature.instanceId)?.owner ?? ctx.player;
}

function takeFromDeck(
  ctx: OpContext,
  player: PlayerId,
  filter: unknown,
  count: number,
  each: (card: CardInstance) => void
): number {
  const deck = ctx.state.players[player].deck;
  let taken = 0;
  for (let i = 0; i < deck.length && taken < count; ) {
    if (matchFilter(deck[i].def, filter)) {
      each(deck.splice(i, 1)[0]);
      taken += 1;
    } else {
      i += 1;
    }
  }
  if (taken > 0) shuffleDeck(ctx.state, player);
  return taken;
}

/** Swap a player's Active with one of their Bench stickers. */
export function exchangeActive(
  state: GameState,
  player: PlayerId,
  benchInstanceId: string,
  events: GameEvent[]
): string | null {
  const row = state.players[player].row;
  const slot = row.findIndex((c, i) => i > 0 && c?.instanceId === benchInstanceId);
  if (slot === -1) return 'That sticker is not on the Bench';
  const active = row[0];
  const incoming = row[slot]!;
  row[0] = incoming;
  row[slot] = active;
  if (active) clearConditions(active, player, events);
  events.push({ type: 'swapped', player, instanceId: incoming.instanceId, cardName: incoming.def.name });
  return null;
}

/** Attach an energy card to a sticker, running its on-attach effects. */
export function attachEnergyCard(
  state: GameState,
  owner: PlayerId,
  creature: CreatureOnBoard,
  card: CardInstance,
  events: GameEvent[]
): void {
  (creature.reactions ??= []).push(card);
  events.push({
    type: 'energyAttached', player: owner, targetInstanceId: creature.instanceId,
    cardName: card.def.name, targetName: creature.def.name,
  });
  const game = reactionGame(card.def);
  for (const op of game?.effects ?? []) {
    // e.g. Mixed Signals: 10 damage to the sticker it lands on.
    if (op.op === 'selfDamage' && op.when === 'onAttach') {
      placeDamage(state, owner, creature, num(op.amount, 10), events);
    }
  }
}

// --- damage-shaping ops (pre-damage pass) ----------------------------------

registerOp('flipBonus', (op, ctx) => {
  if (!ctx.dmg) return;
  if (flipCoin(ctx.state, ctx.player, ctx.events, 'bonus')) ctx.dmg.bonus += num(op.bonus);
});

registerOp('flipDamage', (op, ctx) => {
  if (!ctx.dmg) return;
  let heads = 0;
  for (let i = 0; i < num(op.flips, 1); i++) {
    if (flipCoin(ctx.state, ctx.player, ctx.events, 'damage')) heads += 1;
  }
  ctx.dmg.bonus += heads * num(op.perHeads);
});

// --- conditions ------------------------------------------------------------

registerOp('status', (op, ctx) => {
  const key = conditionKey(op.status);
  if (!key) return;
  let victim = opponentActive(ctx);
  let victimOwner: PlayerId = other(ctx.player);
  if (op.target === 'self' && ctx.source) {
    victim = ctx.source;
    victimOwner = ctx.player;
  }
  if (!victim) return;
  applyCondition(ctx.state, victimOwner, victim, key, ctx.events, typeof op.amount === 'number' ? op.amount : undefined);
});

registerOp('flipStatus', (op, ctx) => {
  if (!flipCoin(ctx.state, ctx.player, ctx.events, 'status')) return;
  ops.get('status')!(op, ctx);
});

registerOp('lockSwap', (_op, ctx) => {
  const victim = opponentActive(ctx);
  if (victim) applyStatus(ctx.state, other(ctx.player), victim, { key: 'swaplock', turns: 1 }, ctx.events);
});

registerOp('noAttack', (_op, ctx) => {
  const victim = ctx.affected ?? ctx.source;
  if (victim) applyStatus(ctx.state, ownerOf(ctx, victim), victim, { key: 'noattack', turns: 0 }, ctx.events);
});

registerOp('buffDamage', (op, ctx) => {
  if (op.duration === 'attached') return; // standing bonus, read as a passive
  const bearer = ctx.source ?? ctx.state.players[ctx.player].row[0];
  if (bearer) applyStatus(ctx.state, ctx.player, bearer, { key: 'boosted', value: num(op.amount), turns: 0 }, ctx.events);
});

registerOp('reduceDamageNextTurn', (op, ctx) => {
  const bearer = ctx.source;
  if (bearer) applyStatus(ctx.state, ctx.player, bearer, { key: 'protected', value: num(op.amount), turns: 0 }, ctx.events);
});

registerOp('protect', (_op, ctx) => {
  const bearer = ctx.source;
  if (bearer) applyStatus(ctx.state, ctx.player, bearer, { key: 'protected', value: 9999, turns: 0 }, ctx.events);
});

// --- direct damage / healing ----------------------------------------------

registerOp('selfDamage', (op, ctx) => {
  if (op.when === 'onAttach') return; // handled by attachEnergyCard
  if (ctx.source) placeDamage(ctx.state, ctx.player, ctx.source, num(op.amount), ctx.events);
});

registerOp('benchDamage', (op, ctx) => {
  const enemy = other(ctx.player);
  const bench = benchStickers(ctx.state, enemy).filter(
    (c) => !hasOp(allPassives(ctx.state, enemy, c), 'benchImmune')
  );
  // Prefer a command-picked target, then taunt bearers, then the frailest.
  const picked = targetCreature(ctx);
  const order = bench.sort((a, b) => a.health - b.health);
  if (picked && bench.includes(picked.creature)) {
    order.splice(order.indexOf(picked.creature), 1);
    order.unshift(picked.creature);
  } else {
    const taunt = order.find((c) => hasOp(allPassives(ctx.state, enemy, c), 'taunt'));
    if (taunt) {
      order.splice(order.indexOf(taunt), 1);
      order.unshift(taunt);
    }
  }
  for (const victim of order.slice(0, num(op.targets, 1))) {
    placeDamage(ctx.state, enemy, victim, num(op.amount), ctx.events);
  }
});

registerOp('thorns', (op, ctx) => {
  // Damaged-trigger context: sting whoever just hit the bearer.
  if (ctx.attacker) placeDamage(ctx.state, ownerOf(ctx, ctx.attacker), ctx.attacker, num(op.amount, 10), ctx.events);
});

registerOp('heal', (op, ctx) => {
  const amount = num(op.amount);
  const mine = ctx.state.players[ctx.player];
  const target = op.target ?? 'self';
  if (target === 'all') {
    for (const c of mine.row) if (c) healSticker(ctx.state, ctx.player, c, amount, ctx.events);
    return;
  }
  let creature: CreatureOnBoard | null = null;
  if (target === 'self') creature = ctx.source ?? mine.row[0];
  else if (target === 'active') creature = mine.row[0];
  else {
    // 'choose': the command's target, else the most damaged friendly sticker.
    const picked = targetCreature(ctx);
    creature =
      picked && picked.owner === ctx.player
        ? picked.creature
        : mine.row
            .filter((c): c is CreatureOnBoard => c !== null && c.health < c.maxHealth)
            .sort((a, b) => a.health / a.maxHealth - b.health / b.maxHealth)[0] ?? null;
  }
  if (creature) healSticker(ctx.state, ctx.player, creature, amount, ctx.events);
});

// --- cards: draw / search / recover ----------------------------------------

registerOp('draw', (op, ctx) => {
  for (let i = 0; i < num(op.count, 1) && !ctx.state.gameOver; i++) drawCard(ctx.state, ctx.player, ctx.events);
});

registerOp('drawTo', (op, ctx) => {
  const me = ctx.state.players[ctx.player];
  const enemy = ctx.state.players[other(ctx.player)];
  const behind = (enemy.prizes?.length ?? 0) > (me.prizes?.length ?? 0);
  const goal = behind && typeof op.ifBehind === 'number' ? op.ifBehind : num(op.count, 1);
  while (me.hand.length < goal && me.deck.length > 0 && !ctx.state.gameOver) {
    drawCard(ctx.state, ctx.player, ctx.events);
  }
});

registerOp('search', (op, ctx) => {
  const me = ctx.state.players[ctx.player];
  takeFromDeck(ctx, ctx.player, op.filter, num(op.count, 1), (card) => {
    me.hand.push(card);
    ctx.events.push({ type: 'cardDrawn', player: ctx.player, cardName: card.def.name });
  });
});

registerOp('searchToBench', (op, ctx) => {
  const me = ctx.state.players[ctx.player];
  takeFromDeck(ctx, ctx.player, { ...(op.filter as object), kind: 'sticker' }, num(op.count, 1), (card) => {
    if (!isBasicSticker(card.def)) {
      me.hand.push(card);
      return;
    }
    const slot = me.row.findIndex((s, i) => i > 0 && s === null);
    if (slot === -1) {
      me.hand.push(card);
      return;
    }
    me.row[slot] = makeBoardSticker(card, ctx.state.turn);
    ctx.events.push({ type: 'creatureSummoned', player: ctx.player, instanceId: card.instanceId, slot, cardName: card.def.name });
  });
});

registerOp('searchEnergy', (op, ctx) => {
  const bearer =
    op.attachTo === 'bench'
      ? benchStickers(ctx.state, ctx.player)[0] ?? ctx.source
      : ctx.source ?? ctx.state.players[ctx.player].row[0];
  if (!bearer) return;
  const ownType = stickerGame(bearer.def)?.type;
  const me = ctx.state.players[ctx.player];
  let attached = 0;
  for (let i = 0; i < me.deck.length && attached < num(op.count, 1); ) {
    const game = reactionGame(me.deck[i].def);
    const matchesType = op.type !== 'own' || !ownType || game?.type === ownType;
    if (game && !game.special && matchesType) {
      attachEnergyCard(ctx.state, ctx.player, bearer, me.deck.splice(i, 1)[0], ctx.events);
      attached += 1;
    } else {
      i += 1;
    }
  }
  if (attached > 0) shuffleDeck(ctx.state, ctx.player);
});

registerOp('searchEvolve', (_op, ctx) => {
  const me = ctx.state.players[ctx.player];
  for (const creature of me.row) {
    if (!creature) continue;
    const i = me.deck.findIndex((card) => {
      const g = stickerGame(card.def);
      return !!g && (g.upgradesFrom === creature.def.id || g.upgradesFrom === creature.def.name);
    });
    if (i !== -1) {
      const card = me.deck.splice(i, 1)[0];
      shuffleDeck(ctx.state, ctx.player);
      evolveInto(ctx.state, ctx.player, creature, card, ctx.events);
      return;
    }
  }
});

registerOp('lookTop', (op, ctx) => {
  const me = ctx.state.players[ctx.player];
  const top = me.deck.slice(0, num(op.count, 1));
  const pick = top.find((card) => matchFilter(card.def, op.take));
  if (pick) {
    me.deck.splice(me.deck.indexOf(pick), 1);
    me.hand.push(pick);
    ctx.events.push({ type: 'cardDrawn', player: ctx.player, cardName: pick.def.name });
  }
  shuffleDeck(ctx.state, ctx.player);
});

registerOp('peekTop', (_op, ctx) => {
  const me = ctx.state.players[ctx.player];
  const top = me.deck[0];
  if (!top) return;
  // Auto-choice: bottom a redundant basic energy, keep anything else.
  const isBasicEnergy = reactionGame(top.def) && !reactionGame(top.def)?.special;
  const energyInHand = me.hand.filter((c) => reactionGame(c.def)).length;
  if (isBasicEnergy && energyInHand >= 2) me.deck.push(me.deck.shift()!);
});

registerOp('recover', (op, ctx) => {
  const me = ctx.state.players[ctx.player];
  let taken = 0;
  for (let i = 0; i < me.graveyard.length && taken < num(op.count, 1); ) {
    if (matchFilter(me.graveyard[i].def, op.filter)) {
      const card = me.graveyard.splice(i, 1)[0];
      me.hand.push(card);
      ctx.events.push({ type: 'cardDrawn', player: ctx.player, cardName: card.def.name });
      taken += 1;
    } else {
      i += 1;
    }
  }
});

registerOp('recoverAttach', (op, ctx) => {
  const me = ctx.state.players[ctx.player];
  const picked = targetCreature(ctx);
  const bearer = picked && picked.owner === ctx.player ? picked.creature : me.row[0];
  if (!bearer) return;
  let taken = 0;
  for (let i = 0; i < me.graveyard.length && taken < num(op.count, 1); ) {
    if (matchFilter(me.graveyard[i].def, op.filter)) {
      attachEnergyCard(ctx.state, ctx.player, bearer, me.graveyard.splice(i, 1)[0], ctx.events);
      taken += 1;
    } else {
      i += 1;
    }
  }
  ctx.affected = bearer;
});

registerOp('moveEnergy', (op, ctx) => {
  const me = ctx.state.players[ctx.player];
  const picked = targetCreature(ctx);
  const to = picked && picked.owner === ctx.player ? picked.creature : me.row[0];
  if (!to) return;
  const from = me.row.find((c) => c && c !== to && (c.reactions?.length ?? 0) > 0);
  if (!from) return;
  for (let i = 0; i < num(op.count, 1); i++) {
    const card = from.reactions?.pop();
    if (!card) break;
    attachEnergyCard(ctx.state, ctx.player, to, card, ctx.events);
  }
});

registerOp('moveAllEnergyOnKO', (_op, ctx) => {
  // KO-trigger context: the bearer is being knocked out.
  if (!ctx.source) return;
  const to = benchStickers(ctx.state, ctx.player)[0];
  if (!to) return;
  const cards = ctx.source.reactions?.splice(0) ?? [];
  for (const card of cards) attachEnergyCard(ctx.state, ctx.player, to, card, ctx.events);
});

registerOp('discardEnergy', (op, ctx) => {
  if (op.from === 'self') {
    if (ctx.source) discardEnergyFrom(ctx.state, ctx.player, ctx.source, num(op.count, 1), ctx.events);
  } else {
    const victim = opponentActive(ctx);
    if (victim) discardEnergyFrom(ctx.state, other(ctx.player), victim, num(op.count, 1), ctx.events);
  }
});

registerOp('discardTool', (op, ctx) => {
  const picked = targetCreature(ctx);
  if (picked && picked.creature.gift) {
    discardGift(ctx.state, picked.owner, picked.creature, ctx.events);
    return;
  }
  for (const pid of [other(ctx.player), ctx.player] as PlayerId[]) {
    const victim = ctx.state.players[pid].row.find((c) => c?.gift);
    if (victim) {
      discardGift(ctx.state, pid, victim, ctx.events);
      return;
    }
  }
});

// --- hands and decks -------------------------------------------------------

registerOp('shuffleHandDraw', (op, ctx) => {
  const me = ctx.state.players[ctx.player];
  me.deck.push(...me.hand.splice(0));
  shuffleDeck(ctx.state, ctx.player);
  for (let i = 0; i < num(op.count, 1) && !ctx.state.gameOver; i++) drawCard(ctx.state, ctx.player, ctx.events);
});

registerOp('opponentShuffleHandDraw', (op, ctx) => {
  const enemy = other(ctx.player);
  const them = ctx.state.players[enemy];
  them.deck.push(...them.hand.splice(0));
  shuffleDeck(ctx.state, enemy);
  for (let i = 0; i < num(op.count, 1) && !ctx.state.gameOver; i++) drawCard(ctx.state, enemy, ctx.events);
});

registerOp('discardHand', (_op, ctx) => {
  const me = ctx.state.players[ctx.player];
  me.graveyard.push(...me.hand.splice(0));
});

registerOp('revealHand', (_op, ctx) => {
  const enemy = other(ctx.player);
  ctx.events.push({
    type: 'handRevealed',
    player: enemy,
    cardNames: ctx.state.players[enemy].hand.map((c) => c.def.name),
  });
});

registerOp('opponentShuffleFromHand', (op, ctx) => {
  const enemy = other(ctx.player);
  const them = ctx.state.players[enemy];
  let taken = 0;
  for (let i = 0; i < them.hand.length && taken < num(op.count, 1); ) {
    if (matchFilter(them.hand[i].def, op.filter)) {
      them.deck.push(them.hand.splice(i, 1)[0]);
      taken += 1;
    } else {
      i += 1;
    }
  }
  if (taken > 0) shuffleDeck(ctx.state, enemy);
});

registerOp('millDrawPer', (op, ctx) => {
  const me = ctx.state.players[ctx.player];
  const milled = me.deck.splice(0, num(op.count, 1));
  me.graveyard.push(...milled);
  const matches = milled.filter((c) => matchFilter(c.def, op.filter)).length;
  for (let i = 0; i < matches && !ctx.state.gameOver; i++) drawCard(ctx.state, ctx.player, ctx.events);
});

// --- board movement --------------------------------------------------------

registerOp('gust', (_op, ctx) => {
  const enemy = other(ctx.player);
  const picked = targetCreature(ctx);
  const bench = benchStickers(ctx.state, enemy);
  const incoming =
    picked && picked.owner === enemy && bench.includes(picked.creature)
      ? picked.creature
      : // Auto-pick: drag out the frailest thing on their bench.
        [...bench].sort((a, b) => a.health - b.health)[0];
  if (incoming) exchangeActive(ctx.state, enemy, incoming.instanceId, ctx.events);
});

registerOp('switchSelf', (_op, ctx) => {
  const picked = targetCreature(ctx);
  const bench = benchStickers(ctx.state, ctx.player);
  const incoming =
    picked && picked.owner === ctx.player && bench.includes(picked.creature)
      ? picked.creature
      : bench.sort((a, b) => b.health - a.health)[0];
  if (incoming) exchangeActive(ctx.state, ctx.player, incoming.instanceId, ctx.events);
});

// --- misc ------------------------------------------------------------------

registerOp('flip', (op, ctx) => {
  const branch = flipCoin(ctx.state, ctx.player, ctx.events) ? op.heads : op.tails;
  if (Array.isArray(branch)) runOps(branch as EffectOp[], ctx);
});

registerOp('lockKind', (op, ctx) => {
  const flags = ctx.state.players[ctx.player].turnFlags;
  if (flags && typeof op.kind === 'string' && !flags.locked.includes(op.kind)) flags.locked.push(op.kind);
});

registerOp('drawOnDamaged', (op, ctx) => {
  // Damaged-trigger context (Read Receipt).
  for (let i = 0; i < num(op.count, 1) && !ctx.state.gameOver; i++) drawCard(ctx.state, ctx.player, ctx.events);
});

/** Evolve a board sticker into the given card (upgrade command, searchEvolve). */
export function evolveInto(
  state: GameState,
  owner: PlayerId,
  creature: CreatureOnBoard,
  card: CardInstance,
  events: GameEvent[]
): void {
  const fromName = creature.def.name;
  (creature.stack ??= []).push({ instanceId: `${creature.instanceId}#${creature.stack.length}`, def: creature.def });
  const damage = creature.maxHealth - creature.health;
  const game = stickerGame(card.def);
  let maxHp = game?.hp ?? creature.maxHealth;
  // A +HP Tool keeps counting on the evolved form.
  if (creature.gift) {
    const giftGame = creature.gift.def.game;
    if (giftGame && 'effects' in giftGame) {
      for (const op of giftGame.effects ?? []) {
        if (op.op === 'hpBonus' && typeof op.amount === 'number') maxHp += op.amount;
      }
    }
  }
  creature.def = { ...card.def, skills: [] };
  creature.maxHealth = maxHp;
  creature.health = Math.max(1, maxHp - damage);
  creature.enteredTurn = state.turn;
  creature.traitUsed = false;
  clearConditions(creature, owner, events);
  events.push({ type: 'upgraded', player: owner, instanceId: creature.instanceId, cardName: card.def.name, fromName });
}

/** Run a sticker's trait if it has the given trigger. */
export function runTraitTrigger(
  state: GameState,
  owner: PlayerId,
  creature: CreatureOnBoard,
  trigger: 'onPlay' | 'onTurnStart' | 'onDamaged' | 'onKO' | 'onKOOpponent',
  events: GameEvent[],
  extra?: Partial<OpContext>
): void {
  const trait = stickerGame(creature.def)?.trait;
  if (!trait || trait.trigger !== trigger) return;
  events.push({
    type: 'skillTriggered', player: owner, instanceId: creature.instanceId,
    cardName: creature.def.name, skill: trait.name, icon: '✨',
  });
  runOps(trait.effects, { state, events, player: owner, source: creature, ...extra });
}
