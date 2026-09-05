import { registerStatus } from '../statuses.js';

/**
 * Pokemon-mode Special Conditions and utility statuses, registered in the
 * shared statuses registry so the client renders their icons and text with
 * zero extra wiring. Only the ACTIVE sticker can hold a Special Condition;
 * retreating or evolving clears them (the engine enforces both).
 *
 * The between-turns behavior (poison ticks, burn/sleep cure flips) lives in
 * pokemon/engine.ts — it needs the deterministic coin flip and must ignore
 * weakness/resistance, which generic status hooks can't express. Rename any
 * of these for your skin with configureStatus() — the generator data matches
 * by name OR key, so "Spammed" and "Poisoned" both resolve here.
 */

export const CONDITION_KEYS = ['spammed', 'flamed', 'muted', 'lagging', 'glitched'] as const;
export type ConditionKey = (typeof CONDITION_KEYS)[number];

/** Sleep/paralysis replace each other; poison/burn stack alongside. */
export const EXCLUSIVE_CONDITIONS: ConditionKey[] = ['muted', 'lagging', 'glitched'];

registerStatus({
  key: 'spammed', // Poisoned
  name: 'Spammed',
  icon: '💩',
  describe: (v) => `Takes ${v || 10} damage between turns.`,
});

registerStatus({
  key: 'flamed', // Burned
  name: 'Flamed',
  icon: '🔥',
  describe: (v) => `Takes ${v || 20} damage between turns, then flips to recover.`,
});

registerStatus({
  key: 'muted', // Asleep
  name: 'Muted',
  icon: '💤',
  describe: () => 'Cannot attack or retreat. Flips to wake up between turns.',
  blocksAttack: true,
  blocksSwap: true,
});

registerStatus({
  key: 'lagging', // Paralyzed
  name: 'Lagging',
  icon: '🐌',
  describe: () => 'Cannot attack or retreat. Recovers at the end of its own turn.',
  blocksAttack: true,
  blocksSwap: true,
});

registerStatus({
  key: 'glitched', // Confused
  name: 'Glitched',
  icon: '😵',
  describe: () => 'Flips before attacking; tails, the move fails and it takes 30 damage.',
});

// --- Utility statuses used by the effect DSL (not Special Conditions) ------
// These use the standard `turns` lifecycle: they tick down at the bearer's
// owner's turn start and expire the tick AFTER hitting 0. So `turns: 0`
// lasts for the rest of the current turn, `turns: 1` through the next one.

registerStatus({
  key: 'boosted', // buffDamage duration 'turn'
  name: 'Boosted',
  icon: '📣',
  describe: (v) => `Its moves do ${v} more damage.`,
});

registerStatus({
  key: 'protected', // protect / reduceDamageNextTurn
  name: 'Protected',
  icon: '🛡',
  describe: (v) => (v >= 9999 ? 'Takes no move damage.' : `Takes ${v} less move damage.`),
  hooks: {
    modifyDamageTaken: (amount, ctx) => Math.max(0, amount - ctx.value),
  },
});

registerStatus({
  key: 'noattack', // noAttack op (e.g. Reaction Rush)
  name: 'Winded',
  icon: '⛔',
  describe: () => 'Cannot attack this turn.',
  blocksAttack: true,
});

registerStatus({
  key: 'swaplock', // lockSwap op
  name: 'Swap-locked',
  icon: '🔗',
  describe: () => 'Cannot retreat.',
  blocksSwap: true,
});
