import type { CreatureOnBoard, GameState, PlayerId, StatusRef } from './types.js';
import type { GameEvent } from './events.js';
import { applyDamage } from './damage.js';

/**
 * The status (counter) registry — ticking conditions that sit ON a creature:
 * Poison, Frozen, Shield. The third extension point of this boilerplate,
 * alongside effects.ts and skills.ts, and built the same way: register a
 * status once and spells, skills, NFT metadata, the engine, and the UI all
 * pick it up.
 *
 * A status is data + behavior:
 *  - a FLAG the rules engine queries (`blocksAttack` — Frozen);
 *  - HOOKS the engine calls: `onTurnStart` ticks at the bearer's owner's
 *    turn start (Poison), `modifyDamageTaken` intercepts incoming damage
 *    (Shield).
 *
 * Lifetime: a status with `turns` expires that many of the bearer's own
 * full turns after it lands (Frozen 1 = can't attack on your next turn).
 * A hook may call `ctx.expire()` to end its status early (Shield, when
 * spent). Statuses without either stay until the creature dies (Poison).
 * Re-applying a status ADDS its value and keeps the longer duration.
 */

export interface StatusHookContext {
  state: GameState;
  /** Owner of the afflicted creature. */
  owner: PlayerId;
  /** The creature carrying this status. */
  creature: CreatureOnBoard;
  /** The live StatusRef — hooks may mutate `value` (e.g. Shield spends it). */
  ref: StatusRef;
  value: number;
  events: GameEvent[];
  /** Remove this status once the current hook finishes. */
  expire: () => void;
}

export interface StatusDef {
  key: string;
  /** Display name, e.g. 'Frozen'. */
  name: string;
  /** Single glyph shown on the card, e.g. '❄'. */
  icon: string;
  describe: (value: number) => string;
  /** Bearer cannot attack while this status is present (Frozen). */
  blocksAttack?: boolean;
  hooks?: {
    /** At the bearer's owner's turn start (Poison ticks here). */
    onTurnStart?: (ctx: StatusHookContext) => void;
    /** Adjust damage the bearer takes — combat AND spells (Shield). */
    modifyDamageTaken?: (amount: number, ctx: StatusHookContext) => number;
    /** Adjust damage the bearer deals. */
    modifyDamageDealt?: (amount: number, ctx: StatusHookContext) => number;
  };
}

const registry = new Map<string, StatusDef>();

export function registerStatus(def: StatusDef): void {
  registry.set(def.key, def);
}

export function getStatus(key: string): StatusDef | undefined {
  return registry.get(key);
}

/** Rebrand a status without touching its mechanics (like configureSkill). */
export function configureStatus(
  key: string,
  overrides: Partial<Pick<StatusDef, 'name' | 'icon' | 'describe'>>
): void {
  const def = registry.get(key);
  if (def) registry.set(key, { ...def, ...overrides });
}

export function allStatuses(): StatusDef[] {
  return [...registry.values()];
}

/** Match a metadata name like "Frozen" to a registered key, or null. */
export function findStatusKey(name: string): string | null {
  const norm = name.toLowerCase().replace(/[^a-z0-9]/g, '');
  for (const def of registry.values()) {
    if (def.key.toLowerCase() === norm) return def.key;
    if (def.name.toLowerCase().replace(/[^a-z0-9]/g, '') === norm) return def.key;
  }
  return null;
}

/**
 * Put a status on a creature (the one entry point — spells, skills, and
 * future mechanics all call this). Re-applying adds value / keeps the
 * longer duration.
 */
export function applyStatus(
  state: GameState,
  owner: PlayerId,
  creature: CreatureOnBoard,
  ref: StatusRef,
  events: GameEvent[]
): void {
  const def = registry.get(ref.key);
  if (!def) return;
  const existing = creature.statuses.find((s) => s.key === ref.key);
  if (existing) {
    if (ref.value !== undefined) existing.value = (existing.value ?? 0) + ref.value;
    if (ref.turns !== undefined) existing.turns = Math.max(existing.turns ?? 0, ref.turns);
  } else {
    creature.statuses.push({ ...ref });
  }
  events.push({
    type: 'statusApplied',
    player: owner,
    instanceId: creature.instanceId,
    cardName: creature.def.name,
    status: def.name,
    icon: def.icon,
    value: ref.value,
  });
}

