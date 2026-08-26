import type { CreatureOnBoard, GameState, PlayerId, SkillRef } from './types.js';
import type { GameEvent } from './events.js';
import { applyStatus } from './statuses.js';

/**
 * The skill (keyword) registry — modular MTG-style abilities like Haste,
 * First Strike, Guard. THE second big extension point of this boilerplate
 * (alongside effects.ts).
 *
 * A skill is data + behavior:
 *  - capability FLAGS the rules engine queries (`grantsSummonReady`, `guards`,
 *    `strikesFirst`) — use these when a skill changes what is *legal*;
 *  - event HOOKS the engine calls at specific moments — use these when a
 *    skill *does* something (modify damage, heal, trigger on death...).
 *
 * To create a new skill: call registerSkill() with a unique key, then put
 * `{ key: 'yourSkill' }` in any CardDef's `skills` array (or map it from NFT
 * metadata in cardMapper.ts). The card text, the on-card icon, the engine,
 * the AI, and the targeting UI all pick it up from here — no other wiring.
 */

/** Context handed to every skill hook. `creature` is the skill's bearer. */
export interface SkillHookContext {
  state: GameState;
  /** Owner of the bearer. */
  owner: PlayerId;
  /** The creature carrying this skill. */
  creature: CreatureOnBoard;
  /** The skill's magnitude (SkillRef.value, default 1). */
  value: number;
  events: GameEvent[];
  /** The opposing creature in a damage exchange, if any. */
  other?: CreatureOnBoard;
  /** The opposing player, when damage targets a face. */
  otherPlayer?: PlayerId;
  /** True when the bearer is the attacker in the current exchange. */
  attacking?: boolean;
}

export interface SkillDef {
  key: string;
  /** Display name, e.g. 'First Strike'. */
  name: string;
  /** Single glyph shown on the card, e.g. '⚔'. */
  icon: string;
  describe: (value: number) => string;
  /** Bearer may attack the turn it is summoned (Haste). */
  grantsSummonReady?: boolean;
  /** Enemies must attack bearers of this skill before anything else (Guard). */
  guards?: boolean;
  /** Bearer deals combat damage first; a defender killed this way never strikes back. */
  strikesFirst?: boolean;
  hooks?: {
    /** After the bearer enters play. */
    onSummon?: (ctx: SkillHookContext) => void;
    /** At the bearer's owner's turn start. */
    onTurnStart?: (ctx: SkillHookContext) => void;
    /** At the bearer's owner's turn end (before the next turn starts). */
    onEndTurn?: (ctx: SkillHookContext) => void;
    /** When the bearer's owner draws a card (bearer must be on the board). */
    onDraw?: (ctx: SkillHookContext) => void;
    /** When another friendly creature dies while the bearer is on the board. */
    onAllyDeath?: (ctx: SkillHookContext) => void;
    /** When the bearer dies (before it leaves the row). */
    onDeath?: (ctx: SkillHookContext) => void;
    /** Adjust damage the bearer deals (combat and face hits). */
    modifyDamageDealt?: (amount: number, ctx: SkillHookContext) => number;
    /** Adjust damage the bearer takes (combat AND spells). */
    modifyDamageTaken?: (amount: number, ctx: SkillHookContext) => number;
    /** After the bearer deals damage (amount is the final dealt value). */
    afterDealDamage?: (amount: number, ctx: SkillHookContext) => void;
  };
}

const registry = new Map<string, SkillDef>();

export function registerSkill(def: SkillDef): void {
  registry.set(def.key, def);
}

export function getSkill(key: string): SkillDef | undefined {
  return registry.get(key);
}

/**
 * Rebrand a skill without touching its mechanics: change the display name,
 * icon, or description while every card keeps referencing the same key.
 * e.g. configureSkill('haste', { name: 'Charge', icon: '🐎' }).
 * Card text, on-card icons, trigger popups, and metadata matching (a
 * "Skills: Charge" attribute) all follow the new name automatically.
 */
export function configureSkill(
  key: string,
  overrides: Partial<Pick<SkillDef, 'name' | 'icon' | 'describe'>>
): void {
  const def = registry.get(key);
  if (def) registry.set(key, { ...def, ...overrides });
}

export function allSkills(): SkillDef[] {
  return [...registry.values()];
}

