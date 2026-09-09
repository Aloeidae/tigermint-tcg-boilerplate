import {
  DECK_SIZE, findEffectKey, findSkillKey, isOverlayLayout,
  type CardDef, type GameBlock, type OverlayLayout, type SkillRef,
} from '@tcg/shared';
import { CONFIG } from './config.js';
import { setPackOverlayLayout } from './overlayConfig.js';

/**
 * Local card pack loader — play your custom cards BEFORE minting them.
 *
 * Drop your card images plus a `pack.json` manifest into
 * `packages/client/public/pack/`. If the manifest exists, it replaces the
 * demo deck whenever no wallet is connected (a connected wallet's NFTs still
 * win). A worked example ships as `pack.example.json` in that folder — copy
 * it to `pack.json` and make it yours. The manifest is friendly to
 * hand-writing:
 *
 * {
 *   "name": "My Pack",
 *   "cards": [
 *     {
 *       "name": "Cinder Kit",
 *       "type": "creature",            // creature | equipment | spell
 *       "cost": 1, "attack": 2, "health": 1,
 *       "skills": ["Haste"],           // names or "Armor 2" style, matched
 *                                      // against the skill registry
 *       "effect": "damage 3",          // spells: effect name + amount
 *       "art": "cinder-kit.jpeg",      // file in this same folder
 *       "fullArt": true,                // image IS the card (default true)
 *       "description": "Flavor text.",  // optional, <=500 chars on TigerMint
 *       "editions": 4                   // optional print run when minted;
 *                                       // rarity-tier defaults when absent
 *     }
 *   ]
 * }
 *
 * For equipment, `attack`/`health` are read as the +X/+Y bonuses.
 * This mirrors the NFT metadata schema, so a pack that plays well locally
 * mints 1:1 (see cardMapper.ts).
 */

interface PackCardJson {
  id?: string;
  name?: string;
  type?: string;
  cost?: number;
  attack?: number;
  health?: number;
  skills?: (string | SkillRef)[];
  effect?: string | { key: string; amount?: number };
  text?: string;
  /** Flavor text; used as the card's text locally, minted as the item description. */
  description?: string;
  art?: string;
  fullArt?: boolean;
  /**
   * Card style: 'framed' | 'fullart' | 'overlay'. Wins over `fullArt`.
   * 'overlay' composites name/stats/text over the full-bleed image at the
   * layout's positions (see the manifest-level `layout` block).
   */
  style?: string;
  /** Per-card overlay-layout override (see shared/src/overlay.ts). */
  layout?: unknown;
  rarity?: string;
  /**
   * Is this card part of the basic (free) deck? Defaults by rarity: COMMON
   * or unset = basic; RARE/EPIC/LEGENDARY = mint-only (players must own the
   * NFT to play it). Set explicitly to override either way.
   */
  basic?: boolean;
  /** Print run when minted (TigerMint editions). Ignored for local play. */
  editions?: number;
  copies?: number;
  /**
   * Pocket-mode definition (League presets) — passed through verbatim.
   * The card-set generator writes these; see shared/src/pocket/types.ts.
   */
  game?: GameBlock;
  /**
   * Display traits TigerMint mints verbatim (Card ID, Stage, HP, Move 1…).
   * The game ignores them locally — minted NFTs match back to this card via
   * their "Card ID" trait instead. (TigerMint appends "Rarity" on its own,
   * so manifests should not include that trait_type here.)
   */
  attributes?: { trait_type: string; value: string | number }[];
}

export interface LocalPack {
  name: string;
  /** Every card in the set (galleries, demo pulls, the mint manifest). */
  cards: CardDef[];
  /** The freely playable subset — what fills decks without owning NFTs. */
  basicCards: CardDef[];
  /** The set's overlay-style layout (manifest top-level `layout` block). */
  layout?: OverlayLayout;
}

export async function loadLocalPack(): Promise<LocalPack | null> {
  const local = await fetchPack('/pack/pack.json', 'Custom pack', false);
  if (local) {
    setPackOverlayLayout(local.layout ?? null);
    return local;
  }

  // No local pack: TigerMint pins the pack.json a card set was launched from
  // and serves it byte-for-byte at /api/v1/collections/{slug}/pack.json
  // (public, CORS) — so configured slugs hydrate the full card set, `game`
  // blocks included, with nothing bundled in the client. Multiple slugs
  // merge into one pool (multi-pack boosters).
  const urls =
    CONFIG.packManifestUrls.length > 0
      ? CONFIG.packManifestUrls
      : CONFIG.tigermintSlugs.map(
          (slug) => `${CONFIG.tigermintApiBase}/api/v1/collections/${encodeURIComponent(slug)}/pack.json`
        );
  let merged: LocalPack | null = null;
  for (const url of urls) {
    const pack = await fetchPack(url, 'Card set', true);
    if (!pack) continue;
    if (!merged) {
      merged = pack;
    } else {
      const seen = new Set(merged.cards.map((c) => c.id));
      merged.cards.push(...pack.cards.filter((c) => !seen.has(c.id)));
      merged.basicCards.push(...pack.basicCards.filter((c) => !seen.has(c.id)));
      merged.layout ??= pack.layout;
    }
  }
  setPackOverlayLayout(merged?.layout ?? null);
  return merged;
}