/** True while any status on the creature forbids attacking (Frozen). */
export function statusBlocksAttack(creature: CreatureOnBoard): boolean {
  return creature.statuses.some((s) => registry.get(s.key)?.blocksAttack);
}

function ctxFor(
  state: GameState,
  owner: PlayerId,
  creature: CreatureOnBoard,
  ref: StatusRef,
  events: GameEvent[],
  expired: Set<StatusRef>
): StatusHookContext {
  return {
    state,
    owner,
    creature,
    ref,
    value: ref.value ?? 1,
    events,
    expire: () => expired.add(ref),
  };
}

function remove(
  creature: CreatureOnBoard,
  owner: PlayerId,
  ref: StatusRef,
  events: GameEvent[]
): void {
  const i = creature.statuses.indexOf(ref);
  if (i === -1) return;
  creature.statuses.splice(i, 1);
  const def = registry.get(ref.key);
  events.push({
    type: 'statusExpired',
    player: owner,
    instanceId: creature.instanceId,
    status: def?.name ?? ref.key,
    icon: def?.icon ?? '',
  });
}

/**
 * Tick a creature's statuses at its owner's turn start: run onTurnStart
 * hooks, then count down `turns` (a status expires the turn AFTER its
 * counter hits 0, so Frozen 1 blocks exactly one full own-turn).
 */
export function tickStatuses(
  state: GameState,
  owner: PlayerId,
  creature: CreatureOnBoard,
  events: GameEvent[]
): void {
  const expired = new Set<StatusRef>();
  for (const ref of [...creature.statuses]) {
    const def = registry.get(ref.key);
    if (!def) continue;
    if (ref.turns !== undefined) {
      if (ref.turns <= 0) {
        expired.add(ref);
        continue;
      }
      ref.turns -= 1;
    }
    def.hooks?.onTurnStart?.(ctxFor(state, owner, creature, ref, events, expired));
  }
  for (const ref of expired) remove(creature, owner, ref, events);
}

/** Pipe incoming/outgoing damage through status hooks (called by damage.ts). */
export function modifyStatusDamage(
  which: 'modifyDamageTaken' | 'modifyDamageDealt',
  amount: number,
  state: GameState,
  owner: PlayerId,
  creature: CreatureOnBoard,
  events: GameEvent[]
): number {
  let result = amount;
  const expired = new Set<StatusRef>();
  for (const ref of [...creature.statuses]) {
    const hook = registry.get(ref.key)?.hooks?.[which];
    if (hook) result = hook(result, ctxFor(state, owner, creature, ref, events, expired));
  }
  for (const ref of expired) remove(creature, owner, ref, events);
  return Math.max(0, result);
}

/** Human-readable status line for card text, e.g. "☠ Poison 2 · ❄ Frozen". */
export function statusLine(refs: StatusRef[] | undefined): string {
  if (!refs || refs.length === 0) return '';
  return refs
    .map((ref) => {
      const def = registry.get(ref.key);
      if (!def) return ref.key;
      return `${def.icon} ${def.name}${ref.value !== undefined ? ` ${ref.value}` : ''}`;
    })
    .join(' · ');
}

// ---------------------------------------------------------------------------
// Built-in statuses — a template for each kind of mechanic.
// ---------------------------------------------------------------------------

registerStatus({
  key: 'poison',
  name: 'Poison',
  icon: '☠',
  describe: (v) => `Takes ${v} damage at the start of its owner's turns.`,
  hooks: {
    onTurnStart: (ctx) => {
      // Through the damage pipeline, so Armor / Shield interact consistently.
      applyDamage(ctx.state, null, ctx.creature, ctx.value, ctx.events);
    },
  },
});

registerStatus({
  key: 'frozen',
  name: 'Frozen',
  icon: '❄',
  describe: () => 'Cannot attack.',
  blocksAttack: true,
});

registerStatus({
  key: 'shield',
  name: 'Shield',
  icon: '🛡',
  describe: (v) => `Absorbs the next ${v} damage.`,
  hooks: {
    modifyDamageTaken: (amount, ctx) => {
      if (amount <= 0) return amount;
      const absorbed = Math.min(amount, ctx.ref.value ?? 0);
      ctx.ref.value = (ctx.ref.value ?? 0) - absorbed;
      if ((ctx.ref.value ?? 0) <= 0) ctx.expire();
      return amount - absorbed;
    },
  },
});