/** Match a metadata name like "First Strike" to a registered key, or null. */
export function findSkillKey(name: string): string | null {
  const norm = name.toLowerCase().replace(/[^a-z0-9]/g, '');
  for (const def of registry.values()) {
    if (def.key.toLowerCase() === norm) return def.key;
    if (def.name.toLowerCase().replace(/[^a-z0-9]/g, '') === norm) return def.key;
  }
  return null;
}

/** A creature's effective skills: its own plus everything its equipment grants. */
export function creatureSkills(creature: CreatureOnBoard): SkillRef[] {
  const refs: SkillRef[] = [...(creature.def.skills ?? [])];
  for (const eq of creature.equipment) refs.push(...(eq.def.skills ?? []));
  return refs;
}

export function creatureHasFlag(
  creature: CreatureOnBoard,
  flag: 'grantsSummonReady' | 'guards' | 'strikesFirst'
): boolean {
  return creatureSkills(creature).some((ref) => getSkill(ref.key)?.[flag]);
}

/** Human-readable skill line for card text, e.g. "Haste · Armor 2". */
export function skillLine(refs: SkillRef[] | undefined): string {
  if (!refs || refs.length === 0) return '';
  return refs
    .map((ref) => {
      const def = getSkill(ref.key);
      if (!def) return ref.key;
      const v = ref.value ?? 1;
      const showValue = ref.value !== undefined;
      return `${def.icon} ${def.name}${showValue ? ` ${v}` : ''}`;
    })
    .join(' · ');
}

function ctxFor(
  state: GameState,
  owner: PlayerId,
  creature: CreatureOnBoard,
  ref: SkillRef,
  events: GameEvent[],
  extra?: Partial<SkillHookContext>
): SkillHookContext {
  return { state, owner, creature, value: ref.value ?? 1, events, ...extra };
}

/** Run one hook across all of a creature's skills. */
export function runHook(
  hook: 'onSummon' | 'onTurnStart' | 'onEndTurn' | 'onDraw' | 'onAllyDeath' | 'onDeath',
  state: GameState,
  owner: PlayerId,
  creature: CreatureOnBoard,
  events: GameEvent[]
): void {
  for (const ref of creatureSkills(creature)) {
    getSkill(ref.key)?.hooks?.[hook]?.(ctxFor(state, owner, creature, ref, events));
  }
}

/** Run one hook across every creature a player controls. */
export function runRowHook(
  hook: 'onEndTurn' | 'onDraw',
  state: GameState,
  owner: PlayerId,
  events: GameEvent[]
): void {
  for (const c of state.players[owner].row) {
    if (c) runHook(hook, state, owner, c, events);
  }
}

/** Pipe an amount through modifyDamageDealt / modifyDamageTaken hooks. */
export function modifyDamage(
  which: 'modifyDamageDealt' | 'modifyDamageTaken',
  amount: number,
  state: GameState,
  owner: PlayerId,
  creature: CreatureOnBoard,
  events: GameEvent[],
  extra?: Partial<SkillHookContext>
): number {
  let result = amount;
  for (const ref of creatureSkills(creature)) {
    const hook = getSkill(ref.key)?.hooks?.[which];
    if (hook) result = hook(result, ctxFor(state, owner, creature, ref, events, extra));
  }
  return Math.max(0, result);
}

export function runAfterDealDamage(
  amount: number,
  state: GameState,
  owner: PlayerId,
  creature: CreatureOnBoard,
  events: GameEvent[],
  extra?: Partial<SkillHookContext>
): void {
  for (const ref of creatureSkills(creature)) {
    getSkill(ref.key)?.hooks?.afterDealDamage?.(amount, ctxFor(state, owner, creature, ref, events, extra));
  }
}

function triggered(ctx: SkillHookContext, def: SkillDef): void {
  ctx.events.push({
    type: 'skillTriggered',
    player: ctx.owner,
    instanceId: ctx.creature.instanceId,
    cardName: ctx.creature.def.name,
    skill: def.name,
    icon: def.icon,
  });
}

// ---------------------------------------------------------------------------
// Built-in skills — a template for each kind of mechanic.
// ---------------------------------------------------------------------------

registerSkill({
  key: 'haste',
  name: 'Haste',
  icon: '⚡',
  describe: () => 'Can attack the turn it is summoned.',
  grantsSummonReady: true,
});

registerSkill({
  key: 'guard',
  name: 'Guard',
  icon: '🛡',
  describe: () => 'Enemies must attack this creature first.',
  guards: true,
});

