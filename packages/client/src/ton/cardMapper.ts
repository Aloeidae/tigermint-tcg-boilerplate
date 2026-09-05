import { findEffectKey, findSkillKey, getSkill, padDeck, type CardDef, type CardType, type SkillRef } from '@tcg/shared';
import type { NftItem } from './nfts.js';
import { CONFIG } from '../config.js';

/**
 * NFT -> card mapping. THIS is the file to rewrite for your own collection.
 *
 * The default mapper works with ANY collection: it hashes the NFT's address so
 * the same NFT always becomes the same card, and derives type/cost/stats from
 * that hash. If your collection's metadata carries real game attributes
 * (e.g. trait_type "Attack" / "Health" / "Cost" / "Type"), those win over the
 * hash-derived values — so a purpose-built collection maps 1:1 onto cards.
 *
 * Skills work the same way: a "Skills" (or "Abilities") attribute like
 * "Haste, Armor 2" maps by name onto the skill registry (skills.ts), and NFTs
 * without one get an occasional hash-picked skill so any collection feels
 * alive. Register a new skill and metadata can reference it immediately.
 */

export function nftToCard(nft: NftItem): CardDef {
  const h = fnv1a(nft.address);
  const attr = (name: string): number | undefined => {
    const found = nft.attributes.find((a) => a.trait_type.toLowerCase() === name);
    if (!found) return undefined;
    const n = Number(found.value);
    return Number.isFinite(n) ? n : undefined;
  };
  const attrText = (name: string): string | undefined => {
    const found = nft.attributes.find((a) => a.trait_type.toLowerCase() === name);
    return found ? String(found.value).toLowerCase() : undefined;
  };
  const attrRaw = (name: string): string | undefined => {
    const found = nft.attributes.find((a) => a.trait_type.toLowerCase() === name);
    return found ? String(found.value) : undefined;
  };

  // Card name: a "Card Name" attribute wins over the NFT's own name. Some
  // launchpads (TigerMint's bulk-import path included) number items
  // "Collection #N" and drop custom names — a Card Name trait survives.
  const cardName = attrRaw('card name') ?? nft.name;

  // Type: metadata attribute first, else hash bucket (70% creature / 15% equipment / 15% spell).
  let type: CardType;
  const declaredType = attrText('type') ?? attrText('card type');
  if (declaredType === 'creature' || declaredType === 'equipment' || declaredType === 'spell') {
    type = declaredType;
  } else {
    const bucket = h % 20;
    type = bucket < 14 ? 'creature' : bucket < 17 ? 'equipment' : 'spell';
  }

  const cost = clamp(attr('cost') ?? 1 + ((h >>> 4) % 6), 1, 10);

  // Card style: a "Card Style" attribute ("full art" / "framed") wins over
  // the game-wide default. Full-art NFTs are complete card designs — the
  // client renders the image as the whole card.
  const styleAttr = attrText('card style') ?? attrText('style');
  const fullArt = styleAttr ? /full/.test(styleAttr) : CONFIG.cardStyle === 'fullart';

  const base: CardDef = {
    id: nft.address,
    name: cardName,
    type,
    cost,
    art: nft.image,
    fullArt: fullArt || undefined,
    // Minted items carry a "Rarity" trait (appended by TigerMint).
    rarity: attrRaw('rarity')?.toUpperCase(),
  };

  if (type === 'creature') {
    // Spend a stat budget driven by cost, split by another hash slice.
    const budget = cost * 2 + 1;
    const attackShare = 1 + ((h >>> 9) % (budget - 1));
    return {
      ...base,
      attack: clamp(attr('attack') ?? attackShare, 0, 99),
      health: clamp(attr('health') ?? Math.max(1, budget - attackShare), 1, 99),
      skills: skillsFor(nft, h, 'creature', fullArt),
    };
  }

  if (type === 'equipment') {
    const budget = cost + 1;
    const atkBonus = (h >>> 9) % (budget + 1);
    return {
      ...base,
      attackBonus: attr('attack') ?? atkBonus,
      healthBonus: attr('health') ?? budget - atkBonus,
      skills: skillsFor(nft, h, 'equipment', fullArt),
      text: 'Attach to a friendly creature.',
    };
  }

  // Spell: a "Spell Effect" attribute (e.g. "damage 3", "aoe damage 2",
  // "draw 2") wins — matched against the effect registry by name — so a
  // purpose-built collection's spells always do what their art says.
  const declaredEffect = attrText('spell effect') ?? attrText('effect');
  if (declaredEffect) {
    const match = declaredEffect.match(/^(.*?)\s*(\d+)?$/);
    const key = match && match[1] ? findEffectKey(match[1]) : null;
    if (key) {
      return { ...base, effect: { key, amount: match![2] ? Number(match![2]) : 1 } };
    }
  }

  // No declared effect: pick one of the built-in effects, scaled to cost.
  const spellKind = (h >>> 13) % 4;
  const effect =
    spellKind === 0
      ? { key: 'damage', amount: cost + 1 }
      : spellKind === 1
        ? { key: 'heal', amount: cost + 2 }
        : spellKind === 2
          ? { key: 'draw', amount: Math.max(1, Math.floor(cost / 2)) }
          : { key: 'buffAttack', amount: cost + 1 };
  return { ...base, effect };
}

