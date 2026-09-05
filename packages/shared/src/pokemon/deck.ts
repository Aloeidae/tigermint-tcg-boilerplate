import type { CardDef } from '../types.js';
import type { RulesConfig } from '../rules.js';
import type { ReactionType } from './types.js';
import { isBasicSticker, reactionGame, stickerGame, trainerGame } from './types.js';

/**
 * Deck legality and a starter-deck builder for the pokemon mode.
 */

/** Problems with a deck under the given rules; empty = legal. */
export function validatePokemonDeck(defs: CardDef[], rules: RulesConfig): string[] {
  const problems: string[] = [];
  if (defs.length !== rules.deckSize) {
    problems.push(`Deck must be exactly ${rules.deckSize} cards (has ${defs.length})`);
  }
  if (!defs.some((d) => isBasicSticker(d))) {
    problems.push('Deck needs at least one basic sticker');
  }
  const byName = new Map<string, number>();
  let specials = 0;
  for (const d of defs) {
    const reaction = reactionGame(d);
    if (reaction && !reaction.special) continue; // basic energy is unlimited
    if (reaction?.special) specials += 1;
    byName.set(d.name, (byName.get(d.name) ?? 0) + 1);
  }
  for (const [name, count] of byName) {
    if (count > 4) problems.push(`Too many copies of ${name} (${count}/4)`);
  }
  if (specials > 4) problems.push(`Too many special energy cards (${specials}/4)`);
  return problems;
}

/**
 * Build a playable starter deck from whatever pool is available: pick the
 * two best-supported types, take their sticker lines, sprinkle trainers,
 * and fill the rest with matching basic energy. Deterministic.
 */
export function buildStarterPokemonDeck(pool: CardDef[], deckSize: number): CardDef[] {
  const stickers = pool.filter((d) => stickerGame(d));
  const trainers = pool.filter((d) => {
    const t = trainerGame(d);
    return !!t;
  });
  const basicEnergy = new Map<ReactionType, CardDef>();
  for (const d of pool) {
    const r = reactionGame(d);
    if (r && !r.special && !basicEnergy.has(r.type)) basicEnergy.set(r.type, d);
  }

  // Rank types by how many playable stickers (with energy support) they have.
  const byType = new Map<ReactionType, CardDef[]>();
  for (const d of stickers) {
    const t = stickerGame(d)!.type;
    if (!basicEnergy.has(t) && t !== 'Neutral') continue;
    byType.set(t, [...(byType.get(t) ?? []), d]);
  }
  const rankedTypes = [...byType.entries()].sort((a, b) => b[1].length - a[1].length).map(([t]) => t);
  const useTypes = new Set(rankedTypes.slice(0, 2));

  const deck: CardDef[] = [];
  const copies = new Map<string, number>();
  const add = (d: CardDef, n: number) => {
    for (let i = 0; i < n && deck.length < deckSize; i++) {
      const have = copies.get(d.name) ?? 0;
      if (have >= 4 && !(reactionGame(d) && !reactionGame(d)?.special)) return;
      copies.set(d.name, have + 1);
      deck.push(d);
    }
  };

  // Sticker lines: basics thicker than evolutions, stars as singletons.
  const chosen = stickers
    .filter((d) => useTypes.has(stickerGame(d)!.type) || stickerGame(d)!.type === 'Neutral')
    .sort((a, b) => stickerGame(a)!.stageIndex - stickerGame(b)!.stageIndex);
  const stickerBudget = Math.round(deckSize * 0.4);
  for (const d of chosen) {
    if (deck.filter((x) => stickerGame(x)).length >= stickerBudget) break;
    const g = stickerGame(d)!;
    add(d, g.star ? 1 : g.stageIndex === 0 ? 3 : 2);
  }

  // Trainers: up to ~25%.
  const trainerBudget = Math.round(deckSize * 0.25);
  for (const d of trainers) {
    if (deck.filter((x) => trainerGame(x)).length >= trainerBudget) break;
    add(d, 2);
  }

  // Fill with basic energy for the types actually in the deck.
  const energyTypes = [...new Set(deck.map((d) => stickerGame(d)?.type).filter((t): t is ReactionType => !!t && basicEnergy.has(t)))];
  let i = 0;
  while (deck.length < deckSize && energyTypes.length > 0) {
    add(basicEnergy.get(energyTypes[i % energyTypes.length])!, 1);
    i += 1;
  }
  // Degenerate pools: pad with whatever exists so the size is legal.
  i = 0;
  while (deck.length < deckSize && pool.length > 0) {
    deck.push(pool[i % pool.length]);
    i += 1;
  }
  return deck;
}