registerSkill({
  key: 'firstStrike',
  name: 'First Strike',
  icon: '⚔',
  describe: () => 'Strikes first in combat; a defender it kills never strikes back.',
  strikesFirst: true,
});

const armorDef: SkillDef = {
  key: 'armor',
  name: 'Armor',
  icon: '⛨',
  describe: (v) => `Takes ${v} less damage from all sources.`,
  hooks: {
    modifyDamageTaken: (amount, ctx) => {
      const reduced = Math.max(0, amount - ctx.value);
      if (amount > 0 && reduced < amount) triggered(ctx, armorDef);
      return reduced;
    },
  },
};
registerSkill(armorDef);

const lifelinkDef: SkillDef = {
  key: 'lifelink',
  name: 'Lifelink',
  icon: '♥',
  describe: () => 'Damage it deals also heals its owner.',
  hooks: {
    afterDealDamage: (amount, ctx) => {
      if (amount <= 0) return;
      const p = ctx.state.players[ctx.owner];
      p.life += amount;
      ctx.events.push({ type: 'lifeChanged', player: ctx.owner, life: p.life, delta: amount });
      triggered(ctx, lifelinkDef);
    },
  },
};
registerSkill(lifelinkDef);

const deathtouchDef: SkillDef = {
  key: 'deathtouch',
  name: 'Deathtouch',
  icon: '☠',
  describe: () => 'Any creature it damages is destroyed.',
  hooks: {
    afterDealDamage: (amount, ctx) => {
      if (amount > 0 && ctx.other && ctx.other.health > 0) {
        ctx.other.health = 0;
        triggered(ctx, deathtouchDef);
      }
    },
  },
};
registerSkill(deathtouchDef);

const scavengerDef: SkillDef = {
  key: 'scavenger',
  name: 'Scavenger',
  icon: '🦴',
  describe: (v) => `Gains +${v}/+${v} whenever a friendly creature dies.`,
  hooks: {
    onAllyDeath: (ctx) => {
      ctx.creature.attack += ctx.value;
      ctx.creature.health += ctx.value;
      ctx.creature.maxHealth += ctx.value;
      ctx.events.push({ type: 'creatureBuffed', player: ctx.owner, instanceId: ctx.creature.instanceId });
      triggered(ctx, scavengerDef);
    },
  },
};
registerSkill(scavengerDef);

const inspiringDef: SkillDef = {
  key: 'inspiring',
  name: 'Inspiring',
  icon: '🎺',
  describe: (v) => `Heals its owner ${v} at the end of their turn.`,
  hooks: {
    onEndTurn: (ctx) => {
      const p = ctx.state.players[ctx.owner];
      p.life += ctx.value;
      ctx.events.push({ type: 'lifeChanged', player: ctx.owner, life: p.life, delta: ctx.value });
      triggered(ctx, inspiringDef);
    },
  },
};
registerSkill(inspiringDef);

const venomousDef: SkillDef = {
  key: 'venomous',
  name: 'Venomous',
  icon: '🐍',
  describe: (v) => `Creatures it damages are poisoned for ${v}.`,
  hooks: {
    afterDealDamage: (amount, ctx) => {
      if (amount <= 0 || !ctx.other || ctx.other.health <= 0) return;
      const found = findCreatureOwner(ctx.state, ctx.other.instanceId);
      if (found === null) return;
      applyStatus(ctx.state, found, ctx.other, { key: 'poison', value: ctx.value }, ctx.events);
      triggered(ctx, venomousDef);
    },
  },
};
registerSkill(venomousDef);

/** Owner lookup without importing helpers (avoids an import cycle). */
function findCreatureOwner(state: GameState, instanceId: string): PlayerId | null {
  for (const p of state.players) {
    if (p.row.some((c) => c?.instanceId === instanceId)) return p.id;
  }
  return null;
}

const regenerateDef: SkillDef = {
  key: 'regenerate',
  name: 'Regenerate',
  icon: '♻',
  describe: (v) => `Heals ${v} at the start of its owner's turn.`,
  hooks: {
    onTurnStart: (ctx) => {
      const missing = ctx.creature.maxHealth - ctx.creature.health;
      const healed = Math.min(ctx.value, missing);
      if (healed <= 0) return;
      ctx.creature.health += healed;
      ctx.events.push({
        type: 'creatureHealed',
        player: ctx.owner,
        instanceId: ctx.creature.instanceId,
        amount: healed,
      });
      triggered(ctx, regenerateDef);
    },
  },
};
registerSkill(regenerateDef);
