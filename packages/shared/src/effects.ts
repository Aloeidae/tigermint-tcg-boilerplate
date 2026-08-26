import type { EffectRef, EffectTarget, GameState, PlayerId, TargetSpec } from './types.js';
import type { GameEvent } from './events.js';
import { damageFace, drawCard, findCreature, healFace, other } from './helpers.js';
import { applyDamage } from './damage.js';
import { applyStatus } from './statuses.js';

/**
 * The effects registry — THE main extension point of this boilerplate.
 *
 * A spell's (or equipment's) `effect.key` looks up a handler here. To add a new
 * mechanic, register a handler with registerEffect() and reference its key from
 * a CardDef. Handlers mutate the state clone they are given and push events;
 * death sweeping and win checks run in the engine after the handler returns.
 */

export interface EffectContext {
  state: GameState;
  caster: PlayerId;
  target: EffectTarget;
  amount: number;
  events: GameEvent[];
}

export type EffectHandler = (ctx: EffectContext) => void;

interface EffectEntry {
  handler: EffectHandler;
  /** What the UI/AI must pick as a target before casting. */
  targetSpec: TargetSpec;
  describe: (amount: number) => string;
}

const registry = new Map<string, EffectEntry>();

export function registerEffect(
  key: string,
  targetSpec: TargetSpec,
  describe: (amount: number) => string,
  handler: EffectHandler
): void {
  registry.set(key, { handler, targetSpec, describe });
}

export function getEffect(key: string): EffectEntry | undefined {
  return registry.get(key);
}

/**
 * Match a metadata name like "damage", "AoE Damage" or "buff attack" to a
 * registered effect key, or null. Lets NFT attributes and pack manifests
 * reference effects by human-friendly names.
 */
export function findEffectKey(name: string): string | null {
  const norm = name.toLowerCase().replace(/[^a-z0-9]/g, '');
  for (const key of registry.keys()) {
    if (key.toLowerCase() === norm) return key;
  }
  return null;
}

export function effectTargetSpec(ref: EffectRef | undefined): TargetSpec {
  if (!ref) return 'none';
  return registry.get(ref.key)?.targetSpec ?? 'none';
}

export function effectText(ref: EffectRef | undefined): string {
  if (!ref) return '';
  const entry = registry.get(ref.key);
  return entry ? entry.describe(ref.amount ?? 0) : '';
}

/** Validate that a chosen target satisfies an effect's target spec. */
export function isValidTarget(
  state: GameState,
  caster: PlayerId,
  spec: TargetSpec,
  target: EffectTarget
): boolean {
  switch (spec) {
    case 'none':
      return true;
    case 'friendly-creature': {
      if (target.kind !== 'creature') return false;
      const found = findCreature(state, target.instanceId);
      return !!found && found.owner === caster;
    }
    case 'enemy-creature': {
      if (target.kind !== 'creature') return false;
      const found = findCreature(state, target.instanceId);
      return !!found && found.owner === other(caster);
    }
    case 'any-creature':
      return target.kind === 'creature' && !!findCreature(state, target.instanceId);
    case 'any':
      if (target.kind === 'face') return true;
      return target.kind === 'creature' && !!findCreature(state, target.instanceId);
    case 'friendly':
      if (target.kind === 'face') return target.player === caster;
      if (target.kind === 'creature') {
        const found = findCreature(state, target.instanceId);
        return !!found && found.owner === caster;
      }
      return false;
  }
}

// ---------------------------------------------------------------------------
// Built-in effects
// ---------------------------------------------------------------------------

registerEffect('damage', 'any', (n) => `Deal ${n} damage to any target.`, (ctx) => {
  if (ctx.target.kind === 'creature') {
    const found = findCreature(ctx.state, ctx.target.instanceId);
    // Through the damage pipeline, so skills like Armor apply to spells too.
    if (found) applyDamage(ctx.state, null, found.creature, ctx.amount, ctx.events);
  } else if (ctx.target.kind === 'face') {
    damageFace(ctx.state, ctx.target.player, ctx.amount, ctx.events);
  }
});