/**
 * Skills for an NFT card. Metadata wins: a "Skills"/"Abilities" attribute like
 * "Haste, Armor 2" is parsed against the skill registry by key or display
 * name (renames via configureSkill() are matched too). Without metadata,
 * ~40% of creatures (and ~20% of equipment) get one hash-picked skill so any
 * collection plays with abilities out of the box — EXCEPT full-art cards:
 * their abilities are painted into the art, so only declared metadata counts
 * (a random skill the art doesn't show would lie to the player).
 */
function skillsFor(nft: NftItem, h: number, type: 'creature' | 'equipment', fullArt = false): SkillRef[] | undefined {
  const declared = nft.attributes.find((a) =>
    ['skill', 'skills', 'ability', 'abilities'].includes(a.trait_type.toLowerCase())
  );
  if (declared) {
    const refs: SkillRef[] = [];
    for (const part of String(declared.value).split(/[,;/]+/)) {
      // Each entry is "Name" or "Name 2" (trailing number = the skill's value).
      const match = part.trim().match(/^(.*?)\s*(\d+)?$/);
      if (!match || !match[1]) continue;
      const key = findSkillKey(match[1]);
      if (key) refs.push(match[2] ? { key, value: Number(match[2]) } : { key });
    }
    if (refs.length > 0) return refs;
  }

  // Full-art cards get skills only from metadata — never from the hash.
  if (fullArt) return undefined;

  // Hash fallback.
  const creaturePool = ['haste', 'guard', 'firstStrike', 'lifelink', 'armor', 'deathtouch', 'regenerate'];
  const equipmentPool = ['haste', 'firstStrike', 'lifelink'];
  const pool = type === 'creature' ? creaturePool : equipmentPool;
  const chance = type === 'creature' ? 4 : 2; // out of 10
  if ((h >>> 16) % 10 >= chance) return undefined;
  const key = pool[(h >>> 20) % pool.length];
  if (!getSkill(key)) return undefined;
  const needsValue = key === 'armor' || key === 'regenerate';
  return [needsValue ? { key, value: 1 + ((h >>> 23) % 2) } : { key }];
}

/**
 * Give an NFT card its pokemon-mode definition by matching it against the
 * local pack (the generator's pack.json ships a full `game` block per card).
 * Minted metadata stays lean; the pack manifest is the game-rules source of
 * truth, matched by card name (a "Card Name" trait survives launchpad
 * renaming) or id.
 */
export function withGameBlock(card: CardDef, pack: { cards: CardDef[] } | null | undefined): CardDef {
  if (card.game || !pack) return card;
  const match = pack.cards.find((p) => p.game && (p.id === card.id || p.name === card.name));
  return match ? { ...card, game: match.game } : card;
}

/**
 * Build a playable deck: every owned NFT joins once, and the rest of the deck
 * fills from the standard deck (your pack.json, or the demo catalog). That's
 * the recommended shape for a game: players can play day one on the standard
 * deck and mint booster pulls as they go — each pull adds a card, it never
 * has to replace a whole deck.
 */
export function buildDeckFromNfts(nfts: NftItem[], standard?: CardDef[]): CardDef[] {
  const deck: CardDef[] = nfts.map(nftToCard).slice(0, 30);
  if (standard && standard.length > 0) {
    for (let i = 0; deck.length < 30; i++) deck.push(standard[i % standard.length]);
  }
  return padDeck(deck);
}

function fnv1a(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, Math.round(n)));
}