async function fetchPack(url: string, fallbackName: string, remote: boolean): Promise<LocalPack | null> {
  try {
    const res = await fetch(url, { cache: 'no-cache' });
    if (!res.ok) return null;
    const data = (await res.json()) as { name?: string; cards?: PackCardJson[]; layout?: unknown };
    if (!Array.isArray(data.cards)) return null;
    const cards: CardDef[] = [];
    const basicCards: CardDef[] = [];
    data.cards.forEach((raw, index) => {
      const card = toCardDef(raw, index, remote);
      if (!card) return;
      cards.push(card);
      if (isBasic(raw)) basicCards.push(card);
    });
    if (cards.length === 0) return null;
    return {
      name: data.name ?? fallbackName,
      cards,
      basicCards,
      layout: isOverlayLayout(data.layout) ? data.layout : undefined,
    };
  } catch {
    return null; // no pack there — that's fine, the demo deck covers it
  }
}

/** Basic (free) unless a rarity above COMMON says otherwise; `basic` overrides. */
function isBasic(raw: PackCardJson): boolean {
  if (typeof raw.basic === 'boolean') return raw.basic;
  const rarity = typeof raw.rarity === 'string' ? raw.rarity.toUpperCase() : '';
  return rarity === '' || rarity === 'COMMON';
}

/**
 * A full deck built purely from the pack's basic (free) cards, cycled to deck
 * size. Mint-only cards never enter a deck this way — they join through the
 * wallet. A pack with no basic cards at all falls back to the full set so the
 * game still runs.
 */
export function packDeck(pack: LocalPack): CardDef[] {
  const pool = pack.basicCards.length > 0 ? pack.basicCards : pack.cards;
  const deck: CardDef[] = [];
  for (let i = 0; deck.length < DECK_SIZE; i++) {
    deck.push(pool[i % pool.length]);
  }
  return deck;
}

function toCardDef(raw: PackCardJson, index: number, remote = false): CardDef | null {
  if (!raw || typeof raw.name !== 'string') return null;
  const type = raw.type === 'creature' || raw.type === 'equipment' || raw.type === 'spell' ? raw.type : 'creature';

  // A manifest fetched from TigerMint references art by bare filename; those
  // files live on IPFS behind the minted items, not under /pack/ — leave the
  // art unset (procedural placeholder) rather than point at a 404. Owned
  // NFTs bring their own image URLs.
  const bareArt = raw.art && !raw.art.startsWith('/') && !/^https?:\/\//.test(raw.art);
  const card: CardDef = {
    id: raw.id ?? `pack-${slug(raw.name)}-${index}`,
    name: raw.name,
    type,
    cost: clamp(raw.cost ?? 1, 1, 20),
    art: raw.art && !(remote && bareArt) ? (bareArt ? `/pack/${raw.art}` : raw.art) : undefined,
    fullArt: raw.fullArt !== false, // packs are full-art by default
    rarity: typeof raw.rarity === 'string' ? raw.rarity.toUpperCase() : undefined,
    text: raw.text ?? raw.description,
    skills: parseSkills(raw.skills),
  };
  if (raw.game && typeof raw.game === 'object' && typeof raw.game.kind === 'string') {
    card.game = raw.game;
  }
  if (typeof raw.style === 'string') {
    const s = raw.style.toLowerCase();
    if (s === 'overlay') card.style = 'overlay';
    else if (s === 'framed') card.style = 'framed';
    else if (s.includes('full')) card.style = 'fullArt';
  }
  if (isOverlayLayout(raw.layout) && raw.layout) card.layout = raw.layout;

  if (type === 'creature') {
    card.attack = clamp(raw.attack ?? 1, 0, 99);
    card.health = clamp(raw.health ?? 1, 1, 99);
  } else if (type === 'equipment') {
    card.attackBonus = clamp(raw.attack ?? 0, 0, 99);
    card.healthBonus = clamp(raw.health ?? 0, 0, 99);
  } else {
    card.effect = parseEffect(raw.effect);
    // A spell with no standard effect can't be played in standard mode, but a
    // pocket-only card (energy without a legacy mapping) is still welcome.
    if (!card.effect && !card.game) return null;
  }
  return card;
}

function parseSkills(skills?: (string | SkillRef)[]): SkillRef[] | undefined {
  if (!Array.isArray(skills)) return undefined;
  const refs: SkillRef[] = [];
  for (const entry of skills) {
    if (typeof entry === 'object' && entry && typeof entry.key === 'string') {
      const key = findSkillKey(entry.key) ?? entry.key;
      refs.push(entry.value !== undefined ? { key, value: entry.value } : { key });
      continue;
    }
    if (typeof entry !== 'string') continue;
    // "Haste" or "Armor 2" — trailing number is the skill's value.
    const match = entry.trim().match(/^(.*?)\s*(\d+)?$/);
    if (!match || !match[1]) continue;
    const key = findSkillKey(match[1]);
    if (key) refs.push(match[2] ? { key, value: Number(match[2]) } : { key });
  }
  return refs.length > 0 ? refs : undefined;
}

function parseEffect(effect?: string | { key: string; amount?: number }): CardDef['effect'] {
  if (!effect) return undefined;
  if (typeof effect === 'object') {
    const key = findEffectKey(effect.key) ?? effect.key;
    return { key, amount: effect.amount };
  }
  // "damage 3", "aoe damage 2", "draw 2"...
  const match = effect.trim().match(/^(.*?)\s*(\d+)?$/);
  if (!match || !match[1]) return undefined;
  const key = findEffectKey(match[1]);
  if (!key) return undefined;
  return { key, amount: match[2] ? Number(match[2]) : 1 };
}

function slug(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, Math.round(Number(n) || 0)));
}