registerEffect('heal', 'friendly', (n) => `Restore ${n} health to a friendly creature or yourself.`, (ctx) => {
  if (ctx.target.kind === 'creature') {
    const found = findCreature(ctx.state, ctx.target.instanceId);
    if (found) {
      const healed = Math.min(ctx.amount, found.creature.maxHealth - found.creature.health);
      if (healed > 0) {
        found.creature.health += healed;
        ctx.events.push({
          type: 'creatureHealed',
          player: found.owner,
          instanceId: found.creature.instanceId,
          amount: healed,
        });
      }
    }
  } else if (ctx.target.kind === 'face') {
    healFace(ctx.state, ctx.caster, ctx.amount, ctx.events);
  }
});

registerEffect('draw', 'none', (n) => `Draw ${n} card${n === 1 ? '' : 's'}.`, (ctx) => {
  for (let i = 0; i < ctx.amount; i++) {
    if (ctx.state.gameOver) break;
    drawCard(ctx.state, ctx.caster, ctx.events);
  }
});

registerEffect('buffAttack', 'friendly-creature', (n) => `Give a friendly creature +${n} attack.`, (ctx) => {
  if (ctx.target.kind !== 'creature') return;
  const found = findCreature(ctx.state, ctx.target.instanceId);
  if (found) {
    found.creature.attack += ctx.amount;
    ctx.events.push({ type: 'creatureBuffed', player: found.owner, instanceId: found.creature.instanceId });
  }
});

registerEffect('aoeDamage', 'none', (n) => `Deal ${n} damage to all enemy creatures.`, (ctx) => {
  const enemy = ctx.state.players[other(ctx.caster)];
  for (const c of enemy.row) {
    if (c) applyDamage(ctx.state, null, c, ctx.amount, ctx.events);
  }
});

/**
 * Register a "summon <Token> N" effect for a token creature. Called by
 * registerToken() (cards.ts), so every token is immediately summonable from
 * spells, metadata ("Spell Effect: summon squirrel 2"), and pack manifests.
 * Tokens fill free row slots; extras beyond the row are lost.
 */
export function registerSummonEffect(tokenDef: import('./types.js').CardDef): void {
  registerEffect(
    `summon${tokenDef.name}`,
    'none',
    (n) => `Summon ${n} ${tokenDef.name}${n === 1 ? '' : 's'} (${tokenDef.attack ?? 0}/${tokenDef.health ?? 1}).`,
    (ctx) => {
      const row = ctx.state.players[ctx.caster].row;
      for (let i = 0; i < ctx.amount; i++) {
        const slot = row.findIndex((s) => s === null);
        if (slot === -1) break;
        const instanceId = `tok-${ctx.state.nextTokenId++}`;
        row[slot] = {
          instanceId,
          def: tokenDef,
          attack: tokenDef.attack ?? 0,
          health: tokenDef.health ?? 1,
          maxHealth: tokenDef.health ?? 1,
          ready: !ctx.state.rules.summoningSickness,
          attacksUsed: 0,
          equipment: [],
          statuses: [],
        };
        ctx.events.push({ type: 'creatureSummoned', player: ctx.caster, instanceId, slot, cardName: tokenDef.name });
      }
    }
  );
}

// --- Status appliers (see statuses.ts). "Spell Effect: poison 2" etc. ---

registerEffect('poison', 'enemy-creature', (n) => `Poison an enemy creature for ${n}: it takes that damage every turn.`, (ctx) => {
  if (ctx.target.kind !== 'creature') return;
  const found = findCreature(ctx.state, ctx.target.instanceId);
  if (found) applyStatus(ctx.state, found.owner, found.creature, { key: 'poison', value: ctx.amount }, ctx.events);
});

registerEffect('freeze', 'enemy-creature', () => 'Freeze an enemy creature: it cannot attack on its next turn.', (ctx) => {
  if (ctx.target.kind !== 'creature') return;
  const found = findCreature(ctx.state, ctx.target.instanceId);
  if (found) applyStatus(ctx.state, found.owner, found.creature, { key: 'frozen', turns: 1 }, ctx.events);
});

registerEffect('shield', 'friendly-creature', (n) => `Shield a friendly creature from the next ${n} damage.`, (ctx) => {
  if (ctx.target.kind !== 'creature') return;
  const found = findCreature(ctx.state, ctx.target.instanceId);
  if (found) applyStatus(ctx.state, found.owner, found.creature, { key: 'shield', value: ctx.amount }, ctx.events);
});
